/**
 * LIAR'S DICE (Dudo) — the rulebook, pure.
 *
 * Every player hides five dice under a cup and bids on how many of a face are on the WHOLE table.
 * You raise or you call. The whole game is the gap between what you can see and what you must
 * guess, which is why this file's most important property is the one it does not have: no function
 * here can be handed a seat and asked what someone else is holding without the caller already
 * holding the full match. That is what `view.ts` is for.
 *
 * WHY THE REDUCER IS TOTAL. `applyAction` answers every input with a match — an illegal bid, a
 * challenge from the wrong seat, an action on a finished match all return the input unchanged.
 * That is what lets the referee hand a wire action straight in without pre-validating it: the
 * rules are the validator, in one place, rather than a check in the gateway that can drift from a
 * check in the reducer. UNO and Chess make the same promise for the same reason.
 *
 * RANDOMNESS IS INJECTED, never called. Every roll takes an `rng: () => number`, so a test can
 * hand in a sequence and assert an exact table, and the referee can persist the outcome it rolled.
 * A reducer that reached for `Math.random` would be untestable AND unreplayable — and a replayed
 * action that re-rolls is a retry turning a loss into a win.
 *
 * WHAT V1 GOT WRONG, since these rules are paid for by those defects (Game-Shack `liars_dice`):
 *   - `dieCounts` was hardcoded `[5,5,5,5]` regardless of player count, so two ghost seats sat at
 *     five dice forever and a 2- or 3-player match could NEVER be won. Here the match is built
 *     from `seatCount` and nothing is sized by a literal.
 *   - 1s were wild but ordered as merely the top face, making "three 1s" a one-step raise over
 *     "three 6s" despite being twice as hard. See `isLegalRaise` for the conversion that fixes it.
 *   - No turn authority: the bid handler trusted a CSS `pointer-events` gate, so a console call
 *     during a bot's turn attributed your bid to the bot. Here `seat !== match.turn` is a no-op.
 */

/** A die face. 1s are wild except in palifico. */
export type Face = 1 | 2 | 3 | 4 | 5 | 6;

export const DICE_PER_PLAYER = 5;
export const MIN_SEATS = 2;
export const MAX_SEATS = 6;

/** A claim about the whole table: `quantity` dice showing `face` (wilds included, outside palifico). */
export interface Bid {
  readonly quantity: number;
  readonly face: Face;
}

export type Action =
  | { readonly type: 'bid'; readonly quantity: number; readonly face: Face }
  | { readonly type: 'challenge' }
  | { readonly type: 'spotOn' };

/**
 * `bidding` takes actions; `reveal` is the frozen moment after a call, when every cup is open and
 * the projection publishes what it previously hid. A phase, not a renderer flag — a client must
 * never be sent dice it is merely expected not to draw.
 */
export type Phase = 'bidding' | 'reveal' | 'finished';

/** What the last call resolved to — the reveal screen reads this, and only this. */
export interface Resolution {
  readonly kind: 'challenge' | 'spotOn';
  /** Who called. */
  readonly caller: number;
  /** The bid under test. */
  readonly bid: Bid;
  /** How many dice actually showed that face, wilds counted per the round's rules. */
  readonly actual: number;
  /** Whether the CALLER was right. */
  readonly callerWon: boolean;
  /** Seats that lost a die to this call. Several, when a spot-on lands. */
  readonly losers: readonly number[];
  /** Seats knocked out by it. */
  readonly eliminated: readonly number[];
}

export interface LiarsDiceMatch {
  /** `dice[seat]` — every die that seat holds. An eliminated seat holds `[]`. */
  readonly dice: readonly (readonly Face[])[];
  readonly turn: number;
  readonly bid: Bid | null;
  readonly phase: Phase;
  /**
   * PALIFICO. Set for a round opened by a player down to their last die: 1s stop being wild and
   * the face is locked to whatever the opener names, so everyone may only raise the quantity.
   * `-1` when the round is ordinary — a sentinel rather than `null` because this state crosses
   * RTDB on the fallback path, which drops null children (the Tic-Tac-Toe bug).
   */
  readonly palificoSeat: number;
  /** The face locked by a palifico opener, or `-1` before the opening bid / outside palifico. */
  readonly lockedFace: number;
  readonly resolution: Resolution | null;
  /** `-1` until the match ends. */
  readonly winner: number;
  /** Bumped on every completed round; the client keys its `reportResult` ref on it. */
  readonly round: number;
}

