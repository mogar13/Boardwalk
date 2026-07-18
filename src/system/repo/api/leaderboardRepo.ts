import { apiFetch, type ApiClientConfig } from '@/system/repo/api/client';
import type { LeaderboardEntry, LeaderboardRepo } from '@/system/repo/types';

/**
 * The server-backed `LeaderboardRepo`. The ranking is COMPUTED server-side (wins summed from
 * stats, balances from the ledger), which is the whole point of moving it off the client — a
 * self-reported leaderboard is the hole BACKEND_PLAN.md names. `top` returns rows already ranked,
 * so no page re-sorts, identical to the Firebase repo's contract.
 *
 * `board` rides along as a query param so this matches the interface, but the server does not yet
 * rank by board — it stays wins-ordered until the backend grows the other boards (BACKEND_PLAN).
 * This repo is shadow-mode; the Firebase repo is the live path that ranks all four boards today.
 */
export function httpLeaderboardRepo(cfg: ApiClientConfig): LeaderboardRepo {
  return {
    async top(limit: number, board = 'wins'): Promise<readonly LeaderboardEntry[]> {
      const res = await apiFetch(
        cfg,
        `/leaderboard?limit=${String(limit)}&board=${board}`,
        { method: 'GET' }
      );
      if (!res.ok) throw new Error(`leaderboard load failed: ${String(res.status)}`);
      const body = (await res.json()) as { entries: LeaderboardEntry[] };
      return body.entries;
    },
  };
}
