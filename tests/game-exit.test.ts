/**
 * THE WAY OUT OF A GAME BELONGS TO THE OS, and this is the guard that says so.
 *
 * THE DEFECT IT FENCES, which shipped in both of its halves at once. A room game's page carried TWO
 * ways out. "Leave table" sat in the header and only dropped `?table=` — so it did not leave the
 * game, it dumped you on the game's own create-or-join form, a page the launch modal exists to stop
 * anybody meeting. The control that actually reached the boardwalk was a second button at the very
 * BOTTOM of the column, under the seat list, under the board, under the chat — reachable only by
 * scrolling past a full felt, which is `<GameResult>`'s defect in a different costume and was
 * reported the same way: "I need to scroll down to get back to the hub."
 *
 * So the rule, and it is a rule rather than a fix to one screen: **LEAVE TABLE = BACK TO THE HUB**,
 * there is exactly one exit, and it is `<ExitGame>`. Getting back to a setup screen is the
 * browser's Back button (`enterTable` pushes for that reason); it is not a second control.
 *
 * WHAT CAN AND CANNOT BE CHECKED HERE. There is no DOM in this suite, so "the exit is above the
 * fold" is not assertable and pretending otherwise would be the vacuous-guard failure this repo has
 * caught on itself twice. What IS assertable is the source text, which is where the drift happens —
 * a second exit is always a perfectly reasonable-looking `<Button onClick={onExit}>` that somebody
 * adds because the first one was hard to find. Same shape as `tests/game-result.test.ts`, and for
 * the same reason: the compiler has no opinion and the mistake renders beautifully.
 *
 * BOTH DIRECTIONS, because they catch opposite mistakes:
 *   - nothing under the games or room trees draws an exit of its own (the second-button regression);
 *   - every SOLO game draws one — a game that never mounts a `<Lobby>` has no header drawn for it,
 *     so forgetting the exit strands the player on a board with no way back at all.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registry } from '@/games/registry';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Every `.ts`/`.tsx` under a directory, recursively, as repo-ish `[path, source]` pairs. */
function sourcesUnder(dir: string): [path: string, src: string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx'))
      out.push([full.slice(SRC.length), readFileSync(full, 'utf8')]);
  }
  return out;
}

/**
 * The trees a player is inside a GAME in. The shell's own error pages (`Play`'s "no such game",
 * `NotFound`) are deliberately outside it: there is no table to leave there, so "Back to the hub"
 * is the honest label and this rule has nothing to say about it.
 */
const SOURCES = [
  ...sourcesUnder(`${SRC}games`),
  ...sourcesUnder(`${SRC}system/room`),
  ...sourcesUnder(`${SRC}system/game`),
].filter(([path]) => path !== 'system/game/ExitGame.tsx');

const EXIT_PATH = fileURLToPath(new URL('../src/system/game/ExitGame.tsx', import.meta.url));

/**
 * Genuinely rendering the OS control: imported BY PATH and put on the page. Both halves, because
 * either alone is a substring somebody passes by accident — `tests/game-result.test.ts` learned
 * that when renaming the component to `GameResultXX` left every case green.
 */
const IMPORTS_IT = /from '@\/system\/game\/ExitGame'/;
const RENDERS_IT = /<ExitGame[\s/>]/;
const usesTheControl = (src: string): boolean => IMPORTS_IT.test(src) && RENDERS_IT.test(src);

describe('the way out of a game is the OS’s', () => {
  it('sweeps trees that are actually there', () => {
    // Guard the guard: a walker that matched nothing would report success forever.
    expect(SOURCES.length).toBeGreaterThan(25);
    expect(registry.length).toBeGreaterThan(0);
  });

  it('nothing draws an exit of its own', () => {
    // `onClick={onExit}` is what all three hand-rolled exits spelled, and what a fourth would.
    const rogue = SOURCES.filter(([, src]) => /onClick=\{\s*onExit\s*\}/.test(src)).map(([p]) => p);
    expect(
      rogue,
      `a hand-rolled way out in: ${rogue.join(', ')}. Render <ExitGame onExit={onExit} /> — ` +
        'one exit, in the header, and it goes to the hub.'
    ).toEqual([]);
  });

  it('no second way out at the bottom of the page', () => {
    // The literal regression: a "Back to the hub" button below the board, under the fold. The
    // phrase is banned outright inside a game rather than merely deduplicated, because the reason
    // it kept reappearing is that it reads as helpful right up until the page is taller than a
    // screen — which is every real table.
    const loose = SOURCES.filter(([, src]) => src.includes('Back to the hub')).map(([p]) => p);
    expect(
      loose,
      `a second way out in: ${loose.join(', ')}. The one exit is <ExitGame>, and it already goes there.`
    ).toEqual([]);
  });

  it('every game with a SOLO mode draws the exit itself', () => {
    // A solo board mounts no <Lobby>, so nobody draws a header for it. Forgetting the control there
    // is not an inconsistency, it is a board with no way off it. Keyed on DECLARING `solo` rather
    // than on being solo-only, because Blackjack is now both: its room branch gets the lobby's
    // header and its room-less branch has to draw its own, and only one of those is somebody else's
    // problem.
    const solo = registry.filter((g) => g.manifest.modes.includes('solo'));
    const stranded = solo
      .map((g) => g.manifest.id)
      .filter(
        (id) =>
          !SOURCES.some(([path, src]) => path.startsWith(`games/${id}/`) && usesTheControl(src))
      );
    expect(
      stranded,
      `solo boards with no way out: ${stranded.join(', ')}. They have no lobby to draw one for them.`
    ).toEqual([]);
    // Not vacuous: this repo ships solo boards.
    expect(solo.length).toBeGreaterThan(0);
  });

  it('the lobby’s exit is ABOVE the board and the chat, never under them', () => {
    // THE ACTUAL REGRESSION, as an ordering assertion — the same technique `tests/rules-deploy.test.ts`
    // uses to pin one job before another. A second `<ExitGame>` appended at the bottom of the room
    // column passes every case above (it is the OS control, and it carries no banned phrase) and is
    // exactly the button that had to be scrolled to. What cannot be true of it is that the LAST exit
    // in this file still comes before the chat panel — the room view's chrome is its header.
    const src = SOURCES.find(([path]) => path === 'system/room/Lobby.tsx')?.[1] ?? '';
    const lastExit = src.lastIndexOf('<ExitGame');
    const chat = src.indexOf('<ChatPanel');
    expect(chat).toBeGreaterThan(0);
    expect(
      lastExit,
      'an <ExitGame> is rendered after the chat panel — that is the below-the-fold button again.'
    ).toBeLessThan(chat);
  });

  it('the lobby’s in-room view draws it, for every game that has one', () => {
    const lobby = SOURCES.find(([path]) => path === 'system/room/Lobby.tsx');
    expect(lobby).toBeDefined();
    expect(usesTheControl(lobby?.[1] ?? '')).toBe(true);
  });

  it('the control leaves — it does not navigate somewhere of its own', () => {
    // The old header button called a `leaveTable` that only edited the query string, which is how
    // "leave" came to mean "stay here and show a form". Whatever this renders, the click has to be
    // the caller's `onExit` and nothing else — so it may not reach for the router at all.
    const src = readFileSync(EXIT_PATH, 'utf8');
    expect(src).toMatch(/onClick=\{\s*onExit\s*\}/);
    expect(src).not.toContain('react-router-dom');
    expect(src).not.toContain('useSearchParams');
  });
});
