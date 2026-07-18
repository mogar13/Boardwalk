/**
 * The signed-in identity, split out of the profile's data shapes when those moved into
 * `@boardwalk/game-logic` (Phase D). It stayed behind on purpose: `Session` is an AUTH fact —
 * it comes from Firebase Auth and the `admins/` node, not from the database record the
 * referee owns — and the shared package is exactly the code the SERVER also runs, where a
 * client's cached idea of its own admin-ness is meaningless. Nothing here is a game rule.
 */

/**
 * A signed-in identity. Distinct from Profile because they have different lifetimes
 * and different owners: this comes from Firebase Auth and the `admins/` node and
 * changes only on sign-in/out; the Profile comes from the database and ticks every
 * time money moves.
 */
export interface Session {
  readonly uid: string;

  /** The canonical, cleaned, lowercase form. The key `usernames/<x>` is filed under. */
  readonly username: string;

  /**
   * Does `admins/<uid>` exist? Read at sign-in, fail-closed.
   *
   * THIS IS A CACHE OF AN ANSWER THE SERVER ALREADY GAVE, AND IT IS NOT A PRIVILEGE.
   * It hides UI and nothing else. Every privileged action attempts its write and lets
   * `database.rules.json` judge it — the server is the only judge — so forging this
   * to `true` in a debugger buys a visible button that still gets permission-denied.
   *
   * NOTE WHAT IS NOT IN `Profile`: an `isDev` field. v1 stored one at
   * `users/<uid>/profile/isDev`, self-writable and granting nothing, and it was still
   * a live problem — chat trusted a client-asserted `isDev` on every message, so
   * anyone could mint themselves a dev badge. A forgeable field that grants nothing
   * is not harmless; it is a thing the next feature will believe. v2 does not store
   * one, so no future reader can trust it. That is the difference between documenting
   * "don't trust isDev" and making it unspellable.
   */
  readonly isAdmin: boolean;
}
