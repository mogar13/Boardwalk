/**
 * Achievements — a catalogue of predicates, pure and testable, and the home of the one bug
 * this whole OS is a reaction to.
 *
 * v1's `big_win` — "win $1,000+ in one bet" — shipped with ZERO unlock sites. Not a broken
 * one: none at all. It could not have one, because the only function that recorded a win took
 * a `gameId` and nothing else, so no code path ever knew a payout to test against $1,000. The
 * achievement existed in the list, rendered a locked badge forever, and was unwinnable. That
 * is the concrete failure `reportResult` exists to fix: it is handed the payout AND the
 * wager, so `big_win` here has a real predicate and a real caller.
 *
 * WHY PREDICATES OVER A VIEW, NOT EVENT HANDLERS. An achievement is a QUESTION ABOUT STATE
 * ("have you now won 100 games", "was this bet over $500"), and a question about state is a
 * pure function of that state. Modelling them as `.on('win', …)` handlers is what let v1's
 * unlock logic scatter across games and diverge; a predicate list is evaluated in one place,
 * every result, and adding an achievement is adding one row here — no game changes.
 *
 * Idempotence is the caller's job and it is trivial: `applyResult` only ADDS ids that are
 * satisfied-and-not-already-unlocked, so a predicate that is true for many results (like
 * `deep_pockets`) fires exactly once, the first time, and a later poorer state never revokes
 * it. See `@/system/economy/result`.
 */
import { levelFromXp } from '@/system/profile/xp';

/**
 * Everything a predicate is allowed to look at, assembled once by `applyResult` from the
 * profile AFTER the result is applied plus the two facts about the result itself. Flat and
 * readonly — a predicate cannot reach past this into the profile and start depending on a
 * field nobody projected here.
 */
export interface AchievementView {
  /** Games played across every game, after this result. */
  readonly totalPlayed: number;
  /** Wins across every game, after this result. */
  readonly totalWins: number;
  /** Bankroll after this result, in cents. */
  readonly bankrollCents: number;
  /** XP after this result. */
  readonly xp: number;
  /** What was staked on the result just settled, in cents. 0 for a game with no betting. */
  readonly lastWagerCents: number;
  /** payout − wager on the result just settled, in cents. The single-bet win magnitude. */
  readonly lastNetCents: number;
}

export interface Achievement {
  /** Stable id — the key under `profile.achievements`. Never renamed; a rename orphans a badge. */
  readonly id: string;
  /** Shown on the badge. */
  readonly name: string;
  /** How you earn it, in a breath. Shown under a locked badge as the goal. */
  readonly description: string;
  /** The face of the badge. */
  readonly emoji: string;
  /** True when the view satisfies it. Pure — no clock, no randomness, no I/O. */
  readonly test: (view: AchievementView) => boolean;
}

/** $1,000, in cents — the `big_win` line, named so the number is not a mystery at the call. */
const BIG_WIN_CENTS = 100_000;
/** $500, in cents — the stake that makes you a high roller. */
const HIGH_ROLLER_CENTS = 50_000;
/** $50,000, in cents — a bankroll that says you are ahead. */
const DEEP_POCKETS_CENTS = 5_000_000;

/**
 * The catalogue, ordered — the profile page renders it in this order, so the order is a
 * design choice (the reachable ones first, the grind and the flex last). Adding an
 * achievement is adding a row here; nothing else changes, which is the whole point of the
 * predicate model.
 */
export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'first_win',
    name: 'First Blood',
    description: 'Win your first game.',
    emoji: '🎉',
    test: (v) => v.totalWins >= 1,
  },
  {
    id: 'big_win',
    name: 'Big Win',
    description: 'Net $1,000 or more on a single bet.',
    emoji: '💰',
    // THE ONE v1 COULD NOT FIRE. `lastNetCents` is payout − wager, so it is the actual money
    // won on the hand, not the gross returned — a $600 payout on a $500 bet is a $100 win, and
    // this correctly does not fire on it.
    test: (v) => v.lastNetCents >= BIG_WIN_CENTS,
  },
  {
    id: 'high_roller',
    name: 'High Roller',
    description: 'Put $500 on the line in one bet.',
    emoji: '🦈',
    // The stake, not the result — you earn this for the nerve, win or lose.
    test: (v) => v.lastWagerCents >= HIGH_ROLLER_CENTS,
  },
  {
    id: 'seasoned',
    name: 'Seasoned',
    description: 'Reach level 10.',
    emoji: '⭐',
    // Reads the same `levelFromXp` the top bar and profile bar read, so the badge cannot
    // unlock at a level the meter disagrees with.
    test: (v) => levelFromXp(v.xp) >= 10,
  },
  {
    id: 'table_regular',
    name: 'Table Regular',
    description: 'Play 100 games.',
    emoji: '🎲',
    test: (v) => v.totalPlayed >= 100,
  },
  {
    id: 'deep_pockets',
    name: 'Deep Pockets',
    description: 'Hold a bankroll of $50,000.',
    emoji: '💎',
    test: (v) => v.bankrollCents >= DEEP_POCKETS_CENTS,
  },
];

/** Lookup by id, for rendering a stored `achievements` set back into names and emoji. */
export const achievementById: ReadonlyMap<string, Achievement> = new Map(
  ACHIEVEMENTS.map((a) => [a.id, a])
);

/**
 * Every achievement id the view now satisfies — NOT "newly unlocked". The diff against what
 * was already earned is `applyResult`'s job, because only it knows the before-state; keeping
 * this a pure "what is true now" makes it trivial to test (build a view, assert the set) and
 * impossible to get the idempotence wrong here.
 */
export function satisfiedAchievements(view: AchievementView): readonly string[] {
  return ACHIEVEMENTS.filter((a) => a.test(view)).map((a) => a.id);
}
