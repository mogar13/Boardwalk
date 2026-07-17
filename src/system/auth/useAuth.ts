import { useEffect } from 'react';
import { useAuthStore, subscribeToSession } from '@/system/auth/authStore';
import type { Session } from '@/system/profile/types';
import type { RepoResult, SignInInput, SignUpInput } from '@/system/repo';

/**
 * The auth surface. A game never touches this — Phase 3's shell owns the gate — but the
 * profile panel and the top bar do.
 */

export interface AuthApi {
  /**
   * `'unknown'` until Firebase has answered. RENDER A LOADING STATE FOR IT; do not treat
   * it as signed-out. Auth restores asynchronously, so "signed out" on first paint is a
   * guess that is wrong for every returning player, and the visible cost is a sign-in form
   * flashing on every reload. See the Status type in authStore.
   */
  readonly status: 'unknown' | 'signed-out' | 'signed-in';
  readonly session: Session | null;
  readonly busy: boolean;
  readonly signUp: (input: SignUpInput) => Promise<RepoResult<Session>>;
  readonly signIn: (input: SignInInput) => Promise<RepoResult<Session>>;
  readonly signOut: () => Promise<void>;
}

export function useAuth(): AuthApi {
  const status = useAuthStore((s) => s.status);
  const session = useAuthStore((s) => s.session);
  const busy = useAuthStore((s) => s.busy);
  const signUp = useAuthStore((s) => s.signUp);
  const signIn = useAuthStore((s) => s.signIn);
  const signOut = useAuthStore((s) => s.signOut);
  return { status, session, busy, signUp, signIn, signOut };
}

/**
 * Are we an admin? `admins/<uid>` said so at sign-in.
 *
 * THIS HIDES UI AND NOTHING ELSE. It is not a privilege and it is not a check — the
 * server is the only judge, and every privileged action attempts its write and lets
 * `database.rules.json` reject it. Forging this to `true` buys a visible button that
 * still gets permission-denied.
 *
 * Naming it `useIsAdmin` rather than `isDev` is deliberate. v1's `.dev-only` class and
 * `profile.isDev` boolean read like authority and were treated as such twice, at a cost of
 * two shipped backdoors. This one reads a cache of an answer the server already gave, and
 * `Session.isAdmin` says so at the type.
 */
export function useIsAdmin(): boolean {
  return useAuthStore((s) => s.session?.isAdmin ?? false);
}

/**
 * Start the one session subscription. Mount ONCE, at the app root, next to `<UiRoot />`.
 *
 * WHY A HOOK AND NOT A MODULE-LEVEL CALL. A subscription started at import time runs
 * during module evaluation, before React exists, and can never be torn down — which is the
 * shape of v1's leak (22 of 25 games leaking a live Firebase listener per lobby close,
 * because `SystemMatch.setListener` was optional and 22 of them ignored it). Inside an
 * effect, teardown is the return value, and StrictMode's double-invoke in dev exists
 * precisely to make a missing one visible.
 *
 * `[]` is correct: `subscribeToSession` is a module function, not a value that changes.
 * The subscription lives for the page, and the cleanup is what makes that a choice rather
 * than an accident.
 */
export function useAuthBootstrap(): void {
  useEffect(() => subscribeToSession(), []);
}
