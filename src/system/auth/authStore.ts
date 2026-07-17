import { create } from 'zustand';
import { cleanUsername } from '@/system/auth/credentials';
import { defaultProfile } from '@/system/profile/defaults';
import type { Profile, Session } from '@/system/profile/types';
import { firebaseReady, repos } from '@/system/repo';
import type { RepoResult, SignInInput, SignUpInput } from '@/system/repo';

/**
 * Session + profile, in one store, subscribed once.
 *
 * WHY ONE STORE AND NOT TWO. They look separable and are not: a profile is only ever
 * loaded FOR a session, and every bug in this area is the two disagreeing — a stale
 * profile surviving a sign-out, a profile arriving after the session it belonged to has
 * gone. v1's `_loadIntoProfile` carries the scar:
 *
 *   "never merge in the previous session's SystemProfile.data, since the previous user
 *    (or guest) may have left stale loadout/inventory/bankroll fields behind"
 *
 * That is a cross-user data leak, fixed by hard-replacing rather than merging. Here the
 * two fields are set together in every transition, so the state that leaked cannot be
 * constructed: there is no moment where `session` and `profile` are assigned from
 * different sources.
 *
 * WHY ZUSTAND AND NOT CONTEXT. ARCHITECTURE.md's stack table: "Context would thrash on a
 * ticking bankroll." A context value re-renders every consumer on every change, and from
 * Phase 4 this store changes on every hand of blackjack. A Zustand selector re-renders
 * only what read the field that moved.
 */

type Status =
  /**
   * We have not heard from Firebase yet. THE HONEST INITIAL STATE, and it has to exist.
   *
   * Auth restores asynchronously, so on first paint the answer is genuinely unknown —
   * rendering "signed out" would flash a sign-in form at someone who is signed in, on
   * every reload. v1 papered over this with an optimistic session restored synchronously
   * from localStorage plus a reconcile pass to tear it back down; that is a lot of
   * machinery to avoid rendering a spinner for 200ms.
   */
  'unknown' | 'signed-out' | 'signed-in';

interface AuthState {
  readonly status: Status;
  readonly session: Session | null;
  readonly profile: Profile | null;
  /** Set while a sign-in/sign-up round-trip is in flight, so the form can disable itself. */
  readonly busy: boolean;

  readonly signUp: (input: SignUpInput) => Promise<RepoResult<Session>>;
  readonly signIn: (input: SignInInput) => Promise<RepoResult<Session>>;
  readonly signOut: () => Promise<void>;
}

/**
 * Load the profile, or create it if the record is missing.
 *
 * THE SELF-HEAL, and it is the one thing here that v1 does not do. Sign-up is four writes
 * (Auth user, `usernames/`, `users/`, `leaderboard/`) with no transaction spanning them,
 * because none is possible — RTDB rules cannot reach an Auth user, so a failure after step
 * one cannot be rolled back. v1's answer is an honest error string and an account that
 * stays broken: `{ ok: false, error: "Account created but saving failed" }`, and the user
 * is stranded with credentials that work and a profile that does not exist.
 *
 * Healing on read costs three lines and turns that into a bad minute. It is safe for
 * exactly one reason: `load()` returns `null` ONLY on an authoritative "the node is not
 * there". A network failure throws instead — if it returned null we would overwrite a real
 * account with a fresh $5,000 every time someone's wifi dropped.
 */
async function loadOrCreateProfile(session: Session): Promise<Profile> {
  const existing = await repos.profile.load(session.uid);
  if (existing !== null) return existing;

  // `username` is '' for an email account (Auth knows the address, not the name) — in that
  // case the profile record was the only thing that knew, and it is what is missing. A
  // placeholder beats a crash; the name is editable and the bankroll is what matters.
  const fresh = defaultProfile(session.username === '' ? 'Player' : session.username);
  await repos.profile.create(session.uid, fresh);
  return fresh;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'unknown',
  session: null,
  profile: null,
  busy: false,

  async signUp(input) {
    set({ busy: true });
    try {
      const result = await repos.auth.signUp(input);
      if (!result.ok) return result;
      // Create the profile HERE and not inside the repo, so the ordering — identity first,
      // then the record that hangs off it — is one readable sequence in one place rather
      // than split across two repos that each know half of it.
      await repos.profile.create(result.value.uid, defaultProfile(input.username));
      // NOT set() here. `onSessionChanged` fires for this sign-up and hydrates the store
      // through the same path a page reload takes. Assigning it here too would mean two
      // writers for one transition and, eventually, two that disagree.
      return result;
    } finally {
      set({ busy: false });
    }
  },

  async signIn(input) {
    set({ busy: true });
    try {
      return await repos.auth.signIn(input);
    } finally {
      set({ busy: false });
    }
  },

  async signOut() {
    // Nothing is cleared here on purpose. `onSessionChanged` fires with null and clears
    // both fields together — one writer per transition. Clearing here too would race the
    // listener for who gets to write `null`, and the loser would be re-writing state the
    // winner had already moved past.
    await repos.auth.signOut();
  },
}));

/**
 * Subscribe to Firebase's session, once, for the life of the page. Called by `<UiRoot>`'s
 * neighbour in App.tsx — see `useAuthBootstrap`.
 *
 * The unsubscriber is returned rather than dropped even though nothing will realistically
 * call it before the page unloads. That is not ceremony: `onSessionChanged` returns it
 * (repo/types.ts explains why every subscribe here does), React StrictMode double-invokes
 * effects in dev specifically to catch a subscription that cannot be undone, and a
 * listener leaked here is v1's exact defect — 22 of its 25 games leaked a live Firebase
 * subscription per lobby close because the teardown was somebody's job to remember.
 */
export function subscribeToSession(): () => void {
  // No credentials, no subscription — and NOT a throw.
  //
  // Every repo method reaches `firebaseAuth()`, which throws when the config is missing.
  // Inside an effect that throw is an unhandled render error, so a fresh clone with no
  // `.env.local` would white-screen on the exact page whose job is to explain that there
  // is no `.env.local`. The status stays 'unknown' and App.tsx's `firebaseReady()` check
  // renders the panel that names the missing variables.
  if (!firebaseReady().ok) return () => undefined;

  return repos.auth.onSessionChanged((session) => {
    if (session === null) {
      // HARD REPLACE, never a merge. Both fields, together. This is v1's cross-user leak
      // fix stated as an assignment instead of a comment.
      useAuthStore.setState({ status: 'signed-out', session: null, profile: null });
      return;
    }

    void loadOrCreateProfile(session).then(
      (profile) => {
        useAuthStore.setState({
          status: 'signed-in',
          // For an email account Auth has no username; the profile record is what knows.
          // Backfilling it here keeps `session.username` meaningful for every account
          // rather than only synthetic ones.
          session:
            session.username === ''
              ? { ...session, username: cleanUsername(profile.name) }
              : session,
          profile,
        });
      },
      () => {
        // The profile could not be read AND could not be created — offline, or the rules
        // said no. Signed in with no record is not a state anything downstream can use,
        // and pretending otherwise is how `undefined` reaches a component. Stay signed-out
        // and let them try again.
        useAuthStore.setState({ status: 'signed-out', session: null, profile: null });
      }
    );
  });
}
