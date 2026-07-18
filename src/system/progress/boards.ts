/**
 * The leaderboard boards — pure ranking logic, so "who is #1 at X" is a unit test, not a thing
 * discovered by staring at the page.
 *
 * WHY A REGISTRY OF PURE COMPARATORS. Phase 4 had one board (wins) and the leaderboardRepo comment
 * argued the sort belongs in the repo, because "pushing the sort into each page is how two screens
 * rank differently". That reasoning survives the move to many boards — it just moves up a level:
 * the ONE source of truth is now this registry, imported by the repo (to rank) AND by the page (to
 * label and read). Two screens still cannot disagree, because there is one `compare` per board and
 * both call it. What changed is only that there are four of them.
 *
 * The whole reason boards exist: one stiff "wins" number lets exactly one player be #1. Four axes
 * let a grinder, a whale, a leveller and a sharp each top a board — everyone can be best at
 * something, which is the entire point of the stat wall.
 *
 * PURE — no React, no Firebase, no formatting. A comparator is a question about two rows and a
 * number; keeping it that way is what makes `boards.test.ts` able to assert the order of a
 * hand-built set. Presentation (money vs level vs percent) stays in the page, which already owns
 * `formatMoney`/`xpProgress` — a board says how to RANK, not how to draw.
 */
import type { LeaderboardEntry } from '@/system/repo/types';

export type BoardId = 'wins' | 'richest' | 'level' | 'winRate';

/**
 * The floor to appear on the win-rate board. Without it a player who won their single game sits at
 * 100% above everyone who has played hundreds — a rate is only a ranking once it is over enough
 * games to mean something. Ten is small enough that a real player clears it in a session and large
 * enough that one lucky hand does not top the board.
 */
export const WIN_RATE_MIN_GAMES = 10;

/** Win rate as a 0..1 ratio. 0 for a player who has not played — never a divide-by-zero. */
export function winRateOf(entry: LeaderboardEntry): number {
  return entry.played > 0 ? entry.wins / entry.played : 0;
}

export interface Board {
  readonly id: BoardId;
  /** The tab label. */
  readonly label: string;
  /** The ranked-column header (short — it sits over a narrow column). */
  readonly column: string;
  /** One line under the page header, so the ranking rule is never a mystery. */
  readonly blurb: string;
  /**
   * Does this row qualify for this board at all? Every board but win-rate takes everyone; win-rate
   * hides players under `WIN_RATE_MIN_GAMES` so the top of the board is players with a real sample.
   */
  readonly eligible: (entry: LeaderboardEntry) => boolean;
  /**
   * The full ranking, tiebreaks included — a TOTAL order, so the board does not reshuffle two
   * otherwise-equal players on every refresh. Sorts descending (best first): a negative result
   * means `a` outranks `b`, matching `Array.sort`.
   */
  readonly compare: (a: LeaderboardEntry, b: LeaderboardEntry) => number;
}

/**
 * The four boards. The tiebreak chains are deliberate: each board breaks a tie by the OTHER
 * standings in a sensible order, so a tie on the headline number still lands somewhere stable
 * rather than in refresh-order.
 */
export const BOARDS: readonly Board[] = [
  {
    id: 'wins',
    label: 'Most Wins',
    column: 'Wins',
    blurb: 'Ranked by total wins across every game — the headline board.',
    eligible: () => true,
    // The Phase 4 order, preserved exactly so this board is byte-for-byte the old one.
    compare: (a, b) => b.wins - a.wins || b.bankrollCents - a.bankrollCents || b.xp - a.xp,
  },
  {
    id: 'richest',
    label: 'Richest',
    column: 'Bankroll',
    blurb: 'Ranked by bankroll — who is holding the biggest stack right now.',
    eligible: () => true,
    compare: (a, b) => b.bankrollCents - a.bankrollCents || b.wins - a.wins || b.xp - a.xp,
  },
  {
    id: 'level',
    label: 'Highest Level',
    column: 'Level',
    blurb: 'Ranked by XP — the players who have logged the most time at the tables.',
    eligible: () => true,
    compare: (a, b) => b.xp - a.xp || b.wins - a.wins || b.bankrollCents - a.bankrollCents,
  },
  {
    id: 'winRate',
    label: 'Best Win Rate',
    column: 'Win %',
    blurb: `Ranked by win rate, among players with ${String(WIN_RATE_MIN_GAMES)}+ games — skill, not volume.`,
    eligible: (e) => e.played >= WIN_RATE_MIN_GAMES,
    // Rate first; more games breaks a tie (a higher sample is the more earned rate); then raw wins.
    compare: (a, b) => winRateOf(b) - winRateOf(a) || b.played - a.played || b.wins - a.wins,
  },
];

/** Lookup by id, for turning a stored tab choice back into its board. Falls back to wins. */
export function boardById(id: string): Board {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0]!;
}

/**
 * Rank a set of rows for one board: drop the ineligible, then sort by the board's total order.
 * Pure — the repo calls this after fetching, and a test calls it on a literal array. Does not
 * mutate its input (sorts a copy), so a caller holding the unranked rows keeps them.
 */
export function rankFor(board: Board, rows: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  return rows.filter((r) => board.eligible(r)).sort(board.compare);
}
