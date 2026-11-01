import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { eq, is, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { countExamples, removeExamples, seedExamples } from "../seed/exemples.ts";
import { connect, MIGRATIONS_FOLDER } from "../src/db.ts";
import * as schema from "../src/schema.ts";
import { freshDb, NOW, ON_SERVER, rowsOf } from "./helpers.ts";

const CMS_DIR = fileURLToPath(new URL("..", import.meta.url));
// drizzle-kit est installé à la racine de l'espace de travail npm : Node le trouve en remontant les dossiers.
const DRIZZLE_KIT = join(dirname(createRequire(import.meta.url).resolve("drizzle-kit")), "bin.cjs");
const TABLES = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));

const rows = rowsOf;

describe("migrations", () => {
  it("s'appliquent sur une base vide : tables, recherche française, règles d'accès partout", async () => {
    const { db, close } = await freshDb();
    try {
      const tables = rows<{ name: string; rls: boolean; policies: number }>(
        await db.execute(sql`select c.relname as name, c.relrowsecurity as rls, (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
          from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`),
      );
      expect(tables.map((table) => table.name)).toEqual(TABLES.map((table) => getTableConfig(table).name).sort());
      // Aucune table publique sans sécurité par ligne, ni sans règle.
      expect(tables.filter((table) => !table.rls || table.policies === 0)).toEqual([]);
      const [config] = rows<{ vector: string }>(await db.execute(sql`select to_tsvector('public.french_unaccent', 'Éloïse : musiques électroniques')::text as vector`));
      expect(config!.vector).toBe("'electron':3 'elois':1 'musiqu':2");
      const applied = rows<{ n: number }>(await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`));
      expect(applied[0]!.n).toBe(readdirSync(MIGRATIONS_FOLDER).filter((file) => file.endsWith(".sql")).length);
    } finally {
      await close();
    }
  });

  it("rejouées, ne changent rien", async () => {
    const { db, migrate, close } = await freshDb();
    try {
      await migrate();
      await migrate();
      const applied = rows<{ n: number }>(await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`));
      expect(applied[0]!.n).toBe(3);
    } finally {
      await close();
    }
  });

  it("donnent les colonnes que décrit le schéma Drizzle", async () => {
    const { db, close } = await freshDb();
    try {
      const columns = rows<{ table_name: string; column_name: string; is_nullable: string }>(
        await db.execute(sql`select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'`),
      );
      for (const table of TABLES) {
        const config = getTableConfig(table);
        const actual = columns.filter((column) => column.table_name === config.name);
        expect(actual.map((column) => column.column_name).sort(), config.name).toEqual(config.columns.map((column) => column.name).sort());
        for (const column of config.columns) {
          const found = actual.find((candidate) => candidate.column_name === column.name)!;
          expect(found.is_nullable === "NO", `${config.name}.${column.name}`).toBe(column.notNull || column.primary);
        }
      }
    } finally {
      await close();
    }
  });

  it("sont à jour : drizzle-kit n'a rien de plus à tirer du schéma", () => {
    const out = mkdtempSync(join(tmpdir(), "parabole-cms-drizzle-"));
    try {
      cpSync(MIGRATIONS_FOLDER, out, { recursive: true });
      const before = readdirSync(out).length;
      // drizzle-kit veut un dossier de sortie relatif.
      const run = spawnSync(process.execPath, [DRIZZLE_KIT, "generate", "--dialect=postgresql", "--schema=./src/schema.ts", `--out=${relative(CMS_DIR, out)}`], {
        cwd: CMS_DIR,
        encoding: "utf8",
      });
      expect(run.status, run.stderr).toBe(0);
      expect(`${run.stdout}${run.stderr}`).toContain("No schema changes");
      expect(readdirSync(out)).toHaveLength(before);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("seed", () => {
  it("passe, se rejoue sans doublon et se retire sans toucher au reste", async () => {
    const { db, close } = await freshDb();
    try {
      // Un vrai contenu, saisi par l'équipe : le seed ne doit jamais y toucher.
      await db.insert(schema.page).values({ slug: "a-propos", title: "À propos", body: "Le vrai texte.", status: "published" });
      const first = await seedExamples(db, { now: NOW });
      expect(first).toEqual({ media: 15, tags: 11, artists: 8, shows: 9, tracks: 16, events: 7, pages: 2 });
      await seedExamples(db, { now: NOW });
      expect(await countExamples(db)).toEqual({ shows: 9, artists: 8, events: 7, pages: 2, tags: 11, media: 15 });
      await removeExamples(db);
      expect(await countExamples(db)).toEqual({ shows: 0, artists: 0, events: 0, pages: 0, tags: 0, media: 0 });
      const left = rows<{ n: number }>(await db.execute(sql`select (select count(*) from track) + (select count(*) from show_tag) + (select count(*) from event_photo) as n`));
      expect(Number(left[0]!.n)).toBe(0);
      const [real] = await db.select().from(schema.page).where(eq(schema.page.slug, "a-propos"));
      expect(real?.body).toBe("Le vrai texte.");
    } finally {
      await close();
    }
  });

  it("marque tout comme exemple", async () => {
    const { db, close } = await freshDb();
    try {
      await seedExamples(db, { now: NOW });
      const unmarked = rows<{ what: string }>(
        await db.execute(sql`select 'show ' || slug as what from show where title not like '%(exemple)' or slug not like 'exemple-%'
          union all select 'artist ' || slug from artist where name not like '%(exemple)' or slug not like 'exemple-%'
          union all select 'event ' || slug from event where title not like '%(exemple)' or slug not like 'exemple-%'
          union all select 'page ' || slug from page where title not like '%(exemple)' or slug not like 'exemple-%'
          union all select 'tag ' || slug from tag where name not like '%(exemple)' or slug not like 'exemple-%'
          union all select 'media ' || key from media where key not like 'exemples/%' or alt not like '%exemple%'`),
      );
      expect(unmarked).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe.skipIf(ON_SERVER)("base locale (PGlite)", () => {
  it("garde ses données d'une ouverture à l'autre", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "parabole-cms-pglite-"));
    try {
      const first = await connect({ dataDir });
      await seedExamples(first.db, { now: NOW });
      await first.close();
      const again = await connect({ dataDir });
      expect((await countExamples(again.db)).shows).toBe(9);
      await again.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
