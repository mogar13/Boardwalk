import { get, ref } from 'firebase/database';
import { DEFAULT_AVATAR } from '@/system/profile/defaults';
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
 * but only on a single child, and the ranking has a tiebreak — equal wins are broken by bankroll,
 * then XP — that a single-child query cannot express. It would also need an `.indexOn` in the
 * rules. At this app's scale (a handful of accounts) reading the whole node and sorting here is
 * correct and simplest; the honest note is that a large board would want the index and a server
 * ordering, and this is the seam where that change lands without touching the page. The repo
 * boundary is exactly what makes that a later edit to this file and nothing else.
 */

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const firebaseLeaderboardRepo: LeaderboardRepo = {
  async top(limit): Promise<readonly LeaderboardEntry[]> {
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
      };
    });

    // Wins rank; bankroll breaks a tie; XP breaks that. A stable, total order so the board does
    // not reshuffle two equal players on every refresh.
    rows.sort((a, b) => b.wins - a.wins || b.bankrollCents - a.bankrollCents || b.xp - a.xp);
    return rows.slice(0, Math.max(0, limit));
  },
};
