// ESLint for boardwalk-api — flat, type-aware, and wired into CI.
//
// WHY THIS FILE EXISTS AT ALL. The root eslint.config.mjs ignores `boardwalk-api/**` for a
// good reason (it is React/browser-shaped and points at the app's tsconfig, which does not
// include these files), and the package has had a `lint` script since it was created. But
// with no config here, that script resolved the ROOT config, matched its ignore, and exited
// with "All files matched by 'src' are ignored" — an error that reads like a setup problem
// rather than what it was: ~2,000 lines of the money referee never linted by anything, for
// the entire life of the package.
//
// That is CLAUDE.md's own failure mode landing on the backend — "a rule that matches nothing
// reports success", except here it was a whole linter. The package that owns the ledger was
// the one place in the repo with no static guard beyond `tsc`.
//
// The rigor is the root's, minus the rules whose subject does not exist here. There is no UI,
// so no DaisyUI/palette/native-dialog bans and no React hooks plugin. What carries over is the
// part that has teeth on a server: `recommendedTypeChecked`, unused-vars as an error, and the
// deep-relative-import ban.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'data/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        // `project`, not `projectService`. The default service resolves each file to the
        // NEAREST tsconfig.json — which here is the BUILD config, and it includes only
        // `src/**`. Every tests/ file would then fail to parse with "not in project", and the
        // usual cure for that noise is to stop linting tests. tsconfig.test.json is the one
        // that spans src + tests, so it is named explicitly and there is nothing to drift.
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // Same shape as the root's: `_`-prefixed is the sanctioned way to say "this argument
      // exists for its position", which Express's `(err, req, res, next)` handlers need —
      // the 4-arity IS the signature, so `next` cannot simply be dropped.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // The root bans `../../**` because the app has the `@/` alias. This package does not,
      // but the rule still earns its place: src/ is two levels deep at most, so any `../../`
      // here is a file reaching across the service's own seams (a route into another route's
      // internals) rather than up one level to a shared module. One `../` stays fine.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../**'],
              message:
                'src/ is at most two levels deep — a `../../` is a file reaching across a seam, not up to a shared module. Import from the module that owns the thing instead.',
            },
          ],
        },
      ],
    },
  },

  {
    // The operational scripts (backup, backfill, restore drill) are plain .mjs with no
    // tsconfig. They are linted — they are the tools that touch production data — but
    // type-aware rules cannot run on a file TypeScript has no program for.
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  prettier
);
