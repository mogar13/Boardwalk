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
 * TIERED CHAINS (P3). Most rows now belong to a `chain` (Bronze→Silver→Gold→Platinum of the
 * same idea) so there is always a next tier just out of reach. A chain is still just four rows
 * with escalating thresholds — no new mechanism, the predicate model already carried it. The
 * top tier of the two mastery chains (chess, blackjack) `grants` an EARN-ONLY cosmetic, which
 * is the whole point of P2's `priceCents: null` items: skill buys prestige money cannot.
 *
 * FEATS (P3). A handful of achievements are moment-based, not state-based — "won with a natural
 * 21", "cleared Solitaire without recycling". Those cannot be a question about the profile after
 * the fact (the profile never learns the hand was a two-card 21), so the GAME reports them by id
 * through `ResultReport.feats` and the pipeline records any that are marked `feat` here. A feat
 * has no `test`; `satisfiedAchievements` never returns it. `FEAT_IDS` is the allow-list, so a
 * game reporting `chess_platinum` through the feats channel unlocks nothing — only `feat` rows.
 *
 * Idempotence is the caller's job and it is trivial: `applyResult` only ADDS ids that are
 * satisfied-and-not-already-unlocked, so a predicate that is true for many results (like
 * `bankroll_bronze`) fires exactly once, the first time, and a later poorer state never revokes
 * it. See `@/system/economy/result`.
 */
import { levelFromXp } from '../profile/xp';

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
  /**
   * Wins per game, keyed by `manifest.id`, after this result. The per-game mastery chains
   * (chess, blackjack) read one entry each — a game never played is absent, so a predicate
   * reads `?? 0`. Kept as data (a map), not the whole `Stats`, so a predicate still cannot
   * reach a field nobody projected here.
   */
  readonly winsByGame: Readonly<Record<string, number>>;
}

/** The tier ranking — index is the medal rank, and the last is the chain's completing tier. */
export const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum'] as const;

/** Bronze→Platinum. Derived from `TIER_ORDER` so the type and the ordered list cannot drift. */
export type Tier = (typeof TIER_ORDER)[number];

export interface Achievement {
  /** Stable id — the key under `profile.achievements`. Never renamed; a rename orphans a badge. */
  readonly id: string;
  /** Shown on the badge. */
  readonly name: string;
  /** How you earn it, in a breath. Shown under a locked badge as the goal (hidden ones hide it). */
  readonly description: string;
  /** The face of the badge. */
  readonly emoji: string;
  /**
   * True when the view satisfies it. Pure — no clock, no randomness, no I/O. ABSENT on a feat:
   * a feat is unlocked only by a game reporting its id, never by a state predicate, so
   * `satisfiedAchievements` skips any row without a `test`.
   */
  readonly test?: (view: AchievementView) => boolean;
  /** Chain group id — siblings share it and are ordered by `tier`. Absent on a standalone badge. */
  readonly chain?: string;
  /** Tier within the chain. Drives the medal shown; the top tier (`platinum`) may `grant`. */
  readonly tier?: Tier;
  /**
   * A cosmetic id (see `@/system/store/catalog`) GRANTED into `inventory` the moment this
   * unlocks. Lives on a chain's completing tier — finishing the chain drops the earn-only
   * cosmetic. This is the P2→P3 link: `applyResult` reads it and adds the id, and it is the ONLY
   * path an earn-only item is obtained (the store refuses to sell it).
   */
  readonly grants?: string;
  /** Hidden until earned — renders as "???" with no goal shown. Discovery is the reward. */
  readonly hidden?: boolean;
  /**
   * A feat: unlocked only by a game reporting its id in `ResultReport.feats`, never by a
   * predicate. Marks the row as reportable — `FEAT_IDS` is built from this, so only `feat` rows
   * can be unlocked through the feats channel. Feats have no `test`.
   */
  readonly feat?: boolean;
}

// ── Threshold constants, named so a number at a call is never a mystery ──────────────────────────
/** $1,000, in cents — the `big_win` line. */
const BIG_WIN_CENTS = 100_000;
/** $500, in cents — the stake that makes you a high roller. */
const HIGH_ROLLER_CENTS = 50_000;

/** The two per-game mastery chains share one ladder: 1 / 10 / 50 / 100 wins. */
const GAME_MASTERY = [1, 10, 50, 100] as const;

