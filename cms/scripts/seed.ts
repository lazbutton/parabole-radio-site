/**
 * Le jeu d'exemples (seed/exemples.ts), clairement marqués comme tels.
 *
 *   npm run db:seed                  remplace les exemples de la base locale (PGlite) par un jeu neuf
 *   npm run db:seed -- --supprimer   retire tous les exemples, et rien d'autre
 *   npm run db:seed -- --distant     sur la base de DATABASE_URL (Supabase), déjà migrée
 */
import { connect } from "../src/db.ts";
import { removeExamples, seedExamples } from "../seed/exemples.ts";

// Les variables de cms/.env, s'il existe (DATABASE_URL).
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {}

const args = new Set(process.argv.slice(2));
const { db, kind, close } = await connect();
try {
  if (kind === "supabase" && !args.has("--distant")) {
    console.error("DATABASE_URL vise une base distante. Pour y écrire les exemples quand même : npm run db:seed -- --distant");
    process.exitCode = 1;
  } else if (args.has("--supprimer")) {
    await removeExamples(db);
    console.log("Exemples retirés.");
  } else {
    const summary = await seedExamples(db);
    console.log(
      `Exemples écrits : ${summary.shows} shows (${summary.tracks} morceaux), ${summary.artists} artistes, ${summary.events} événements, ` +
        `${summary.tags} étiquettes, ${summary.pages} pages, ${summary.media} fichiers.`,
    );
  }
} finally {
  await close();
}
