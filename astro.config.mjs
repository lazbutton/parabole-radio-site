// @ts-check
import { defineConfig, envField } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  site: "https://parabole-radio-site.vercel.app",
  // Les pages sont statiques (générées au build) ; seules les routes de src/pages/api/ tournent sur Vercel, dans une
  // fonction. maxDuration : Hopper peut mettre jusqu'à 25 s à répondre (src/pages/api/hopper.ts).
  adapter: vercel({ maxDuration: 30 }),
  // Navigation sans rechargement (ClientRouter, src/layouts/Base.astro) : une page survolée est chargée d'avance.
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  env: {
    schema: {
      // Clé partenaire de Hopper (facultative) : 60 recherches par minute au lieu de 10. Réglage Vercel, jamais dans le dépôt.
      HOPPER_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
