import { defaultProfileFor, type Profile } from '@boardwalk/game-logic';
import { displayNameFrom } from '@/system/auth/credentials';

/**
 * A new account's opening position, as the APP spells it: an auth concern (turning a raw
 * username into a display name) wrapped around the shared one.
 *
 * The shape and the opening stake moved to `@boardwalk/game-logic` in Phase D, because the
 * referee grants that stake and a second copy of the number on the server is the drift the
 * parity test used to guard. What stayed is `displayNameFrom` — the server never sees a raw
 * username and has no reason to.
 *
 * Called from two places that must agree: sign-up, and the self-heal path in the profile store
 * when a record is missing.
 *
 * WHAT IS NOT HERE, and why each absence is a decision rather than an omission:
 *
 *   • `isDev` — v2 does not store one at all. See `Session.isAdmin` in `@/system/auth/session`.
 *   • `chatColor` — chat pins its author to `auth.uid` instead; there is no colour field.
 *
 * The `equipped` map landed in P2 of the progression overhaul, WITH its readers: the card games
 * draw `equipped.cardback` (via `useEquippedCardBack`) and the profile card shows
 * `equipped.title` — so a card back is no longer the `loadout.color` this note once warned
 * about.
 */
export function defaultProfile(rawUsername: string): Profile {
  return defaultProfileFor(displayNameFrom(rawUsername));
}
