/**
 * The economy, which is pure and therefore testable without a table to sit at — the whole
 * reason `useBet` and `reportResult` are thin wrappers over `bet.ts` and `result.ts` and not
 * logic buried in a component.
 *
 * The bugs an economy ships are the ones v1 shipped: a payout discarded because the record
 * function had no parameter for it, a stat credited without the money or the money without the
 * stat, an achievement that could never fire, a bet clamped six different ways in six games.
 * Every one of those is a wrong RETURN VALUE from a pure function, so every one is caught here
 * in milliseconds — which is the argument for the functions being pure in the first place.
 */
import { describe, expect, it } from 'vitest';
import { clampBet, maxBet, validateBet } from '@/system/economy/bet';
import { applyResult } from '@/system/economy/result';
import { defaultProfile } from '@/system/profile/defaults';
import { statFor } from '@/system/progress/stats';

const BOUNDS = { min: 200, max: 50_000 } as const; // $2 .. $500

describe('validateBet', () => {
  it('accepts a bet inside the limits and within the bankroll', () => {
    expect(validateBet(1000, 500_000, BOUNDS)).toEqual({ ok: true, amountCents: 1000 });
  });

  it('refuses below the table minimum first, even when broke', () => {
    // Order matters: a $0 bet is the degenerate case and must not be reported as "can't afford".
    const check = validateBet(100, 10, BOUNDS);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain('at least');
  });

  it('refuses above the table maximum', () => {
    const check = validateBet(60_000, 500_000, BOUNDS);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain('max');
  });

  it('refuses a bet larger than the bankroll', () => {
    const check = validateBet(40_000, 30_000, BOUNDS);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain('only have');
  });

  it('refuses a fractional cent rather than rounding it — the v1 parseInt bug, made loud', () => {
    const check = validateBet(1000.5, 500_000, BOUNDS);
    expect(check.ok).toBe(false);
  });
});

describe('maxBet / clampBet', () => {
  it('caps the max bet at the smaller of table max and bankroll', () => {
    expect(maxBet(500_000, BOUNDS)).toBe(50_000); // table max wins
    expect(maxBet(30_000, BOUNDS)).toBe(30_000); // bankroll wins
  });

  it('snaps an over-bankroll amount to all-in', () => {
    expect(clampBet(99_999, 30_000, BOUNDS)).toBe(30_000);
  });

  it('snaps a below-minimum amount up to the minimum', () => {
    expect(clampBet(50, 500_000, BOUNDS)).toBe(200);
  });

  it('rounds a fractional amount to a whole cent', () => {
    expect(clampBet(1000.4, 500_000, BOUNDS)).toBe(1000);
  });
});

