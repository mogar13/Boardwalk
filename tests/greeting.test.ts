import { describe, expect, it } from 'vitest';
import { hubGreeting } from '@/shell/greeting';

/**
 * The hub's opening line. Four assertions over a two-branch function, which sounds like overkill
 * until you notice that only ONE of the branches is reachable on a developer's machine.
 *
 * Every account anybody here signs in with has played something, so "Welcome back" renders on
 * every reload and the first-run wording is text that only a brand-new player ever sees. That is
 * the same blindness that left `GET /leaderboard` behind auth for weeks — invisible to anyone
 * holding a session, and caught only by a test that asked for the state it could not reproduce by
 * clicking. So the first-run branch is asked for BY NAME here rather than trusted.
 */
describe('hubGreeting', () => {
  it('welcomes a returning player back', () => {
    expect(hubGreeting({ name: 'Ada', played: 1 })).toBe('Welcome back, Ada');
  });

  it('does NOT say "welcome back" to an account that has never finished a game', () => {
    // The branch a developer never reaches. A brand-new profile is `played: 0`, and greeting it
    // with "welcome back" is a claim about a visit that did not happen.
    expect(hubGreeting({ name: 'Ada', played: 0 })).toBe('Welcome to the boardwalk, Ada');
  });

  it('drops the name clause rather than trailing a comma', () => {
    // A profile can land a tick after the session, and a display name is user-supplied. Neither
    // may produce "Welcome back, " — an empty subject reads as a bug where a shorter sentence
    // reads as a sentence. Whitespace counts as blank; a padded name is trimmed, not rendered.
    expect(hubGreeting({ name: '', played: 3 })).toBe('Welcome back');
    expect(hubGreeting({ name: '   ', played: 0 })).toBe('Welcome to the boardwalk');
    expect(hubGreeting({ name: '  Ada  ', played: 3 })).toBe('Welcome back, Ada');
  });

  it('treats a nonsense played count as a first visit, not a returning one', () => {
    // `played` is a sum over stats that arrived from the wire, so NaN is reachable. `> 0` answers
    // false for it, which lands on the harmless side: a returning player reads one odd sentence,
    // where the other direction asserts a visit that never happened.
    expect(hubGreeting({ name: 'Ada', played: Number.NaN })).toBe('Welcome to the boardwalk, Ada');
    expect(hubGreeting({ name: 'Ada', played: -4 })).toBe('Welcome to the boardwalk, Ada');
  });
});
