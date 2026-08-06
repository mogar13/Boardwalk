/**
 * STACKING — the house rule everybody actually plays: a +2 played at you can be answered with your
 * own +2, and the debt accumulates until somebody cannot answer and takes the lot.
 *
 * Slice 2 of `plans/done/UNO_HOUSE_RULES.md`. It rides the seam slice 1 built: `stack`/`crossStack` are
 * booleans on the TABLE (chosen at create, stamped onto the round by `deal`, published by
 * `toPublic`), so the referee and every client read the same two flags and `unoStart` still has no
 * field for either.
 *
 * WHY THIS IS ITS OWN FILE. `uno.ts` is the rulebook's front door and it is already 650 lines
 * against an 800-line ceiling; the stack's own predicates are self-contained and belong beside
 * `houseRules.ts` and `pot.ts` rather than inside it. It imports only TYPES from `./uno`, so there
 * is no runtime cycle — `verbatimModuleSyntax` erases the import entirely and the module graph runs
 * one way, `uno.ts` → here.
 */

import { resolveHouseRules, type UnoHouseRules } from './houseRules';
import type { Card, UnoColor } from './uno';

/**
 * THE POSITION A CARD IS PLAYED INTO — the four facts that decide whether it may be.
 *
 * It exists because `canPlay(card, top, color)` grew a fourth and fifth input and three loose
 * arguments is how a call site ends up passing "the top card and the colour" while silently meaning
 * "and no stack". Every read site now takes the position WHOLE, so a caller cannot supply most of
 * it: the two new facts are not defaulted anywhere, which is the point of the signature change.
 *
 * `UnoState` — the wire projection — extends this, so a client passes the state it already has and
 * the reducer builds one with `tableOf`. That is what makes the board's feel check and the
 * referee's enforcement literally the same call.
 */
export interface UnoTable {
  readonly top: Card;
  /** The active colour — a wild sets this; otherwise the top card's own. */
  readonly color: UnoColor;
  /**
   * CARDS OWED to whoever is on turn, or `0`. Wire-safe as a number rather than an optional: the
   * wire drops null/undefined children, and "nothing owed" is a real value, not an absence.
   *
   * Read it through `drawDebt` and never directly — see there for the two ways a raw field lies.
   */
  readonly pendingDraw: number;
  /**
   * THE RULES THIS ROUND IS BEING PLAYED UNDER, so every client's feel check reads the same
   * booleans the referee enforced.
   *
   * `canPlay`/`mustDraw` are what dim a card and what arm the auto-draw, and they are advisory —
   * the referee decides. That is exactly why they must not disagree: a client that thought stacking
   * was off would grey out the +2 the rules would have accepted, and one that thought it was on
   * would offer a click the dealer refuses. Neither is a crash and both are unplayable.
   */
  readonly houseRules: UnoHouseRules;
}

/**
 * WHAT THIS TABLE OWES — the one reader of `pendingDraw`, and the reason the field is never read
 * directly anywhere.
 *
 * A raw `pendingDraw` can lie in two directions, and both are reachable rather than theoretical:
 *
 *   • THE DEPLOY ORDER. The frontend ships on push and the Pi by hand, so a new client WILL read a
 *     projection from a referee that has never heard of this field. `undefined` typechecks as
 *     `number` and every comparison against it is quietly false — which happens to be the right
 *     answer here (a server not running stacking is not running any), but only because this is the
 *     one place that decides it. `houseRules` can be absent for the same reason, and
 *     `undefined.stack` is a TypeError that takes the board down, so it is resolved rather than
 *     indexed.
 *   • A DEBT WITHOUT THE RULE. `stack` off means no stack exists, whatever a number says, so the
 *     flags are the authority and the counter is subordinate to them. Anything else lets one
 *     stale field collapse the legal set at a table that never agreed to play that way.
 *
 * So: not stacking → nothing owed; anything non-finite, negative or fractional → nothing owed.
 * Never throws, exactly like `resolveHouseRules`, and for the same reason — a reducer reading a
 * rule must never have to handle a value the table could not have offered.
 */
export function drawDebt(table: UnoTable): number {
  if (!resolveHouseRules(table.houseRules).stack) return 0;
  const n: unknown = table.pendingDraw;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * May `card` be played onto a LIVE stack? This is the whole of stacking's legality rule, and it is
 * a REPLACEMENT for colour/value matching rather than an addition to it: while a debt stands you
 * are answering it, not following a card, so a red 5 on a red +2 is refused and a plain wild — which
 * plays on anything in the ordinary game — is refused too, because it draws nobody anything.
 *
 * THE LADDER IS DELIBERATELY ASYMMETRIC, and this is the part that is easy to get wrong by making
 * it tidy. A +4 may answer a +2 (with `crossStack`), and a +2 may NEVER answer a +4 — that is the
 * rule as it is actually played, and the reason it is not symmetric is that a stack must terminate:
 * if the smaller card could always answer the bigger, a table holding enough +2s could keep a
 * single +4 alive indefinitely and the debt would only ever grow.
 *
 * `crossStack` is checked here and nowhere else, and it is already NORMALISED off without `stack`
 * by `resolveHouseRules` — so this function never spells `stack && crossStack` and cannot forget to.
 */
export function answersStack(card: Card, top: Card, rules: UnoHouseRules): boolean {
  if (card.kind === 'draw2') return top.kind === 'draw2';
  if (card.kind === 'wild4')
    return top.kind === 'wild4' || (rules.crossStack && top.kind === 'draw2');
  return false;
}