// ── rolling ──────────────────────────────────────────────────────────────────────────────────

/** One die. Injected rng, so a test can hand in an exact sequence. */
function rollDie(rng: () => number): Face {
  return (Math.floor(rng() * 6) + 1) as Face;
}

/** `count` dice, sorted ascending — a cup has no order, and sorting makes a hand readable. */
export function rollDice(count: number, rng: () => number): Face[] {
  return Array.from({ length: count }, () => rollDie(rng)).sort((a, b) => a - b);
}

/** How many dice are on the table across every seat. */
export function totalDice(match: LiarsDiceMatch): number {
  return match.dice.reduce((n, hand) => n + hand.length, 0);
}

/** Seats still holding dice. */
export function livingSeats(match: LiarsDiceMatch): number[] {
  const out: number[] = [];
  match.dice.forEach((hand, i) => {
    if (hand.length > 0) out.push(i);
  });
  return out;
}

/** Is this round palifico — 1s dead, face locked? */
export function isPalifico(match: LiarsDiceMatch): boolean {
  return match.palificoSeat >= 0;
}

// ── counting ─────────────────────────────────────────────────────────────────────────────────

/**
 * How many dice on the table show `face`.
 *
 * Wilds are counted OUTSIDE palifico only, and never when the bid itself is on 1s (a 1 cannot be
 * wild for itself and be counted twice). v1 counted `val === face || val === 1` unconditionally,
 * which double-counts every 1 on a bid of 1s.
 */
export function countFace(match: LiarsDiceMatch, face: Face): number {
  const wild = !isPalifico(match) && face !== 1;
  let n = 0;
  for (const hand of match.dice)
    for (const die of hand) if (die === face || (wild && die === 1)) n += 1;
  return n;
}

// ── the bid ladder ───────────────────────────────────────────────────────────────────────────

/**
 * THE WILD-ONES CONVERSION, and the rule v1 did not have.
 *
 * Because 1s count as every face they are roughly twice as easy to have and twice as hard to
 * claim, so a ladder that treats them as a sixth face lets "three 1s" raise "three 6s" for free.
 * The standard Dudo conversion instead:
 *
 *   - switching TO 1s      → at least `ceil(current / 2)`
 *   - switching OFF 1s     → at least `current * 2 + 1`
 *
 * So "seven 5s" → "four 1s" is legal, and "four 1s" → "nine 6s" is the cheapest way back out.
 * Within one face family it is the ordinary rule: more dice, or the same dice at a higher face.
 *
 * In PALIFICO the face is locked by the opener and only the quantity may rise — and since 1s are
 * not wild there, no conversion applies at all.
 */
export function isLegalRaise(match: LiarsDiceMatch, next: Bid): boolean {
  if (next.quantity < 1 || !Number.isInteger(next.quantity)) return false;
  if (next.quantity > totalDice(match)) return false;

  const current = match.bid;
  if (current === null) {
    // THE OPENING BID MAY NOT BE ON WILDS — but only where 1s actually ARE wild. Opening on 1s
    // outside palifico would force everyone straight into the doubling conversion below from the
    // first word of the round, which is the standard Dudo ban. Inside palifico 1s are an ordinary
    // face with no conversion attached, so there is nothing to ban and the opener may name them.
    return isPalifico(match) || next.face !== 1;
  }

  if (isPalifico(match)) {
    // Face locked; quantity only.
    return next.face === current.face && next.quantity > current.quantity;
  }

  const toWild = next.face === 1 && current.face !== 1;
  const fromWild = current.face === 1 && next.face !== 1;

  if (toWild) return next.quantity >= Math.ceil(current.quantity / 2);
  if (fromWild) return next.quantity >= current.quantity * 2 + 1;

  // Same family: strictly more dice, or the same count at a higher face.
  if (next.quantity > current.quantity) return true;
  return next.quantity === current.quantity && next.face > current.face;
}

