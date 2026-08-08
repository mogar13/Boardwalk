/**
 * THE ACTIVE COLOUR IS NAMED EXACTLY WHERE THE CARD CANNOT NAME IT ITSELF.
 *
 * TWO COMPLAINTS, ONE RULE, and this guard exists because they pull in opposite directions and a
 * later reader will only find one of them.
 *
 *   1. The pill was unconditional, and it said "RED" under a red card beside a red-tinted border —
 *      three statements of one fact stacked in the middle of the table. So it was removed and the
 *      discard was lit from the active colour instead.
 *   2. Which is right for a coloured card and NOT ENOUGH for the case the pill was actually earning
 *      its place in: a wild or a +4 is black, its face carries no colour at all, and it is exactly
 *      the moment the colour CHANGED. A soft glow is a fine reminder of something you already know
 *      and a poor announcement of something that just happened.
 *
 * Deleting the pill satisfies (1) and breaks (2); keeping it satisfies (2) and is (1). The rule
 * that satisfies both is CONDITIONAL ON THE CARD: drawn when `top` is colourless, and only then.
 * Without this test the next person reads one half of that argument in a docblock and "tidies" the
 * condition away in either direction, and both mistakes render perfectly.
 *
 * RENDERED, NOT GREPPED (`tests/modal.test.ts`'s trick). `<TableCentre>` takes plain props — no
 * hooks, no context, no router — so the real component goes through `renderToStaticMarkup` in Node
 * and what is asserted is the markup a browser is handed. A source sweep could only ask whether the
 * word `colourless` appears somewhere.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TableCentre } from '@/games/uno/components/TableCentre';
import type { Card, UnoColor } from '@boardwalk/game-logic/games/uno';

const COLOURS: readonly UnoColor[] = ['red', 'blue', 'green', 'yellow'];

const wild = (kind: 'wild' | 'wild4' = 'wild'): Card => ({
  id: 'w1',
  color: 'wild',
  kind,
  value: -1,
});
const numbered = (color: UnoColor): Card => ({ id: 'n1', color, kind: 'number', value: 7 });

function render(top: Card, color: UnoColor): string {
  return renderToStaticMarkup(
    createElement(TableCentre, {
      top,
      color,
      direction: 1,
      deckCount: 40,
      pending: 0,
      canDraw: false,
      onDraw: () => undefined,
    })
  );
}

/**
 * The markup a SIGHTED player gets — the screen-reader line is stripped first, because it states
 * the colour unconditionally and would make every assertion below pass for the wrong reason. That
 * line is asserted separately, and on purpose: it is the accessibility floor and must NOT become
 * conditional along with the pill.
 */
const visible = (html: string): string =>
  html.replace(/<span class="sr-only"[^>]*>.*?<\/span>/g, '');

/** The pill's tinted surface — a class nothing else in this component spells. */
const pillFor = (color: UnoColor): string => `bg-uno-${color}/20`;

describe('the UNO table centre names the colour when the card cannot', () => {
  it('a WILD says which colour was called — for every colour', () => {
    for (const color of COLOURS) {
      const html = visible(render(wild(), color));
      expect(html, `a wild called as ${color} must name it`).toContain(pillFor(color));
      expect(html.toLowerCase(), `…in words, not only in a tint`).toContain(`>${color}`);
    }
  });

  it('a WILD DRAW FOUR says it too — the card that changes the colour AND punishes you', () => {
    const html = visible(render(wild('wild4'), 'green'));
    expect(html).toContain(pillFor('green'));
  });

  it('a COLOURED card says nothing — the card is already saying it', () => {
    for (const color of COLOURS) {
      const html = visible(render(numbered(color), color));
      expect(html, `a ${color} number card must not repeat its own colour`).not.toContain(
        pillFor(color)
      );
    }
  });

  it('the pill follows the ACTIVE colour, never the card', () => {
    // The whole point: a wild's own `color` is `'wild'`, so a pill read off the card would render
    // nothing or throw. Every one of these is a wild whose called colour differs from the last.
    for (const color of COLOURS) {
      const html = visible(render(wild(), color));
      for (const other of COLOURS) if (other !== color) expect(html).not.toContain(pillFor(other));
    }
  });

  it('the discard is lit in the active colour either way', () => {
    // The halo is not conditional — on a wild it is the pill's echo, on a coloured card it is the
    // felt lit by the card. Dropping it for the coloured case would take the table's light away to
    // fix a redundancy that is no longer there.
    expect(render(wild(), 'blue')).toContain('bg-uno-blue/50');
    expect(render(numbered('blue'), 'blue')).toContain('bg-uno-blue/50');
  });

  it('a screen reader is told the colour on EVERY card, pill or no pill', () => {
    // The floor, and the reason `visible()` exists above. A blur is not text and neither is a
    // coloured pill, so this line is what actually carries the colour to a reader — it must not
    // acquire the pill's condition.
    for (const top of [wild(), wild('wild4'), numbered('red')])
      expect(render(top, 'yellow')).toContain('Colour in play: yellow');
  });
});
