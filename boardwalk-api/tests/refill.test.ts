import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/db';
import { balanceOf, loadProfile, upsertProfile } from '../src/domain/profile';
import { DAY_MS, REFILL_FLOOR_CENTS, STARTING_BANKROLL_CENTS, checkRefill } from '../src/domain/economy';
import { applyBet, applyRefill, refillsToday } from '../src/domain/mutations';

/**
 * THE BANKRUPT REFILL, at the referee (V1_FEATURE_GAPS.md #10).
 *
 * The arithmetic — how much a top-up grants — is the shared `refillGrantFor` and is tested once, in
 * the frontend suite's `tests/refill.test.ts`. What is tested HERE is everything that needed the
 * server's own state, i.e. everything a client could otherwise lie about:
 *
 *   • the balance the eligibility is judged against is the LEDGER'S, not a claim;
 *   • the once-per-day limit, against the SERVER'S clock and the server's own rows;
 *   • that a refusal costs neither the nonce nor the day's allowance;
 *   • that a replay pays once;
 *   • and the anti-faucet property end to end — no sequence of requests leaves anyone above the
 *     floor, which is the difference between a lifeline and a money printer.
 *
 * A REFILL MOVES MONEY AND NOTHING ELSE. The assertions that XP and the stats do not move are not
 * padding: `recordOutcome` is one call away in the same file, and going broke is not a result.
 */

const seeded = (): Db => {
  const db = openDb(':memory:');
  upsertProfile(db, 'u1', { name: 'Ada', avatar: '👤', equipped: {} }, { now: 1 });
  return db;
};

/** A millisecond inside UTC day `n`. Matches the day index `refillsToday` counts against. */
const day = (n: number) => n * DAY_MS + 1_000;

/** Spend down to `left` cents through the ordinary bet path, so the LEDGER is what says so. */
const spendDownTo = (db: Db, left: number, at: number): void => {
  const amount = balanceOf(db, 'u1') - left;
  const r = applyBet(db, 'u1', { nonce: `spend-${String(at)}-${String(left)}`, gameId: 'roulette', amountCents: amount }, at);
  expect(r.ok).toBe(true);
};

/* --------------------------------------------------------- pure decision */

