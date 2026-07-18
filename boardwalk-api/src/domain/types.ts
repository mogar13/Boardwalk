/**
 * The wire/domain shape the referee speaks, standalone so this service never imports the
 * frontend. It MUST stay structurally identical to the frontend's `@/system/profile/types`
 * Profile — the API's whole Phase-A job is to produce a byte-identical profile — but a shared
 * package is Phase D's `packages/game-logic` move, not something to reach for with one consumer.
 */
export interface GameStat {
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly pushed: number;
}

export interface DailyState {
  readonly lastClaimDay: number;
  readonly streak: number;
}

/**
 * The equipped non-avatar cosmetics. A field is absent when nothing of that kind is equipped —
 * NOT `null`, matching the frontend's shape exactly, because the frontend's `Equipped` uses
 * optional fields and a `null` here would round-trip as a value where it expects an absence.
 *
 * ADDED IN PHASE B, AND IT WAS A LIVE BUG. Phase A's Profile had no `equipped` at all, so the
 * shadow mirror dropped a player's card back and title on every single write — silently, because
 * the diff had nothing to compare against. Cutting over without this would have unequipped
 * everyone the moment the API became the source of truth.
 */
export interface Equipped {
  readonly cardback?: string;
  readonly title?: string;
}

export interface Profile {
  readonly name: string;
  readonly avatar: string;
  /** INTEGER CENTS. Derived from the ledger sum on read; a delta appended on write. */
  readonly bankrollCents: number;
  readonly xp: number;
  readonly stats: Readonly<Record<string, GameStat>>;
  readonly achievements: Readonly<Record<string, number>>;
  readonly inventory: Readonly<Record<string, true>>;
  readonly equipped: Equipped;
  readonly daily: DailyState;
}

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
   * "one source of truth" call as `level` from `xp`. Added in Phase B: Phase A's entry omitted it,
   * so the API's leaderboard could not have served the skill board at all.
   */
  readonly played: number;
}