// ── the reducer ──────────────────────────────────────────────────────────────────────────────

/** A fresh match: `seatCount` cups of five, seat 0 to open. */
export function deal(seatCount: number, rng: () => number): LiarsDiceMatch {
  const seats = Math.max(MIN_SEATS, Math.min(MAX_SEATS, Math.floor(seatCount)));
  return {
    dice: Array.from({ length: seats }, () => rollDice(DICE_PER_PLAYER, rng)),
    turn: 0,
    bid: null,
    phase: 'bidding',
    palificoSeat: -1,
    lockedFace: -1,
    resolution: null,
    winner: -1,
    round: 0,
  };
}

/** The next living seat after `from`, wrapping. Returns `from` if it is the only one left. */
function nextLiving(match: LiarsDiceMatch, from: number): number {
  const n = match.dice.length;
  for (let step = 1; step <= n; step += 1) {
    const i = (from + step) % n;
    if ((match.dice[i]?.length ?? 0) > 0) return i;
  }
  return from;
}

/**
 * Open the next round: re-roll every living cup, decide palifico, and seat the opener.
 *
 * V1 ALWAYS OPENED AT SEAT 0 regardless of who lost, and that is kept here deliberately (the
 * owner declined loser-leads). If it reads wrong in play with palifico live, this is the one line
 * to change: `turn: opener` below already takes a seat, so loser-leads is passing the loser in.
 */
function startRound(match: LiarsDiceMatch, rng: () => number): LiarsDiceMatch {
  const living = livingSeats(match);
  const opener = living.includes(0) ? 0 : (living[0] ?? 0);
  // Palifico when the opener is down to their last die. Only the OPENER's count decides it, so a
  // table with two one-die players does not stack the rule.
  const palifico = (match.dice[opener]?.length ?? 0) === 1 && living.length > 1;
  return {
    ...match,
    dice: match.dice.map((hand) => (hand.length > 0 ? rollDice(hand.length, rng) : [])),
    turn: opener,
    bid: null,
    phase: 'bidding',
    palificoSeat: palifico ? opener : -1,
    lockedFace: -1,
    resolution: null,
    round: match.round + 1,
  };
}

/** Take one die off each named seat and report who that knocked out. */
function removeDice(
  dice: readonly (readonly Face[])[],
  losers: readonly number[]
): { dice: Face[][]; eliminated: number[] } {
  const next = dice.map((hand) => hand.slice());
  const eliminated: number[] = [];
  for (const seat of losers) {
    const hand = next[seat];
    if (hand === undefined || hand.length === 0) continue;
    hand.pop();
    if (hand.length === 0) eliminated.push(seat);
  }
  return { dice: next, eliminated };
}

/**
 * Resolve a call. Shared by challenge and spot-on because the only differences are which
 * comparison decides it and who pays — and writing that twice is how the two drift.
 */
function resolveCall(
  match: LiarsDiceMatch,
  seat: number,
  kind: 'challenge' | 'spotOn'
): LiarsDiceMatch {
  const bid = match.bid;
  if (bid === null) return match;

  const actual = countFace(match, bid.face);
  const living = livingSeats(match);

  let callerWon: boolean;
  let losers: number[];

  if (kind === 'challenge') {
    // The bid is a lie when the table cannot cover it. The bidder pays, or the challenger does.
    callerWon = actual < bid.quantity;
    losers = callerWon ? [bidderOf(match)] : [seat];
  } else {
    // SPOT-ON is the asymmetric play: exactly right costs EVERY other living seat a die, wrong
    // costs only the caller. That swing is what gives a losing position a way back in, and it is
    // why it is worth the risk of calling it.
    callerWon = actual === bid.quantity;
    losers = callerWon ? living.filter((s) => s !== seat) : [seat];
  }

  const { dice, eliminated } = removeDice(match.dice, losers);
  const resolution: Resolution = { kind, caller: seat, bid, actual, callerWon, losers, eliminated };
  const survivors = dice.filter((hand) => hand.length > 0).length;

  return {
    ...match,
    dice,
    phase: survivors <= 1 ? 'finished' : 'reveal',
    resolution,
    winner: survivors <= 1 ? dice.findIndex((hand) => hand.length > 0) : -1,
  };
}

