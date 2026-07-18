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
   * The progression fact. `level` is NOT a field — it is a function of this number,
   * computed by `levelFromXp` in `@/system/profile/xp`. Phase 2 stored both; Phase 3, the
   * first reader, deleted the derived one, because two stored facts for one truth is the
   * shape of half the v1 defect table and Phase 4's award sites would each have had to keep
   * them in sync. See the header of xp.ts for the full argument.
   *
   * Phase 4 is that award site: `reportResult` (see `@/system/economy/result`) is now the
   * ONLY thing that moves this number, in the same call that moves bankroll and stats — the
   * v1 fix stated as an assignment, since `recordWin(gameId)` took one arg and the payout it
   * was handed went nowhere.
   */
  readonly xp: number;

  /**
   * Per-game play record, keyed by `manifest.id`. Empty for a fresh account, and empty on
   * the wire too — RTDB strips an empty object, so `readProfile` defaults a missing `stats`
   * to `{}` (see profileRepo). The KEY is a gameId and never a literal spelled twice: this
   * is where the `texas_holdem`→`"poker"` drift would have lived, and the registry deriving
   * every id from `manifest.id` is what stops it.
   *
   * `won` summed across every game is the leaderboard's rank key — see `totalWins` in
   * `@/system/progress/stats` and the `wins` projection in profileRepo.
   */
  readonly stats: Stats;

  /**
   * Unlocked achievements: id → the epoch-ms moment it fired. A set with a timestamp, not a
   * boolean, because "when did I earn this" is the only interesting thing to show next to
   * one and a boolean throws it away.
   *
   * Unlock is one-way and idempotent: `reportResult` only ADDS keys, never removes them, so
   * a later losing hand cannot revoke a badge. `big_win` finally has an unlock site here —
   * v1 shipped it with zero, because nothing ever knew a payout.
   */
  readonly achievements: AchievementSet;

  /**
   * Cosmetics the player OWNS — a set of catalog ids (see `@/system/store/catalog`). A set,
   * not a list, because ownership is a membership question and a list invites duplicates and
   * an order that means nothing. Stored on the wire as `{ id: true }` for the same reason:
   * RTDB coerces an array to `{0:…,1:…}` and strips an empty one, so the object form is the
   * one that round-trips.
   *
   * Owning is not equipping. The equipped avatar is `avatar` above; `inventory` is the set
   * of avatars you are ALLOWED to equip. This is deliberately not v1's `loadout.color` — a
   * cosmetic field written by the store and read by nothing. An owned avatar has a reader
   * the moment it is equipped (the top bar, the profile card), which is the test a cosmetic
   * has to pass to exist here.
   */
  readonly inventory: Inventory;

  /**
   * The EQUIPPED cosmetics for the kinds that are not the avatar — the readers that keep a
   * bought card back or title from being `loadout.color`. `avatar` stays top-level (above) and
   * is NOT folded in here: the owner's decision was to keep it where it is and add this map for
   * the new kinds, so existing accounts need no migration.
   *
   * Always an object, possibly empty. A fresh account has `{}`, which RTDB strips on the wire —
   * so `readProfile` defaults a missing `equipped` back to `{}` the same way it does `stats`.
   * Each field is a cosmetic id (see `@/system/store/catalog`); `cardback` is read by the card
   * games through `useEquippedCardBack`, `title` by the profile card.
   */
  readonly equipped: Equipped;

  /**
   * The daily-reward clock. `lastClaimDay` is a UTC day index (see `dayIndex` in
   * `@/system/rewards/daily`), 0 meaning never claimed; `streak` is the run of consecutive
   * days. Two numbers, not a timestamp, because the reward is a per-DAY event and a day
   * index compares by equality where a timestamp would need arithmetic every render.
   */
  readonly daily: DailyState;
}

/**
 * One game's lifetime record. All four counts, not just `won`, because a stats card that
 * says "12 wins" and cannot say "of how many" is a brag, not a record — and `played` is
 * what `table_regular` and the like are checked against.
 *
 * INTEGER COUNTS, always ≥ 0. `bumpStats` in `@/system/progress/stats` is the only writer.
 */
export interface GameStat {
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly pushed: number;
}

/** Per-game records, keyed by `manifest.id`. Absent games have never been played. */
export type Stats = Readonly<Record<string, GameStat>>;

/** Unlocked achievement id → epoch-ms unlock time. See `@/system/progress/achievements`. */
export type AchievementSet = Readonly<Record<string, number>>;

/** Owned cosmetic ids, as a set. `{ id: true }` on the wire — see the `inventory` note. */
export type Inventory = Readonly<Record<string, true>>;

/**
 * The equipped non-avatar cosmetics. Each field is a cosmetic id, absent when nothing of that
 * kind is worn. `avatar` is NOT here — it stays top-level on `Profile` (the owner's no-migration
 * decision). `database.rules.json` pins this to exactly these keys (`$other: false`).
 */
export interface Equipped {
  /** The card back the card games draw — see `@/system/cards/useEquippedCardBack`. */
  readonly cardback?: string;
  /** The title shown on the profile card. The best titles are earn-only (achievement-granted). */
  readonly title?: string;
  /** The table surface all five boards draw under the play area — `@/system/felt/useEquippedFelt`. */
  readonly felt?: string;
  /** The ring around your avatar in the top bar and profile card — `@/system/frame/useEquippedFrame`. */
  readonly frame?: string;
}

/** The daily-reward clock. See the `daily` note and `@/system/rewards/daily`. */
export interface DailyState {
  /** UTC day index of the last claim; 0 = never. */
  readonly lastClaimDay: number;
  /** Consecutive-day run. 0 before the first claim, reset to 1 after a gap. */
  readonly streak: number;
}
