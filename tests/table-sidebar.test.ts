/**
 * A PANEL IN THE TABLE'S SIDEBAR NEVER GROWS THE PAGE. Every game, current and future.
 *
 * THE DEFECT, and it is the second time this exact shape has been reported. Each panel bounded
 * ITSELF — the chat at `max-h-[60vh]`, the move log at `max-h-[28rem]` — which reads as careful and
 * bounds nothing together: at 1080p that is 648 + 448 plus two headers, so the sidebar ran ~1200px
 * beside a ~730px board. The column, not the board, then set the page height; the page grew a
 * scrollbar; and the move log, being second in the column, was the half that ended up off the
 * bottom of the screen. Which is the fold problem `<GameResult>` and `<ExitGame>` each already
 * closed once, arriving a third time through a different door.
 *
 * SO THE RULE IS STRUCTURAL: the COLUMN owns the height, and the panels take `flex-1 min-h-0`
 * shares of it and scroll inside themselves. That makes "both fit" a property of the layout rather
 * than of two numbers agreeing, and it is why a third panel could be added tomorrow without anyone
 * re-deriving the arithmetic.
 *
 * WHAT IS ASSERTED AND WHY IT IS SOURCE TEXT. There is no DOM in this suite, so "the page does not
 * scroll" is not assertable — pretending otherwise would be the vacuous-guard failure this repo has
 * caught on itself twice. What IS assertable is the mechanism, because the regression has exactly
 * one spelling: somebody gives a panel a height of its own. So a sidebar panel may not name a
 * height in ANY unit, must carry the two classes that make sharing work, and the bound must exist
 * on the column — three checks that go red on the way the mistake is actually made.
 *
 * `min-h-0` is called out separately rather than folded in, for `<Modal>`'s reason: a flex item's
 * default `min-height: auto` refuses to shrink below its content, so a panel with `flex-1` and no
 * `min-h-0` ignores its own `overflow-y-auto` and pushes the column open again — the same bug, with
 * every class looking right.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * COMMENTS ARE STRIPPED BEFORE ANYTHING IS SCANNED, and that is not a convenience. Every file this
 * guard reads explains the defect it fences, in prose, by NAMING the classes that caused it — so
 * the first run flagged `ChatPanel` and `MoveLog` for the `max-h-[60vh]` and `max-h-[28rem]` in
 * their own war stories. A guard that goes red on the documentation of the bug it prevents is a
 * guard somebody deletes on its first red run.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const read = (rel: string): string => stripComments(readFileSync(`${SRC}${rel}`, 'utf8'));

/** Every `.tsx` under a directory, recursively. */
function tsxUnder(dir: string): [path: string, src: string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...tsxUnder(full));
    else if (entry.endsWith('.tsx')) out.push([full.slice(SRC.length), readFileSync(full, 'utf8')]);
  }
  return out;
}

/**
 * A height named in a class — `max-h-[60vh]`, `max-h-96`, `h-[28rem]`, `min-h-40`. `min-h-0` is
 * deliberately NOT one of these: it is the fix, not the defect, and it is the one height-ish class
 * a sharing panel must carry.
 */
const NAMES_A_HEIGHT = /\b(?:max-h|min-h|h)-(?!0\b)(?!full\b)(?:\[[^\]]+\]|\d+|screen|dvh|svh)/;

/** The panels that live in the sidebar. The move log is found through its `<TableAside>` import. */
const SIDEBAR_PANELS = ['system/chat/ChatPanel.tsx', 'system/room/TableAside.tsx'];