/**
 * Who made the standing bid. Derived from the turn order rather than stored, because a stored
 * bidder is a second source of truth for a fact the turn already determines — the `level`/`xp`
 * rule, one layer down. The bidder is the living seat immediately before whoever is on turn.
 */
function bidderOf(match: LiarsDiceMatch): number {
  const n = match.dice.length;
  for (let step = 1; step <= n; step += 1) {
    const i = (match.turn - step + n * 2) % n;
    if ((match.dice[i]?.length ?? 0) > 0) return i;
  }
  return match.turn;
}

/**
 * THE REDUCER. Total: any illegal action returns `match` unchanged, so the caller never has to ask
 * permission first.
 *
 * IT TAKES NO RNG, AND THAT IS A GUARANTEE RATHER THAN AN OVERSIGHT. Every roll in this game
 * happens in `deal` or `advanceRound`; an action only ever reads the dice that are already on the
 * table. So applying the same action to the same match twice yields the same match — which is
 * what makes a replayed action safe at the referee. A reducer that re-rolled inside an action
 * would turn a retried request into a fresh roll, and a flaky connection into a way to re-take a
 * challenge you just lost.
 */
export function applyAction(match: LiarsDiceMatch, seat: number, action: Action): LiarsDiceMatch {
  if (match.phase !== 'bidding') return match;
  if (match.winner !== -1) return match;
  if (seat !== match.turn) return match;
  if ((match.dice[seat]?.length ?? 0) === 0) return match;

  if (action.type === 'bid') {
    const face = action.face;
    if (face < 1 || face > 6 || !Number.isInteger(face)) return match;
    const bid: Bid = { quantity: action.quantity, face };
    if (!isLegalRaise(match, bid)) return match;
    return {
      ...match,
      bid,
      // A palifico opener's face is the locked one for the rest of the round.
      lockedFace: isPalifico(match) && match.bid === null ? face : match.lockedFace,
      turn: nextLiving(match, seat),
    };
  }

  // A call needs something to call. Opening with `challenge` is a no-op, not a crash.
  if (match.bid === null) return match;
  return resolveCall(match, seat, action.type === 'spotOn' ? 'spotOn' : 'challenge');
}

/**
 * Leave the reveal and open the next round. Separate from `applyAction` because the reveal is a
 * TIMED state the referee steps out of, not something a player does — and folding it into the
 * reducer would let one player's click skip everyone else's look at the dice.
 */
export function advanceRound(match: LiarsDiceMatch, rng: () => number): LiarsDiceMatch {
  if (match.phase !== 'reveal') return match;
  return startRound(match, rng);
}

// ── the house ────────────────────────────────────────────────────────────────────────────────

/**
 * The bot, and a real upgrade on v1's — which raised the quantity by exactly one every turn,
 * always swung the face to its own best face (telegraphing its hand every single turn), never bid
 * 1s at all, and whose three difficulty levels differed by ONE INTEGER in the challenge threshold.
 *
 * This one reasons from the expectation over unknown dice: outside palifico a given face is hit by
 * ⅓ of unseen dice (the face itself plus wilds), inside palifico by ⅙. It counts what it holds,
 * adds the expectation for what it cannot see, and calls when the standing bid is implausible
 * past a tolerance that TIGHTENS as it runs out of dice — a bot on its last die is desperate, and
 * plays like it.
 *
 * It bluffs. `rng` decides whether to raise the face instead of the quantity, and how far past its
 * own comfort it is willing to claim, so it is not readable off the table the way v1's was — and
 * because the rng is injected, all of it is still exactly testable.
 */
