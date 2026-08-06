import { apiFetch, type ApiClientConfig } from '@/system/repo/api/client';
import type { LeaderboardEntry, LeaderboardRepo } from '@/system/repo/types';

/**
 * The server-backed `LeaderboardRepo`. The ranking is COMPUTED server-side (wins summed from
 * stats, balances from the ledger), which is the whole point of moving it off the client — a
 * self-reported leaderboard is the hole BACKEND_PLAN.md names. `top` returns rows already ranked
 * and already sliced, so no page re-sorts, identical to the Firebase repo's contract.
 *
 * `board` IS HONOURED NOW, and this docblock used to say it was not. Its previous text — "the
 * server does not yet rank by board … this repo is shadow-mode; the Firebase repo is the live path"
 * — was written in Phase A and was correct then. Phase B made this repo the live path and left the
 * sentence standing, so the file most likely to be read while debugging the boards actively said
 * the boards were somebody else's problem. Both halves are fixed: the server ranks through the
 * shared `boardById`/`rankFor` in `@boardwalk/game-logic`, and this comment no longer describes a
 * repo that has not been the live one for two phases.
 *
 * NO CLIENT-SIDE RE-RANK, deliberately. It would look like belt-and-braces and would in fact be a
 * second ranking of a set the server already filtered and truncated — re-sorting the top 25 by
 * wins into bankroll order answers a different question than "who is richest", and the win-rate
 * board's ineligible rows are already gone, so a re-filter would find nothing and prove nothing.
 * One ranker per request.
 *
 * UNAUTHENTICATED-SAFE: `/leaderboard` is mounted before the API's auth middleware, so this
 * resolves signed out. `apiFetch` sends a token when there is one and omits it when there is not.
 */
export function httpLeaderboardRepo(cfg: ApiClientConfig): LeaderboardRepo {
  return {
    async top(limit: number, board = 'wins'): Promise<readonly LeaderboardEntry[]> {
      const res = await apiFetch(cfg, `/leaderboard?limit=${String(limit)}&board=${board}`, {
        method: 'GET',
      });
      if (!res.ok) throw new Error(`leaderboard load failed: ${String(res.status)}`);
      const body = (await res.json()) as { entries: LeaderboardEntry[] };
      return body.entries;
    },
  };
}