describe('a table-sidebar panel never grows the page', () => {
  it('sweeps files that are actually there', () => {
    for (const p of SIDEBAR_PANELS) expect(read(p).length).toBeGreaterThan(200);
  });

  it('no sidebar panel names a height of its own', () => {
    // Including every game's `<TableAside>` content, because the panel is the game's and the rule
    // is the OS's — a seventh game's panel must not be able to reintroduce this.
    const panels = [
      ...SIDEBAR_PANELS.map((p): [string, string] => [p, read(p)]),
      ...tsxUnder(`${SRC}games`)
        .filter(([, src]) => src.includes("from '@/system/room/TableAside'"))
        .map(([path, src]): [string, string] => [path, stripComments(src)]),
    ];
    // Not vacuous — the move log is one of these, and it is what the rule was written for.
    expect(panels.length).toBeGreaterThan(SIDEBAR_PANELS.length);

    const offenders = panels
      .filter(([, src]) => NAMES_A_HEIGHT.test(src))
      .map(([path, src]) => `${path} (${NAMES_A_HEIGHT.exec(src)?.[0] ?? '?'})`);
    expect(
      offenders,
      `a sidebar panel naming its own height: ${offenders.join(', ')}. The COLUMN owns the ` +
        'height (see <Lobby>); a panel takes `flex-1 min-h-0` and scrolls inside its share.'
    ).toEqual([]);
  });

  it('every sidebar panel takes a SHARE of the column', () => {
    for (const path of SIDEBAR_PANELS) {
      // THE PANEL'S OWN ROOT, not "somewhere in the file" — and that distinction is the
      // falsification talking. The first draft asked whether `min-h-0` appeared anywhere in the
      // source; dropping it from the `<Card>` left every case GREEN, because the scrolling body
      // one element down still carried it. A class on the wrong element is exactly the defect, so
      // asking "is this string present" is asking nothing.
      const root = /<Card className="([^"]*)"/.exec(read(path))?.[1] ?? '';
      expect(root, `${path} draws no <Card> root`).not.toBe('');
      expect(root, `${path}'s panel must flex to its share, got: ${root}`).toMatch(/\bflex-1\b/);
      // The load-bearing one: without it the panel refuses to shrink below its content and the
      // column grows anyway, with `overflow-y-auto` and `flex-1` both present and both correct.
      expect(root, `${path}'s panel must carry min-h-0, got: ${root}`).toMatch(/\bmin-h-0\b/);
    }
    // The SCROLL CONTAINER is the OS's, once, and a game cannot supply its own — which is the
    // height rule made unspellable rather than merely checked. `<TableAside>` draws the body; a
    // game hands over lines.
    expect(read('system/room/TableAside.tsx')).toMatch(/overflow-y-auto/);
    expect(read('system/chat/ChatPanel.tsx')).toMatch(/overflow-y-auto/);
  });

  it('the column takes the board’s height and contributes none of its own', () => {
    const aside = /<aside[^>]*className="([^"]*)"/.exec(read('system/room/Lobby.tsx'))?.[1] ?? '';
    expect(aside, 'the lobby draws no <aside> for the sidebar').not.toBe('');

    // OUT OF FLOW BESIDE THE BOARD, which is the whole mechanism and the part a `max-h` cannot
    // supply. A grid item contributes its content to the row's height, so a merely CAPPED column
    // still pushes the row open — it just stops pushing at the cap. Taking the panels out of flow
    // empties the wrapper's content box, so the row is the board's height and the sidebar is
    // stretched to it: the page cannot grow, at any content length, rather than growing to a limit.
    // It is also what makes 50/50 real — `flex-1` divides a definite height and nothing else.
    expect(aside, `the sidebar must leave the grid row's flow at lg, got: ${aside}`).toMatch(
      /lg:absolute/
    );
    expect(aside, `…and fill it, got: ${aside}`).toMatch(/lg:inset-0/);

    // Below `lg` there is no board beside it, so it is in normal flow and takes the viewport bound
    // instead. A fixed rem bound would be the same defect one level up — right at one window size.
    expect(
      aside,
      `the stacked column must bound itself against the viewport, got: ${aside}`
    ).toMatch(/max-h-\[calc\(100dvh-/);
    expect(aside, 'the column must be a flex column for its panels to share').toMatch(/flex-col/);
  });
});