export function chooseAiAction(match: LiarsDiceMatch, seat: number, rng: () => number): Action {
  const mine = match.dice[seat] ?? [];
  const unknown = totalDice(match) - mine.length;
  const wildOn = !isPalifico(match);
  const hitRate = wildOn ? 1 / 3 : 1 / 6;

  /** What I hold toward `face`, wilds included where they count. */
  const held = (face: Face): number =>
    mine.filter((d) => d === face || (wildOn && face !== 1 && d === 1)).length;
  /** What I'd expect the table to hold in total. */
  const expected = (face: Face): number =>
    held(face) + unknown * (face === 1 && wildOn ? 1 / 6 : hitRate);

  const faces: Face[] = [2, 3, 4, 5, 6, 1];
  const current = match.bid;

  if (current !== null) {
    const plausible = expected(current.face);
    // Tighter tolerance the fewer dice I hold — with one die left a loose call ends me.
    const tolerance = mine.length <= 1 ? 0.5 : mine.length <= 2 ? 1 : 1.5;

    // SPOT-ON when the bid sits almost exactly on the expectation and the table is small enough
    // for that to be more than a coin flip. Rare on purpose: it is the high-variance play.
    if (totalDice(match) <= 6 && Math.abs(plausible - current.quantity) < 0.35 && rng() < 0.18) {
      return { type: 'spotOn' };
    }

    if (current.quantity > plausible + tolerance) return { type: 'challenge' };
  }

  /**
   * EVERY candidate is filtered through `isLegalRaise`, opening included — the house may not
   * return an action the reducer will refuse. It is not a style point: `applyAction` is total, so
   * an illegal bot action is a NO-OP, and a no-op on a bot's turn is a table that stalls forever
   * on an unchanged state with nobody able to move. A first draft picked the bot's strongest face
   * for an opening bid without checking it, and a palifico round opened by a bot holding 1s hung
   * exactly that way. Choosing from a legal set makes the whole class unspellable.
   */
  const rungs = (face: Face): number[] =>
    current === null
      ? [Math.max(1, Math.round(expected(face))), 1]
      : [
          current.quantity, // the same dice at a higher face — v1's bot never used this rung
          current.quantity + 1,
          Math.max(1, Math.ceil(current.quantity / 2)), // the conversion INTO wilds
          current.quantity * 2 + 1, // and back out of them
        ];

  const legal = faces
    .flatMap((face) => rungs(face).map((quantity) => ({ quantity, face })))
    .filter((b) => isLegalRaise(match, b));

  // Nothing legal left to say. With a standing bid that means the ladder is exhausted, which is
  // itself a reason to call; with no standing bid it cannot happen on a table that has dice.
  if (legal.length === 0) return { type: 'challenge' };

  /**
   * RANK BY RISK PER FACE, not by distance from one number.
   *
   * A first draft scored every candidate against a single global `target`, which cannot tell
   * "four 1s while I hold three of them" (safe) from "eight 2s" (a bluff) — they are the same
   * distance from a target of six. Risk is `quantity - expected(face)`: how far past what I
   * believe this claim reaches. Ranking by it makes the wild conversion fall out for free, since
   * halving the quantity to switch to 1s is often the safest thing on the board, and it is
   * exactly the rung v1's house could not spell.
   */
  const risk = (b: Bid): number =>
    b.quantity - expected(b.face) + (b.face === 1 && wildOn ? 0.4 : 0);
  const bluffing = rng() < 0.25;
  legal.sort((a, b) => risk(a) - risk(b));

  // A bluff takes the second-safest rung instead of the safest, so the house is not readable off
  // the table the way v1's was — it swung to its own best face every single turn.
  const pick = (bluffing ? (legal[1] ?? legal[0]) : legal[0]) as Bid;
  return { type: 'bid', quantity: pick.quantity, face: pick.face };
}
