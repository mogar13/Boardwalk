import { describe, expect, it } from 'vitest';
import {
  BOARDS,
  boardById,
  rankFor,
  winRateOf,
  WIN_RATE_MIN_GAMES,
  type BoardId,
} from '@/system/progress/boards';
import type { LeaderboardEntry } from '@/system/repo/types';

/**
 * The leaderboard boards — the "everyone can be #1 at something" ranking logic. These tests assert
 * each board orders a hand-built set the way its name promises, that ties break stably, and that
 * the win-rate floor keeps a one-lucky-game player off the skill board. The page and the repo both
 * rank through `rankFor`, so proving it here proves it for both.
 */

function entry(over: Partial<LeaderboardEntry> & { uid: string }): LeaderboardEntry {
  return {
    name: over.uid,
    avatar: '👤',
    bankrollCents: 0,
    xp: 0,
    wins: 0,
    played: 0,
    ...over,
  };
}

/** The ranked uids, for terse order assertions. */
function order(board: BoardId, rows: readonly LeaderboardEntry[]): string[] {
  return rankFor(boardById(board), rows).map((r) => r.uid);
}

describe('the board registry', () => {
  it('has four boards with unique ids', () => {
    expect(BOARDS).toHaveLength(4);
    const ids = BOARDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['wins', 'richest', 'level', 'winRate']);
  });

  it('every board carries a label, column and blurb', () => {
    for (const b of BOARDS) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.column.length).toBeGreaterThan(0);
      expect(b.blurb.length).toBeGreaterThan(0);
    }
  });

  it('boardById resolves a known id and falls back to wins on an unknown one', () => {
    expect(boardById('winRate').id).toBe('winRate');
    expect(boardById('richest').id).toBe('richest');
    expect(boardById('nonsense').id).toBe('wins');
    expect(boardById('').id).toBe('wins');
  });
});

describe('winRateOf', () => {
  it('is the wins/played ratio', () => {
    expect(winRateOf(entry({ uid: 'a', wins: 3, played: 4 }))).toBeCloseTo(0.75);
    expect(winRateOf(entry({ uid: 'b', wins: 10, played: 10 }))).toBe(1);
  });

  it('is 0 for a player who has never played — no divide-by-zero', () => {
    expect(winRateOf(entry({ uid: 'c', wins: 0, played: 0 }))).toBe(0);
  });
});

describe('the Most Wins board', () => {
  it('ranks by wins, descending', () => {
    const rows = [
      entry({ uid: 'low', wins: 2 }),
      entry({ uid: 'high', wins: 9 }),
      entry({ uid: 'mid', wins: 5 }),
    ];
    expect(order('wins', rows)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks a wins tie by bankroll, then XP', () => {
    const rows = [
      entry({ uid: 'poor', wins: 5, bankrollCents: 100, xp: 999 }),
      entry({ uid: 'rich', wins: 5, bankrollCents: 900, xp: 1 }),
      entry({ uid: 'richXp', wins: 5, bankrollCents: 900, xp: 500 }),
    ];
    // Same wins → richer first; same wins AND bankroll → more XP first.
    expect(order('wins', rows)).toEqual(['richXp', 'rich', 'poor']);
  });

  it('takes every player — no eligibility floor', () => {
    const rows = [entry({ uid: 'a', wins: 1, played: 1 }), entry({ uid: 'b', wins: 0, played: 0 })];
    expect(order('wins', rows)).toHaveLength(2);
  });
});

describe('the Richest board', () => {
  it('ranks by bankroll, descending, regardless of wins', () => {
    const rows = [
      entry({ uid: 'whale', bankrollCents: 9_000_000, wins: 0 }),
      entry({ uid: 'grinder', bankrollCents: 1_000, wins: 500 }),
    ];
    expect(order('richest', rows)).toEqual(['whale', 'grinder']);
  });
});

describe('the Highest Level board', () => {
  it('ranks by xp, descending, regardless of wins or bankroll', () => {
    const rows = [
      entry({ uid: 'veteran', xp: 50_000, wins: 3, bankrollCents: 0 }),
      entry({ uid: 'novice', xp: 100, wins: 300, bankrollCents: 9_000_000 }),
    ];
    expect(order('level', rows)).toEqual(['veteran', 'novice']);
  });
});

describe('the Best Win Rate board', () => {
  it('ranks by rate among the eligible', () => {
    const rows = [
      entry({ uid: 'sharp', wins: 18, played: 20 }), // 90%
      entry({ uid: 'steady', wins: 12, played: 20 }), // 60%
      entry({ uid: 'grinder', wins: 40, played: 100 }), // 40%
    ];
    expect(order('winRate', rows)).toEqual(['sharp', 'steady', 'grinder']);
  });

  it('hides players under the min-games floor — a lucky 1/1 does not top the skill board', () => {
    const rows = [
      entry({ uid: 'perfect', wins: 1, played: 1 }), // 100% but only 1 game
      entry({ uid: 'proven', wins: 8, played: WIN_RATE_MIN_GAMES }), // 80% over the floor
    ];
    const ranked = order('winRate', rows);
    expect(ranked).toEqual(['proven']); // the 1/1 player is filtered out entirely
  });

  it('admits a player exactly at the floor', () => {
    const rows = [entry({ uid: 'edge', wins: 5, played: WIN_RATE_MIN_GAMES })];
    expect(order('winRate', rows)).toEqual(['edge']);
  });

  it('breaks a rate tie by the larger sample', () => {
    const rows = [
      entry({ uid: 'small', wins: 6, played: 12 }), // 50% over 12
      entry({ uid: 'large', wins: 25, played: 50 }), // 50% over 50
    ];
    expect(order('winRate', rows)).toEqual(['large', 'small']);
  });
});

describe('rankFor', () => {
  it('does not mutate its input', () => {
    const rows = [entry({ uid: 'a', wins: 1 }), entry({ uid: 'b', wins: 9 })];
    const before = rows.map((r) => r.uid);
    rankFor(boardById('wins'), rows);
    expect(rows.map((r) => r.uid)).toEqual(before);
  });

  it('returns an empty array for no rows', () => {
    expect(rankFor(boardById('winRate'), [])).toEqual([]);
  });
});
