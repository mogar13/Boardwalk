/**
 * WHAT A CHAIR COSTS — the stake ladder the lobby offers a host at create time.
 *
 * The sibling of `tableSizeChoices`, and it exists for the same reason: a pre-game decision that
 * every seat at the table is bound by is OS work, not something each betting game draws for itself.
 * v1 asked "ANTE: NONE / $25 / $100 / $500 / $1K" in a `<select>` welded into UNO's start screen,
 * which is the shape this repo replaced with `manifest.options` — except an ante cannot BE a
 * `manifest.option`, because those values live in `<GameShell>` and are per-client, and a guest has
 * to know what a chair costs before sitting in it. So the ante rides the room (`RoomMeta.anteCents`)
 * and the control lives here.
 *
 * A GAME DECLARES A RANGE, NOT A LADDER. `manifest.betting` is already `{min, max}` and already
 * means "the stakes this game is played for". Handing each game its own list of rungs would be
 * v1's difficulty-vocabulary drift in a new costume — easy/normal/hard vs easy/medium/hard across
 * 22 games — so there is ONE ladder, filtered to what a game says it plays for.
 */

/** What a game declares about money. The OS's view of `manifest.betting` — a range and one flag. */
export interface BettingSpec {
  readonly min: number;
  readonly max: number;
  /** A lone player may bet: the house banks the pot. See `GameManifest.betting`. */
  readonly house?: boolean;
  /** Each chair stakes its own, every round — so there is no TABLE ante. See `GameManifest.betting`. */
  readonly perSeat?: boolean;
}

/**
 * The rungs, ascending, in integer cents. A casino ladder rather than an arithmetic one: the steps
 * a player recognises without reading them, which is the whole job of a chip denomination.
 *
 * Frozen because it is a money constant, and money constants that can be pushed onto are how a
 * ladder acquires a rung nobody priced.
 */
export const ANTE_RUNGS_CENTS: readonly number[] = Object.freeze([
  100, 500, 2_500, 10_000, 50_000, 100_000,
]);

/**
 * The stakes a host may pick from, given what the game says it is played for.
 *
 * ZERO IS ALWAYS FIRST, and it is not a rung — it is the option to play for nothing. `betting` on a
 * manifest means "this game CAN be played for money", never "must be": a table of friends who want
 * the game and not the stakes is the common case, and a picker that cannot offer it turns a betting
 * game into a gambling-only one. It is also the honest default (below).
 *
 * A range that admits no rung collapses to `[0]` — one option, which the lobby reads as "draw
 * nothing", exactly as a one-size seat range draws no size picker. A control that cannot change the
 * outcome is worse than no control, and that rule is already load-bearing twice in this file's
 * neighbours (`tableSizeChoices`, the AI-mode visibility toggle).
 *
 * Garbage in — a reversed range, a fractional bound, NaN — collapses the same way rather than
 * rendering a broken picker or, worse, offering a fractional stake that `validateBet` would refuse
 * at the moment money moved.
 */
export function anteChoices(betting?: BettingSpec): number[] {
  if (betting === undefined) return [0];
  // A PER-SEAT game has no table stake to offer. Blackjack is the only one: each chair names its
  // own wager every round, from the board, so an ante picker here would set a number nothing
  // charges — and the lobby would then print "$25 a seat · winner takes the pot" over a game with
  // no pot at all. Collapsing to `[0]` draws no control, exactly as a one-size seat range does,
  // and a control that cannot change the outcome is worse than no control.
  if (betting.perSeat === true) return [0];
  const { min, max } = betting;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [0];
  return [0, ...ANTE_RUNGS_CENTS.filter((v) => v >= min && v <= max)];
}

/**
 * The stake a fresh lobby starts on: **nothing**.
 *
 * Deliberately not the smallest rung, and the reasoning is the seat-count picker's, taken one step
 * further. That default was changed from `seats.max` to `seats.min` because a default should be the
 * one a player opening the game alone can actually use — and here the equivalent is stronger than a
 * convenience argument: money should never leave an account because somebody did not notice a
 * control. Opting IN to stakes is a decision; opting out of them must not have to be.
 */
export const DEFAULT_ANTE_CENTS = 0;

/**
 * WHO WOULD FUND THIS TABLE'S POT, as far as the OS can tell — which is only ever enough to decide
 * what to SAY and which controls to lock.
 *
 * `'players'` two or more humans anteing into a pot of their own money; `'house'` one human banked
 * by a game that declared `betting.house`; `'none'` no usable stake, or a lone player at a game
 * that never measured what its bots are worth.
 *
 * **THIS IS NOT THE AUTHORITY AND MUST NOT BECOME ONE.** The rule that decides what leaves the
 * ledger is the game's own (`potBacking` in UNO's rulebook, run by the referee); this is the same
 * question asked from the one place that cannot import a rulebook, because `src/system/room` moving
 * a bag it must not interpret is what keeps a second game's house rules from having to work around
 * UNO's. Two mechanisms for one rule is a thing this repo permits only with an assertion attached,
 * so `tests/uno-house-bet.test.ts` drives both over every table shape off the REAL manifest and
 * asserts they agree. Getting it wrong here costs a wrong sentence, never a wrong payout — but a
 * wrong sentence about money is what the ante line was already fixed once for.
 */
export type TableBacking = 'none' | 'players' | 'house';

/**
 * Two, and it is the game's number rather than the OS's — `MIN_HUMANS_TO_BET` in UNO's `pot.ts`,
 * restated here because the OS may not import a rulebook and asserted equal to it in the test named
 * above. It is the threshold between a pot made of players' money and one the house banks, not
 * between betting and not; below it there is still a game to play for money, just not one where
 * anybody's ante is somebody else's winnings.
 */
const MIN_HUMANS_FOR_A_PLAYER_POT = 2;

export function tableBacking(
  betting: BettingSpec | undefined,
  anteCents: number,
  humans: number
): TableBacking {
  if (betting === undefined) return 'none';
  if (!Number.isFinite(anteCents) || Math.floor(anteCents) <= 0) return 'none';
  if (!Number.isFinite(humans)) return 'none';
  if (humans >= MIN_HUMANS_FOR_A_PLAYER_POT) return 'players';
  if (humans === 1 && betting.house === true) return 'house';
  return 'none';
}
