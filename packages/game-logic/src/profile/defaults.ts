import type { Profile } from './types';

/**
 * A new account's opening position — the SHARED half, so the referee and the browser cannot
 * disagree about what a fresh player starts with.
 *
 * Before Phase D this number existed twice: here, and again as `STARTING_BANKROLL_CENTS` in
 * `boardwalk-api/src/domain/economy.ts`, kept honest by `tests/economy-parity.test.ts`. That test
 * is deleted now, and it is allowed to be deleted for exactly one reason: there is nothing left
 * to compare. The server grants the opening stake by importing THIS constant. A parity test over
 * one definition is a test that can only ever pass.
 *
 * `defaultProfile(rawUsername)` did NOT move — deriving a display name from a username is auth
 * logic (`@/system/auth/credentials`), and the referee has no business with it. What moved is the
 * part that is a rule about money and shape; the app wraps it.
 */

/**
 * $5,000, in cents. Matches v1's starting bankroll of 5000 dollars deliberately:
 * ARCHITECTURE.md#decisions accepts "new account, fresh $5,000" as the price of separate Auth,
 * and there is no reason to make the fresh start feel different from the one people know.
 *
 * The unit is not the same as v1's and that is the entire point — see Profile.
 */
export const STARTING_BANKROLL_CENTS = 500_000;

/**
 * Deliberately a person, not a face. v1's default is the same, and the reason is that an avatar
 * you did not choose should look like a placeholder rather than like a choice someone made for
 * you.
 */
export const DEFAULT_AVATAR = '👤';

/**
 * A fresh profile for an ALREADY-DERIVED display name.
 *
 * The four progress fields start EMPTY, and three of them start as an empty object that RTDB will
 * strip on write — which is exactly why `readProfile` defaults a missing one rather than trusting
 * the wire. `daily` is the exception: `{ lastClaimDay: 0, streak: 0 }` is not empty, so it
 * round-trips, and 0 is the honest "never claimed".
 *
 * No `level`: it is derived from `xp` (0 → level 1) by `levelFromXp`, never stored.
 */
export function defaultProfileFor(name: string): Profile {
  return {
    name,
    avatar: DEFAULT_AVATAR,
    bankrollCents: STARTING_BANKROLL_CENTS,
    xp: 0,
    stats: {},
    achievements: {},
    inventory: {},
    equipped: {},
    daily: { lastClaimDay: 0, streak: 0 },
  };
}
