/**
 * Les règles d'accès (drizzle/0002_acces.sql), essayées sous des rôles simulés comme ceux de Supabase : le public
 * (anon), un compte sans fiche d'équipe, un éditeur, un admin.
 */
import { eq, sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withViewer, type Tx, type Viewer } from "../src/access.ts";
import type { Connection, Db } from "../src/db.ts";
import { facet, member, media, page, show, tag, tagGroup, tagMember, track } from "../src/schema.ts";
import { createAccount, exampleDb, pgError, rowsOf } from "./helpers.ts";

let connection: Connection;
let db: Db;
let editorId: string;
let adminId: string;
let strangerId: string;

beforeAll(async () => {
  connection = await exampleDb();
  db = connection.db;
  adminId = await createAccount(db, "admin");
  editorId = await createAccount(db, "editor");
  // Un compte Supabase Auth sans fiche dans « member » : il ne devrait pas exister (inscriptions fermées), mais s'il
  // existe, il n'a pas plus de droits que le public.
  strangerId = await createAccount(db);
});
afterAll(() => connection.close());

const PUBLIC: Viewer = { role: "anon" };
const stranger = (): Viewer => ({ role: "authenticated", userId: strangerId });
const editor = (): Viewer => ({ role: "authenticated", userId: editorId });
const admin = (): Viewer => ({ role: "authenticated", userId: adminId });

/** Fait les écritures sous ce rôle, rend leur résultat, puis annule tout : la base des tests reste celle du seed. */
async function thenUndo<T>(viewer: Viewer, run: (tx: Tx) => Promise<T>): Promise<T> {
  let result!: T;
  await withViewer(db, viewer, async (tx) => {
    result = await run(tx);
    tx.rollback();
  }).catch((error) => {
    if (!(error instanceof TransactionRollbackError)) throw error;
  });
  return result;
}

