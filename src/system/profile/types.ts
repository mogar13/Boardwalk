/**
 * What a player IS. The domain shape — not the wire shape.
 *
 * The wire shape lives in `@/system/repo/firebase/profileRepo` and is a different
 * type on purpose, because Firebase's is a hostile format: it strips empty arrays and
 * empty objects on write, so a field you set to `[]` comes back MISSING, and a record
 * written by an older version comes back with whatever fields that version had. v1 hit
 * both — `_loadIntoProfile` carries a comment about `unlocked` vanishing and crashing
 * the profile panel on every fresh account. So the wire type is all-optional and
 * `readProfile()` is where the two meet. Everything above the repo gets THIS, and this
 * one has no optionals.
 */
export interface Profile {
  /**
   * Display name — trimmed, case preserved. NOT the username.
   *
   * v1 keeps both (`record.username` cleaned and canonical, `profile.name` raw) and
   * the pair is easy to mistake for a duplicate. It is not: one is the key
   * `usernames/<x>` is filed under, the other is what a person typed. Collapsing them
   * eats the user's capitals or breaks the index, depending which one wins.
   */
  readonly name: string;

  /** One emoji. `database.rules.json` caps it at 8 chars — an emoji is not one byte. */
  readonly avatar: string;

  /**
   * INTEGER CENTS. Always. $5,000 is 500_000.
   *
   * CLAUDE.md's rule, and v1's `setMoney` is the reason: it did `parseInt(amount)`, so
   * blackjack paying `bet * 2.5` on a 3:2 natural silently dropped the fractional
   * chip — every time, for years, in the game the whole casino is built around. Cents
   * make the fraction unrepresentable rather than truncated, and the field name is
   * what stops the next person storing dollars in it.
   *
   * `readonly` here is the type-level half of "there is no setter" (ARCHITECTURE.md).
   * The runtime half is that `useBankroll()` returns this and no mutator exists to
   * pair with it — Phase 4's `useBet()`/`reportResult()` are the only writers, and
   * they do not exist yet, so right now nothing in the repo can spell `money += x`.
   */
  readonly bankrollCents: number;

  /**
   * The only progression fact stored. `level` is NOT a field — it is a function of this
   * number, computed by `levelFromXp` in `@/system/profile/xp`. Phase 2 stored both; Phase
   * 3, the first reader, deleted the derived one, because two stored facts for one truth is
   * the shape of half the v1 defect table and Phase 4's award sites would each have had to
   * keep them in sync. See the header of xp.ts for the full argument.
   */
  readonly xp: number;
}

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
