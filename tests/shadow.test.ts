import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/system/profile/types';
import { diffProfiles } from '@/system/repo/shadow/diff';
import {
  mirrorProfile,
  shadowProfileRepo,
  type ShadowLog,
} from '@/system/repo/shadow/profileRepo';
import type { ProfileRepo } from '@/system/repo/types';

/**
 * The Phase-A shadow layer (BACKEND_PLAN.md): a pure write-vs-readback diff, plus the wrapper that
 * keeps Firebase authoritative while mirroring to the API. The two properties worth pinning are
 * that a clean round-trip diffs to nothing, and that the mirror can never break the primary path.
 */

const baseProfile = (over: Partial<Profile> = {}): Profile => ({
  name: 'Ada',
  avatar: '🎩',
  bankrollCents: 500_000,
  xp: 1200,
  stats: { blackjack: { played: 10, won: 4, lost: 5, pushed: 1 } },
  achievements: { big_win: 1700000000000 },
  inventory: { top_hat: true },
  equipped: { cardback: 'cb_red3' },
  daily: { lastClaimDay: 19500, streak: 3 },
  ...over,
});

describe('diffProfiles', () => {
  it('is empty when the server read back exactly what was written', () => {
    const p = baseProfile();
    // A distinct object with identical values — equality is by value, not reference.
    expect(diffProfiles(p, baseProfile())).toEqual([]);
  });

  it('reports a null read-back as one whole-profile diff, not a field storm', () => {
    const diffs = diffProfiles(baseProfile(), null);
    expect(diffs).toEqual([{ path: '(profile)', expected: 'present', actual: 'absent' }]);
  });

  it('names the scalar field that disagreed, with both values', () => {
    const diffs = diffProfiles(baseProfile(), baseProfile({ bankrollCents: 499_999 }));
    expect(diffs).toEqual([{ path: 'bankrollCents', expected: 500_000, actual: 499_999 }]);
  });

  it('descends into a nested stat count', () => {
    const diffs = diffProfiles(
      baseProfile(),
      baseProfile({ stats: { blackjack: { played: 10, won: 3, lost: 5, pushed: 1 } } })
    );
    expect(diffs).toEqual([{ path: 'stats.blackjack.won', expected: 4, actual: 3 }]);
  });

  it('catches a field the server is MISSING (present on one side only)', () => {
    const diffs = diffProfiles(baseProfile(), baseProfile({ inventory: {} }));
    expect(diffs).toEqual([{ path: 'inventory.top_hat', expected: true, actual: undefined }]);
  });

  it('catches a field the server has EXTRA', () => {
    const diffs = diffProfiles(
      baseProfile({ achievements: {} }),
      baseProfile({ achievements: { high_roller: 42 } })
    );
    expect(diffs).toEqual([{ path: 'achievements.high_roller', expected: undefined, actual: 42 }]);
  });

  it('diffs the daily clock', () => {
    const diffs = diffProfiles(baseProfile(), baseProfile({ daily: { lastClaimDay: 19500, streak: 2 } }));
    expect(diffs).toEqual([{ path: 'daily.streak', expected: 3, actual: 2 }]);
  });
});

/** A minimal in-memory `ProfileRepo` for the wrapper tests. */
function memoryRepo(): ProfileRepo & { readonly saved: Profile[] } {
  const saved: Profile[] = [];
  return {
    saved,
    load: () => Promise.resolve(saved.length > 0 ? saved[saved.length - 1]! : null),
    create: (_uid, p) => {
      saved.push(p);
      return Promise.resolve();
    },
    save: (_uid, p) => {
      saved.push(p);
      return Promise.resolve();
    },
  };
}

const silentLog: ShadowLog = { disagreement: () => undefined, failure: () => undefined };

describe('mirrorProfile', () => {
  it('logs nothing when the mirror round-trips cleanly', async () => {
    const mirror = memoryRepo();
    const disagreement = vi.fn();
    const failure = vi.fn();
    await mirrorProfile(mirror, 'u1', baseProfile(), { disagreement, failure });
    expect(mirror.saved).toHaveLength(1);
    expect(disagreement).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });

  it('logs a disagreement when the read-back differs from what was written', async () => {
    // A mirror that stores one thing but reads back another — the exact drift shadow mode exists to catch.
    const mirror: ProfileRepo = {
      load: () => Promise.resolve(baseProfile({ xp: 999 })),
      create: () => Promise.resolve(),
      save: () => Promise.resolve(),
    };
    const disagreement = vi.fn();
    const failure = vi.fn();
    await mirrorProfile(mirror, 'u1', baseProfile(), { disagreement, failure });
    expect(disagreement).toHaveBeenCalledWith('u1', [{ path: 'xp', expected: 1200, actual: 999 }]);
    expect(failure).not.toHaveBeenCalled();
  });

  it('swallows a mirror failure into log.failure and never rejects', async () => {
    const mirror: ProfileRepo = {
      load: () => Promise.reject(new Error('unused')),
      create: () => Promise.resolve(),
      save: () => Promise.reject(new Error('API down')),
    };
    const disagreement = vi.fn();
    const failure = vi.fn();
    await expect(
      mirrorProfile(mirror, 'u1', baseProfile(), { disagreement, failure })
    ).resolves.toBeUndefined();
    expect(failure).toHaveBeenCalledOnce();
    expect(disagreement).not.toHaveBeenCalled();
  });
});

describe('shadowProfileRepo', () => {
  it('reads through the primary alone (no shadow read)', async () => {
    const primary = memoryRepo();
    const mirrorLoad = vi.fn(() => Promise.resolve(null));
    const mirror: ProfileRepo = { load: mirrorLoad, create: () => Promise.resolve(), save: () => Promise.resolve() };
    await primary.create('u1', baseProfile());

    const repo = shadowProfileRepo(primary, mirror, silentLog);
    const loaded = await repo.load('u1');

    expect(loaded).toEqual(baseProfile());
    expect(mirrorLoad).not.toHaveBeenCalled();
  });

  it('writes to the primary and mirrors on save', async () => {
    const primary = memoryRepo();
    const mirror = memoryRepo();
    const repo = shadowProfileRepo(primary, mirror, silentLog);

    await repo.save('u1', baseProfile());
    // The mirror runs fire-and-forget; let its microtasks drain.
    await Promise.resolve();
    await Promise.resolve();

    expect(primary.saved).toHaveLength(1);
    expect(mirror.saved).toHaveLength(1);
  });

  it('does NOT reject a save when the mirror throws (primary is authoritative)', async () => {
    const primary = memoryRepo();
    const mirror: ProfileRepo = {
      load: () => Promise.resolve(null),
      create: () => Promise.reject(new Error('API down')),
      save: () => Promise.reject(new Error('API down')),
    };
    const repo = shadowProfileRepo(primary, mirror, silentLog);

    await expect(repo.save('u1', baseProfile())).resolves.toBeUndefined();
    expect(primary.saved).toHaveLength(1);
  });
});
