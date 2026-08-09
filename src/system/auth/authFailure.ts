/**
 * Why a sign-in that WORKED still put you back on the sign-in form.
 *
 * THE OUTAGE THIS EXISTS FOR (2026-08-09). The Pi's database stick fell off the USB bus,
 * systemd stopped `boardwalk-api` because the unit requires that mount, and every
 * `GET /profile` answered 502 for three and a half hours. In the browser that rendered as:
 * type your password, get a green "Welcome back." toast, and land back on the sign-in form.
 * No error, nowhere, on any surface. Firebase Auth really had accepted the credentials —
 * that is what the toast is about — and then `loadOrCreateProfile` threw, and
 * `subscribeToSession`'s rejection handler answered by setting `status: 'signed-out'`,
 * because "signed in with no profile" is genuinely not a state anything downstream can use.
 *
 * That decision is still right. What was missing is that it threw the REASON away, so the
 * screen made a claim ("welcome back") and then contradicted it with a login form, which is
 * this repo's own "a UI that lies" failure arriving through a door nobody had watched. The
 * player's only available theory is that they typed their password wrong, so they type it
 * again, and it fails again, identically and silently.
 *
 * WHY THE COPY LEADS WITH THE PASSWORD. The single most useful thing to say is the thing the
 * screen was implicitly denying: your credentials were fine, stop retyping them. Everything
 * else is a suggestion; that one is a fact, and it is the one that stops the loop.
 *
 * WHY IT DOES NOT NAME A CAUSE PRECISELY. A 502 from the referee and a rules refusal from
 * RTDB arrive here as an ordinary `Error` and are not reliably distinguishable from its
 * message — and a confidently wrong diagnosis is worse than an honest general one, because it
 * sends someone to fix the wrong thing. So the sentence covers both, and `detail` carries the
 * raw text for whoever can read it. That is the `NotConfigured` panel's precedent in this same
 * file's neighbour: name the fix, and show the machine's own words underneath.
 */

export interface AuthFailure {
  /** One sentence, the headline: what did not happen. */
  readonly message: string;
  /** What it means for the player, and what to do. Leads with "not your password". */
  readonly hint: string;
  /** The underlying error's own words. For a reader who can act on `502` or `PERMISSION_DENIED`. */
  readonly detail: string;
}

/**
 * Turn whatever `loadOrCreateProfile` rejected with into something a person can read.
 *
 * TOTAL BY CONSTRUCTION — a rejection can carry anything at all (a string, `undefined`, a
 * DOMException), and this runs on the path that is already going wrong. Throwing here would
 * replace a bad sign-in with a blank page.
 */
export function describeAuthFailure(error: unknown): AuthFailure {
  return {
    message: 'Signed in, but your profile could not be loaded.',
    hint: 'Your username and password were accepted — this is not a password problem. The game server may be down. Try again in a moment.',
    detail: detailOf(error),
  };
}

const NO_DETAIL = 'No further detail was reported.';

function detailOf(error: unknown): string {
  // `Error` first: the common case, and `String(err)` on one yields "Error: ..." which reads
  // like noise next to a label that already says something went wrong.
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error.trim() !== '') return error;
  // `null`/`undefined` are named rather than stringified: `String(undefined)` is the word
  // "undefined", which reads as a bug in THIS function rather than as a report about theirs —
  // and it is the exact string a reader would waste time searching the codebase for.
  if (error === null || error === undefined) return NO_DETAIL;
  const rendered = safeString(error);
  return rendered.trim() === '' ? NO_DETAIL : rendered;
}

function safeString(value: unknown): string {
  try {
    // A thrown object can have a hostile `toString`; this whole module runs on the failure
    // path and must not add a second failure to the first.
    return String(value);
  } catch {
    return '';
  }
}
