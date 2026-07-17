/**
 * `@boardwalk/eslint-rules` — the local plugin.
 *
 * ARCHITECTURE.md's stack table says "ESLint 10 flat + local rules, fails the
 * build", and these are the local rules. They are here rather than in an npm
 * package because they encode decisions specific to this repo (which words are
 * DaisyUI components AND card-game nouns; that the primary colour means action) — the kind of
 * thing that is right for exactly one codebase.
 *
 * Both are wired in eslint.config.mjs and both are asserted to FIRE on the bug, and
 * NOT to fire on the sanctioned pattern, in tests/lint-rules.test.ts. CLAUDE.md:
 * adding a rule means adding its guard and a test that the guard fires, in the same
 * commit. A rule that matches nothing reports success.
 */
import noCrossGameImports from './no-cross-game-imports.mjs';
import noDaisyuiClasses from './no-daisyui-classes.mjs';
import noFirebaseImports from './no-firebase-imports.mjs';
import noImpureLogic from './no-impure-logic.mjs';
import noRawPalette from './no-raw-palette.mjs';

export default {
  meta: { name: '@boardwalk/eslint-rules', version: '1.0.0' },
  rules: {
    'no-cross-game-imports': noCrossGameImports,
    'no-daisyui-classes': noDaisyuiClasses,
    'no-firebase-imports': noFirebaseImports,
    'no-impure-logic': noImpureLogic,
    'no-raw-palette': noRawPalette,
  },
};
