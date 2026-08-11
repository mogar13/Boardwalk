import type { UnoColor } from '@boardwalk/game-logic/games/uno';

/**
 * WHAT THE BOARD SAYS TO A HAND THAT CANNOT PLAY — the one line under the fan, as a pure function.
 *
 * It is a function rather than a ternary in the JSX because it became a CLAIM ABOUT THE FUTURE the
 * moment auto-draw became optional. "…drawing a card…" is the board promising a move it is about to
 * make; with the preference off, nobody makes it, so the player waits out a beat that never comes
 * and the table looks hung. That is the UI that lies, in three words, and it is invisible to every
 * static tool in this repo — the classes are right, the string interpolates, the branch typechecks.
 *
 * So the verb is the thing being decided here, and it is decided in one place with a test on it.
 * Extracting it costs a file and buys the only form of the assertion that exists: there is no DOM
 * in this suite and no way to render this board without a room, so "the line matches the behaviour"
 * is not assertable about the JSX and is entirely assertable about this.
 *
 * The DEBT branch is separate copy rather than a synonym: taking a +4 is not the same event as
 * drawing one card, and a line that said "drawing a card" while four arrive is wrong about the
 * table in a way a player notices immediately.
 */
export function stuckLine(args: {
  /** What the table owes this seat — `drawDebt`, never `pendingDraw` raw. `0` for nothing owed. */
  readonly owed: number;
  /** The ACTIVE colour, which is what `mustDraw` matched against — not the top card's own colour. */
  readonly color: UnoColor;
  /** Whether this player has the auto-draw preference on. The whole reason this branches. */
  readonly autoDraw: boolean;
}): string {
  const { owed, color, autoDraw } = args;
  if (owed > 0) {
    return autoDraw
      ? `Nothing answers the +${String(owed)} — taking it…`
      : `Nothing answers the +${String(owed)} — press the deck to take it.`;
  }
  return autoDraw
    ? `Nothing matches ${color} — drawing a card…`
    : `Nothing matches ${color} — press the deck to draw.`;
}
