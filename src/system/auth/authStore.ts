import { create } from 'zustand';
import { cleanUsername } from '@/system/auth/credentials';
import { defaultProfile } from '@/system/profile/defaults';
import type { Profile } from '@boardwalk/game-logic';
import type { Session } from '@/system/auth/session';
import { firebaseReady, repos } from '@/system/repo';
import type { EconomyIntent, RepoResult, SignInInput, SignUpInput } from '@/system/repo';

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

  /**
   * Persist a mutated profile — THE single writer that moves money after sign-up, and the
   * thing Phase 4's whole economy hangs off. It is deliberately not exported as a hook, and it
   * is deliberately whole-profile-in, not a patch: the economy computes the next profile with
   * pure logic (`applyResult`, `applyPurchase`, `claimDaily`) and hands the finished thing
   * here. A game never sees this — it gets `useBet`/`reportResult`, which call it — so "there
   * is no money setter a game can reach" stays true at the type level (`useBankroll` is a
   * readonly number) AND at the module level (this is not on any game-facing surface).
   *
   * Optimistic: it sets the store first so the top bar ticks instantly, then persists, and
   * REVERTS if the write is rejected — money is client-authoritative in v2, so the local value
   * is the truth until the server disagrees, and a failed save must not leave the UI showing a
   * balance the database does not hold. It rethrows so the caller can toast.
   */
  readonly mutateProfile: (next: Profile) => Promise<void>;

  /**
   * MOVE MONEY — Phase B's single path, and the reason `mutateProfile` no longer is one.
   *
   * The caller passes an INTENT (what the player did) and the optimistic profile the pure client
   * logic computed for it. The store shows the optimistic one immediately so the top bar ticks
   * without a round-trip, then replaces it with whatever the server says is true. Those are
   * usually identical — the same pure rules run on both sides — and when they are not, the
   * server wins, within one round trip, silently. A refusal ("insufficient funds") reverts and
   * returns the reason for the caller to toast.
   *
   * With no API configured, `repos.economy` is the Firebase fallback: it persists the optimistic
   * profile and hands it straight back, so this is exactly the pre-Phase-B behaviour and the
   * hooks above cannot tell which world they are in.
   */
  readonly applyEconomy: (
    intent: EconomyIntent,
    optimistic: Profile
  ) => Promise<RepoResult<Profile>>;

  /**
   * INSTALL A PROFILE THE REFEREE ALREADY DECIDED — Phase D's addition, and the narrowest one that
   * works.
   *
   * `applyEconomy` is the path for money the CLIENT initiates: it computes an optimistic profile,
   * sends an intent, and reconciles. A server-dealt blackjack hand inverts that. The referee takes
   * the stake, deals, and settles from its own cards inside the same request, so by the time the
   * response lands there is nothing left to predict — the authoritative profile is simply in hand,
   * and the only thing left to do is show it. Routing that through `applyEconomy` would mean
   * inventing an optimistic profile for a hand whose outcome we do not know, which is a guess with
   * a 3:2 tail on it.
   *
   * IT IS NOT A MONEY SETTER, and the distinction is the whole reason it is safe to add. It
   * computes nothing and it accepts nothing a caller made up: the only values that reach it come
   * back from a repo, exactly as `applyEconomy`'s own `set({ profile: result.value })` does. And it
   * is not on any game-facing surface — a game gets `useBet`/`reportResult`/`useBlackjackTable`,
   * never the store — so "there is no bankroll setter a game can reach" is still true at the module
   * level as well as the type level.
   */
  readonly adoptProfile: (authoritative: Profile) => void;
}

/**
 * A per-intent id, so a retried request is recognised as the same intent rather than a second one.
 * `crypto.randomUUID` is in every browser this app supports; the fallback keeps a non-secure
 * context (an old dev host over plain HTTP) from throwing, and uniqueness is all that is needed —
 * the nonce is not a secret and grants nothing on its own.
 */
function mintNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `n-${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
}

export { mintNonce };

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

  // PHASE B: re-read rather than trusting `fresh`. The opening bankroll is now the SERVER's grant,
  // not the number we just sent — they agree today (the parity test pins both to the same
  // constant), and the day they stop agreeing this reads the truth instead of rendering our guess
  // until the next reload. Falls back to `fresh` if the read fails, because a brand-new account
  // with a working record is not worth failing sign-in over.
  const stored = await repos.profile.load(session.uid).catch(() => null);
  return stored ?? fresh;
}

export const useAuthStore = create<AuthState>((set, get) => ({
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

  async mutateProfile(next) {
    const { session, profile: prev } = get();
    // Signed out, or hydrating: there is nothing to save against, so this is a no-op rather
    // than a throw — a stray economy call during a sign-out transition should be harmless.
    if (session === null || prev === null) return;

    set({ profile: next }); // optimistic — the top bar ticks now, not after the round-trip
    try {
      await repos.profile.save(session.uid, next);
    } catch (error) {
      // The write was rejected (offline, or the rules said no). Put the old profile back so the
      // UI matches the database, and rethrow so the caller can say "couldn't save". Reverting
      // to the exact `prev` we captured — not re-loading — keeps this synchronous and avoids a
      // second round-trip that could also fail.
      //
      // But ONLY revert if our optimistic `next` is still the store's profile. If a second
      // mutation (a daily claim landing while a hand settles) has already written over `next`,
      // reverting to `prev` would wipe that newer write too — a lost update that vanishes money
      // or XP the player earned. Leaving the newer optimistic value in place is the safe choice:
      // the client stays ahead of the server until the next successful save reconciles it.
      if (get().profile === next) set({ profile: prev });
      throw error;
    }
  },

  adoptProfile(authoritative) {
    // Signed out, or mid-transition: there is nothing to adopt onto, and writing a profile with no
    // session is the cross-user leak `subscribeToSession` hard-replaces to prevent. A late response
    // arriving after a sign-out is dropped, which is the correct thing to do with it.
    if (get().session === null) return;
    set({ profile: authoritative });
  },

  async applyEconomy(intent, optimistic) {
    const { session, profile: prev } = get();
    if (session === null || prev === null) {
      return { ok: false, error: 'not signed in' };
    }

    set({ profile: optimistic });
    try {
      const result = await repos.economy.apply(session.uid, intent, optimistic);
      // Only reconcile if our optimistic value is still the one on screen. If a second mutation
      // (a daily claim landing while a hand settles) has already written over it, overwriting
      // with THIS call's answer would drop the newer one — the lost-update hazard `mutateProfile`
      // documents. The next successful mutation returns a profile that includes both, so leaving
      // the newer optimistic value alone is the safe direction.
      if (get().profile !== optimistic) return result;

      if (!result.ok) {
        // The server refused. Our optimistic profile was never true, so put the old one back —
        // this is the branch that stops a rejected bet from leaving a phantom deduction on screen.
        set({ profile: prev });
        return result;
      }
      set({ profile: result.value });
      return result;
    } catch (error) {
      // A broken connection, not a refusal. Same revert, and rethrow so the caller can say
      // "couldn't save" rather than "you can't afford that" — the two are very different to read.
      if (get().profile === optimistic) set({ profile: prev });
      throw error;
    }
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
