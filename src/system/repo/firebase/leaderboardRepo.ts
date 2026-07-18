import { get, ref } from 'firebase/database';
import { DEFAULT_AVATAR } from '@boardwalk/game-logic';
import { boardById, rankFor } from '@/system/progress/boards';
import { firebaseDb } from '@/system/repo/firebase/app';
import type { LeaderboardEntry, LeaderboardRepo } from '@/system/repo/types';

/**
 * `leaderboard/` — the public standings, read.
 *
 * This is the reader the node was built for. Phase 2 wrote the projection on sign-up and pinned
 * it in the rules; Phase 3 left the page a placeholder because it "ranks by wins, a stat Phase 4
 * adds with its writer"; Phase 4 added the writer (`profileRepo.save` projects `wins`), so the
 * page can finally exist. The node is world-readable, so this needs no auth — reading it is the
 * one thing anyone, signed in or not, may do.
 *
 * WHY FETCH-ALL-AND-SORT AND NOT A SERVER QUERY. RTDB can `orderByChild('wins').limitToLast(n)`,
 * but only on a single child, and every board's ranking has a tiebreak a single-child query cannot
 * express — and now there are four boards, some (win rate) ranked on a value that is not even a
 * stored child. It would also need an `.indexOn` in the rules. At this app's scale (a handful of
 * accounts) reading the whole node and sorting here is correct and simplest; the honest note is
 * that a large board would want the index and a server ordering, and this is the seam where that
 * change lands without touching the page. The repo boundary is exactly what makes that a later
 * edit to this file and nothing else.
 *
 * The ranking itself is NOT here — it is `rankFor` in `@/system/progress/boards`, the one place
 * every board's order is defined, imported by this repo AND the page so the two cannot disagree.
 */

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const firebaseLeaderboardRepo: LeaderboardRepo = {
  async top(limit, board = 'wins'): Promise<readonly LeaderboardEntry[]> {
    const snap = await get(ref(firebaseDb(), 'leaderboard'));
    if (!snap.exists()) return [];

    const raw = snap.val() as Record<string, unknown>;
    const rows: LeaderboardEntry[] = Object.entries(raw).map(([uid, value]) => {
      const r = (typeof value === 'object' && value !== null ? value : {}) as Record<
        string,
        unknown
      >;
      return {
        uid,
        name: str(r.name, 'Player'),
        avatar: str(r.avatar, DEFAULT_AVATAR),
        bankrollCents: Math.max(0, num(r.bankrollCents)),
        xp: Math.max(0, num(r.xp)),
        wins: Math.max(0, num(r.wins)),
        played: Math.max(0, num(r.played)),
      };
    });

    // `rankFor` drops the ineligible (win-rate's min-games floor) and sorts by the board's total
    // order — a stable ranking so equal players do not reshuffle on refresh. One source of truth,
    // shared with the page; here we only fetch and slice.
    return rankFor(boardById(board), rows).slice(0, Math.max(0, limit));
  },
};
