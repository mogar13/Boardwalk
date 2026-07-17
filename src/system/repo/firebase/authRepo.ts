import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { get, ref, set } from 'firebase/database';
import {
  cleanUsername,
  friendlyAuthError,
  isSyntheticEmail,
  looksLikeEmail,
  syntheticEmail,
  validatePassword,
  validateUsername,
  type IdentityMode,
} from '@/system/auth/credentials';
import type { Session } from '@/system/profile/types';
import { firebaseAuth, firebaseDb } from '@/system/repo/firebase/app';
import type {
  AuthRepo,
  RepoResult,
  SignInInput,
  SignUpInput,
  Unsubscribe,
} from '@/system/repo/types';

/**
 * Firebase Auth + the `usernames/` index + the `admins/` check.
 *
 * NOT IN HERE, AND NEVER: a password. Not hashed, not encoded, not compared. Firebase
 * owns credentials and is the only thing that ever touches one.
 *
 * That sentence is the single most expensive line in this repo's history. v1 shipped
 * TWO backdoors against it — a hardcoded `username === "forerunner" && password ===
 * "luna&abi"` granting `isDev` in world-readable client source, and a second,
 * console-reachable `SystemProfile.authenticateDev(password)` doing the same from a
 * different file — alongside a reversible "hash" (`btoa("C4S1N0_OS_" + password)`)
 * stored in a users node, and a `verifySecurityAnswer()` that RETURNED THE PLAINTEXT
 * PASSWORD to the caller. v1's own tombstone comment, left where the second one was:
 *
 *   "There is deliberately no client-side password check here — one shipped in the
 *    public source would be no gate at all."
 *
 * The fix is not vigilance. It is that Firebase Auth is the only party with a password
 * to compare, so there is nothing here for a check to be written against.
 */

/** `admins/<uid>` — read-only, self-only, and the only real privilege boundary. See database.rules.json. */
const ADMIN_NODE = 'admins';
/** The public username -> uid index. World-readable, so it holds `viaEmail: boolean` and never an address. */
const USERNAME_NODE = 'usernames';

interface UsernameEntry {
  readonly uid: string;
  readonly viaEmail: boolean;
}

const codeOf = (e: unknown): string => (e instanceof FirebaseError ? e.code : 'unknown');

/**
 * Is this uid an admin?
 *
 * FAILS CLOSED, and the `catch` is the interesting half: `admins/<uid>` is readable
 * only by `<uid>`, so a rules rejection is a legitimate answer meaning "no", not an
 * error to surface. Anything else that goes wrong — offline, malformed — also lands
 * here and also means "not an admin", which is the only safe reading. v1 does exactly
 * this and its comment is the whole justification: `// rules deny -> not an admin`.
 */
async function readIsAdmin(uid: string): Promise<boolean> {
  try {
    const snap = await get(ref(firebaseDb(), `${ADMIN_NODE}/${uid}`));
    return snap.exists();
  } catch {
    return false;
  }
}

async function readUsernameEntry(username: string): Promise<UsernameEntry | null> {
  const snap = await get(ref(firebaseDb(), `${USERNAME_NODE}/${cleanUsername(username)}`));
  if (!snap.exists()) return null;
  const value = snap.val() as Partial<UsernameEntry> | null;
  if (value == null || typeof value.uid !== 'string') return null;
  // `viaEmail` is coerced rather than trusted: it is world-readable data, and an older
  // or hand-edited record may simply not have it. Absent means "synthetic", which is
  // the mode that fails safe — it sends the user to the username field, where a wrong
  // guess is a normal failed sign-in rather than a leaked hint about their address.
  return { uid: value.uid, viaEmail: value.viaEmail === true };
}

/**
 * Turn a Firebase user into our Session. The `admins/` read is the only extra I/O, and
 * it happens here rather than in the store so that no caller can construct a Session
 * without one — a Session with a default-true `isAdmin` should be impossible to spell.
 */
async function toSession(user: User): Promise<Session> {
  // The synthetic address IS the username, which is why this reconstruction is safe and
  // does not need another read. For an email account, Auth has no idea what the username
  // is — the profile record does, and the store fills it in from there.
  const email = user.email ?? '';
  const username = isSyntheticEmail(email) ? cleanUsername(email.split('@')[0] ?? '') : '';
  return { uid: user.uid, username, isAdmin: await readIsAdmin(user.uid) };
}

/**
 * Resolve whatever they typed into the address Firebase Auth knows them by.
 *
 * The one branch that matters is the middle: if the account was created WITH an email,
 * we refuse rather than guessing. We cannot derive the address — it is deliberately not
 * in the index — and the honest answer is to send them to the right field. v1 says the
 * same thing in the same place.
 */
async function resolveAuthEmail(identifier: string): Promise<RepoResult<string>> {
  const typed = identifier.trim();
  if (looksLikeEmail(typed)) return { ok: true, value: typed };

  const entry = await readUsernameEntry(typed);
  // Same string as a wrong password, on purpose: distinguishing them makes this form an
  // account-enumeration oracle. See friendlyAuthError.
  if (entry === null) return { ok: false, error: 'Wrong username or password.' };
  if (entry.viaEmail) {
    return { ok: false, error: 'This account signs in with its email address — use that instead.' };
  }
  return { ok: true, value: syntheticEmail(typed) };
}

