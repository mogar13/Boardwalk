import type { Profile } from '@/system/profile/types';
import { apiFetch, type ApiClientConfig } from '@/system/repo/api/client';
import type { ProfileRepo } from '@/system/repo/types';

/**
 * The server-backed `ProfileRepo` — the Phase-A replacement for `firebase/profileRepo`, built
 * against the SAME interface so the composition root swaps one for the other with no game, hook,
 * or component touched. That is the entire payoff of the repo boundary.
 *
 * The server derives the uid from the verified token, so the `uid` argument is not sent — it is
 * kept in the signature only because the interface has it and callers pass it. `create` and
 * `save` are one PUT: the server upserts, exactly as the frontend's `writeBoth` does both nodes.
 */
export function httpProfileRepo(cfg: ApiClientConfig): ProfileRepo {
  const put = async (profile: Profile): Promise<void> => {
    const res = await apiFetch(cfg, '/profile', { method: 'PUT', body: JSON.stringify(profile) });
    if (!res.ok) throw new Error(`profile save failed: ${String(res.status)}`);
  };

  return {
    async load(_uid: string): Promise<Profile | null> {
      const res = await apiFetch(cfg, '/profile', { method: 'GET' });
      // 404 is the authoritative "no record" — mapped to null, the same contract the Firebase
      // repo gives with `snap.exists()`. Any other non-2xx is a real failure and throws.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`profile load failed: ${String(res.status)}`);
      const body = (await res.json()) as { profile: Profile };
      return body.profile;
    },

    async create(_uid: string, profile: Profile): Promise<void> {
      await put(profile);
    },

    async save(_uid: string, profile: Profile): Promise<void> {
      await put(profile);
    },
  };
}