/** Roman numeral per tier, so a mastery chain's rows read I→IV without an index lookup. */
const TIER_NUMERAL: Record<Tier, string> = {
  bronze: 'I',
  silver: 'II',
  gold: 'III',
  platinum: 'IV',
};

/** Exactly four of something — one per tier. Built with literal indices so a rung is never `undefined`. */
type Quad<T> = readonly [T, T, T, T];

/**
 * Build a chain's four rungs, one per tier, calling `build` with each config, its tier, and whether
 * it is the top (completing) tier. Literal-index tuple access (`configs[0]` … `TIER_ORDER[3]`)
 * keeps every rung provably defined under `noUncheckedIndexedAccess`, and pairs config-to-tier
 * once here so no chain can drift its tier order.
 */
function fourTiers<T>(
  configs: Quad<T>,
  build: (config: T, tier: Tier, top: boolean) => Achievement
): readonly Achievement[] {
  return [
    build(configs[0], TIER_ORDER[0], false),
    build(configs[1], TIER_ORDER[1], false),
    build(configs[2], TIER_ORDER[2], false),
    build(configs[3], TIER_ORDER[3], true),
  ];
}

/**
 * A per-game mastery chain over `view.winsByGame[gameId]`, the top tier granting an earn-only
 * cosmetic. Factored because chess and blackjack are the same ladder with a different game id,
 * name and reward — the shape that most invites a copy-paste divergence.
 */
function masteryChain(
  gameId: string,
  chain: string,
  label: string,
  emoji: string,
  grant: string,
  grantName: string
): readonly Achievement[] {
  return fourTiers(GAME_MASTERY, (threshold, tier, top) => ({
    id: `${chain}_${tier}`,
    name: `${label} ${TIER_NUMERAL[tier]}`,
    description: top
      ? `Win ${String(threshold)} games — grants the “${grantName}” title.`
      : `Win ${String(threshold)} game${threshold === 1 ? '' : 's'}.`,
    emoji,
    chain,
    tier,
    test: (v: AchievementView) => (v.winsByGame[gameId] ?? 0) >= threshold,
    ...(top ? { grants: grant } : {}),
  }));
}

/** One rung of a `thresholdChain`. */
interface ThresholdRow {
  readonly at: number;
  readonly name: string;
  readonly description: string;
}

/**
 * A threshold chain: four rows over one numeric view field. Used by the wins, bankroll and
 * level ladders — same structure, different projection and copy.
 */
function thresholdChain(
  chain: string,
  emoji: string,
  read: (v: AchievementView) => number,
  rows: Quad<ThresholdRow>
): readonly Achievement[] {
  return fourTiers(rows, (row, tier) => ({
    id: `${chain}_${tier}`,
    name: row.name,
    description: row.description,
    emoji,
    chain,
    tier,
    test: (v: AchievementView) => read(v) >= row.at,
  }));
}

/**
 * The catalogue, ordered — the profile page renders it in this order. The reachable standalone
 * badges first, then the chains (each a Bronze→Platinum ladder), then the feats (the brag-worthy
 * moments, one hidden). Adding an achievement is adding a row here; nothing else changes, which
 * is the whole point of the predicate model.
 */
