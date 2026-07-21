import { describe, expect, it } from 'vitest';
import {
  REFILL_FLOOR_CENTS,
  STARTING_BANKROLL_CENTS,
  isBroke,
  refillGrantFor,
} from '@boardwalk/game-logic';

/**
 * The bankrupt refill's arithmetic. Small surface, and the tests that matter are the ones about
 * what it CANNOT do: the property under test is not "it pays $200", it is **"no sequence of
 * refills can leave anyone above the floor"** — the thing that separates a lifeline from a faucet.
 *
 * `refillGrantFor` is the whole rule (the once-per-day limit is the referee's clock, tested in
 * `boardwalk-api/tests/economy.test.ts`), so a grant that is wrong here is wrong on both sides at
 * once. That is the Phase-D bargain: one module, one test, no parity to keep.
 */
describe('refillGrantFor', () => {
  it('tops a broke player up to exactly the floor, from any balance below it', () => {
    for (const balance of [0, 1, 99, 5_000, REFILL_FLOOR_CENTS - 1]) {
      const grant = refillGrantFor(balance);
      expect(grant).not.toBeNull();
      expect(balance + (grant ?? 0)).toBe(REFILL_FLOOR_CENTS);
    }
  });

  it('refuses at the floor and above — the boundary is inclusive on the solvent side', () => {
    expect(refillGrantFor(REFILL_FLOOR_CENTS)).toBeNull();
    expect(refillGrantFor(REFILL_FLOOR_CENTS + 1)).toBeNull();
    expect(refillGrantFor(STARTING_BANKROLL_CENTS)).toBeNull();
    // And one cent short is still broke — the boundary is not off by one.
    expect(refillGrantFor(REFILL_FLOOR_CENTS - 1)).toBe(1);
  });

  it('is null and not zero when ineligible, so a caller cannot bank an empty grant', () => {
    // The distinction the whole `null` return exists for: `0` would be a truthy-ish "success"
    // that burns a nonce and writes a zero ledger row.
    expect(refillGrantFor(REFILL_FLOOR_CENTS)).toBeNull();
    expect(refillGrantFor(REFILL_FLOOR_CENTS)).not.toBe(0);
  });

  it('NO SEQUENCE OF REFILLS LEAVES ANYONE ABOVE THE FLOOR — the anti-faucet property', () => {
    // Refill, then refill again, then again. A flat `+N` grant would compound here; a top-up
    // cannot, because the second call sees the balance the first one produced.
    let balance = 0;
    for (let i = 0; i < 50; i += 1) {
      const grant = refillGrantFor(balance);
      if (grant === null) break;
      balance += grant;
    }
    expect(balance).toBe(REFILL_FLOOR_CENTS);
    expect(refillGrantFor(balance)).toBeNull();

    // And interleaved with losses, which is the real usage: still capped at the floor, never above.
    for (const loss of [1, 137, 19_999, REFILL_FLOOR_CENTS]) {
      balance = Math.max(0, balance - loss);
      const grant = refillGrantFor(balance);
      if (grant !== null) balance += grant;
      expect(balance).toBeLessThanOrEqual(REFILL_FLOOR_CENTS);
    }
  });

  it('is worth far less than the opening stake — a lifeline, not a session reset', () => {
    expect(REFILL_FLOOR_CENTS).toBeLessThan(STARTING_BANKROLL_CENTS);
  });

  it('grants whole cents, and treats a broken balance as 0 rather than throwing', () => {
    for (const balance of [-1, -500_000, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(refillGrantFor(balance)).toBe(REFILL_FLOOR_CENTS);
    }
    // A fractional balance cannot mint a fractional grant — money is integer cents, always.
    const grant = refillGrantFor(100.7);
    expect(grant).not.toBeNull();
    expect(Number.isInteger(grant)).toBe(true);
    expect(grant).toBe(REFILL_FLOOR_CENTS - 100);
  });
});

describe('isBroke', () => {
  it('agrees with refillGrantFor everywhere — one predicate, one sign', () => {
    for (const balance of [0, 1, 19_999, REFILL_FLOOR_CENTS, REFILL_FLOOR_CENTS + 1, 10_000_000]) {
      expect(isBroke(balance)).toBe(refillGrantFor(balance) !== null);
    }
  });
});
