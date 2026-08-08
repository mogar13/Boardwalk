/**
 * The hub's opening line, as a pure function of two facts about the player.
 *
 * WHY THIS IS NOT AN INLINE TERNARY. It has a branch a developer never sees. Every account on
 * this machine has played something, so "Welcome back" renders on every reload here and the
 * first-run wording is dead text that only a brand-new player ever reads — which is the same
 * blindness that let `GET /leaderboard` sit behind auth for weeks (see the standings row in
 * CLAUDE.md's Enforcement table). Telling somebody "welcome back" on the first screen they have
 * ever seen is small, but it is wrong, and the only way it stays right is a test that asks for
 * the branch by name.
 *
 * The string is SENTENCE CASE. The hub renders it through a `uppercase` utility, so the shouting
 * is the stylesheet's — which keeps the accessible name, the page title and any future copy edit
 * readable, and means a screen reader is not spelling out capitals.
 */
export interface GreetingInput {
  readonly name: string;
  /** `totalPlayed(profile.stats)` — how many games this account has finished, ever. */
  readonly played: number;
}

/**
 * `Welcome back, Ada` / `Welcome to the boardwalk, Ada`, and the same two without the name when
 * there is not a usable one.
 *
 * A BLANK NAME DROPS ITS CLAUSE rather than rendering "Welcome back, " with a dangling comma.
 * A profile is loaded a tick after the session on some paths and a display name is user-supplied,
 * so an empty string is a state this genuinely reaches — the UNO move log took the same care with
 * a missing seat name, and for the same reason: an empty subject reads as a bug, where a shorter
 * sentence reads as a sentence.
 *
 * A NON-POSITIVE OR NONSENSE `played` READS AS FIRST RUN. `played` is a sum over stats that
 * arrived from the wire, so NaN is reachable; `> 0` answers false for it and lands on the
 * first-run wording, which is the harmless direction. Greeting a returning player as new costs
 * them one sentence; greeting a new player with "welcome back" is a claim about a visit that
 * never happened.
 */
export function hubGreeting({ name, played }: GreetingInput): string {
  const opener = played > 0 ? 'Welcome back' : 'Welcome to the boardwalk';
  const trimmed = name.trim();
  return trimmed === '' ? opener : `${opener}, ${trimmed}`;
}
