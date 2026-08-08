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
import { formatMoney } from '@boardwalk/game-logic';

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
export function anteChoices(betting?: { readonly min: number; readonly max: number }): number[] {
  if (betting === undefined) return [0];
  const { min, max } = betting;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [0];
  return [0, ...ANTE_RUNGS_CENTS.filter((v) => v >= min && v <= max)];
}

/**
 * A HAND-TYPED STAKE, read. Either integer cents inside the game's declared range, or a sentence
 * saying what to do about it.
 *
 * The ladder is six rungs a player recognises without reading them, and it is the right default —
 * but it is also the whole of what a table could ever be played for, and "$25 or $100, nothing
 * between" is a picker deciding a thing the people at the table are better placed to decide. So a
 * host may type one. The rungs stay: a ladder is what you want when you do not care, and a field is
 * what you want when you do.
 *
 * IT REFUSES RATHER THAN ROUNDS, in both directions, and that is the `parseInt` war story showing
 * up on the input side of the same number. `validateBet` REFUSES a fractional bet rather than
 * rounding it, so a stake that arrives as `2550.4` does not become a cheaper table — it becomes a
 * table whose deal fails at the exact moment money moves, with the host already sat down. Cents are
 * assembled from the STRING's own digits and never from `value * 100`, because `Number('12.10') *
 * 100` is `1209.9999999999998` and `Math.round` hiding that is how a rounding rule gets written
 * accidentally.
 *
 * THE RANGE IS THE GAME'S, unchanged: `betting.min`..`betting.max` is already "the stakes this game
 * is played for", so typing is a finer grain within it and never a way past it. Zero is NOT
 * accepted here even though it is the ladder's first rung — "None" is a button, and a field that
 * silently means the same thing as a button is two controls for one value.
 *
 * The error strings are the caller's copy and say what to do (`Input`'s own rule: "Bet more than
 * $2" beats "Invalid"), because a field that only says a value is wrong makes the reader guess
 * which of three rules they broke.
 */
export type AnteParse =
  { readonly ok: true; readonly cents: number } | { readonly ok: false; readonly error: string };

export function parseAnte(text: string, betting?: BettingSpec): AnteParse {
  // Unreachable from the panel (no `betting` means no ante control at all), and answered rather
  // than thrown: a total function has no branch a caller has to remember to guard.
  if (betting === undefined) return { ok: false, error: 'This game is not played for money' };
  const { min, max } = betting;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min)
    return { ok: false, error: 'This game is not played for money' };

  // A `$` and thousands separators are what a person types when asked for money, not a mistake.
  const cleaned = text.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (cleaned === '') return { ok: false, error: 'Enter an amount' };

  const m = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  const whole = m?.[1] ?? '';
  const frac = m?.[2] ?? '';
  if (m === null || (whole === '' && frac === ''))
    return { ok: false, error: 'Numbers only — 250, or 12.50' };
  if (frac.length > 2) return { ok: false, error: 'Cents only — two decimal places at most' };

  const cents = Number(whole === '' ? '0' : whole) * 100 + Number((frac + '00').slice(0, 2));
  // Past 2^53 the arithmetic above stops being exact, and an inexact number of cents is the one
  // thing a ledger row must never hold.
  if (!Number.isSafeInteger(cents)) return { ok: false, error: 'That is more than anyone has' };

  if (cents < min || cents > max)
    return { ok: false, error: `Between ${formatMoney(min)} and ${formatMoney(max)}` };
  return { ok: true, cents };
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

/** What a game declares about money. The OS's view of `manifest.betting` — a range and one flag. */
export interface BettingSpec {
  readonly min: number;
  readonly max: number;
  /** A lone player may bet: the house banks the pot. See `GameManifest.betting`. */
  readonly house?: boolean;
}

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