describe('checkRefill', () => {
  it('sizes the grant to reach the floor when broke and unrefilled today', () => {
    expect(checkRefill({ balanceCents: 0, refillsToday: 0 })).toEqual({
      ok: true,
      value: { grantCents: REFILL_FLOOR_CENTS },
    });
    expect(checkRefill({ balanceCents: 5_000, refillsToday: 0 })).toEqual({
      ok: true,
      value: { grantCents: REFILL_FLOOR_CENTS - 5_000 },
    });
  });

  it('refuses a solvent player — a top-up is not a stipend', () => {
    const r = checkRefill({ balanceCents: REFILL_FLOOR_CENTS, refillsToday: 0 });
    expect(r.ok).toBe(false);
  });

  it('refuses a second one the same day, even at zero', () => {
    const r = checkRefill({ balanceCents: 0, refillsToday: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toMatch(/today/);
  });

  it('checks the day BEFORE the balance, so a broke repeat reads as the limit, not as solvency', () => {
    // Both refusals apply; the player needs to be told the true reason, and "you are not broke" to
    // a player holding $0 is the kind of message that reads as a bug.
    const r = checkRefill({ balanceCents: 0, refillsToday: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toMatch(/today/);
  });
});

/* ------------------------------------------------------------- the route */

describe('applyRefill', () => {
  it('tops a broke player up to exactly the floor, off the LEDGER balance', () => {
    const db = seeded();
    spendDownTo(db, 1_000, day(10));
    expect(balanceOf(db, 'u1')).toBe(1_000);

    const r = applyRefill(db, 'u1', { nonce: 'r1' }, day(10));
    expect(r.ok).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(REFILL_FLOOR_CENTS);
  });

  it('refuses a solvent player and writes nothing at all', () => {
    const db = seeded();
    const before = balanceOf(db, 'u1');
    const r = applyRefill(db, 'u1', { nonce: 'r1' }, day(10));
    expect(r.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(before);
    expect(refillsToday(db, 'u1', day(10))).toBe(0);
  });

  it('a refusal costs neither the nonce nor the day — refused at 9am, topped up at 9pm', () => {
    const db = seeded();
    // Solvent: refused.
    expect(applyRefill(db, 'u1', { nonce: 'same' }, day(10)).ok).toBe(false);
    // Now genuinely broke, later the same day, with the SAME nonce the refusal was sent with.
    spendDownTo(db, 0, day(10) + 1);
    const r = applyRefill(db, 'u1', { nonce: 'same' }, day(10) + 2);
    expect(r.ok).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(REFILL_FLOOR_CENTS);
  });

  it('refuses a SECOND top-up the same day with a fresh nonce — the limit is the ledger, not the nonce', () => {
    const db = seeded();
    spendDownTo(db, 0, day(10));
    expect(applyRefill(db, 'u1', { nonce: 'r1' }, day(10)).ok).toBe(true);

    // Lose it all again, ask again, same day, brand-new nonce.
    spendDownTo(db, 0, day(10) + 1);
    const second = applyRefill(db, 'u1', { nonce: 'r2' }, day(10) + 2);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error).toMatch(/today/);
    expect(balanceOf(db, 'u1')).toBe(0);
  });

  it('allows one again the next UTC day', () => {
    const db = seeded();
    spendDownTo(db, 0, day(10));
    expect(applyRefill(db, 'u1', { nonce: 'r1' }, day(10)).ok).toBe(true);
    spendDownTo(db, 0, day(10) + 1);

    expect(applyRefill(db, 'u1', { nonce: 'r2' }, day(11)).ok).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(REFILL_FLOOR_CENTS);
  });

  it('cannot be replayed into a second grant', () => {
    const db = seeded();
    spendDownTo(db, 0, day(10));
    expect(applyRefill(db, 'u1', { nonce: 'r1' }, day(10)).ok).toBe(true);

    const again = applyRefill(db, 'u1', { nonce: 'r1' }, day(10));
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error('unreachable');
    expect(again.value.replayed).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(REFILL_FLOOR_CENTS);
    expect(refillsToday(db, 'u1', day(10))).toBe(1);
  });

  it('moves money and NOTHING else — no XP, no stats, no achievements', () => {
    const db = seeded();
    spendDownTo(db, 0, day(10));
    const before = loadProfile(db, 'u1');
    applyRefill(db, 'u1', { nonce: 'r1' }, day(10));
    const after = loadProfile(db, 'u1');

    expect(after?.xp).toBe(before?.xp);
    expect(after?.stats).toEqual(before?.stats);
    expect(after?.achievements).toEqual(before?.achievements);
    expect(after?.inventory).toEqual(before?.inventory);
  });

  it('THE ANTI-FAUCET PROPERTY: a hundred days of grinding never beats the opening stake', () => {
    const db = seeded();
    // Burn the welcome money first, so every cent below comes from refills alone.
    spendDownTo(db, 0, day(0));

    let peak = 0;
    for (let d = 1; d <= 100; d += 1) {
      // Ask twice a day, every day, forever. Only the first can land.
      applyRefill(db, 'u1', { nonce: `a${String(d)}` }, day(d));
      applyRefill(db, 'u1', { nonce: `b${String(d)}` }, day(d) + 60_000);
      peak = Math.max(peak, balanceOf(db, 'u1'));
      // Bank it: keep the winnings, go broke again the honest way.
      spendDownTo(db, 0, day(d) + 120_000);
    }
    // 100 days of maximal grinding, and the balance never once passed the floor — let alone the
    // $5,000 an account starts with. That is the whole reason a top-up is a top-up.
    expect(peak).toBe(REFILL_FLOOR_CENTS);
    expect(peak).toBeLessThan(STARTING_BANKROLL_CENTS);
  });
});

describe('refillsToday', () => {
  it('counts this uid only, refills only, and lets the allowance reset the next day', () => {
    const db = seeded();
    upsertProfile(db, 'u2', { name: 'Bo', avatar: '👤', equipped: {} }, { now: 1 });

    spendDownTo(db, 0, day(10));
    applyRefill(db, 'u1', { nonce: 'r1' }, day(10));

    expect(refillsToday(db, 'u1', day(10))).toBe(1);
    // Tomorrow is a fresh window — otherwise the allowance would never come back.
    expect(refillsToday(db, 'u1', day(11))).toBe(0);
    // Another account's ledger is not this one's.
    expect(refillsToday(db, 'u2', day(10))).toBe(0);
    // The signup grant and the bet above sit in the same window and are not refills — this is 1,
    // not 3, because the count is filtered on the reason and not merely on the day.
    expect(refillsToday(db, 'u1', day(10))).toBe(1);
  });

  it('a WOUND-BACK clock cannot re-open the allowance', () => {
    // The window is `created_at >= startOfToday` with no upper bound, on purpose: asked from
    // yesterday, today's refill is still counted. So setting the server's clock back — the oldest
    // cheat there is, and the one `claimDaily` closes with `>` instead of `!==` — makes this
    // check stricter, never looser. A bounded `< startOfTomorrow` window would pay twice here.
    const db = seeded();
    spendDownTo(db, 0, day(10));
    applyRefill(db, 'u1', { nonce: 'r1' }, day(10));

    expect(refillsToday(db, 'u1', day(9))).toBe(1);
    const rewound = applyRefill(db, 'u1', { nonce: 'r2' }, day(9));
    expect(rewound.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(REFILL_FLOOR_CENTS);
  });
});