/** Le nombre de lignes de chaque table visibles sous ce rôle. */
async function visible(viewer: Viewer, tables: string[]): Promise<Record<string, number>> {
  return withViewer(db, viewer, async (tx) => {
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const [row] = rowsOf<{ n: number }>(await tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`));
      counts[table] = Number(row!.n);
    }
    return counts;
  });
}

const CONTENT = [
  ...["show", "artist", "event", "page", "tag", "track", "show_artist", "show_tag", "event_artist", "event_photo", "media"],
  ...["facet", "tag_group", "tag_member", "artist_tag", "event_tag"],
];

/** Ce que le public doit voir, compté par le propriétaire des tables avec des requêtes indépendantes des règles. */
async function expectedPublic(): Promise<Record<string, number>> {
  const rows = await db.execute(sql`select
    (select count(*) from show where status = 'published')::int as show,
    (select count(*) from artist where status = 'published')::int as artist,
    (select count(*) from event where status = 'published')::int as event,
    (select count(*) from page where status = 'published')::int as page,
    (select count(*) from tag)::int as tag,
    (select count(*) from track t join show s on s.id = t.show_id where s.status = 'published')::int as track,
    (select count(*) from show_artist sa join show s on s.id = sa.show_id join artist a on a.id = sa.artist_id where s.status = 'published' and a.status = 'published')::int as show_artist,
    (select count(*) from show_tag st join show s on s.id = st.show_id where s.status = 'published')::int as show_tag,
    (select count(*) from event_artist ea join event e on e.id = ea.event_id join artist a on a.id = ea.artist_id where e.status = 'published' and a.status = 'published')::int as event_artist,
    (select count(*) from event_photo p join event e on e.id = p.event_id where e.status = 'published')::int as event_photo,
    (select count(*) from facet)::int as facet,
    (select count(*) from tag_group)::int as tag_group,
    (select count(*) from tag_member)::int as tag_member,
    (select count(*) from artist_tag ag join artist a on a.id = ag.artist_id where a.status = 'published')::int as artist_tag,
    (select count(*) from event_tag et join event e on e.id = et.event_id where e.status = 'published')::int as event_tag`);
  return rowsOf<Record<string, number>>(rows)[0]!;
}

describe("le public (anon)", () => {
  it("ne voit que le publié, et ce qui dépend d'un contenu publié", async () => {
    const seen = await visible(PUBLIC, CONTENT);
    const { media: _media, ...rest } = seen;
    expect(rest).toEqual(await expectedPublic());
    // Les pages : l'exemple publié, et les mentions légales posées par la migration (0015_a_propos_acces.sql).
    expect(seen).toMatchObject({ show: 8, artist: 7, event: 6, page: 2, track: 15, facet: 5, tag_group: 30, tag_member: 327 });
  });

  it("ne voit que les fichiers d'un contenu publié", async () => {
    const keys = await withViewer(db, PUBLIC, (tx) => tx.select({ key: media.key }).from(media));
    const all = await db.select({ key: media.key }).from(media);
    expect(keys).toHaveLength(12);
    const hidden = all.map((file) => file.key).filter((key) => !keys.some((file) => file.key === key));
    expect(hidden.sort()).toEqual(["exemples/fichier-pas-encore-utilise.webp", "exemples/pochette-brouillon.webp", "exemples/portrait-ana-brouillon.webp"]);
  });

  it("ne voit pas l'équipe", async () => {
    expect(await pgError(withViewer(db, PUBLIC, (tx) => tx.select().from(member)))).toMatchObject({ code: "42501", message: expect.stringContaining("permission denied") });
  });

  it("n'écrit rien, nulle part", async () => {
    const insert = await pgError(withViewer(db, PUBLIC, (tx) => tx.insert(show).values({ slug: "intrus", title: "Intrus", type: "dj_set" })));
    expect(insert).toMatchObject({ code: "42501", message: expect.stringContaining("permission denied") });
    const update = await pgError(withViewer(db, PUBLIC, (tx) => tx.update(show).set({ title: "Piraté" })));
    expect(update.code).toBe("42501");
    const remove = await pgError(withViewer(db, PUBLIC, (tx) => tx.delete(track)));
    expect(remove.code).toBe("42501");
    const truncate = await pgError(withViewer(db, PUBLIC, (tx) => tx.execute(sql`truncate show cascade`)));
    expect(truncate.code).toBe("42501");
    const join = await pgError(withViewer(db, PUBLIC, (tx) => tx.insert(member).values({ userId: strangerId, email: "x@exemple.test", name: "X", role: "admin" })));
    expect(join.code).toBe("42501");
  });
});

describe("un compte sans fiche d'équipe", () => {
  it("voit ce que voit le public", async () => {
    expect(await visible(stranger(), CONTENT)).toEqual(await visible(PUBLIC, CONTENT));
    expect((await visible(stranger(), ["member"])).member).toBe(0);
  });

  it("n'écrit rien : la sécurité par ligne refuse ou ne trouve rien", async () => {
    const insert = await pgError(withViewer(db, stranger(), (tx) => tx.insert(show).values({ slug: "intrus", title: "Intrus", type: "dj_set" })));
    expect(insert).toMatchObject({ code: "42501", message: expect.stringContaining("row-level security") });
    const updated = await thenUndo(stranger(), (tx) => tx.update(show).set({ title: "Piraté" }).returning({ id: show.id }));
    expect(updated).toHaveLength(0);
    const deleted = await thenUndo(stranger(), (tx) => tx.delete(page).returning({ id: page.id }));
    expect(deleted).toHaveLength(0);
    // Se nommer admin soi-même : refusé.
    const promoted = await pgError(withViewer(db, stranger(), (tx) => tx.insert(member).values({ userId: strangerId, email: "moi@exemple.test", name: "Moi", role: "admin" })));
    expect(promoted.message).toContain("row-level security");
  });
});

describe("un éditeur", () => {
  it("voit tout, brouillons compris", async () => {
    const all = await visible({ role: "authenticated", userId: editorId }, CONTENT);
    expect(all).toMatchObject({ show: 9, artist: 8, event: 7, page: 3, media: 15, track: 16 });
  });

  it("crée, modifie et supprime des contenus", async () => {
    const result = await thenUndo(editor(), async (tx) => {
      const [created] = await tx.insert(show).values({ slug: "nouveau-show", title: "Nouveau show", type: "podcast" }).returning();
      await tx.insert(track).values([
        { showId: created!.id, position: 1, artist: "A", title: "Un" },
        { showId: created!.id, position: 2, artist: "B", title: "Deux" },
      ]);
      const [published] = await tx
        .update(show)
        .set({ status: "published", broadcastAt: new Date("2026-06-01T18:00:00Z") })
        .where(eq(show.id, created!.id))
        .returning({ status: show.status });
      const removed = await tx.delete(page).where(eq(page.slug, "exemple-page-brouillon")).returning({ slug: page.slug });
      return { published, removed };
    });
    expect(result.published?.status).toBe("published");
    expect(result.removed).toEqual([{ slug: "exemple-page-brouillon" }]);
  });

  it("rend public le fichier d'un brouillon en le publiant", async () => {
    const cover = await thenUndo(editor(), async (tx) => {
      await tx.update(show).set({ status: "published" }).where(eq(show.slug, "exemple-set-non-publie"));
      // Toujours dans la transaction, le public verrait maintenant la pochette.
      await tx.execute(sql`select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      return tx.select({ key: media.key }).from(media).where(eq(media.key, "exemples/pochette-brouillon.webp"));
    });
    expect(cover).toEqual([{ key: "exemples/pochette-brouillon.webp" }]);
  });

  it("voit l'équipe mais ne la gère pas", async () => {
    expect((await visible(editor(), ["member"])).member).toBeGreaterThanOrEqual(2);
    const insert = await pgError(withViewer(db, editor(), (tx) => tx.insert(member).values({ userId: strangerId, email: "nouveau@exemple.test", name: "Nouveau", role: "editor" })));
    expect(insert.message).toContain("row-level security");
    // Se promouvoir admin, ou retirer l'admin : aucune ligne touchée.
    const promoted = await thenUndo(editor(), (tx) => tx.update(member).set({ role: "admin" }).where(eq(member.userId, editorId)).returning());
    expect(promoted).toHaveLength(0);
    const removed = await thenUndo(editor(), (tx) => tx.delete(member).where(eq(member.userId, adminId)).returning());
    expect(removed).toHaveLength(0);
  });

  it("respecte les contraintes du modèle", async () => {
    // Publier sans date de diffusion, un slug mal formé, un lien Hopper étranger, une durée nulle : refusés.
    const noDate = await pgError(withViewer(db, editor(), (tx) => tx.insert(show).values({ slug: "sans-date", title: "Sans date", type: "dj_set", status: "published" })));
    expect(noDate).toMatchObject({ code: "23514", message: expect.stringContaining("show_published_has_date") });
    const badSlug = await pgError(withViewer(db, editor(), (tx) => tx.insert(show).values({ slug: "Mauvais Slug", title: "x", type: "dj_set" })));
    expect(badSlug.message).toContain("show_slug_format");
    const [anyShow] = await db.select({ id: show.id }).from(show).limit(1);
    const badLink = await pgError(withViewer(db, editor(), (tx) => tx.insert(track).values({ showId: anyShow!.id, position: 99, artist: "A", title: "B", hopperUrl: "https://example.com/x" })));
    expect(badLink.message).toContain("track_hopper_url");
    const badDuration = await pgError(withViewer(db, editor(), (tx) => tx.update(show).set({ durationSeconds: 0 }).where(eq(show.id, anyShow!.id))));
    expect(badDuration.message).toContain("show_duration");
  });

  it("met à jour la date de modification, quel que soit le chemin de l'écriture", async () => {
    const [before] = await db.select({ updatedAt: show.updatedAt }).from(show).where(eq(show.slug, "exemple-matin-calme"));
    const [after] = await thenUndo(editor(), (tx) => tx.update(show).set({ title: "Matin très calme (exemple)" }).where(eq(show.slug, "exemple-matin-calme")).returning({ updatedAt: show.updatedAt }));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });
});

