import type { Profile } from '@/system/profile/types';
import { diffProfiles, type ProfileDiff } from '@/system/repo/shadow/diff';
import type { ProfileRepo } from '@/system/repo/types';

/**
 * Shadow mode (BACKEND_PLAN.md Phase A). A `ProfileRepo` that keeps `primary` (Firebase) as the
 * source of truth and MIRRORS every write to `mirror` (the API), then reads the record back and
 * logs any disagreement. It ships nothing user-visible — the deliverable is "the API produces
 * identical results," proven by an empty diff for a week of real play before Phase B trusts the
 * server.
 *
 * TWO INVARIANTS, both load-bearing:
 *
 *   • THE MIRROR NEVER AFFECTS THE PRIMARY. `create`/`save` await Firebase and return; the mirror
 *     runs fire-and-forget (`void`), and a mirror that 401s, times out, or is simply down can never
 *     reject the write the app is actually waiting on. Money is client-authoritative in Phase A, so
 *     the primary write is the truth and the shadow is an observer.
 *   • READS DO NOT SHADOW. `load` delegates to Firebase alone. Diffing reads now would be pure
 *     noise: the API's store is empty until the write mirror fills it, so every early read would
 *     "disagree" with a 404. Writes are what we mirror; the read-back inside the mirror is what we
 *     diff against.
 */

/** Where a shadow observation goes. Injectable so a test can assert on it; `console` by default. */
export interface ShadowLog {
  disagreement(uid: string, diffs: readonly ProfileDiff[]): void;
  failure(uid: string, error: unknown): void;
}

const consoleShadowLog: ShadowLog = {
  disagreement(uid, diffs) {
    // Shadow diagnostics are the whole deliverable of Phase A. (`no-console` is not enforced here.)
    console.warn(`[shadow] profile disagreement for ${uid}:`, diffs);
  },
  failure(uid, error) {
    // A mirror failure is expected and harmless (the API may be down); info, not warn.
    console.info(`[shadow] profile mirror failed for ${uid} (primary unaffected):`, error);
  },
};

/**
 * Mirror one profile to the API and diff the read-back. Exported and `async` (not the fire-and-
 * forget wrapper below) so it can be awaited in a test; the repo calls it with `void`. It swallows
 * every error into `log.failure` on purpose — this runs detached from the primary write, so a throw
 * here would be an unhandled rejection, and there is nothing for it to fail into.
 */
export async function mirrorProfile(
  mirror: ProfileRepo,
  uid: string,
  profile: Profile,
  log: ShadowLog = consoleShadowLog
): Promise<void> {
  try {
    await mirror.save(uid, profile);
    const readback = await mirror.load(uid);
    const diffs = diffProfiles(profile, readback);
    if (diffs.length > 0) log.disagreement(uid, diffs);
  } catch (error) {
    log.failure(uid, error);
  }
}

export function shadowProfileRepo(
  primary: ProfileRepo,
  mirror: ProfileRepo,
  log: ShadowLog = consoleShadowLog
): ProfileRepo {
  return {
    // Source of truth, untouched.
    load: (uid) => primary.load(uid),

    async create(uid, profile) {
      await primary.create(uid, profile);
      void mirrorProfile(mirror, uid, profile, log);
    },

    async save(uid, profile) {
      await primary.save(uid, profile);
      void mirrorProfile(mirror, uid, profile, log);
    },
  };
}