describe('applyResult — bankroll, XP, stats and achievements in one call', () => {
  const NOW = 1_700_000_000_000;

  it('credits a gross payout to a bankroll the wager already left', () => {
    // Even-money win on a $10 bet: $10 left at commit, so bankroll is $4,990 here; $20 comes
    // back. Net +$10, and the stored bankroll is 499_000 + 2_000.
    const p = { ...defaultProfile('t'), bankrollCents: 499_000 };
    const out = applyResult(
      p,
      'blackjack',
      { outcome: 'win', payoutCents: 2000, wagerCents: 1000 },
      NOW
    );
    expect(out.profile.bankrollCents).toBe(501_000);
    expect(out.netCents).toBe(1000);
    expect(out.xpGained).toBe(100);
    expect(statFor(out.profile.stats, 'blackjack')).toEqual({
      played: 1,
      won: 1,
      lost: 0,
      pushed: 0,
    });
  });

  it('records a loss with no payout and a losing stat', () => {
    const p = defaultProfile('t');
    const out = applyResult(
      p,
      'blackjack',
      { outcome: 'loss', payoutCents: 0, wagerCents: 1000 },
      NOW
    );
    expect(out.profile.bankrollCents).toBe(p.bankrollCents); // wager already gone; nothing returns
    expect(out.netCents).toBe(-1000);
    expect(out.xpGained).toBe(10);
    expect(statFor(out.profile.stats, 'blackjack')).toEqual({
      played: 1,
      won: 0,
      lost: 1,
      pushed: 0,
    });
  });

  it('records a push as neither a win nor a loss and returns the stake', () => {
    const p = { ...defaultProfile('t'), bankrollCents: 499_000 };
    const out = applyResult(
      p,
      'blackjack',
      { outcome: 'push', payoutCents: 1000, wagerCents: 1000 },
      NOW
    );
    expect(out.profile.bankrollCents).toBe(500_000);
    expect(out.netCents).toBe(0);
    expect(statFor(out.profile.stats, 'blackjack')).toEqual({
      played: 1,
      won: 0,
      lost: 0,
      pushed: 1,
    });
  });

  it('lets a non-betting game report a win: XP and a stat, no money moved', () => {
    const p = defaultProfile('t');
    const out = applyResult(p, 'chess', { outcome: 'win' }, NOW);
    expect(out.profile.bankrollCents).toBe(p.bankrollCents);
    expect(out.netCents).toBe(0);
    expect(out.xpGained).toBe(100);
    expect(statFor(out.profile.stats, 'chess').won).toBe(1);
  });

  it('unlocks big_win — the achievement v1 could never fire — on a $1,000 net', () => {
    const p = defaultProfile('t');
    const out = applyResult(
      p,
      'blackjack',
      { outcome: 'win', payoutCents: 200_000, wagerCents: 100_000 },
      NOW
    );
    expect(out.netCents).toBe(100_000);
    const ids = out.unlocked.map((a) => a.id);
    expect(ids).toContain('big_win');
    expect(out.profile.achievements.big_win).toBe(NOW);
  });

  it('does NOT fire big_win on a large gross payout with a small net', () => {
    // A $600 payout on a $500 bet is a $100 win, not a $600 one. The v1 bug was not knowing the
    // difference; this asserts we do.
    const p = { ...defaultProfile('t'), bankrollCents: 1_000_000 };
    const out = applyResult(
      p,
      'blackjack',
      { outcome: 'win', payoutCents: 60_000, wagerCents: 50_000 },
      NOW
    );
    expect(out.unlocked.map((a) => a.id)).not.toContain('big_win');
  });

  it('unlocks first_win and high_roller together, once', () => {
    const p = { ...defaultProfile('t'), bankrollCents: 1_000_000 };
    const out = applyResult(
      p,
      'blackjack',
      { outcome: 'win', payoutCents: 100_000, wagerCents: 50_000 },
      NOW
    );
    const ids = out.unlocked.map((a) => a.id);
    expect(ids).toContain('first_win');
    expect(ids).toContain('high_roller');
  });

  it('never re-fires an already-unlocked achievement', () => {
    const p = defaultProfile('t');
    const first = applyResult(p, 'chess', { outcome: 'win' }, NOW);
    expect(first.unlocked.map((a) => a.id)).toContain('first_win');
    const second = applyResult(first.profile, 'chess', { outcome: 'win' }, NOW + 1);
    expect(second.unlocked.map((a) => a.id)).not.toContain('first_win');
    // ...and the original timestamp is preserved, not overwritten by the second win.
    expect(second.profile.achievements.first_win).toBe(NOW);
  });

  it('does not mutate the profile it was handed', () => {
    const p = defaultProfile('t');
    const before = JSON.stringify(p);
    applyResult(p, 'blackjack', { outcome: 'win', payoutCents: 2000, wagerCents: 1000 }, NOW);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('floors the bankroll at zero rather than writing a negative', () => {
    const p = { ...defaultProfile('t'), bankrollCents: 0 };
    const out = applyResult(
      p,
      'blackjack',
      { outcome: 'loss', payoutCents: -5000, wagerCents: 0 },
      NOW
    );
    expect(out.profile.bankrollCents).toBe(0);
  });
});