describe("les étiquettes et les filtres", () => {
  it("sont publics ; le public n'y écrit rien", async () => {
    const insert = await pgError(withViewer(db, PUBLIC, (tx) => tx.insert(facet).values({ slug: "intrus", name: "Intrus", scope: "show", position: 9 })));
    expect(insert).toMatchObject({ code: "42501", message: expect.stringContaining("permission denied") });
    const remove = await pgError(withViewer(db, PUBLIC, (tx) => tx.delete(tagMember)));
    expect(remove.code).toBe("42501");
    const sneak = await pgError(withViewer(db, stranger(), (tx) => tx.insert(facet).values({ slug: "intrus", name: "Intrus", scope: "show", position: 9 })));
    expect(sneak).toMatchObject({ code: "42501", message: expect.stringContaining("row-level security") });
    const moved = await thenUndo(stranger(), (tx) => tx.update(tagGroup).set({ position: 99 }).returning({ id: tagGroup.tagId }));
    expect(moved).toHaveLength(0);
  });

  it("se rangent par l'équipe : un filtre, un groupe, une étiquette dans ce groupe", async () => {
    const result = await thenUndo(editor(), async (tx) => {
      const [made] = await tx.insert(facet).values({ slug: "langue", name: "Langue", scope: "show", showTypes: ["podcast"], position: 6 }).returning({ id: facet.id });
      const [group] = await tx.insert(tag).values({ name: "Langues d'Afrique", slug: "langues-d-afrique" }).returning({ id: tag.id });
      const [wolof] = await tx.insert(tag).values({ name: "Wolof", slug: "wolof" }).returning({ id: tag.id });
      await tx.insert(tagGroup).values({ facetId: made!.id, tagId: group!.id, position: 1 });
      return tx.insert(tagMember).values({ facetId: made!.id, groupId: group!.id, tagId: wolof!.id }).returning();
    });
    expect(result).toHaveLength(1);
  });

  it("gardent leurs places en ordre : un groupe dans son filtre, une étiquette hors d'elle-même", async () => {
    const [genre] = await db.select({ id: facet.id }).from(facet).where(eq(facet.slug, "genre"));
    const [club] = await db.select({ id: tag.id }).from(tag).where(eq(tag.slug, "club"));
    const [caraibes] = await db.select({ id: tag.id }).from(tag).where(eq(tag.slug, "caraibes"));
    // Caraïbes n'est pas un groupe de Genre : on n'y range rien.
    const orphan = await pgError(withViewer(db, editor(), (tx) => tx.insert(tagMember).values({ facetId: genre!.id, groupId: caraibes!.id, tagId: club!.id })));
    expect(orphan.code).toBe("23503");
    const itself = await pgError(withViewer(db, editor(), (tx) => tx.insert(tagMember).values({ facetId: genre!.id, groupId: club!.id, tagId: club!.id })));
    expect(itself.code).toBe("23514");
  });
});

