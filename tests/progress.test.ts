/**
 * Stats and achievements — pure, and the two things v1 got most silently wrong. Stats drifted
 * because the id could be spelled twice and the counter took no payout; achievements shipped
 * unwinnable because nothing evaluated them. Both are now pure functions with one caller, and
 * "did it count right" and "does the badge fire at the boundary" are assertions here.
 */
import { describe, expect, it } from 'vitest';
import { satisfiedAchievements, type AchievementView } from '@/system/progress/achievements';
import { bumpStats, EMPTY_STAT, statFor, totalPlayed, totalWins } from '@/system/progress/stats';
import { xpThresholdForLevel } from '@/system/profile/xp';

describe('bumpStats', () => {
  it('increments played plus exactly one outcome counter', () => {
    const s = bumpStats({}, 'blackjack', 'win');
    expect(statFor(s, 'blackjack')).toEqual({ played: 1, won: 1, lost: 0, pushed: 0 });
    const s2 = bumpStats(s, 'blackjack', 'loss');
    expect(statFor(s2, 'blackjack')).toEqual({ played: 2, won: 1, lost: 1, pushed: 0 });
  });

  it('keeps each game separate — the drift v1 shipped when texas_holdem recorded as poker', () => {
    let s = bumpStats({}, 'blackjack', 'win');
    s = bumpStats(s, 'chess', 'win');
    expect(statFor(s, 'blackjack').won).toBe(1);
    expect(statFor(s, 'chess').won).toBe(1);
    expect(totalWins(s)).toBe(2);
    expect(totalPlayed(s)).toBe(2);
  });

  it('does not mutate the input', () => {
    const s = { blackjack: { played: 1, won: 1, lost: 0, pushed: 0 } };
    const frozen = JSON.stringify(s);
    bumpStats(s, 'blackjack', 'loss');
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it('hands back a zeroed stat for a game never played', () => {
    expect(statFor({}, 'unplayed')).toEqual(EMPTY_STAT);
  });
});

describe('satisfiedAchievements', () => {
  const base: AchievementView = {
    totalPlayed: 0,
    totalWins: 0,
    bankrollCents: 0,
    xp: 0,
    lastWagerCents: 0,
    lastNetCents: 0,
  };

  it('is empty for a fresh account that just lost its first hand', () => {
    expect(satisfiedAchievements({ ...base, totalPlayed: 1 })).toEqual([]);
  });

  it('fires first_win on the first win', () => {
    expect(satisfiedAchievements({ ...base, totalPlayed: 1, totalWins: 1 })).toContain('first_win');
  });

  it('fires big_win at exactly $1,000 net and not a cent below', () => {
    expect(satisfiedAchievements({ ...base, lastNetCents: 100_000 })).toContain('big_win');
    expect(satisfiedAchievements({ ...base, lastNetCents: 99_999 })).not.toContain('big_win');
  });

  it('fires high_roller on the stake regardless of the result', () => {
    expect(satisfiedAchievements({ ...base, lastWagerCents: 50_000 })).toContain('high_roller');
    expect(satisfiedAchievements({ ...base, lastWagerCents: 49_999 })).not.toContain('high_roller');
  });

  it('fires seasoned exactly at the level-10 XP threshold', () => {
    const at10 = xpThresholdForLevel(10);
    expect(satisfiedAchievements({ ...base, xp: at10 })).toContain('seasoned');
    expect(satisfiedAchievements({ ...base, xp: at10 - 1 })).not.toContain('seasoned');
  });

  it('fires table_regular at 100 games and deep_pockets at $50,000', () => {
    expect(satisfiedAchievements({ ...base, totalPlayed: 100 })).toContain('table_regular');
    expect(satisfiedAchievements({ ...base, totalPlayed: 99 })).not.toContain('table_regular');
    expect(satisfiedAchievements({ ...base, bankrollCents: 5_000_000 })).toContain('deep_pockets');
  });
});
