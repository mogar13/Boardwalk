import { fileURLToPath, URL } from 'node:url';
// `vitest/config`, not `vite` — it is the same defineConfig widened to accept the
// `test` block below. Importing from 'vite' typechecks everything except the one
// key this file adds.
import { defineConfig } from 'vitest/config';
// `loadEnv` from 'vite', not 'vitest/config': the latter re-exports `defineConfig`
// (widened for the `test` block) but not the rest of Vite's API surface. Same package
// underneath — this is a re-export gap, not two Vites.
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// Tailwind v4 is a Vite plugin, not a PostCSS step, and there is no
// tailwind.config.js by design — the whole configuration is CSS, and it lives in
// packages/theme. See src/index.css for the two-line entry.
import tailwindcss from '@tailwindcss/vite';
// The SAME reader the browser uses, called here with Node's env instead of
// import.meta.env. That is the entire reason src/system/repo/firebase/config.ts is pure
// and takes `env` as an argument: the list of required keys has one home and two readers
// that cannot see each other. A copy of the list here is the v1 defect in miniature —
// its Firebase config lived inline in 32 HTML files, each free to drift from the others.
import { readFirebaseConfig, missingConfigMessage } from './src/system/repo/firebase/config';
// The Pages SPA fallback: dist/404.html = a byte-copy of index.html, so a deep link that
// Pages has no file for boots the app and lets react-router resolve it. Pure + self-checking
// — see scripts/spa-fallback.mjs for why BrowserRouter needs this on a static host.
import { writeSpaFallback } from './scripts/spa-fallback.mjs';

export default defineConfig(({ command, mode }) => {
  // A PRODUCTION BUILD WITH NO CREDENTIALS FAILS HERE, LOUDLY.
  //
  // The alternative is a green deploy of a site whose only feature is a panel explaining
  // that it has no database — which is a failure discovered by a player rather than by
  // CI. `npm run build` is what the deploy runs, so this gates the deploy the same way
  // prebuild's lint and file-size guards do.
  //
  // `dev` is deliberately exempt: `npm run dev` must work on a fresh clone with no
  // secrets, and it does — App.tsx renders the missing-variable panel instead of a form.
  // Someone reading the code has no Firebase project and should not need one.
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const result = readFirebaseConfig(env);
    if (!result.ok) {
      throw new Error(`\n\n${missingConfigMessage(result.missing)}\n`);
    }
  }

  return {
    // GitHub Pages serves this repo at https://mogar13.github.io/Boardwalk/, so every
    // asset URL is prefixed. A wrong `base` fails in exactly one place — production —
    // because dev and preview would still resolve from the root.
    base: '/Boardwalk/',

    plugins: [
      tailwindcss(),
      react(),
      // Emit dist/404.html after the bundle is written. `apply: 'build'` so `npm run dev`
      // and `preview` skip it (the dev server resolves any path to the SPA already);
      // `closeBundle` so index.html is on disk when it copies. `outDir` is captured from
      // the resolved config rather than hardcoded, so a future change to `build.outDir`
      // does not silently write the fallback to the wrong place.
      (() => {
        let outDir = 'dist';
        return {
          name: 'boardwalk-spa-fallback',
          apply: 'build',
          configResolved(resolved) {
            outDir = resolved.build.outDir;
          },
          closeBundle() {
            const written = writeSpaFallback(outDir);
            this.info?.(`SPA fallback written: ${written}`);
          },
        };
      })(),
    ],

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
      // The guard tests shell out to node and git; the default 5s is not enough. The
      // rules test additionally boots the Firebase emulator (a JVM), which is slower
      // still — see tests/database-rules.test.ts.
      testTimeout: 120_000,
    },
  };
});
