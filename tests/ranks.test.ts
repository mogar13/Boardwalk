import { describe, expect, it } from 'vitest';
import {
  RANKS,
  levelFromXp,
  nextRankAfterLevel,
  rankForLevel,
  xpThresholdForLevel,
} from '@boardwalk/game-logic';

/**
 * The rank ladder. A lookup table is the kind of thing that looks too simple to test — which is
 * exactly why the interesting cases are the ones a reader would not write by hand: the BOUNDARY
 * (the level a rung starts at, and the one below it), the ladder's own INVARIANTS (ascending,
 * starting at 1, no duplicate ids — the properties `rankForLevel`'s backwards walk silently
 * depends on), and the fact that `nextRankAfterLevel` and `rankForLevel` agree about where one
 * rung stops and the next begins.
 *
 * A ladder that is out of order does not throw; it quietly returns the wrong name forever. That
 * is the failure this file exists to make loud.
 */
describe('RANKS — the ladder itself', () => {
  it('starts at level 1, so every level has a rank', () => {
    expect(RANKS[0]?.minLevel).toBe(1);
  });

  it('is strictly ascending by minLevel — the backwards walk depends on it', () => {
    for (let i = 1; i < RANKS.length; i += 1) {
      expect(RANKS[i]?.minLevel).toBeGreaterThan(RANKS[i - 1]?.minLevel ?? 0);
    }
  });

  it('has unique ids and non-empty names', () => {
    expect(new Set(RANKS.map((r) => r.id)).size).toBe(RANKS.length);
    expect(new Set(RANKS.map((r) => r.name)).size).toBe(RANKS.length);
    for (const rank of RANKS) expect(rank.name.length).toBeGreaterThan(0);
  });
});

describe('rankForLevel', () => {
  it('gives each rung exactly at its minLevel, and the one below at the previous rung', () => {
    for (let i = 1; i < RANKS.length; i += 1) {
      const rung = RANKS[i];
      const below = RANKS[i - 1];
      if (rung === undefined || below === undefined) throw new Error('ladder gap');
      expect(rankForLevel(rung.minLevel).id).toBe(rung.id);
      expect(rankForLevel(rung.minLevel - 1).id).toBe(below.id);
    }
  });

  it('holds the top rank forever above the last rung', () => {
    const top = RANKS[RANKS.length - 1];
    if (top === undefined) throw new Error('empty ladder');
    for (const level of [top.minLevel, top.minLevel + 1, 500, 10_000]) {
      expect(rankForLevel(level).id).toBe(top.id);
    }
  });

  it('floors garbage to the first rung instead of throwing — it renders every frame', () => {
    for (const level of [1, 0, -7, Number.NaN, Number.POSITIVE_INFINITY * -1]) {
      expect(rankForLevel(level).id).toBe(RANKS[0]?.id);
    }
    // A non-integer level is not a thing `levelFromXp` produces, but a caller could pass one.
    expect(rankForLevel(2.9).id).toBe(rankForLevel(2).id);
  });
});

describe('nextRankAfterLevel', () => {
  it('names the rung you are climbing towards, at every rung', () => {
    for (let i = 0; i < RANKS.length - 1; i += 1) {
      const here = RANKS[i];
      const next = RANKS[i + 1];
      if (here === undefined || next === undefined) throw new Error('ladder gap');
      expect(nextRankAfterLevel(here.minLevel)?.id).toBe(next.id);
      // And still the same target one level short of reaching it.
      expect(nextRankAfterLevel(next.minLevel - 1)?.id).toBe(next.id);
    }
  });

  it('is null at the top — the UI renders nothing rather than inventing a rung', () => {
    const top = RANKS[RANKS.length - 1];
    if (top === undefined) throw new Error('empty ladder');
    expect(nextRankAfterLevel(top.minLevel)).toBeNull();
    expect(nextRankAfterLevel(top.minLevel + 100)).toBeNull();
  });

  it('agrees with rankForLevel about where one rung stops and the next starts', () => {
    for (let level = 1; level <= 80; level += 1) {
      const next = nextRankAfterLevel(level);
      if (next === null) {
        expect(rankForLevel(level).id).toBe(RANKS[RANKS.length - 1]?.id);
        continue;
      }
      expect(rankForLevel(level).id).not.toBe(next.id);
      expect(rankForLevel(next.minLevel).id).toBe(next.id);
    }
  });
});

describe('the ladder against the real XP curve', () => {
  it('a fresh account is a Newcomer, and the first promotion is reachable in a session', () => {
    expect(rankForLevel(levelFromXp(0)).id).toBe('newcomer');
    // Bronze at level 3 = 1,500 XP = 15 wins at XP_BY_OUTCOME.win — an evening, not a grind.
    expect(xpThresholdForLevel(3)).toBe(1_500);
    expect(rankForLevel(levelFromXp(1_500)).id).toBe('bronze');
    expect(rankForLevel(levelFromXp(1_499)).id).toBe('newcomer');
  });

  it('the top rank lines up with the Platinum achievement tiers at level 50', () => {
    expect(RANKS[RANKS.length - 1]?.minLevel).toBe(50);
    expect(rankForLevel(levelFromXp(xpThresholdForLevel(50))).id).toBe('legend');
  });
});