describe("un admin", () => {
  it("ajoute, modifie et retire des membres", async () => {
    const newcomer = await createAccount(db);
    const result = await thenUndo(admin(), async (tx) => {
      await tx.insert(member).values({ userId: newcomer, email: "recrue@exemple.test", name: "Recrue", role: "editor" });
      const [promoted] = await tx.update(member).set({ role: "admin" }).where(eq(member.userId, newcomer)).returning({ role: member.role });
      const removed = await tx.delete(member).where(eq(member.userId, newcomer)).returning({ email: member.email });
      return { promoted, removed };
    });
    expect(result).toEqual({ promoted: { role: "admin" }, removed: [{ email: "recrue@exemple.test" }] });
  });

  it("ne peut pas laisser l'équipe sans admin", async () => {
    const demoted = await pgError(withViewer(db, admin(), (tx) => tx.update(member).set({ role: "editor" }).where(eq(member.userId, adminId))));
    expect(demoted).toMatchObject({ code: "23514", message: "L'équipe doit garder au moins un admin." });
    const removed = await pgError(withViewer(db, admin(), (tx) => tx.delete(member).where(eq(member.userId, adminId))));
    expect(removed.code).toBe("23514");
    // Le compte supprimé dans Supabase Auth emporte sa fiche : refusé aussi pour le dernier admin.
    const account = await pgError(db.execute(sql`delete from auth.users where id = ${adminId}`));
    expect(account.code).toBe("23514");
  });

  it("peut céder sa place après avoir nommé un autre admin", async () => {
    const successor = await createAccount(db, "editor");
    await withViewer(db, admin(), async (tx) => {
      await tx.update(member).set({ role: "admin" }).where(eq(member.userId, successor));
      await tx.update(member).set({ role: "editor" }).where(eq(member.userId, adminId));
    });
    const roles = await db.select({ userId: member.userId, role: member.role }).from(member);
    expect(roles.find((row) => row.userId === successor)?.role).toBe("admin");
    expect(roles.find((row) => row.userId === adminId)?.role).toBe("editor");
    // L'ancien admin, devenu éditeur, ne gère plus l'équipe.
    const attempt = await thenUndo(admin(), (tx) => tx.update(member).set({ role: "admin" }).where(eq(member.userId, adminId)).returning());
    expect(attempt).toHaveLength(0);
  });
});

describe("les rôles de Supabase", () => {
  it("rendent la connexion à son propriétaire après chaque transaction", async () => {
    await withViewer(db, PUBLIC, (tx) => tx.execute(sql`select 1`));
    const [row] = rowsOf<{ role: string; uid: string | null }>(await db.execute(sql`select current_user as role, auth.uid() as uid`));
    expect(row).toEqual({ role: "postgres", uid: null });
  });

  it("valent aussi avec l'ancien auth.uid() de Supabase, qui ne lit que request.jwt.claim.sub", async () => {
    const modern = rowsOf<{ definition: string }>(await db.execute(sql`select pg_get_functiondef('auth.uid()'::regprocedure) as definition`))[0]!.definition;
    await db.execute(sql`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$`);
    try {
      expect((await visible(editor(), ["show"])).show).toBe(9);
      expect((await visible(PUBLIC, ["show"])).show).toBe(8);
    } finally {
      await db.execute(sql.raw(modern));
    }
  });

  it("refusent un identifiant de compte mal formé", async () => {
    await expect(withViewer(db, { role: "authenticated", userId: "' or 1=1 --" }, (tx) => tx.execute(sql`select 1`))).rejects.toThrow("Identifiant de compte invalide");
  });
});
