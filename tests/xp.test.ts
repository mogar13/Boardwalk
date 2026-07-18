/**
 * The level curve, which is pure and therefore testable — the whole reason
 * `src/system/profile/xp.ts` is a module and not a helper buried in the top bar.
 *
 * The bugs a level curve ships are all at the boundaries: the XP total that is EXACTLY a
 * level threshold, the total one cent below it, a fresh account at 0, and a hand-edited or
 * legacy negative. `levelFromXp` inverts a quadratic with a float `sqrt`, and float is
 * wrong by one at exactly those thresholds — so every threshold and its neighbours are
 * asserted here, which is the only thing that catches the off-by-one the closed form would
 * otherwise hide.
 */
import { describe, it, expect } from 'vitest';
import { LEVEL_STEP, levelFromXp, xpProgress, xpThresholdForLevel } from '@boardwalk/game-logic';

describe('xpThresholdForLevel', () => {
  it('starts level 1 at 0 XP', () => {
    expect(xpThresholdForLevel(1)).toBe(0);
  });

  it('is the running sum of LEVEL_STEP * (level-1)', () => {
    // 1→2 costs 500, 2→3 costs 1000, 3→4 costs 1500 …
    expect(xpThresholdForLevel(2)).toBe(500);
    expect(xpThresholdForLevel(3)).toBe(1500);
    expect(xpThresholdForLevel(4)).toBe(3000);
    expect(xpThresholdForLevel(5)).toBe(5000);
  });

  it('is always an integer — (L-1)*L is even for every L', () => {
    for (let l = 1; l <= 200; l += 1) {
      expect(Number.isInteger(xpThresholdForLevel(l))).toBe(true);
    }
  });

  it('floors a fractional or sub-1 level to 1', () => {
    expect(xpThresholdForLevel(0)).toBe(0);
    expect(xpThresholdForLevel(-5)).toBe(0);
    expect(xpThresholdForLevel(2.9)).toBe(500);
  });
});

describe('levelFromXp', () => {
  it('is level 1 at 0 XP and for anything at or below it', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(-1)).toBe(1);
    expect(levelFromXp(499)).toBe(1);
  });

  it('is exact AT each threshold — the boundary float gets wrong', () => {
    // The whole point of correcting the sqrt estimate: `xp === threshold` must be the new
    // level, not the previous one, and not the next.
    for (let level = 1; level <= 300; level += 1) {
      const at = xpThresholdForLevel(level);
      expect(levelFromXp(at)).toBe(level);
    }
  });

  it('is the previous level one XP below a threshold', () => {
    for (let level = 2; level <= 300; level += 1) {
      const at = xpThresholdForLevel(level);
      expect(levelFromXp(at - 1)).toBe(level - 1);
    }
  });

  it('never returns a non-finite or sub-1 level', () => {
    expect(levelFromXp(Number.NaN)).toBe(1);
    expect(levelFromXp(Number.POSITIVE_INFINITY)).toBe(1);
    expect(levelFromXp(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it('agrees with a brute-force scan over a wide range', () => {
    // Independent oracle: the largest level whose threshold does not exceed xp. If the
    // closed-form path and this disagree anywhere, the correction loop is wrong.
    const bruteForce = (xp: number): number => {
      let l = 1;
      while (xpThresholdForLevel(l + 1) <= xp) l += 1;
      return l;
    };
    for (let xp = 0; xp <= 200_000; xp += 137) {
      expect(levelFromXp(xp)).toBe(bruteForce(xp));
    }
  });
});

describe('xpProgress', () => {
  it('is empty at the moment of level-up', () => {
    const p = xpProgress(xpThresholdForLevel(3));
    expect(p.level).toBe(3);
    expect(p.into).toBe(0);
    expect(p.needed).toBe(LEVEL_STEP * 3);
    expect(p.pct).toBe(0);
  });

  it('reports how far into the current level the XP sits', () => {
    // Level 2 starts at 500 and costs 1000; 750 XP is 250 into it, a quarter of the way.
    const p = xpProgress(750);
    expect(p.level).toBe(2);
    expect(p.into).toBe(250);
    expect(p.needed).toBe(1000);
    expect(p.pct).toBeCloseTo(0.25, 10);
  });

  it('is a zeroed level-1 bar for 0 and for garbage input', () => {
    for (const xp of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = xpProgress(xp);
      expect(p.level).toBe(1);
      expect(p.into).toBe(0);
      expect(p.pct).toBe(0);
    }
  });

  it('keeps pct within 0..1 across the whole curve', () => {
    for (let xp = 0; xp <= 200_000; xp += 311) {
      const p = xpProgress(xp);
      expect(p.pct).toBeGreaterThanOrEqual(0);
      expect(p.pct).toBeLessThanOrEqual(1);
      expect(p.into).toBeGreaterThanOrEqual(0);
      expect(p.into).toBeLessThan(p.needed);
    }
  });
});
