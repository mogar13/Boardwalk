import { apiFetch, type ApiClientConfig } from '@/system/repo/api/client';
import type { LeaderboardEntry, LeaderboardRepo } from '@/system/repo/types';

/**
 * The server-backed `LeaderboardRepo`. The ranking is COMPUTED server-side (wins summed from
 * stats, balances from the ledger), which is the whole point of moving it off the client — a
 * self-reported leaderboard is the hole BACKEND_PLAN.md names. `top` returns rows already ranked,
 * so no page re-sorts, identical to the Firebase repo's contract.
 */
export function httpLeaderboardRepo(cfg: ApiClientConfig): LeaderboardRepo {
  return {
    async top(limit: number): Promise<readonly LeaderboardEntry[]> {
      const res = await apiFetch(cfg, `/leaderboard?limit=${String(limit)}`, { method: 'GET' });
      if (!res.ok) throw new Error(`leaderboard load failed: ${String(res.status)}`);
      const body = (await res.json()) as { entries: LeaderboardEntry[] };
      return body.entries;
    },
  };
}
