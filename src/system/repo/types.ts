import type { IdentityMode } from '@/system/auth/credentials';
import type { Profile, Session } from '@/system/profile/types';

/**
 * The seam. Everything above this line talks to these interfaces; exactly one
 * directory below it knows what Firebase is.
 *
 * WHY THE SEAM IS WORTH ITS WEIGHT. ARCHITECTURE.md keeps Firebase RTDB and rejects
 * VS-Dashboard's Express+SQLite, because realtime sync is the one thing this app
 * genuinely needs and the one thing SQLite will not give you without hand-building
 * websocket transport. That bet is good today and might not be forever — the moment
 * the economy has to stop being client-authoritative (BACKEND_PLAN.md), the work is
 * rewriting `./firebase/*` and changing which object `./index.ts` exports. Not
 * touching a game. `@boardwalk/no-firebase-imports` is what keeps that sentence true.
 *
 * WHAT IS DELIBERATELY NOT HERE: `RoomRepo` and `ChatRepo`.
 *
 * ARCHITECTURE.md's repo-layout sketch lists all three, and writing the other two now
 * would take ten minutes and be exactly the mistake this codebase was founded to
 * avoid. v1's defect table leads with `validateAndCommit()` — written to end
 * hand-rolled bet math, ZERO adopters, all six betting games still double-clamping by
 * hand — and `SystemProfile`, "the source of truth", called by no game for money. Both
 * are interfaces designed before their callers existed, and both were wrong in ways
 * nobody found until the callers arrived and went around them. Rooms are Phase 5.
 * `RoomRepo` gets designed by `useRoom` needing it, which is the only design input
 * that has ever worked.
 */

/**
 * Stop listening. Returned by every subscribe-shaped method here, and returning it is
 * not a style choice.
 *
 * v1's `SystemUI.on()` has no `off()` at all, so listeners accumulate for the page's
 * lifetime; 22 of its 25 multiplayer games leak a live Firebase subscription per lobby
 * close. Handing back the teardown at the moment of subscription is what makes the
 * caller's cleanup a one-liner instead of a thing they must remember to write
 * somewhere else — and in React it is literally what `useEffect` wants returned, so
 * the correct code is also the shortest code. This is the shape `useRoom<T>()` will be
 * built on in Phase 5.
 */
export type Unsubscribe = () => void;

/**
 * Every repo call that can fail because of something the USER did returns one of
 * these. Calls that can only fail because something is broken throw.
 *
 * The distinction is the useful one: "username already taken" is data the form must
 * render; "the database is unreachable" is not a form state. Making both an exception
 * means the form catches everything and renders `err.message` — which is how a raw
 * Firebase error code ends up in front of a player. Making both a Result means real
 * bugs get swallowed by an `if (!ok)` branch. So: expected failures are values,
 * unexpected ones are exceptions.
 */
export type RepoResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface SignUpInput {
  readonly username: string;
  readonly password: string;
  /**
   * Optional, and the fork the whole identity design turns on.
   *
   * Absent: the account's Auth identity is a synthetic `@boardwalk.invalid` address
   * derived from the username. Sign in with the username. NO PASSWORD RECOVERY IS
   * POSSIBLE, EVER — there is nowhere to send it, and the UI has to say so before they
   * choose, not after they forget.
   *
   * Present: the Auth identity IS the real address, which therefore must never enter
   * the world-readable `usernames/` index. That node stores `viaEmail: true` instead —
   * see credentials.ts.
   */
  readonly email?: string;
}

export interface SignInInput {
  /** A username or an email. The repo decides which by shape and resolves it. */
  readonly identifier: string;
  readonly password: string;
}

export interface AuthRepo {
  /**
   * The authoritative session stream. Fires immediately with the current answer
   * (`null` if signed out), then on every change.
   *
   * THE SUBSCRIPTION IS THE API, and a `getSession()` is deliberately absent. Firebase
   * restores a session asynchronously on page load, so any synchronous getter returns
   * `null` during first paint and something else a tick later — which is a race every
   * caller loses individually. v1 fought this with an optimistic localStorage cache
   * (`_activeUid` restored synchronously "so hub code calling isLoggedIn() during first
   * render sees the right answer") plus a reconcile pass that tears it back down. That
   * works, and it is a lot of machinery to answer a question the callback already
   * answers. Here the store subscribes once and the app renders a loading state until
   * the first fire — which is the honest thing to render, because until then the answer
   * genuinely is not known.
   */
  onSessionChanged(listener: (session: Session | null) => void): Unsubscribe;

  /**
   * Create the Auth user and claim the username index. Does NOT write the profile —
   * see ProfileRepo.create and the ordering note in `@/system/auth/authStore`.
   */
  signUp(input: SignUpInput): Promise<RepoResult<Session>>;

  signIn(input: SignInInput): Promise<RepoResult<Session>>;

  signOut(): Promise<void>;

  /**
   * ALWAYS SUCCEEDS FOR A WELL-FORMED ADDRESS, including one with no account.
   *
   * That is not sloppiness, it is the point: reporting "no such user" turns this form
   * into an account-enumeration oracle. v1 gets this right and says so in a comment —
   * "Don't confirm or deny whether the address exists" — and both branches return the
   * identical string. It is a one-word change to "improve" this into a vulnerability.
   *
   * It DOES fail for a synthetic address: those cannot receive mail, and an account
   * with no email has no recovery path. Saying so plainly beats a reset that silently
   * goes nowhere.
   */
  sendPasswordReset(email: string): Promise<RepoResult<void>>;
}

export interface ProfileRepo {
  /** `null` means the record genuinely is not there — an authoritative server answer, not a guess. */
  load(uid: string): Promise<Profile | null>;

  /**
   * Write a fresh record: the private profile AND its public leaderboard projection,
   * which exist separately because `users/` is not world-readable and a leaderboard is.
   */
  create(uid: string, profile: Profile): Promise<void>;
}

/**
 * The set of repos the app runs on. `@/system/repo` exports one of these and it is the
 * only wiring that names an implementation.
 *
 * Phase 4 adds the economy's writers here; Phase 5 adds rooms and chat. Each arrives
 * with the code that calls it.
 */
export interface Repos {
  readonly auth: AuthRepo;
  readonly profile: ProfileRepo;
}

/** Re-exported so a consumer never needs a second import to type an error branch. */
export type { IdentityMode, Profile, Session };
