import type { Profile } from '@/system/profile/types';
import { apiFetch, type ApiClientConfig } from '@/system/repo/api/client';
import type { EconomyIntent, EconomyRepo, RepoResult } from '@/system/repo/types';

/**
 * THE SERVER-AUTHORITATIVE ECONOMY — BACKEND_PLAN.md Phase B, client half.
 *
 * Each intent maps to one POST, and the response body carries the whole authoritative profile.
 * `clientNext` — the profile the pure client logic computed for the optimistic render — is
 * accepted by the interface and DELIBERATELY NEVER SENT. It is not that the server would ignore
 * it; there is no field in any request body it could travel in. That is the difference between
 * "the server validates the client's number" and "the client has no number to send", and only
 * the second one survives someone reading the source.
 */

const PATHS: Readonly<Record<EconomyIntent['kind'], string>> = {
  bet: '/bet',
  settle: '/settle',
  purchase: '/purchase',
  daily: '/daily',
};

interface MutationBody {
  readonly profile: Profile;
  readonly replayed?: boolean;
}

export function httpEconomyRepo(cfg: ApiClientConfig): EconomyRepo {
  return {
    async apply(
      _uid: string,
      intent: EconomyIntent,
      _clientNext: Profile
    ): Promise<RepoResult<Profile>> {
      const res = await apiFetch(cfg, PATHS[intent.kind], {
        method: 'POST',
        body: JSON.stringify(intent),
      });

      // 409 = the request was understood and is simply not true right now ("insufficient funds",
      // "already claimed today"). That is game state the UI renders, so it comes back as a value.
      // Anything else non-2xx is a real failure and throws — the RepoResult doctrine, unchanged.
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: body.error ?? 'that is not possible right now' };
      }
      if (!res.ok) throw new Error(`${intent.kind} failed: ${String(res.status)}`);

      const body = (await res.json()) as MutationBody;
      return { ok: true, value: body.profile };
    },
  };
}
