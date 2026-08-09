/**
 * WHERE EACH CHAIR SITS ON THE ARC. Pure, and the one piece of geometry this board has.
 *
 * A blackjack table is a HALF-MOON: the dealer stands at the straight edge and the players sit
 * along the curve, which bulges toward the viewer. So a chair near the middle of the arc is
 * FURTHEST from the dealer — lowest on screen — and the chairs at either end ride up toward the
 * dealer's own row. That single fact is what makes a drawing of this game read as a table rather
 * than as a row of hands, and Boardwalk's board did not have it: `state.spots.map` into a
 * `flex flex-wrap gap-4` is a scoreboard that happens to contain cards, which is the exact defect
 * UNO's board rebuild fixed one game over ("a seat is a hand on a table, not a row in a panel").
 *
 * **IT DOES NOT ROTATE YOU TO THE MIDDLE, AND THAT IS THE DIFFERENCE FROM `uno/seatLayout.ts`.**
 * UNO seats you at the bottom and arranges everyone else around you, which is free there because
 * an UNO table is a CIRCLE: rotating a cycle preserves the cycle, so reading clockwise from your
 * own seat still reads the order of play. An arc is not a cycle. Rotating it would put seat 3 to
 * the left of seat 0 on one screen and to the right on another, and blackjack's turn order is
 * simply seat order — the dealer works along the arc and acts last. So chairs render in seat
 * order, left to right, on every screen, and YOUR chair is MARKED rather than moved. Reading the
 * table left to right is reading who plays next, which is the property worth keeping; knowing
 * which one is yours is a nameplate.
 *
 * `tests/blackjack-layout.test.ts` pins both halves — every chair placed exactly once, and the
 * curve symmetric with its low point in the middle — because a layout that drops or duplicates a
 * seat still renders a table that looks completely fine and is missing a player.
 */

/** One chair's place on the arc. Array order is LEFT TO RIGHT, which is also seat order. */
export interface BlackjackSeatSlot {
  /** The absolute seat index — what `state.spots`, `state.turn` and `seats[]` are keyed by. */
  readonly seat: number;
  /**
   * How far DOWN the felt this chair sits, in rem, measured from the top of the arc. Larger is
   * lower on screen and therefore further from the dealer. Always ≥ 0.
   */
  readonly dropRem: number;
}

/**
 * How deep the arc is, in rem — the gap between the highest chair and the lowest.
 *
 * Chosen by eye against a 7rem card: much less and the curve is not legible as one, much more and
 * a four-chair table wastes a card's height of felt on an effect. The board also has to fit beside
 * a 20rem sidebar at `lg`, so vertical budget here is not free.
 */
const ARC_DROP_REM = 1.6;

/**
 * How much of the arc's half-width the chairs actually occupy, as a fraction.
 *
 * Not 1. At exactly 1 the outermost chairs sit at the very ends of the curve, where the drop is
 * zero — so a TWO-chair table (the smallest this game deals) would put both players level with the
 * dealer, on the flat part, with no curve between them at all. Pulling the span in leaves both
 * chairs on the sloped part of the arc, so even the smallest table reads as a table. It is a
 * layout constant, so it was picked by looking at it.
 */
const ARC_SPAN = 0.72;

/**
 * The chairs of a `seatCount`-handed table, left to right, each with how far down the arc it sits.
 *
 * A solo hand (`seatCount === 1`) is one chair at dead centre, which is the deepest point of the
 * arc and exactly where a single player sits at a real table. Zero or a nonsense count is an empty
 * array rather than a throw: it is reachable from a room snapshot that has not loaded, and a board
 * that draws no chairs for a beat is recoverable where one that throws takes the page down.
 */
export function seatArc(seatCount: number): BlackjackSeatSlot[] {
  if (!Number.isFinite(seatCount) || seatCount < 1) return [];
  const count = Math.floor(seatCount);
  if (count === 1) return [{ seat: 0, dropRem: ARC_DROP_REM }];

  return Array.from({ length: count }, (_, seat) => {
    // Normalised position across the arc: -ARC_SPAN at the far left, +ARC_SPAN at the far right.
    const t = ARC_SPAN * ((2 * seat) / (count - 1) - 1);
    // A parabola standing in for the circle. Over this span the two are within a hair of each
    // other, and this one cannot produce a NaN from a rounding error near the ends.
    return { seat, dropRem: ARC_DROP_REM * (1 - t * t) };
  });
}
