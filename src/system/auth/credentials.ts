/**
 * Credential rules, as pure functions. No Firebase, no React, no DOM.
 *
 * WHY THIS FILE IS PURE AND SEPARATE. ARCHITECTURE.md's build order — extract logic,
 * test the logic before any UI exists, then draw the components — is written about
 * games, and the reasoning is not about games at all: logic welded to I/O is
 * untestable logic. Every subtle thing in v1's 771-line `system_auth.js` is in here,
 * and none of it could be tested there because reaching it meant standing up
 * Firebase. tests/credentials.test.ts covers the lot in milliseconds.
 *
 * THE ONE IDEA THIS FILE EXISTS FOR: a username IS an email address, and nobody is
 * told which one.
 *
 * `usernames/` has `".read": true` — it has to, because sign-in must resolve a name
 * to an account before anyone is authenticated. So the index cannot hold real email
 * addresses, and v1's answer is the good one: an account with no email gets a
 * synthetic address in a domain that cannot exist, and Firebase Auth — which owns
 * credentials, and is the only thing that ever did — never knows the difference. The
 * public index then stores `viaEmail: true|false` and never an address. A reader
 * learns WHICH sign-in mode an account uses. Never the address.
 */

/**
 * `.invalid` is reserved by RFC 2606 and is guaranteed never to resolve. That is the
 * point: these addresses must be unroutable BY CONSTRUCTION, not by us remembering
 * not to send to them. v1 used `gameshack.invalid`; this is a different project with
 * separate Auth (ARCHITECTURE.md#decisions), so it gets its own and no Shack account
 * can collide with a Boardwalk one.
 */
export const SYNTHETIC_EMAIL_DOMAIN = 'boardwalk.invalid';

/**
 * Lowercase, because the index key must be canonical — `Forerunner` and `forerunner`
 * cannot be two accounts. Underscores but no dots or plus signs: both have meaning
 * inside an email local-part, and this string becomes one.
 *
 * KEEP IN SYNC WITH database.rules.json, which pins `usernames/$username` to this
 * exact pattern. The rule is the enforcement; this is the courtesy that stops a user
 * finding out via a permission error.
 */
export const USERNAME_RE = /^[a-z0-9_]{2,16}$/;

/** Firebase Auth's own floor is 6. Restating it lets us say so before the round-trip. */
export const MIN_PASSWORD_LENGTH = 6;

/** Agrees with the `name` validators in database.rules.json. */
export const MAX_DISPLAY_NAME_LENGTH = 40;

export type Validity = { readonly ok: true } | { readonly ok: false; readonly error: string };

const VALID: Validity = { ok: true };

/**
 * The canonical form: what `usernames/<key>` is filed under, and what the synthetic
 * address is built from.
 *
 * NOT the display name. v1 keeps `record.username` (cleaned) and `profile.name`
 * (raw, case preserved) as two fields on purpose, and collapsing them into one is a
 * bug in both directions — either the index stops being canonical, or the user's
 * capitals are eaten. `defaultProfile()` in @/system/profile/defaults takes the raw
 * one; everything addressing a node takes this.
 */
export function cleanUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** The display name: trimmed, case preserved. The other half of the pair above. */
export function displayNameFrom(raw: string): string {
  return raw.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
}

export function syntheticEmail(username: string): string {
  return `${cleanUsername(username)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * Used to refuse a password reset to an address that cannot receive one, and to keep
 * the synthetic domain out of anything user-facing. A synthetic address is an
 * implementation detail of Auth, and the moment it is shown to someone it becomes an
 * email address they will try to use.
 */
export function isSyntheticEmail(value: string): boolean {
  return value.trim().toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}

/**
 * Which of the two things did they type in the one box?
 *
 * Deliberately shape-matching and not RFC 5322 — this decides which lookup to run,
 * not whether an address is deliverable. Firebase is the judge of that, and a regex
 * that tries to be one is famously wrong in both directions. The only case that must
 * be right is "contains an @", because a username can never contain one (USERNAME_RE)
 * and so the two sets cannot overlap.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validateUsername(raw: string): Validity {
  const username = cleanUsername(raw);
  if (username === '') return { ok: false, error: 'Pick a username.' };
  if (username.length < 2) return { ok: false, error: 'Usernames are at least 2 characters.' };
  if (username.length > 16) return { ok: false, error: 'Usernames are at most 16 characters.' };
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: 'Letters, numbers and underscores only — no spaces, dots or @.' };
  }
  return VALID;
}

export function validatePassword(password: string): Validity {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Passwords are at least ${String(MIN_PASSWORD_LENGTH)} characters.`,
    };
  }
  return VALID;
}

/**
 * Which identity a sign-up is creating. It changes what an error MEANS, which is the
 * whole reason it is a parameter — see `auth/email-already-in-use` below.
 */
export type IdentityMode = 'username' | 'email';

/**
 * Firebase error code -> something a person can act on.
 *
 * TWO OF THESE ARE SECURITY DECISIONS, NOT COPY:
 *
 * 1. `auth/email-already-in-use` IS THE UNIQUENESS GUARANTEE. Sign-up reads
 *    `usernames/<name>` first, but that read is a courtesy — two people can pass it
 *    at the same instant. What actually cannot race is Firebase Auth refusing to
 *    create a second account on one address. So for a username sign-up this code does
 *    not mean "that email is taken", it means THE USERNAME IS TAKEN, and it is the
 *    only report of that fact anyone should trust. v1 hardcoded this mapping and was
 *    right to; it also applied it to email sign-ups, where it says something false.
 *    Hence the mode.
 *
 * 2. THE CREDENTIAL FAILURES ALL COLLAPSE INTO ONE STRING. `user-not-found` and
 *    `wrong-password` must be indistinguishable or the form is an account oracle:
 *    type a name, learn whether it exists. Modern Firebase already returns
 *    `invalid-credential` for both (email enumeration protection), but it is listed
 *    with the other two rather than trusted, because this project's job is to make
 *    the wrong thing unspellable rather than to hope an upstream default holds.
 *    `sendPasswordReset` does the same in the repo, by design: it returns success for
 *    an address that does not exist.
 */
export function friendlyAuthError(code: string, mode: IdentityMode = 'username'): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return mode === 'username'
        ? 'Username already taken.'
        : 'That email already has an account — sign in instead.';

    case 'auth/invalid-email':
      return 'That email address is not valid.';

    case 'auth/weak-password':
      return `Passwords are at least ${String(MIN_PASSWORD_LENGTH)} characters.`;

    // The oracle-proofing. One string, three codes. See (2) above.
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Wrong username or password.';

    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.';

    case 'auth/network-request-failed':
      return 'No connection — check your network and try again.';

    case 'auth/user-disabled':
      return 'That account is disabled.';

    case 'auth/operation-not-allowed':
      // The one that means WE are misconfigured, not that the user did anything.
      // Email/password sign-in is switched off in the Firebase console.
      return 'Sign-in is not enabled for this app. This is a configuration problem, not you.';

    default:
      return 'Something went wrong. Try again.';
  }
}
