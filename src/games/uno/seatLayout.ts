/**
 * WHERE EACH PLAYER SITS. Pure, and a TABLE rather than a formula.
 *
 * v1's UNO seated opponents at fixed compass points — one opponent opposite you, two on the left
 * and right, three filling left/top/right — and that is most of why its board reads as a table
 * instead of a list: you sit at the bottom, everyone else is arranged around the felt in the order
 * play reaches them. Boardwalk's board rendered every opponent into one wrapping row, which is
 * correct and says nothing.
 *
 * WHY A LOOKUP AND NOT MATHS. v1 topped out at four seats, so its three cases could be literal.
 * Boardwalk seats up to seven, which is six opponents, and every "even distribution" formula I
 * tried put two players in the left column and one at the top for five — technically balanced,
 * visibly lopsided. Six cases, chosen by eye, is the honest amount of cleverness for a layout
 * question. It is also why this is a unit-testable pure function rather than class names inline in
 * the board: `tests/uno-layout.test.ts` pins the arrangement AND the turn order through it, and an
 * arrangement that drops or duplicates a seat is exactly the bug that renders a table which looks
 * fine and is missing a player.
 *
 * ORDER IS TURN ORDER, and it runs bottom → left → top → right → back to you, so reading the table
 * clockwise from your own seat is reading the order of play. Within the left column that means
 * BOTTOM-first (the seat nearest you plays next), which is why `left` is emitted reversed: a flex
 * column renders top-down, and the seat that plays next belongs at the bottom of it, closest to you.
 *
 * Seat POSITIONS never move when a reverse card flips the direction of play — the rotating arrows
 * in the middle of the table say that instead. Re-sorting the seats would make every reverse card
 * throw the whole table across the screen, which is v1's decision too, and it is the right one.
 */

export type UnoSeatSide = 'left' | 'top' | 'right';

export interface UnoSeatSlot {
  /** The absolute seat index — what `state.counts`, `state.turn` and `seats[]` are keyed by. */
  readonly seat: number;
  readonly side: UnoSeatSide;
}

/** How many opponents each side takes, by opponent count. Six entries; six real cases. */
const SIDES: Readonly<Record<number, readonly [left: number, top: number, right: number]>> = {
  0: [0, 0, 0],
  1: [0, 1, 0], // heads-up: directly opposite you
  2: [1, 0, 1], // flanking, nobody opposite — v1's three-player table
  3: [1, 1, 1], // v1's four-player table
  4: [1, 2, 1],
  5: [2, 1, 2],
  6: [2, 2, 2],
};

/**
 * The opponents of `mySeat` at a table of `seatCount`, in turn order, each with the side it sits on.
 *
 * A spectator (`mySeat < 0`, nobody's seat) reads the table from seat 0 so the board still draws
 * every player rather than collapsing — the same fallback the old `turnDistance` made, kept.
 */
export function opponentSlots(mySeat: number, seatCount: number): UnoSeatSlot[] {
  if (seatCount <= 1) return [];
  const me = mySeat < 0 || mySeat >= seatCount ? 0 : mySeat;
  const opponents = seatCount - 1;
  const [leftCount, topCount, rightCount] = SIDES[opponents] ?? SIDES[6] ?? [0, 0, 0];

  // Turn order starting after me, wrapping the table.
  const inTurnOrder: number[] = [];
  for (let step = 1; step <= opponents; step += 1) inTurnOrder.push((me + step) % seatCount);

  const take = (n: number): number[] => inTurnOrder.splice(0, n);
  const left = take(leftCount);
  const top = take(topCount);
  const right = take(rightCount);

  return [
    // Reversed: the next player up sits at the BOTTOM of the left column, nearest you.
    ...left.reverse().map((seat): UnoSeatSlot => ({ seat, side: 'left' })),
    ...top.map((seat): UnoSeatSlot => ({ seat, side: 'top' })),
    ...right.map((seat): UnoSeatSlot => ({ seat, side: 'right' })),
  ];
}

/** The slots for one side, in render order. The board draws three columns from these. */
export function slotsOn(slots: readonly UnoSeatSlot[], side: UnoSeatSide): UnoSeatSlot[] {
  return slots.filter((s) => s.side === side);
}

/** A card in your hand, in rem, at the size the board draws them. */
const CARD_W_REM = 4.3;
/** How much of the fan the board will let itself use before it starts tightening. */
const FAN_WIDTH_REM = 34;
/** The loosest fan: a comfortable hand shows most of every card. */
const MIN_OVERLAP_REM = 2.1;
/** The tightest: past this a card is a stripe and you cannot tell one from another. */
const MAX_OVERLAP_REM = 3.5;

/**
 * How far each card in YOUR hand slides back over the one before it, in rem.
 *
 * A fixed overlap is what a hand of seven wants and what a hand of twenty cannot have — and twenty
 * is entirely reachable, because drawing is what you do when you cannot play and a stacked table
 * punishes one player hard. v1 never solved this (its hand simply ran off both edges of the phone).
 * So the fan TIGHTENS with the hand: loose while it is comfortable, clamped at the point where more
 * tightening would turn the cards into stripes, and the board keeps `overflow-x-auto` behind it as
 * the backstop for the pathological case rather than pretending there is a fan for every hand size.
 */
export function handOverlapRem(count: number): number {
  if (count <= 1) return MIN_OVERLAP_REM;
  // Width of the fan = one whole card, then a visible sliver of each of the rest.
  const needed = (FAN_WIDTH_REM - CARD_W_REM) / (count - 1);
  const overlap = CARD_W_REM - needed;
  return Math.min(MAX_OVERLAP_REM, Math.max(MIN_OVERLAP_REM, overlap));
}
