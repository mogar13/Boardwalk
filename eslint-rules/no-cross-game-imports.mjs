import { dirname, resolve, relative, sep } from 'node:path';

/**
 * Nothing under one game's folder imports another game's folder.
 *
 * WHY THIS IS A RULE AND NOT A NOTE. ARCHITECTURE.md: "nothing under `games/` may import from
 * another game's folder — hoist shared code to `system/` or `ui/` deliberately." The word that
 * matters is *deliberately*. Two games that share a `<Card>` should reach a common kit; two games
 * that share a shuffle should reach a common `system/`. What they must NOT do is reach sideways
 * into each other, because a game is meant to be an independent unit that can be built, tested,
 * and DELETED on its own — and a sideways import quietly makes one game load-bearing for another,
 * so removing Blackjack breaks Chess and nobody knew until it was gone.
 *
 * It is also the pressure that keeps the OS honest. "Resist building a generic board-game engine"
 * (ARCHITECTURE.md) works only if the alternative — copying a bit of another game — is closed off:
 * when two games genuinely repeat, the sanctioned move is to hoist the repeated thing to `system/`
 * ON PURPOSE, and this rule is what makes that the path of least resistance instead of a
 * cross-import that hides the duplication until there are five copies of it.
 *
 * v1 had no boundary here, and paid for it exactly once too often — shared helpers copy-pasted
 * between games drifted apart, so a fix to the shuffle in one game never reached the four others
 * that had forked it.
 *
 * WHAT "ANOTHER GAME" MEANS. A file's game is the first path segment under `src/games/` — so
 * `src/games/chess/logic/moves.ts` belongs to `chess`. The registry (`src/games/registry.ts`,
 * directly under `src/games/` with no game segment) is deliberately NOT governed: naming every
 * game is its entire job, and it is the one file allowed to. An import is illegal only when it
 * lands in a DIFFERENT game's tree; a game importing its own `logic/` or `components/` is fine.
 *
 * SCOPE and resolution mirror `no-firebase-imports`: files under `src/games/<game>/`, and the
 * specifier is RESOLVED, not string-matched, because `../otherGame/board` is a single `../`
 * (allowed by the alias ban — a sibling is a real relationship) and contains no telltale
 * substring, so only resolving the path reveals it crossing a game boundary.
 */

const GAMES_DIR = 'src/games';
const GOVERNED_ROOT = 'src';

const MSG =
  "'{{source}}' reaches into another game ('{{other}}'). A game is an independent unit — it must " +
  "not import a sibling game's folder, or removing one silently breaks the other. If two games " +
  'share code, hoist it to @/system or @/ui deliberately; that friction is the feature.';

const toPosix = (p) => p.split(sep).join('/');
const isInside = (path, base) => path === base || path.startsWith(`${base}/`);

/**
 * The game a repo-relative path belongs to: the first segment under `src/games/`, or null if the
 * path is not inside a game folder. "Inside a game folder" requires a segment AFTER the game name,
 * so `src/games/registry.ts` (rest `['registry.ts']`) belongs to no game and is not governed —
 * naming every game is the registry's whole job. Both a FILE path (`src/games/chess/manifest.ts`)
 * and a resolved MODULE path (`src/games/chess/logic/moves`) satisfy this, which is what lets the
 * one function classify both the importer and its target.
 */
function gameOf(relPath) {
  if (!isInside(relPath, GAMES_DIR)) return null;
  const rest = relPath.slice(GAMES_DIR.length + 1).split('/');
  return rest.length >= 2 ? rest[0] : null;
}

function targetOf(specifier, fileDir, cwd) {
  if (specifier.startsWith('@/')) return `${GOVERNED_ROOT}/${specifier.slice(2)}`;
  if (specifier.startsWith('.')) return toPosix(relative(cwd, resolve(fileDir, specifier)));
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: "No game imports another game's folder." },
    schema: [],
    messages: { cross: MSG },
  },

  create(context) {
    const fileDir = dirname(context.filename);
    const relFile = toPosix(relative(context.cwd, context.filename));
    if (relFile.startsWith('..')) return {};

    // The importing file's own game — classified from its full path, so a file directly in a
    // game root (`src/games/chess/manifest.ts`) counts, while `src/games/registry.ts` does not.
    const home = gameOf(relFile);
    if (home === null) return {};

    function check(node, source) {
      const target = targetOf(source, fileDir, context.cwd);
      if (target === null) return;
      const other = gameOf(target);
      if (other !== null && other !== home) {
        context.report({ node, messageId: 'cross', data: { source, other } });
      }
    }

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
