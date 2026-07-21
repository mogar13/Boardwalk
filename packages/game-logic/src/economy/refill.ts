/**
 * THE BANKRUPT REFILL — the way back to the table when the bankroll hits the floor.
 *
 * V1_FEATURE_GAPS.md #10 calls this "the most-missed" of v1's meta surfaces, and the reason is
 * plain: a player at $0 with no path back is a dead end, and this is play money. v1 had a `↺ REFILL`
 * button and the whole thing was `setMoney(1000)` on the client, which is not a rule, it is a
 * button. Here it is a rule, and the shape of the rule is what keeps it from being a faucet.
 *
 * THREE PROPERTIES, AND THEY ARE THE DESIGN:
 *
 *  1. IT IS A TOP-UP TO A FLOOR, NOT A GRANT OF AN AMOUNT. The player does not receive
 *     `REFILL_FLOOR_CENTS`; they receive whatever it takes to REACH it. So the grant is a pure
 *     function of the balance, the balance after a refill is always exactly the floor, and there
 *     is no arrangement of refills that leaves anyone richer than the floor. A flat `+$500` would
 *     be a different thing entirely: two refills either side of a $1 bet would net $999.
 *
 *  2. IT IS GATED ON BEING BROKE, and "broke" is BELOW the floor, not at zero. A player sitting on
 *     $3 cannot bet at any table in the arcade, so treating that as solvent is a dead end wearing
 *     a different number. The threshold IS the floor — one constant, so "eligible" and "topped up
 *     to" cannot drift apart, and a top-up can never be a no-op that burns a nonce.
 *
 *  3. NEITHER NUMBER TRAVELS. `RefillIntent` is `{nonce}` — see `EconomyIntent` — so a client
 *     names no amount and no balance; the referee reads the balance off its own ledger and calls
 *     THIS function to size the grant. That is the same omission every other intent makes, and it
 *     is why this file is in the shared package rather than being implemented twice.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT KNOW: the once-per-day limit. That is a clock question,
 * and clocks belong to whoever owns the authoritative one — the referee, which counts today's
 * refills in its own ledger (`domain/economy.ts`, `checkRefill`). Putting a day index in here
 * would mean the client holding a second copy of the answer, and a client-held clock is the oldest
 * cheat in the book (`rewards/daily.ts` says the same thing about `claimDaily`).
 *
 * Pure. No clock, no ledger, no profile object — it takes a balance in cents.
 */

/**
 * The floor a refill tops you up TO, in integer cents. $200.
 *
 * Deliberately much smaller than the $5,000 opening stake (`STARTING_BANKROLL_CENTS`): the opening
 * stake is a welcome, and this is a lifeline. A lifeline the size of a welcome would make going
 * broke the fastest way to reset a bad session, which turns the bankroll into a thing that never
 * really goes down — and a bankroll that cannot go down makes the Richest board meaningless and
 * every wager weightless. $200 is enough to sit down at the lowest table and play, and not enough
 * to feel like an outcome.
 */
export const REFILL_FLOOR_CENTS = 20_000;

/**
 * How much a refill would grant at this balance, or `null` when the player is not broke.
 *
 * `null` rather than `0` for the ineligible case, the same values-not-exceptions shape
 * `claimDaily` uses: a caller that treats 0 as "granted nothing, fine" would happily burn a nonce
 * and write a zero ledger row, and the two situations ("you don't need this" and "here is your
 * money") should not be the same value.
 *
 * A negative or non-finite balance is treated as 0 rather than throwing — the referee's balance is
 * a `SUM` over a table and this renders in a hub card, so neither caller wants an exception. The
 * result is floored to an integer because money is integer cents, always.
 */
export function refillGrantFor(balanceCents: number): number | null {
  const balance = Number.isFinite(balanceCents) ? Math.floor(balanceCents) : 0;
  const safe = Math.max(0, balance);
  if (safe >= REFILL_FLOOR_CENTS) return null;
  return REFILL_FLOOR_CENTS - safe;
}

/** Is a top-up available at this balance? The button's predicate, and `refillGrantFor`'s sign. */
export function isBroke(balanceCents: number): boolean {
  return refillGrantFor(balanceCents) !== null;
}
