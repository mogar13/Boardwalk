import { displayNameFrom } from '@/system/auth/credentials';
import type { Profile } from '@/system/profile/types';

/**
 * A new account's opening position. Pure — this is the one place a fresh player's
 * shape is decided, and it is called from two places that must agree: sign-up, and
 * the self-heal path in the profile store when a record is missing.
 */

/**
 * $5,000, in cents. Matches v1's starting bankroll of 5000 dollars deliberately:
 * ARCHITECTURE.md#decisions accepts "new account, fresh $5,000" as the price of
 * separate Auth, and there is no reason to make the fresh start feel different from
 * the one people know.
 *
 * The unit is not the same as v1's and that is the entire point — see Profile.
 */
export const STARTING_BANKROLL_CENTS = 500_000;

/**
 * Deliberately a person, not a face. v1's default is the same, and the reason is that
 * an avatar you did not choose should look like a placeholder rather than like a
 * choice someone made for you.
 */
export const DEFAULT_AVATAR = '👤';

/**
 * WHAT IS NOT HERE, and why each absence is a decision rather than an omission:
 *
 *   • `isDev` — v2 does not store one at all. See Session.isAdmin.
 *   • `chatColor` — chat is Phase 5.
 *
 * The `equipped` map landed in P2 of the progression overhaul, WITH its readers: the card games
 * draw `equipped.cardback` (via `useEquippedCardBack`) and the profile card shows `equipped.title`
 * — so a card back is no longer the `loadout.color` this note once warned about. It starts empty
 * (`{}`, which RTDB strips on the wire and `readProfile` re-defaults); the default card back is a
 * free starter every account owns, so an empty map still draws a valid back.
 *
 * Phase 4 added `stats`, `achievements`, `inventory` and `daily` — each with the consumer
 * that reads it, the `.validate` line in database.rules.json that pins it, and the pure
 * module that writes it, all in the same commit. `$other: false` on the profile node means
 * adding a field here without its rule fails at the server, loudly.
 *
 * The four progress fields start EMPTY, and three of them start as an empty object that RTDB
 * will strip on write — which is exactly why `readProfile` defaults a missing one rather
 * than trusting the wire. `daily` is the exception: `{ lastClaimDay: 0, streak: 0 }` is not
 * empty, so it round-trips, and 0 is the honest "never claimed".
 */
export function defaultProfile(rawUsername: string): Profile {
  return {
    name: displayNameFrom(rawUsername),
    avatar: DEFAULT_AVATAR,
    bankrollCents: STARTING_BANKROLL_CENTS,
    // No `level`: it is derived from `xp` (0 → level 1) by `levelFromXp`, never stored.
    xp: 0,
    stats: {},
    achievements: {},
    inventory: {},
    equipped: {},
    daily: { lastClaimDay: 0, streak: 0 },
  };
}
