/**
 * The credential rules, which are pure and therefore testable — the whole reason
 * `src/system/auth/credentials.ts` is a separate module from the repo that uses it.
 *
 * Every behaviour asserted here exists in v1's 771-line `system_auth.js`, where none of it
 * could be tested because reaching it meant standing up Firebase. That is not a slight on
 * v1; it is ARCHITECTURE.md's build order stated as a consequence — logic welded to I/O is
 * untestable logic, and it is the reason the two security decisions below (the enumeration
 * oracle, the uniqueness mapping) survived as comments rather than as guarantees.
 */
import { describe, it, expect } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  SYNTHETIC_EMAIL_DOMAIN,
  USERNAME_RE,
  cleanUsername,
  displayNameFrom,
  friendlyAuthError,
  isSyntheticEmail,
  looksLikeEmail,
  syntheticEmail,
  validatePassword,
  validateUsername,
} from '@/system/auth/credentials';

describe('the username / display-name pair', () => {
  it('cleans to a canonical lowercase key', () => {
    expect(cleanUsername('  ForeRunner  ')).toBe('forerunner');
  });

  it('keeps the display name distinct — trimmed, but case preserved', () => {
    // THE FIELD-DRIFT TRAP. v1 keeps `record.username` (cleaned, the index key) and
    // `profile.name` (raw, what the person typed) as two fields, and they look like a
    // duplicate right up until someone merges them. Merge toward cleaned and you eat the
    // user's capitals forever; merge toward raw and `usernames/Forerunner` and
    // `usernames/forerunner` become two accounts.
    expect(displayNameFrom('  ForeRunner  ')).toBe('ForeRunner');
    expect(cleanUsername('  ForeRunner  ')).not.toBe(displayNameFrom('  ForeRunner  '));
  });

  it('caps the display name at what database.rules.json will accept', () => {
    // The rules cap `name` at 40 chars. If this drifts, the server rejects the write and
    // the user gets a permission error for typing their own name.
    expect(displayNameFrom('x'.repeat(80))).toHaveLength(40);
  });
});

describe('username validation', () => {
  it.each([
    ['forerunner', true],
    ['ab', true],
    ['a_b_9', true],
    ['x'.repeat(16), true],
    ['a', false],
    ['x'.repeat(17), false],
    ['has space', false],
    ['has.dot', false],
    ['has+plus', false],
    ['', false],
  ])('%s -> %s', (input, ok) => {
    expect(validateUsername(input).ok).toBe(ok);
  });

  it('accepts uppercase input by cleaning it first', () => {
    // The regex is lowercase-only, so validating the RAW string would reject 'ForeRunner'
    // — a name that is perfectly legal once cleaned. Order of operations, asserted.
    expect(validateUsername('ForeRunner').ok).toBe(true);
  });

  it('rejects everything the public index rules would reject', () => {
    // database.rules.json pins `usernames/$username` to this exact pattern. The rule is
    // the enforcement; this is the courtesy that stops a user meeting it as a permission
    // error. If the two drift, sign-up fails at the server with no explanation.
    for (const bad of ['has space', 'has.dot', 'UPPER', 'a', 'x'.repeat(17)]) {
      expect(USERNAME_RE.test(bad)).toBe(false);
    }
  });
});

describe('password validation', () => {
  it('rejects below the floor and accepts at it', () => {
    expect(validatePassword('x'.repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
    expect(validatePassword('x'.repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });
});

describe('the synthetic email trick', () => {
  it('builds an address in a domain that cannot exist', () => {
    expect(syntheticEmail('ForeRunner')).toBe(`forerunner@${SYNTHETIC_EMAIL_DOMAIN}`);
  });

  it('uses an RFC 2606 reserved TLD, so it is unroutable by construction', () => {
    // Not by us remembering not to send to it. `.invalid` is guaranteed never to resolve,
    // which is what makes "an account with no email has no recovery path" a fact about the
    // internet rather than a policy we might relax.
    expect(SYNTHETIC_EMAIL_DOMAIN.endsWith('.invalid')).toBe(true);
  });

  it('round-trips: a synthetic address is recognised as one', () => {
    expect(isSyntheticEmail(syntheticEmail('someone'))).toBe(true);
    expect(isSyntheticEmail('real@example.com')).toBe(false);
  });

  it('recognises a synthetic address regardless of case or padding', () => {
    // Firebase lowercases addresses, but this also reads user input. A synthetic address
    // that slips past this check reaches sendPasswordReset and silently goes nowhere.
    expect(isSyntheticEmail(`  Forerunner@${SYNTHETIC_EMAIL_DOMAIN.toUpperCase()}  `)).toBe(true);
  });

  it('cannot collide with a username, because a username has no @', () => {
    // The two sets must not overlap: `looksLikeEmail` is what decides whether to do an
    // index lookup or use the string directly, and an overlap would make that a coin flip.
    expect(USERNAME_RE.test('a@b.com')).toBe(false);
    expect(looksLikeEmail('forerunner')).toBe(false);
    expect(looksLikeEmail('real@example.com')).toBe(true);
  });
});

describe('error mapping — where the security decisions live', () => {
  it('reports a taken USERNAME for email-already-in-use on a username signup', () => {
    // THE UNIQUENESS GUARANTEE, not a nicety. `usernames/` has no transaction, so the
    // pre-check races. What cannot race is Firebase Auth refusing a second account on one
    // address — so for a username sign-up this code IS "username taken", and it is the only
    // report of that fact anyone should trust. Losing this mapping while tidying up error
    // handling lets two accounts claim one name.
    expect(friendlyAuthError('auth/email-already-in-use', 'username')).toBe(
      'Username already taken.'
    );
  });

  it('reports a taken EMAIL for the same code on an email signup', () => {
    // v1 applied the username mapping to both, so signing up with an in-use email said
    // "Username already taken." — which is false, and sends the user to fix the wrong field.
    const msg = friendlyAuthError('auth/email-already-in-use', 'email');
    expect(msg).toContain('email');
    expect(msg).not.toContain('Username already taken');
  });

  it('gives user-not-found and wrong-password the SAME string', () => {
    // THE ORACLE-PROOFING. If these differ, the sign-in form answers "does this account
    // exist?" for anyone who asks. Modern Firebase collapses both into invalid-credential
    // already; this asserts we do not depend on that upstream default holding.
    const notFound = friendlyAuthError('auth/user-not-found');
    expect(friendlyAuthError('auth/wrong-password')).toBe(notFound);
    expect(friendlyAuthError('auth/invalid-credential')).toBe(notFound);
  });

  it('never leaks a raw Firebase code to a player', () => {
    const msg = friendlyAuthError('auth/some-code-nobody-has-mapped-yet');
    expect(msg).not.toContain('auth/');
    expect(msg).toBe('Something went wrong. Try again.');
  });
});
