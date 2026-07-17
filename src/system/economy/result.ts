/**
 * `reportResult`, as a pure function. This is the single most important line of the whole OS
 * design, and it is deliberately one function you cannot split.
 *
 * THE v1 FAILURE, IN FULL. `recordWin(gameId)` took one argument. Bankroll lived in
 * `SystemUI.money`, a plain setter. So every one of 40+ call sites did the money by hand
 * (`SystemUI.money += payout`) and THEN called `recordWin(gameId)` — two operations, two
 * places, and the payout the second one was handed went straight to the floor because the
 * parameter did not exist. The visible casualties: `big_win` had no unlock site (nothing knew
 * a payout), stats drifted from money (you could credit one without the other), and XP was a
 * third system nobody remembered to call. CLAUDE.md's rule is the fix: "reportResult is one
 * call for bankroll + stats + XP + achievements. Do not split it back apart."
 *
 * This is that call, pure. It takes the whole profile and the result, and returns the whole
 * next profile plus what to tell the player (XP gained, net won, badges unlocked). Bankroll,
 * XP, stats and achievements move together or not at all, because they are one return value —
 * there is no intermediate state where three of the four have updated. The hook (`useGame`)
 * calls this once and persists the result; it cannot call three of the four.
 *
 * Pure, `now` injected: the only impurity an achievement unlock needs is the timestamp, and a
 * parameter keeps this testable to the millisecond instead of racing `Date.now()`.
 */
import type { Profile } from '@/system/profile/types';
import {
  achievementById,
  satisfiedAchievements,
  type Achievement,
  type AchievementView,
} from '@/system/progress/achievements';
import { bumpStats, totalPlayed, totalWins, type Outcome } from '@/system/progress/stats';

export type { Outcome };

/**
 * What a game reports when a hand settles.
 *
 * `payoutCents` is the GROSS returned to the player, and it is added to a bankroll the wager
 * was already taken from at bet time (wagers go through `useBet().commit()`, payouts through
 * here — two events, per ARCHITECTURE.md). So an even-money win on a $10 bet is
 * `{ outcome: 'win', payoutCents: 2000, wagerCents: 1000 }`: the $10 left at commit, $20 comes
 * back, net +$10. A loss is `payoutCents: 0`; a push returns the stake, `payoutCents: 1000`.
 *
 * A game with no economy (chess, solitaire) reports just `{ outcome }` — payout and wager
 * default to 0, bankroll does not move, and it still earns XP, a stat, and a shot at a
 * non-money achievement. That is why this is `reportResult` and not `recordPayout`: the
 * non-betting games have a result to report too.
 */
export interface ResultReport {
  readonly outcome: Outcome;
  /** Gross cents returned to the player. Default 0. */
  readonly payoutCents?: number;
  /** Cents staked on this hand. Default 0. Present so `big_win`/`high_roller` can see the bet. */
  readonly wagerCents?: number;
}

/** What `reportResult` gives back: the next profile, and the facts worth surfacing to the player. */
export interface AppliedResult {
  readonly profile: Profile;
  /** XP this result awarded — for a "+100 XP" flourish. */
  readonly xpGained: number;
  /** payout − wager, the actual money won or lost on the hand. Negative on a loss. */
  readonly netCents: number;
  /** Achievements that unlocked ON THIS RESULT — already diffed against what was earned before. */
  readonly unlocked: readonly Achievement[];
}

/**
 * XP per result. THE ONE KNOB, flat by outcome on purpose: XP that scaled with the wager would
 * make the casino the only place levels come from and turn the chess games into second-class
 * citizens, and this project's five games are chosen for coverage, not to funnel everyone to
 * the tables. A loss still pays a little — you played, and a progression bar that only moves
 * on wins punishes the exact players who need a reason to keep going.
 */
const XP_BY_OUTCOME: Record<Outcome, number> = {
  win: 100,
  push: 20,
  loss: 10,
};

/**
 * Apply a settled result to a profile. The heart of the OS.
 *
 * The order is: money, then XP, then stats, then achievements — and achievements are checked
 * against the state AFTER the first three, because "reach level 10" and "hold $50,000" are
 * questions about the new state, not the old one. Unlock is a diff: an id is in `unlocked`
 * only if it is satisfied now AND was not already in `profile.achievements`, so a predicate
 * that stays true (`deep_pockets`) fires once and never revokes.
 */
export function applyResult(
  profile: Profile,
  gameId: string,
  report: ResultReport,
  nowMs: number
): AppliedResult {
  const payoutCents = Math.round(report.payoutCents ?? 0);
  const wagerCents = Math.round(report.wagerCents ?? 0);
  const netCents = payoutCents - wagerCents;

  // Bankroll: the wager already left at commit, so this only adds the payout. Floored at 0 —
  // rules refuse a negative anyway, and a payout can never push it negative, but a
  // mis-constructed report should be harmless rather than write an illegal value.
  const bankrollCents = Math.max(0, profile.bankrollCents + payoutCents);

  const xpGained = XP_BY_OUTCOME[report.outcome];
  const xp = profile.xp + xpGained;

  const stats = bumpStats(profile.stats, gameId, report.outcome);

  const view: AchievementView = {
    totalPlayed: totalPlayed(stats),
    totalWins: totalWins(stats),
    bankrollCents,
    xp,
    lastWagerCents: wagerCents,
    lastNetCents: netCents,
  };

  const unlocked = satisfiedAchievements(view)
    .filter((id) => !(id in profile.achievements))
    .map((id) => achievementById.get(id))
    .filter((a): a is Achievement => a !== undefined);

  const achievements = { ...profile.achievements };
  for (const a of unlocked) achievements[a.id] = nowMs;

  return {
    profile: { ...profile, bankrollCents, xp, stats, achievements },
    xpGained,
    netCents,
    unlocked,
  };
}