export const ACHIEVEMENTS: readonly Achievement[] = [
  // ── Standalone milestones & single-bet flexes (not chain-shaped) ───────────────────────────────
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
    id: 'table_regular',
    name: 'Table Regular',
    description: 'Play 100 games.',
    emoji: '🎲',
    test: (v) => v.totalPlayed >= 100,
  },

  // ── Wins chain: 10 / 50 / 100 / 500 across every game ──────────────────────────────────────────
  ...thresholdChain('wins', '🏆', (v) => v.totalWins, [
    { at: 10, name: 'Winner', description: 'Win 10 games.' },
    { at: 50, name: 'Contender', description: 'Win 50 games.' },
    { at: 100, name: 'Champion', description: 'Win 100 games.' },
    { at: 500, name: 'Legend', description: 'Win 500 games.' },
  ]),

  // ── Level chain: 5 / 10 / 25 / 50 (reads the same `levelFromXp` the meter does) ────────────────
  ...thresholdChain('level', '⭐', (v) => levelFromXp(v.xp), [
    { at: 5, name: 'Apprentice', description: 'Reach level 5.' },
    { at: 10, name: 'Seasoned', description: 'Reach level 10.' },
    { at: 25, name: 'Veteran', description: 'Reach level 25.' },
    { at: 50, name: 'Prodigy', description: 'Reach level 50.' },
  ]),

  // ── Bankroll chain: $10k / $50k / $250k / $1M ──────────────────────────────────────────────────
  ...thresholdChain('bankroll', '💎', (v) => v.bankrollCents, [
    { at: 1_000_000, name: 'Comfortable', description: 'Hold a bankroll of $10,000.' },
    { at: 5_000_000, name: 'Deep Pockets', description: 'Hold a bankroll of $50,000.' },
    { at: 25_000_000, name: 'Loaded', description: 'Hold a bankroll of $250,000.' },
    { at: 100_000_000, name: 'Millionaire', description: 'Hold a bankroll of $1,000,000.' },
  ]),

  // ── Chess mastery → grants the earn-only "Grandmaster" title on Platinum ───────────────────────
  ...masteryChain('chess', 'chess', 'Chess', '♟️', 'ttl_grandmaster', 'Grandmaster'),

  // ── Blackjack mastery → grants the earn-only "The House" title on Platinum ─────────────────────
  ...masteryChain('blackjack', 'blackjack', 'Blackjack', '🃏', 'ttl_thehouse', 'The House'),

  // ── Feats: moment-based, reported by the game (see the header). One hidden — a surprise. ────────
  {
    id: 'feat_natural',
    name: 'Natural',
    description: 'Win a hand of Blackjack with a two-card 21.',
    emoji: '✨',
    feat: true,
  },
  {
    id: 'feat_cleansheet',
    name: 'Clean Sheet',
    description: 'Clear Solitaire without recycling the stock.',
    emoji: '🧹',
    feat: true,
  },
  {
    id: 'feat_speedrun',
    name: 'Blitz',
    description: 'Win a game of Chess in under 20 moves.',
    emoji: '⚡',
    feat: true,
    // Hidden — it renders "???" until it fires, so the first time you race someone off the board
    // it is a discovery, not a checklist item.
    hidden: true,
  },
];

/** Lookup by id, for rendering a stored `achievements` set back into names and emoji. */
export const achievementById: ReadonlyMap<string, Achievement> = new Map(
  ACHIEVEMENTS.map((a) => [a.id, a])
);

/**
 * The ids a game may report as feats — the allow-list. Built from `feat: true` rows, so a
 * reported id can ONLY unlock an achievement explicitly marked reportable. A game cannot mint
 * `chess_platinum` (and its granted title) through the feats channel; the pipeline drops any
 * reported id not in here. See `recordedFeats`.
 */
export const FEAT_IDS: ReadonlySet<string> = new Set(
  ACHIEVEMENTS.filter((a) => a.feat).map((a) => a.id)
);

/**
 * Every achievement id the view now satisfies — NOT "newly unlocked". The diff against what
 * was already earned is `applyResult`'s job, because only it knows the before-state; keeping
 * this a pure "what is true now" makes it trivial to test (build a view, assert the set) and
 * impossible to get the idempotence wrong here. Feats (no `test`) are never returned — they
 * come through `recordedFeats`, not a state check.
 */
export function satisfiedAchievements(view: AchievementView): readonly string[] {
  return ACHIEVEMENTS.filter((a) => a.test !== undefined && a.test(view)).map((a) => a.id);
}

/**
 * The valid feat ids a game reported — its list, de-duplicated and filtered to real feats.
 * Not "newly unlocked"; the already-earned diff is `applyResult`'s, same as `satisfiedAchievements`.
 * The filter to `FEAT_IDS` is the security boundary: a game reporting a chain id or a typo
 * unlocks nothing.
 */
export function recordedFeats(reported: readonly string[] | undefined): readonly string[] {
  if (reported === undefined) return [];
  return [...new Set(reported)].filter((id) => FEAT_IDS.has(id));
}

/** Total achievements, for the completion denominator. */
export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;

/**
 * Completion percentage — earned / total, rounded. Pure derivation, no storage (the `level`/`wins`
 * rule: never store a fact the counts already determine). `earned` is how many catalogue ids the
 * profile holds; orphan keys from a removed achievement do not count, because the caller counts
 * over `ACHIEVEMENTS`, not over the stored map.
 */
export function completionPct(earned: number): number {
  if (ACHIEVEMENT_COUNT === 0) return 0;
  return Math.round((earned / ACHIEVEMENT_COUNT) * 100);
}
