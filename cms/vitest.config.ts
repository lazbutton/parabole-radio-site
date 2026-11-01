import { defineConfig } from "vitest/config";

export default defineConfig({
  // Chaque fichier de test ouvre sa base PGlite (une seconde environ) : de la marge pour les crochets et les tests.
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
});
