/**
 * The domain shapes the referee speaks — now the SHARED ones, which is what this file's previous
 * header said should happen "in Phase D's `packages/game-logic` move". This is that move.
 *
 * These were a standalone copy on purpose while there was one consumer, and the copy was
 * load-bearing in a bad way: Phase A's `Profile` here had no `equipped` field at all, so the
 * shadow mirror silently dropped every player's card back and title on every write, and nothing
 * caught it because there was nothing to compare against — the two definitions could differ and
 * both compile. Structural identity between two hand-maintained interfaces is a thing you hope
 * for; importing one definition is a thing you get.
 *
 * `LeaderboardEntry` stays defined here because it is not a domain shape at all — it is this
 * service's public projection, assembled from a SQL query, and the frontend has its own idea of
 * the same row at `src/system/repo/types.ts`. A projection is allowed to differ from the record
 * it projects; that is what makes it a projection.
 */
export type { DailyState, Equipped, GameStat, Profile } from '@boardwalk/game-logic';

/** One row of the public standings — the same five fields the frontend's rules pin, plus uid. */
export interface LeaderboardEntry {
  readonly uid: string;
  readonly name: string;
  readonly avatar: string;
  readonly bankrollCents: number;
  readonly xp: number;
  readonly wins: number;
  /**
   * Total games played — the denominator the frontend's Win Rate board ranks on. Projected
   * alongside `wins` because a rate needs both halves; the rate itself is never stored, the same
   * "one source of truth" call as `level` from `xp`. Added in Phase B: Phase A's entry omitted
   * it, so the API's leaderboard could not have served the skill board at all.
   */
  readonly played: number;
}
