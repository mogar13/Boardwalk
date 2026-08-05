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
 * The stake a fresh lobby starts on: **nothing**.
 *
 * Deliberately not the smallest rung, and the reasoning is the seat-count picker's, taken one step
 * further. That default was changed from `seats.max` to `seats.min` because a default should be the
 * one a player opening the game alone can actually use — and here the equivalent is stronger than a
 * convenience argument: money should never leave an account because somebody did not notice a
 * control. Opting IN to stakes is a decision; opting out of them must not have to be.
 */
export const DEFAULT_ANTE_CENTS = 0;
