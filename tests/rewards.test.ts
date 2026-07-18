/**
 * The daily reward — a streak clock, pure, so every awkward case (first claim, a gap, a clock
 * wound backwards, the day-7 cap) is a test that passes a chosen millisecond rather than a bug
 * discovered at midnight in production.
 */
import { describe, expect, it } from 'vitest';
import {
  claimDaily,
  DAILY_REWARDS_CENTS,
  DAY_MS,
  dailyStatus,
  dayIndex,
} from '@boardwalk/game-logic';
import type { DailyState } from '@boardwalk/game-logic';

/** Noon on day `d`, so tests are never sitting exactly on a boundary by accident. */
const at = (d: number) => d * DAY_MS + DAY_MS / 2;
const FRESH: DailyState = { lastClaimDay: 0, streak: 0 };

describe('dayIndex', () => {
  it('collapses a clock to a UTC day integer, equal within a day', () => {
    expect(dayIndex(at(100))).toBe(100);
    expect(dayIndex(100 * DAY_MS)).toBe(100); // midnight
    expect(dayIndex(101 * DAY_MS - 1)).toBe(100); // one ms before the next day
  });
});

describe('dailyStatus', () => {
  it('offers day-1 to a brand-new account', () => {
    const s = dailyStatus(FRESH, at(100));
    expect(s.claimable).toBe(true);
    expect(s.nextStreak).toBe(1);
    expect(s.rewardCents).toBe(DAILY_REWARDS_CENTS[0]);
  });

  it('is not claimable again the same day', () => {
    const claimed: DailyState = { lastClaimDay: 100, streak: 1 };
    expect(dailyStatus(claimed, at(100)).claimable).toBe(false);
  });

  it('continues the streak on the next consecutive day', () => {
    const s = dailyStatus({ lastClaimDay: 100, streak: 3 }, at(101));
    expect(s.claimable).toBe(true);
    expect(s.nextStreak).toBe(4);
    expect(s.streakBroken).toBe(false);
    expect(s.rewardCents).toBe(DAILY_REWARDS_CENTS[3]);
  });

  it('resets the streak to 1 after a gap, and says so', () => {
    const s = dailyStatus({ lastClaimDay: 100, streak: 5 }, at(103));
    expect(s.claimable).toBe(true);
    expect(s.nextStreak).toBe(1);
    expect(s.streakBroken).toBe(true);
  });

  it('caps the reward at day 7 for a long streak', () => {
    const s = dailyStatus({ lastClaimDay: 100, streak: 20 }, at(101));
    expect(s.nextStreak).toBe(21);
    expect(s.rewardCents).toBe(DAILY_REWARDS_CENTS[DAILY_REWARDS_CENTS.length - 1]);
  });

  it('refuses to re-open the claim when the clock is wound backwards', () => {
    // A stale future lastClaimDay must not mint a fresh reward — `>` not `!==` is what stops it.
    const s = dailyStatus({ lastClaimDay: 200, streak: 3 }, at(150));
    expect(s.claimable).toBe(false);
  });
});

describe('claimDaily', () => {
  it('returns null when there is nothing to claim', () => {
    expect(claimDaily({ lastClaimDay: 100, streak: 1 }, at(100))).toBeNull();
  });

  it('advances the clock and pays out in one result the caller applies together', () => {
    const out = claimDaily(FRESH, at(100));
    expect(out).not.toBeNull();
    expect(out?.state).toEqual({ lastClaimDay: 100, streak: 1 });
    expect(out?.rewardCents).toBe(DAILY_REWARDS_CENTS[0]);
  });

  it('continues a streak across consecutive claims', () => {
    const day1 = claimDaily(FRESH, at(100));
    const day2 = claimDaily(day1!.state, at(101));
    expect(day2?.state).toEqual({ lastClaimDay: 101, streak: 2 });
  });
});
