// ESLint, flat, type-aware, wired into `prebuild` so it FAILS THE BUILD.
//
// That last part is the whole point. CLAUDE.md's meta-rule is "make the wrong
// thing unspellable rather than documenting 'don't'", and its corollary is that a
// convention is only real if something red happens when it's broken. Casino OS v1
// documented "don't" extensively and shipped `validateAndCommit()` with zero
// adopters. A linter nobody runs is that same failure with more config.
//
// WHAT IS AND ISN'T HERE YET. Only rules whose subject EXISTS in Phase 0 are
// configured. The DaisyUI-class ban needs `src/ui` (Phase 1); the `firebase/*`
// import boundary needs `src/system/repo` (Phase 2); the `logic/`-purity and
// cross-game import bans need `src/games` (Phase 6). Each lands in the phase that
// creates the thing it guards, because a rule written against a directory that
// does not exist yet matches nothing — and a rule that matches nothing reports
// success. That is not a hypothetical: VS-Dashboard's `check-native-dialogs.sh`
// reported "ok" for a month while `confirm('Clear the entire workspace?')` sat in
// a `.js` file its include list did not cover.
//
// Every rule below is asserted to FIRE on the bug in tests/lint-rules.test.ts.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

// alert / confirm / prompt. CLAUDE.md bans these because v1 has four ad-hoc modal
// systems and toasts that lazily self-inject an inline-styled container. Phase 1
// gives them a real destination (<Modal>, useToast()); the ban comes first so that
// destination is the only road when it arrives.
//
// `no-restricted-globals` is scope-aware, which is why it's this and not a grep:
// it sees through `confirm(someVariable)`, and it will NOT fire on a future
// `const { confirm } = useToast()` — a grep can do neither.
const NATIVE_DIALOGS = [
  {
    name: 'alert',
    message:
      'Use useToast() (Phase 1). A native dialog cannot be themed, tested, or made accessible — and a neon casino that raises a Chrome alert box reads as broken.',
  },
  {
    name: 'confirm',
    message:
      'Use <Modal> (Phase 1) and name what it destroys ("Leave the table — your $250 bet is forfeit?"), never "Are you sure?".',
  },
  {
    name: 'prompt',
    message: 'Use <Modal> with an <Input> (Phase 1). Cancel resolves null, not an empty string.',
  },
];

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', 'dist/**', 'coverage/**', '**/*.min.js'],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  // `.flat['recommended-latest']`, not `['recommended-latest']` — the latter is
  // still the eslintrc shape in v7 and ESLint 10 rejects it outright. It fails
  // loudly, which is the only reason this is a note and not a bug.
  reactHooks.configs.flat['recommended-latest'],

  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        // projectService resolves each file to its owning tsconfig automatically.
        // Type-aware rules are the reason this project can say "money is integer
        // cents" and have it mean something.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      'no-restricted-globals': ['error', ...NATIVE_DIALOGS],

      // The `@/` alias is a stack decision, so the thing it replaced is an error.
      // One `../` is fine — a sibling within a feature is a real relationship.
      // Two or more is a file describing its own position in the tree, which is
      // exactly the fact that changes when anything moves.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../**'],
              message:
                "Use the '@/' alias. VS-Dashboard imports '../../../actualLabor'; we took the alias on day one specifically so no file has to know how deep it is.",
            },
          ],
        },
      ],

      // Unused vars are errors, but `_`-prefixed ones are the sanctioned way to
      // say "this argument exists for its position".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Config and scripts run in Node, not the browser.
  {
    files: ['*.config.{ts,mjs,js}', 'scripts/**/*.mjs', 'tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // The guard scripts are plain .mjs with no tsconfig — type-aware rules cannot
  // run on a file TypeScript does not have a program for.
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Last: turns off everything that only argues with Prettier about whitespace.
  prettier
);
