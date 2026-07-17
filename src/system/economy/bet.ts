/**
 * Bet math — pure, and the reason `validateAndCommit()` is the first row in the v1 defect
 * table.
 *
 * v1 wrote `validateAndCommit()` to end the hand-rolled bet clamping in its six betting
 * games. It had ZERO adopters: all six kept double-clamping by hand, each slightly
 * differently, because the shared function was designed before a caller and turned out to be
 * the wrong shape for every one of them. The lesson is not "write the shared function
 * better" — it is that the CLAMPING is what wants to be shared, as a pure function unit-tested
 * to death, and the wiring (chip rack, buttons) is what wants to be per-game. So this file is
 * the math and only the math; `useBet` is the wiring, thin, and imports this.
 *
 * Everything here is integer cents. A bet is never a float — `parseInt` in v1's `setMoney` ate
 * the fractional chip on a 3:2 natural, and the fix is that a fraction is unrepresentable, not
 * rounded. Amounts arrive already integer (the chip rack only ever adds whole chips); this
 * REFUSES a non-integer rather than rounding one, because a non-integer bet reaching here is a
 * bug upstream and silently rounding it hides the bug.
 */
import { formatDollars } from '@/system/profile/money';

/** A game's betting limits, in cents. Comes from `manifest.betting`; absent means no betting. */
export interface BetBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * A checked bet, or a reason it is not one — the same values-not-exceptions shape the repo
 * uses for user-facing failures (see `RepoResult`). An over-limit bet is a thing the chip
 * rack renders under the chips, not an error it throws.
 */
export type BetCheck =
  | { readonly ok: true; readonly amountCents: number }
  | { readonly ok: false; readonly error: string };

/**
 * The largest legal bet right now: the table max, or the whole bankroll if that is smaller.
 * The chip rack uses it to cap "all in" and to grey out chips you cannot afford, so the max
 * and the validation agree by construction rather than by two people getting the same
 * number.
 */
export function maxBet(balanceCents: number, bounds: BetBounds): number {
  return Math.max(0, Math.min(bounds.max, balanceCents));
}

/**
 * Is this a legal bet? Order matters: the messages are ranked by which fact the player most
 * needs. "You only have $40" beats "table max is $500" when they have $40, because the max is
 * not their problem. Under the table minimum is checked first because a $0 or negative bet is
 * the degenerate case and should not be reported as "you can't afford it".
 */
export function validateBet(
  amountCents: number,
  balanceCents: number,
  bounds: BetBounds
): BetCheck {
  if (!Number.isInteger(amountCents)) {
    // Not a user-facing situation — chips are whole — so the message is plain. Reaching here
    // means a caller built a fractional bet, which is the bug this refuses to paper over.
    return { ok: false, error: 'A bet must be a whole number of cents.' };
  }
  if (amountCents < bounds.min) {
    return { ok: false, error: `Bet at least ${formatDollars(bounds.min)}.` };
  }
  if (amountCents > bounds.max) {
    return { ok: false, error: `Table max is ${formatDollars(bounds.max)}.` };
  }
  if (amountCents > balanceCents) {
    return { ok: false, error: `You only have ${formatDollars(balanceCents)}.` };
  }
  return { ok: true, amountCents };
}

/**
 * Snap an amount to the nearest legal bet — for the chip rack, where "+$100" on a $460
 * balance should land on $460 (all in) rather than refuse. Clamps into
 * `[min, maxBet]` and rounds to a whole cent. If the bankroll is below the table minimum,
 * `maxBet` is under `min` and this returns `maxBet` (all in) — a player who cannot make the
 * minimum bets everything, which the caller can then still reject via `validateBet` if the
 * game forbids a sub-minimum all-in.
 */
export function clampBet(amountCents: number, balanceCents: number, bounds: BetBounds): number {
  const ceiling = maxBet(balanceCents, bounds);
  const rounded = Math.round(amountCents);
  if (rounded >= ceiling) return ceiling;
  if (rounded <= bounds.min) return Math.min(bounds.min, ceiling);
  return rounded;
}
