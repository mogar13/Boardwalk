import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@boardwalk/game-logic';
import type { Session } from '@/system/auth/session';

/**
 * THE BRANCH A DEVELOPER CANNOT REACH BY CLICKING — `tests/greeting.test.ts`'s argument, and the
 * same blindness that left `GET /leaderboard` behind auth for weeks.
 *
 * Every developer signing in here has a working referee, so the profile-load REJECTION is a path
 * that only ever runs in production, during an outage, for a player with no console open. On
 * 2026-08-09 it ran for three and a half hours: the Pi's database stick fell off the USB bus,
 * systemd stopped `boardwalk-api` (the unit requires that mount), `GET /profile` answered 502, and
 * the browser showed a green "Welcome back." toast followed by the sign-in form, with no error on
 * any surface. The credentials had genuinely been accepted; only the profile read failed, and the
 * rejection handler answered by setting `signed-out` and DROPPING the reason.
 *
 * So the assertions are about the pair, never the status alone: a bounce must carry a reason, and
 * a working sign-in must carry none. Asserting `signed-out` by itself passes on the exact bug this
 * file exists for — that was always the value it returned.
 */

const load = vi.fn<(uid: string) => Promise<Profile | null>>();
const create = vi.fn<(uid: string, profile: Profile) => Promise<void>>();

/** The listener `subscribeToSession` registers, captured so a test can drive it. */
let emit: ((session: Session | null) => void) | null = null;

vi.mock('@/system/repo', () => ({
  firebaseReady: () => ({ ok: true }),
  repos: {
    auth: {
      onSessionChanged: (cb: (session: Session | null) => void) => {
        emit = cb;
        return () => undefined;
      },
    },
    profile: {
      load: (uid: string) => load(uid),
      create: (uid: string, profile: Profile) => create(uid, profile),
    },
  },
}));

const { useAuthStore, subscribeToSession } = await import('@/system/auth/authStore');
const { describeAuthFailure } = await import('@/system/auth/authFailure');
const { defaultProfile } = await import('@/system/profile/defaults');

const SESSION: Session = { uid: 'u1', username: 'ada', isAdmin: false };

/** Drive one session change and let the store's `.then` chain settle. */
async function signIn(session: Session | null = SESSION): Promise<void> {
  emit?.(session);
  // A MACROTASK boundary, not a counted run of `await Promise.resolve()`. The chain's length is
  // not fixed — the self-heal path is load → create → load → setState, where the ordinary one is
  // load → setState — so any fixed count of microtask flushes silently under-drains exactly one
  // of these tests and reports the state as still 'unknown'. Yielding to the macrotask queue
  // drains every pending microtask however many there are.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  load.mockReset();
  create.mockReset();
  emit = null;
  useAuthStore.setState({
    status: 'unknown',
    session: null,
    profile: null,
    busy: false,
    authError: null,
  });
  subscribeToSession();
});

describe('a sign-in that bounces says why', () => {
  it('a dead referee leaves an error to read, not just a login form', async () => {
    // Exactly what `httpProfileRepo.load` throws on the 502 the outage produced.
    load.mockRejectedValue(new Error('profile load failed: 502'));

    await signIn();

    const state = useAuthStore.getState();
    // The sign-out itself is still correct — signed-in-with-no-profile is unusable.
    expect(state.status).toBe('signed-out');
    // ...and THIS is the regression. Before the fix, this was null and the screen said nothing.
    expect(state.authError).not.toBeNull();
    // The detail must carry the machine's own words, or nobody can tell a 502 from a refusal.
    expect(state.authError?.detail).toContain('502');
  });

  it('names the password explicitly, because that is what the player will blame', async () => {
    load.mockRejectedValue(new Error('profile load failed: 502'));
    await signIn();

    const failure = useAuthStore.getState().authError;
    // The whole point of the copy: the one fact the silent version implicitly denied. A message
    // that merely says "something went wrong" leaves retyping the password as the best theory,
    // which is what actually happened for three and a half hours.
    expect(failure?.hint.toLowerCase()).toContain('password');
  });

  it('a working sign-in carries no error at all', async () => {
    load.mockResolvedValue(defaultProfile('ada'));

    await signIn();

    const state = useAuthStore.getState();
    expect(state.status).toBe('signed-in');
    // The other half of the pair. Without this, a fix that set `authError` unconditionally would
    // pass every case above while putting a scary panel over every successful sign-in.
    expect(state.authError).toBeNull();
  });

  it('a MISSING profile is not a failure — it self-heals and stays quiet', async () => {
    // `load` returning null is the authoritative "no record", which the store answers by creating
    // one. It must not be confused with a throw: one is a fresh account, the other is an outage,
    // and telling a new player the server is down would be a lie.
    load.mockResolvedValueOnce(null).mockResolvedValueOnce(defaultProfile('ada'));
    create.mockResolvedValue(undefined);

    await signIn();

    const state = useAuthStore.getState();
    expect(create).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('signed-in');
    expect(state.authError).toBeNull();
  });

  it('signing out clears a previous failure', async () => {
    load.mockRejectedValue(new Error('profile load failed: 502'));
    await signIn();
    expect(useAuthStore.getState().authError).not.toBeNull();

    await signIn(null);

    // A stale outage panel hanging over the sign-in form after a clean sign-out is a claim about
    // a request nobody has made yet.
    expect(useAuthStore.getState().authError).toBeNull();
    expect(useAuthStore.getState().status).toBe('signed-out');
  });
});

describe('describeAuthFailure is total', () => {
  // It runs on the path that is ALREADY going wrong, so anything it throws on replaces a bad
  // sign-in with a blank page. A rejection can carry literally anything.
  it('reads an Error message', () => {
    expect(describeAuthFailure(new Error('boom')).detail).toBe('boom');
  });

  it('reads a thrown string', () => {
    expect(describeAuthFailure('PERMISSION_DENIED').detail).toBe('PERMISSION_DENIED');
  });

  it('never renders the word "undefined" at a player', () => {
    // `String(undefined)` is the word "undefined", which reads as a bug in the error reporter
    // rather than a report about the server — and is the exact string someone would then waste
    // time grepping for.
    expect(describeAuthFailure(undefined).detail).not.toContain('undefined');
    expect(describeAuthFailure(null).detail).not.toContain('null');
  });

  it('survives an Error with an empty message, and a hostile toString', () => {
    expect(describeAuthFailure(new Error('')).detail.length).toBeGreaterThan(0);
    const hostile = {
      toString() {
        throw new Error('nope');
      },
    };
    expect(() => describeAuthFailure(hostile)).not.toThrow();
    expect(describeAuthFailure(hostile).detail.length).toBeGreaterThan(0);
  });

  it('always says something, whatever it was handed', () => {
    for (const thrown of [new Error('x'), 'y', null, undefined, 0, {}, []]) {
      const failure = describeAuthFailure(thrown);
      expect(failure.message.length).toBeGreaterThan(0);
      expect(failure.hint.length).toBeGreaterThan(0);
      expect(failure.detail.length).toBeGreaterThan(0);
    }
  });
});
