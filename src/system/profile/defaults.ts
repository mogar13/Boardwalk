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
 *   • `loadout` / `equippedCardBack` / `inventory` / `title` — the store is Phase 4.
 *     v1 shipped `loadout.color` written by the hub and read by nothing, which is a
 *     row in the defect table; a field with no reader is how that starts.
 *   • `chatColor` — chat is Phase 5.
 *   • `stats` / `achievements` / `rewards` — progress is Phase 4.
 *
 * Each lands with its consumer, in the same commit, along with the `.validate` line
 * in database.rules.json that pins it. `$other: false` on the profile node means
 * adding a field here without that line fails at the server, loudly, which is the
 * enforcement making this comment true rather than aspirational.
 */
export function defaultProfile(rawUsername: string): Profile {
  return {
    name: displayNameFrom(rawUsername),
    avatar: DEFAULT_AVATAR,
    bankrollCents: STARTING_BANKROLL_CENTS,
    xp: 0,
    level: 1,
  };
}
