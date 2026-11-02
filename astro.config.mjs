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
  // Les rubriques ont pris des adresses en français avec le menu de la maquette du 2 novembre (src/lib/menu.ts) : les
  // anciennes y mènent pour toujours (redirection permanente).
  redirects: { "/show": "/emissions", "/event": "/evenements", "/about": "/a-propos" },
  // Le tsconfig du projet, nommé : sans lui, Vite le cherche en remontant les dossiers, et une copie du projet rangée
  // dans un autre (les worktrees de .claude/worktrees/) tombe sur celui du dossier parent. Aussi pour l'analyse des
  // dépendances du serveur de développement, qui a ses propres réglages.
  vite: { tsconfig: "./tsconfig.json", optimizeDeps: { rolldownOptions: { tsconfig: fileURLToPath(new URL("./tsconfig.json", import.meta.url)) } } },
  env: {
    schema: {
      // Clé partenaire de Hopper (facultative) : 60 recherches par minute au lieu de 10. Réglage Vercel, jamais dans le dépôt.
      HOPPER_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Clé publishable de Radio Cult (pk_…, page « API key » de son tableau de bord), facultative. Elle n'ouvre que la
      // lecture et peut aller dans la page : le direct y arrive en temps réel, la programmation nomme ses artistes, et
      // les pages des résidents annoncent leurs passages. Sans elle, le site marche comme avant. Jamais la clé secrète.
      PUBLIC_RADIOCULT_KEY: envField.string({ context: "client", access: "public", optional: true }),
      // Le CMS (cms/README.md, section 5). Facultatifs pour que le site public se construise sans eux : l'admin
      // (/admin) dit lui-même ce qui lui manque. En local, dans .env ; en ligne, dans les réglages de Vercel.
      // La base Postgres de Supabase. Vide en local : la base PGlite de cms/.pglite.
      DATABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      // Supabase : la connexion de l'équipe (Auth, côté serveur seulement : l'admin n'envoie aucun client Supabase au
      // navigateur), et le canal de l'antenne libre, que le bandeau écoute avec la seule clé publiable (Realtime). Ni
      // l'adresse ni la clé publiable ne sont secrètes.
      PUBLIC_SUPABASE_URL: envField.string({ context: "client", access: "public", optional: true }),
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: envField.string({ context: "client", access: "public", optional: true }),
      // L'adresse publique du seau des images du CMS (Supabase Storage). Vide : celle du seau « media » de
      // PUBLIC_SUPABASE_URL (src/lib/cms.ts) ; un autre seau, ou un serveur d'images local pour les essais, la remplace.
      PUBLIC_MEDIA_URL: envField.string({ context: "server", access: "public", optional: true }),
      // Turnstile (Cloudflare), contre les robots, au premier message d'un pseudo (CHAT_EN_DIRECT.md, 6.3). Sans ces
      // deux réglages, l'antenne marche sans cette vérification ; les autres limites tiennent.
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({ context: "client", access: "public", optional: true }),
      TURNSTILE_SECRET_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Le magasin Vercel Blob des vidéos de fond envoyées depuis l'admin : Vercel le pose quand on relie le magasin
      // au projet. Sans lui, l'admin gère la liste mais n'envoie rien (src/lib/admin/blob.ts).
      BLOB_READ_WRITE_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
