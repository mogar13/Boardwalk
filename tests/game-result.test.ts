/**
 * THE END OF A ROUND BELONGS TO THE OS, and this is the guard that says so.
 *
 * The defect it fences is one every game arrived at independently, which is the tell that it is the
 * SDK's problem rather than any one game's: a result panel and a play-again button drawn at the
 * BOTTOM of the board, under the move log / the bid box / the tableau — so on a real table the
 * verdict and the only control anybody wants at that moment are below the fold. Six games, six
 * copies, and a seventh inherits it by reading the sixth. `<GameResult>` is the one surface now
 * (see `src/system/game/GameResult.tsx`), and this asserts nobody re-grows their own.
 *
 * WHAT CAN AND CANNOT BE CHECKED HERE. There is no DOM in this suite — no jsdom, no testing-library
 * — so "the panel renders over the page" is not assertable, and pretending otherwise would be the
 * vacuous-guard failure this repo has already found twice on itself. What IS assertable is the
 * SOURCE TEXT, which is exactly where the drift happens: a game that draws its own panel has to
 * import `Rematch` (or write a play-again button) without importing `GameResult`. That is the shape
 * `tests/chess-sets.test.ts` checks for interpolated class names, for the same reason: the compiler
 * has no opinion, and the failure renders perfectly.
 *
 * BOTH DIRECTIONS, because they catch different mistakes:
 *   - every registered game presents a result through the OS — a game that ends and says nothing
 *     about it, or says it its own way, fails;
 *   - nothing renders `<Rematch>` outside `<GameResult>` — that is the specific regression, since
 *     the rematch button is the control that used to sit below the fold, and it is also the one
 *     that must stay mounted in ONE place (moving it remounts it, re-arms `restartGate` against an
 *     already-agreed tally and deals a second round; at a betting table, a second ante).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registry } from '@/games/registry';

const GAMES_DIR = fileURLToPath(new URL('../src/games/', import.meta.url));

/** Every `.ts`/`.tsx` file under a directory, recursively, as [path, source] pairs. */
function sourcesUnder(dir: string): [path: string, src: string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx'))
      out.push([full.slice(GAMES_DIR.length), readFileSync(full, 'utf8')]);
  }
  return out;
}

const GAME_SOURCES = sourcesUnder(GAMES_DIR.replace(/\/$/, ''));

/**
 * A file that genuinely renders the OS surface: it imports it BY PATH and puts the element on the
 * page. Both halves, because either alone is a substring check somebody can pass by accident — the
 * first draft asked only for `includes('GameResult')`, and falsifying it by renaming the component
 * to `GameResultXX` left every case GREEN, since the impostor contains the string. That is the
 * vacuous-guard failure this repo has caught on itself twice; a guard is only worth the run if it
 * goes red when you break the thing.
 */
const IMPORTS_IT = /from '@\/system\/game\/GameResult'/;
const RENDERS_IT = /<GameResult[\s/>]/;
const usesTheSurface = (src: string): boolean => IMPORTS_IT.test(src) && RENDERS_IT.test(src);

describe('the end-of-round surface is the OS’s', () => {
  it('sweeps a games tree that is actually there', () => {
    // Guard the guard. A walker that silently matched nothing reports success forever, which is how
    // a lint rule pointed at a directory that has moved goes blind while staying green.
    expect(GAME_SOURCES.length).toBeGreaterThan(20);
    expect(registry.length).toBeGreaterThan(0);
  });

  it('every registered game presents its result through <GameResult>', () => {
    const without = registry
      .map((game) => game.manifest.id)
      .filter(
        (id) =>
          !GAME_SOURCES.some(([path, src]) => path.startsWith(`${id}/`) && usesTheSurface(src))
      );
    expect(
      without,
      `games drawing their own end-of-round panel: ${without.join(', ')}. ` +
        'Render <GameResult over title>…actions…</GameResult> instead — see src/system/game/GameResult.tsx.'
    ).toEqual([]);
  });

  it('nothing renders <Rematch> outside <GameResult>', () => {
    const loose = GAME_SOURCES.filter(
      ([, src]) => src.includes("from '@/system/room/Rematch'") && !usesTheSurface(src)
    ).map(([path]) => path);
    expect(
      loose,
      `<Rematch> drawn outside the OS surface in: ${loose.join(', ')}. ` +
        'It must live inside <GameResult> — one mount, and never below the fold.'
    ).toEqual([]);
  });

  it('the surface itself is the kit’s one modal, not a panel of its own', () => {
    // The whole value of a single surface is that it cannot be scrolled away from, and that is the
    // native <dialog>'s top layer doing the work rather than anything this repo wrote. A rewrite
    // that quietly turned it back into a positioned div would pass every test above.
    const src = readFileSync(
      fileURLToPath(new URL('../src/system/game/GameResult.tsx', import.meta.url)),
      'utf8'
    );
    expect(src).toContain('<Modal');
    expect(src).toContain("from '@/ui'");
  });
});