export const firebaseAuthRepo: AuthRepo = {
  onSessionChanged(listener): Unsubscribe {
    // `onAuthStateChanged` RETURNS its own unsubscriber, and handing it straight back is
    // the entire fix for v1's `SystemUI.on()` having no `off()`. Nothing here has to
    // remember to tear down, because the only way to subscribe also hands you the way to stop.
    return onAuthStateChanged(firebaseAuth(), (user) => {
      if (user === null) {
        listener(null);
        return;
      }
      // The callback is sync and the admin read is not. A rejection here would be an
      // unhandled rejection inside Firebase's listener, so it is caught and downgraded
      // to a session with no admin rights — fail-closed, consistent with readIsAdmin.
      void toSession(user).then(listener, () => {
        listener({ uid: user.uid, username: '', isAdmin: false });
      });
    });
  },

  async signUp({ username, password, email }: SignUpInput): Promise<RepoResult<Session>> {
    const mode: IdentityMode = email === undefined ? 'username' : 'email';

    // Local checks first — they cost nothing and they are the difference between an
    // instant answer and a round-trip to be told a password is short.
    const nameCheck = validateUsername(username);
    if (!nameCheck.ok) return { ok: false, error: nameCheck.error };
    const passCheck = validatePassword(password);
    if (!passCheck.ok) return { ok: false, error: passCheck.error };
    if (email !== undefined && !looksLikeEmail(email)) {
      return { ok: false, error: 'That email address is not valid.' };
    }

    const clean = cleanUsername(username);
    const authEmail = email?.trim() ?? syntheticEmail(clean);

    // ADVISORY ONLY. Two people can pass this at the same instant, and it is here for
    // the error message, not the guarantee — see below.
    if ((await readUsernameEntry(clean)) !== null) {
      return { ok: false, error: 'Username already taken.' };
    }

    let user: User;
    try {
      // THE AUTH USER IS CREATED FIRST, AND THIS IS THE REAL UNIQUENESS LOCK. There is no
      // transaction on `usernames/` and there does not need to be one: Firebase Auth will
      // not create a second account on one address, so for a username sign-up
      // `auth/email-already-in-use` MEANS "username already taken" — it is the only
      // report of that fact that cannot race. v1 hardcoded exactly this mapping. It is
      // easy to lose while tidying up error handling, and losing it means two accounts can
      // claim one name.
      const cred = await createUserWithEmailAndPassword(firebaseAuth(), authEmail, password);
      user = cred.user;
    } catch (e) {
      return { ok: false, error: friendlyAuthError(codeOf(e), mode) };
    }

    try {
      // Claim the index. The rules allow this only because the node does not exist and
      // `uid` matches ours — claim-then-verify, from v1, no transaction.
      await set(ref(firebaseDb(), `${USERNAME_NODE}/${clean}`), {
        uid: user.uid,
        // NEVER the address itself. This node is world-readable; the boolean is the
        // entire mechanism keeping real emails out of it.
        viaEmail: email !== undefined,
      } satisfies UsernameEntry);
    } catch {
      // PARTIAL SIGN-UP, REPORTED HONESTLY. The Auth user now exists with no index entry,
      // and we cannot roll it back — RTDB rules cannot reach an Auth user; only the console
      // can delete one. v1 has this same hole and says so in its error string.
      //
      // What v2 adds is that it heals: the profile store recreates a missing record on the
      // next successful sign-in, so this is a bad minute rather than a dead account. The
      // index entry is re-claimable because the rules allow a write to a node that does not
      // exist when the uid is yours.
      return {
        ok: false,
        error: 'Account created, but saving your username failed. Sign in to finish setting it up.',
      };
    }

    return { ok: true, value: await toSession(user) };
  },

  async signIn({ identifier, password }: SignInInput): Promise<RepoResult<Session>> {
    const resolved = await resolveAuthEmail(identifier);
    if (!resolved.ok) return resolved;

    try {
      const cred = await signInWithEmailAndPassword(firebaseAuth(), resolved.value, password);
      return { ok: true, value: await toSession(cred.user) };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(codeOf(e), 'username') };
    }
  },

  async signOut(): Promise<void> {
    await fbSignOut(firebaseAuth());
  },

  async sendPasswordReset(email): Promise<RepoResult<void>> {
    const address = email.trim();

    // Refuse the synthetic domain up front. These addresses cannot receive mail by
    // construction, so a reset would go nowhere and report success. An account with no
    // email has no recovery path, and the only decent thing is to say so.
    if (isSyntheticEmail(address) || !looksLikeEmail(address)) {
      return {
        ok: false,
        error: 'That is not an email address. Accounts created without one cannot be recovered.',
      };
    }

    try {
      await sendPasswordResetEmail(firebaseAuth(), address);
    } catch (e) {
      // NOT AN ERROR. "No account for that address" is the answer this endpoint must
      // never give — it turns a reset form into an account-enumeration oracle. Both
      // branches return the same success, exactly as v1 does, with the same reasoning:
      // "Don't confirm or deny whether the address exists."
      if (codeOf(e) !== 'auth/user-not-found') {
        return { ok: false, error: friendlyAuthError(codeOf(e), 'email') };
      }
    }
    return { ok: true, value: undefined };
  },
};
