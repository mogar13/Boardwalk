/**
 * The daily reward — a streak clock, pure, `now` injected.
 *
 * WHY A DAY INDEX AND NOT A TIMESTAMP. "Claimed today" is a per-DAY fact, and comparing two
 * day indices for equality is exact where comparing timestamps needs a "same calendar day"
 * arithmetic that is a bug magnet (DST, month ends, the off-by-one at midnight). `dayIndex`
 * collapses a millisecond clock to an integer number of UTC days, and the whole module then
 * reasons in integers. UTC, not local: the reset moment is the same for everyone and does not
 * shift when a player travels, which is the honest choice for a shared leaderboard even though
 * it means the reset is not local midnight. If that ever matters, it is one function to change.
 *
 * `now` is a parameter for the same reason `applyResult`'s is: a reward clock that reads
 * `Date.now()` internally cannot be tested without mocking time, and this one is tested by
 * passing the millisecond of three specific days.
 */
import type { DailyState } from '@/system/profile/types';

/** Milliseconds in a day. Named so `nowMs / DAY_MS` reads as what it is. */
export const DAY_MS = 86_400_000;

/**
 * The reward for each streak day, in cents: $500 on day one, climbing to $5,000 on day seven,
 * then flat. The climb is the point — a reason to come back tomorrow rather than a flat stipend
 * — and it caps so the streak is not an ever-growing obligation. Money, not cosmetics, because
 * the store is where money turns into cosmetics and a reward that opened the store is what the
 * Phase 3 placeholder promised.
 */
export const DAILY_REWARDS_CENTS: readonly number[] = [
  50_000, // day 1 — $500
  75_000, // day 2 — $750
  100_000, // day 3 — $1,000
  150_000, // day 4 — $1,500
  200_000, // day 5 — $2,000
  250_000, // day 6 — $2,500
  500_000, // day 7+ — $5,000
];

/** UTC day index of a millisecond clock. Equal indices are the same day; that is the whole trick. */
export function dayIndex(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

/** The reward a given streak day pays. Streak ≥ 7 all pay the day-7 amount. */
function rewardForStreak(streak: number): number {
  const idx = Math.min(Math.max(streak, 1), DAILY_REWARDS_CENTS.length) - 1;
  return DAILY_REWARDS_CENTS[idx] ?? DAILY_REWARDS_CENTS[DAILY_REWARDS_CENTS.length - 1] ?? 0;
}

export interface DailyStatus {
  /** Can the player claim right now? False once they have claimed today. */
  readonly claimable: boolean;
  /** The streak they are on before claiming (0 for a brand-new account). */
  readonly streak: number;
  /** What the streak becomes if they claim now — streak+1 on a consecutive day, else 1. */
  readonly nextStreak: number;
  /** What claiming now grants, in cents. */
  readonly rewardCents: number;
  /** True when a gap since the last claim reset the run — for an honest "streak lost" line. */
  readonly streakBroken: boolean;
}

/**
 * Where the streak stands and what a claim would do, without performing it — this is what the
 * card renders. `claimable` is `today > lastClaimDay`, using `>` and not `!==` on purpose: if a
 * clock jumps backwards, a stale future `lastClaimDay` must NOT re-open the claim, or a wound-
 * back clock mints free money every day.
 */
export function dailyStatus(state: DailyState, nowMs: number): DailyStatus {
  const today = dayIndex(nowMs);
  const claimable = today > state.lastClaimDay;
  const consecutive = state.lastClaimDay > 0 && today === state.lastClaimDay + 1;
  const nextStreak = consecutive ? state.streak + 1 : 1;
  const streakBroken = state.lastClaimDay > 0 && today > state.lastClaimDay + 1;
  return {
    claimable,
    streak: state.streak,
    nextStreak,
    rewardCents: rewardForStreak(nextStreak),
    streakBroken,
  };
}

/**
 * Claim today's reward, or `null` if it is not claimable — the same values-not-exceptions
 * shape as the rest of the economy. Returns the new `DailyState` to store and the cents to add
 * to the bankroll; the caller does both in one profile write, so the clock and the money can
 * never disagree (claiming without paying, or paying twice).
 */
export function claimDaily(
  state: DailyState,
  nowMs: number
): { readonly state: DailyState; readonly rewardCents: number } | null {
  const status = dailyStatus(state, nowMs);
  if (!status.claimable) return null;
  return {
    state: { lastClaimDay: dayIndex(nowMs), streak: status.nextStreak },
    rewardCents: status.rewardCents,
  };
}
