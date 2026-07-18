import { dirname, resolve, relative, sep } from 'node:path';

/**
 * `logic/` is pure. A file under a game's `logic/` directory may not import React, the DOM,
 * `@/system`, `@/ui`, or Firebase — nothing but other pure modules.
 *
 * WHY THIS IS THE RULE PHASE 6 OWES. ARCHITECTURE.md's build order for a game is "extract
 * logic first, into pure functions — no DOM, no React, no `@/system` — then test the logic
 * before any UI exists, THEN draw the components." That ordering is the only step that catches
 * a bad shuffle, an off-by-one score, or a broken win check, because it is the only step where
 * the rule is a value a test can assert on rather than a thing a component renders. And it is
 * the property BACKEND_PLAN.md leans on: pure `logic/` is the code that can run unchanged on a
 * server later. Both promises hold only for as long as `logic/` imports nothing impure — and
 * "imports nothing impure" is not a thing you can know by reading, only by enforcing.
 *
 * v1 is the counterexample this pays for. Its shuffles, scoring and win checks lived inside the
 * same files that touched `window.SystemUI` and the DOM, so none of them could be unit-tested —
 * and Blackjack's 3:2 natural silently dropped a chip through `parseInt` for want of a test that
 * a pure payout function would have had.
 *
 * WHAT COUNTS AS IMPURE, and why each is by IMPORT and not by heuristic:
 *
 *   • `react` / `react-dom` — a hook or a component in `logic/` is logic welded to the
 *     render cycle, the exact thing this separates.
 *   • `@/system/**` — the OS. `logic/` sits BELOW the OS: it is what the OS runs, not the
 *     other way round. An import here is the arrow pointing backwards, and it is also how the
 *     Firebase SDK would sneak in through `@/system/repo/firebase` (which resolves under
 *     `src/system`, so this rule catches it too, before `no-firebase-imports` does).
 *   • `@/ui` — the kit is components; a pure function that reaches for a `<Button>` is not pure.
 *
 * DOM access is via globals (`document`, `window`), not imports, so a rule keyed on imports
 * cannot see it — but banning React and `@/system` removes every sanctioned road to the DOM a
 * game has, and the import boundary is the half that is enforceable without false positives.
 * `logic/` reaching for a bare global is caught by review, the same place v1's were not.
 *
 * SCOPE: files whose path contains a `/logic/` segment under either games tree (see
 * `GAMES_DIRS`). A game's components,
 * its manifest, and the registry are all deliberately outside — they SHOULD import the OS; that
 * is what they are for. The rule governs exactly the tree whose whole value is being importless.
 */

/**
 * The games trees. Two of them since Phase D: the five rulebooks moved into the shared
 * `@boardwalk/game-logic` package (so `boardwalk-api` runs the SAME rules), and their
 * components stayed behind under `src/games/`. Both halves keep the shape
 * `<games-dir>/<game>/logic/<file>.ts`, which is what lets one rule govern both.
 *
 * THIS LIST IS THE RULE. A guard aimed at a directory the code has left matches nothing, and a
 * rule that matches nothing reports success — which is exactly the failure CLAUDE.md warns
 * about, landing on the guard instead of the code. `tests/lint-rules.test.ts` writes its
 * fixtures into BOTH trees for that reason.
 */
const GAMES_DIRS = ['src/games', 'packages/game-logic/src/games'];

/** Where `@/`-and-relative specifiers resolve, so the ban survives a relative escape. */
const GOVERNED_ROOT = 'src';

/** `react`, `react-dom`, `react-dom/client` — the render cycle by any of its names. */
const REACT_SPECIFIER = /^react(?:-dom)?(?:\/|$)/;

/** The OS and the kit — the two source trees `logic/` sits below and must not import. */
const IMPURE_DIRS = ['src/system', 'src/ui'];

const REACT_MSG =
  "'{{source}}' pulls in React. A file under logic/ is PURE — no React, no DOM — so it can be " +
  'unit-tested before any UI exists and run unchanged on a server later (BACKEND_PLAN.md). A hook ' +
  "or component belongs in the game's components/, not its logic/.";

const SYSTEM_MSG =
  "'{{source}}' reaches up into the OS (@/system or @/ui). logic/ sits BELOW the OS: it is what the " +
  'OS runs, not the other way round. Keep the rules pure and let the component call the hook — that ' +
  'separation is the only step that catches a bad shuffle or an off-by-one score, because it is the ' +
  'only one where the logic is a value a test can assert on.';

const toPosix = (p) => p.split(sep).join('/');

/** `a/b` is inside `a` and inside `a/b`; NOT inside `a/bc`. */
const isInside = (path, base) => path === base || path.startsWith(`${base}/`);

/** Does this file live under a `logic/` directory within the games tree? */
function isLogicFile(relDir) {
  if (!GAMES_DIRS.some((dir) => isInside(relDir, dir))) return false;
  return relDir.split('/').includes('logic');
}

/**
 * Where a specifier points, as a repo-relative posix path — or null for a bare package, which
 * has no path. Resolved (not string-matched) for the same reason `no-firebase-imports` resolves:
 * a relative escape like `../../system/thing` contains no `src/system` substring but lands there,
 * and only resolving the path catches it.
 */
function targetOf(specifier, fileDir, cwd) {
  if (specifier.startsWith('@/')) return `${GOVERNED_ROOT}/${specifier.slice(2)}`;
  if (specifier.startsWith('.')) return toPosix(relative(cwd, resolve(fileDir, specifier)));
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Keep game logic/ pure — no React, no DOM, no @/system, no @/ui.' },
    schema: [],
    messages: { react: REACT_MSG, system: SYSTEM_MSG },
  },

  create(context) {
    const fileDir = dirname(context.filename);
    const relDir = toPosix(relative(context.cwd, fileDir));

    // Not a logic file — this rule has nothing to say. A game's components SHOULD import the OS.
    if (relDir.startsWith('..') || !isLogicFile(relDir)) return {};

    function check(node, source) {
      if (REACT_SPECIFIER.test(source)) {
        context.report({ node, messageId: 'react', data: { source } });
        return;
      }
      const target = targetOf(source, fileDir, context.cwd);
      if (target !== null && IMPURE_DIRS.some((dir) => isInside(target, dir))) {
        context.report({ node, messageId: 'system', data: { source } });
      }
    }

    // Every syntax that pulls a module in — the same four doors `no-firebase-imports` guards, for
    // the same reason: a rule that only knows `import x from` has three doors open.
    const fromSource = (node) => {
      const src = node.source;
      if (src && src.type === 'Literal' && typeof src.value === 'string') check(src, src.value);
    };

    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          check(node.source, node.source.value);
        }
      },
    };
  },
};
