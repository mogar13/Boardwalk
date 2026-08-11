/**
 * THE LINE THE BOARD SHOWS A HAND THAT CANNOT PLAY — and whether it is telling the truth.
 *
 * This is one string, and it is the smallest thing in the auto-draw slice that can lie. Before the
 * preference existed it was always safe: the board announced a draw it was always about to make.
 * The moment the draw became optional, the announcing wording became a claim about the future that
 * is FALSE for anyone who turned it off — they wait out a beat that never arrives and the table
 * looks hung, which is the same "UI that lies" this repo has now shipped and caught three times.
 *
 * It is a pure function precisely so that claim is assertable. There is no DOM in this suite and no
 * way to render UNO's board without a room, so nothing here could reach it as JSX — which is the
 * whole reason the ternary was lifted out of the markup rather than left where it was written.
 *
 * What is asserted is a PROPERTY rather than the strings: the line must promise a draw exactly when
 * one is coming. Pinning the copy alone would go green on a version that had the branches swapped.
 */
import { describe, it, expect } from 'vitest';
import { stuckLine } from '@/games/uno/components/stuckLine';
import type { UnoColor } from '@boardwalk/game-logic/games/uno';

const COLORS: readonly UnoColor[] = ['red', 'blue', 'green', 'yellow'];

/** Does this line claim the table is about to act on its own? The trailing ellipsis is the tell. */
const promisesADraw = (line: string): boolean => line.endsWith('…');
/** Does it tell the player to act? */
const instructs = (line: string): boolean => /press the deck/i.test(line);

describe('the line promises a draw exactly when one is coming', () => {
  it('announces with the preference ON, and instructs with it OFF', () => {
    // The property, over every shape the position comes in: nothing owed and a debt outstanding,
    // at every colour. Exactly one of "the table will do it" and "you do it" may be true.
    for (const color of COLORS) {
      for (const owed of [0, 1, 2, 4, 6]) {
        const on = stuckLine({ owed, color, autoDraw: true });
        const off = stuckLine({ owed, color, autoDraw: false });
        expect(promisesADraw(on), `on ${color} ${String(owed)}`).toBe(true);
        expect(instructs(on), `on ${color} ${String(owed)}`).toBe(false);
        expect(promisesADraw(off), `off ${color} ${String(owed)}`).toBe(false);
        expect(instructs(off), `off ${color} ${String(owed)}`).toBe(true);
      }
    }
  });

  it('never says the same thing in both states', () => {
    for (const color of COLORS) {
      for (const owed of [0, 3]) {
        expect(stuckLine({ owed, color, autoDraw: true })).not.toBe(
          stuckLine({ owed, color, autoDraw: false })
        );
      }
    }
  });
});

describe('the line says what the position actually is', () => {
  /**
   * A DEBT IS NOT A DRAW. Taking a +4 is a different event from drawing one card, and a line that
   * said "drawing a card" while four arrive is wrong about the table in a way a player sees at
   * once — so the debt branch names the number, and the ordinary branch names the COLOUR, which is
   * the fact `mustDraw` actually matched against.
   */
  it('names the amount owed when there is a debt, in both preference states', () => {
    for (const autoDraw of [true, false]) {
      expect(stuckLine({ owed: 4, color: 'red', autoDraw })).toContain('+4');
      expect(stuckLine({ owed: 2, color: 'red', autoDraw })).toContain('+2');
      // And it does not also quote a colour, which is not what the position is about: with a stack
      // live the legal set has collapsed and colour matching is suspended entirely.
      expect(stuckLine({ owed: 4, color: 'red', autoDraw })).not.toContain('red');
    }
  });

  it('names the ACTIVE colour when nothing is owed, at every colour', () => {
    for (const color of COLORS) {
      for (const autoDraw of [true, false]) {
        expect(stuckLine({ owed: 0, color, autoDraw })).toContain(color);
        expect(stuckLine({ owed: 0, color, autoDraw })).not.toContain('+');
      }
    }
  });
});
