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

export interface Profile {
  readonly name: string;
  readonly avatar: string;
  /** INTEGER CENTS. Derived from the ledger sum on read; a delta appended on write. */
  readonly bankrollCents: number;
  readonly xp: number;
  readonly stats: Readonly<Record<string, GameStat>>;
  readonly achievements: Readonly<Record<string, number>>;
  readonly inventory: Readonly<Record<string, true>>;
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
}
