// @ts-check
import { defineConfig, envField } from "astro/config";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import { fileURLToPath } from "node:url";

export default defineConfig({
  site: "https://parabole-radio-site.vercel.app",
  // Les pages sont statiques (générées au build) ; seules les routes de src/pages/api/ tournent sur Vercel, dans une
  // fonction. maxDuration : Hopper peut mettre jusqu'à 25 s à répondre (src/pages/api/hopper.ts).
  adapter: vercel({ maxDuration: 30 }),
  // React, pour les écrans de travail de l'admin seulement (Radix Themes, src/components/admin/) : le site public n'en
  // charge rien.
  integrations: [react()],
  // Navigation sans rechargement (ClientRouter, src/layouts/Base.astro) : une page survolée est chargée d'avance.
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  // Le tsconfig du projet, nommé : sans lui, Vite le cherche en remontant les dossiers, et une copie du projet rangée
  // dans un autre (les worktrees de .claude/worktrees/) tombe sur celui du dossier parent. Aussi pour l'analyse des
  // dépendances du serveur de développement, qui a ses propres réglages.
  vite: { tsconfig: "./tsconfig.json", optimizeDeps: { rolldownOptions: { tsconfig: fileURLToPath(new URL("./tsconfig.json", import.meta.url)) } } },
  env: {
    schema: {
      // Clé partenaire de Hopper (facultative) : 60 recherches par minute au lieu de 10. Réglage Vercel, jamais dans le dépôt.
      HOPPER_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Le CMS (cms/README.md, section 5). Facultatifs pour que le site public se construise sans eux : l'admin
      // (/admin) dit lui-même ce qui lui manque. En local, dans .env ; en ligne, dans les réglages de Vercel.
      // La base Postgres de Supabase. Vide en local : la base PGlite de cms/.pglite.
      DATABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      // Supabase Auth, pour la connexion de l'équipe. L'adresse et la clé publiable ne sont pas secrètes, mais seul
      // le serveur s'en sert : l'admin n'envoie aucun client Supabase au navigateur.
      PUBLIC_SUPABASE_URL: envField.string({ context: "server", access: "public", optional: true }),
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: envField.string({ context: "server", access: "public", optional: true }),
    },
  },
});
