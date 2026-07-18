import { httpLeaderboardRepo } from '@/system/repo/api/leaderboardRepo';
import { httpProfileRepo } from '@/system/repo/api/profileRepo';
import type { ApiClientConfig } from '@/system/repo/api/client';
import type { LeaderboardRepo, ProfileRepo } from '@/system/repo/types';

/**
 * The API repo family — the server half of the seam, ready but NOT yet wired.
 *
 * WHY IT IS NOT IN `../index.ts` YET. BACKEND_PLAN.md Phase A is "shadow mode": the client keeps
 * writing Firebase as the source of truth AND mirrors to the API, and a diff proves they agree
 * before anything trusts the server. Flipping the composition root to these repos is Phase B, and
 * doing it now — with no shadow proof and no server deployed — would be the `validateAndCommit()`
 * mistake in reverse: shipping a swap before it has earned trust. So these are built against the
 * real interfaces, unit-adjacent to the Firebase ones, and left one wiring line away from live.
 *
 * `room` and `chat` are deliberately absent: they are realtime, and Phase C moves them to
 * WebSockets. Until then they stay on Firebase, so a transitional `Repos` composes THESE two with
 * the Firebase room/chat — that composition is the Phase-B change, made in `../index.ts`.
 */
export interface ApiRepos {
  readonly profile: ProfileRepo;
  readonly leaderboard: LeaderboardRepo;
}

export function apiRepos(cfg: ApiClientConfig): ApiRepos {
  return {
    profile: httpProfileRepo(cfg),
    leaderboard: httpLeaderboardRepo(cfg),
  };
}

export type { ApiClientConfig } from '@/system/repo/api/client';
