import { fileURLToPath, URL } from 'node:url';
// `vitest/config`, not `vite` — it is the same defineConfig widened to accept the
// `test` block below. Importing from 'vite' typechecks everything except the one
// key this file adds.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
// Tailwind v4 is a Vite plugin, not a PostCSS step, and there is no
// tailwind.config.js by design — the whole configuration is CSS, and it lives in
// packages/theme. See src/index.css for the two-line entry.
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages serves this repo at https://mogar13.github.io/Boardwalk/, so every
  // asset URL is prefixed. A wrong `base` fails in exactly one place — production —
  // because dev and preview would still resolve from the root.
  base: '/Boardwalk/',

  plugins: [tailwindcss(), react()],

  // The `@/` alias, decided on day one. VS-Dashboard has none and imports
  // '../../../actualLabor'; the depth of a relative path is not information anyone
  // wants to maintain. Mirrored in tsconfig.app.json's `paths` — both must agree or
  // the editor and the bundler disagree about what a module is.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  test: {
    include: ['tests/**/*.test.ts'],
    // The guard tests shell out to node and git; the default 5s is not enough.
    testTimeout: 30_000,
  },
});
