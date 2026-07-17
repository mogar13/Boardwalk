/**
 * The play record — pure, so the counting is testable without a game to play.
 *
 * This is small on purpose. It exists because v1's stats were the single most silently-broken
 * thing in it: `recordWin(gameId)` took one argument, 40+ call sites passed it a payout it
 * discarded, and five of thirty-one games recorded under the wrong id entirely
 * (`texas_holdem`→`"poker"`), so their wins never reached the hub. The fixes are structural,
 * not careful: the id is `manifest.id` and cannot be spelled twice (the registry), and the
 * bump is one pure function called from one place (`applyResult`), tested here.
 *
 * No React, no Firebase, no DOM — the same rule `xp.ts` follows, for the same reason: an
 * off-by-one in a counter buried in a component surfaces as "the leaderboard is wrong" weeks
 * later, and only a unit test finds it in the second it happens.
 */
import type { GameStat, Stats } from '@/system/profile/types';

/**
 * What a single settled game was, from the bankroll's point of view. `push` is a tie /
 * money-back — it is neither a win nor a loss and must not be counted as either, which is a
 * distinction v1's win/loss-only `recordTie` (0 call sites) never actually made.
 *
 * Defined here, in the leaf module, so `stats` and `economy/result` share one spelling
 * rather than each declaring their own three-string union that could drift.
 */
export type Outcome = 'win' | 'loss' | 'push';

/** A game never played. The default `statFor` hands back, so callers never branch on absence. */
export const EMPTY_STAT: GameStat = { played: 0, won: 0, lost: 0, pushed: 0 };

/** One game's record, or a zeroed one — never `undefined`, so a stats card can render either. */
export function statFor(stats: Stats, gameId: string): GameStat {
  return stats[gameId] ?? EMPTY_STAT;
}

/**
 * Record one settled game. Returns a NEW `Stats` — the input is readonly and stays so, which
 * is what lets `applyResult` compute the whole next profile before anything is written and
 * lets a test assert the old value was not mutated.
 *
 * `played` always increments; exactly one of `won`/`lost`/`pushed` does. There is no way to
 * record a result that bumps neither or bumps two, because the outcome is one enum value and
 * this is a lookup, not a chain of `if`s — the shape of bug (`recordWin` AND `recordLoss`
 * both firing) that v1's split wrapper methods invited.
 */
export function bumpStats(stats: Stats, gameId: string, outcome: Outcome): Stats {
  const prev = statFor(stats, gameId);
  const next: GameStat = {
    played: prev.played + 1,
    won: prev.won + (outcome === 'win' ? 1 : 0),
    lost: prev.lost + (outcome === 'loss' ? 1 : 0),
    pushed: prev.pushed + (outcome === 'push' ? 1 : 0),
  };
  return { ...stats, [gameId]: next };
}

/**
 * Wins across every game. THE LEADERBOARD'S RANK KEY, and the reason it is a derived sum and
 * not a stored counter: a stored `totalWins` would be a second source of truth for a fact the
 * per-game `won` counts already hold — the exact `level`-vs-`xp` redundancy Phase 3 deleted,
 * and the exact shape of v1's `loadout.color`. It is projected onto `leaderboard/<uid>.wins`
 * by the writer, computed here, so the ranking cannot disagree with the record it ranks.
 */
export function totalWins(stats: Stats): number {
  return Object.values(stats).reduce((sum, s) => sum + s.won, 0);
}

/** Games played across everything. Used by `table_regular` and shown on the profile. */
export function totalPlayed(stats: Stats): number {
  return Object.values(stats).reduce((sum, s) => sum + s.played, 0);
}
