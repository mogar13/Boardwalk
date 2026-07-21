/**
 * RANKS — the name that comes with a level. v1 had them (Newcomer → … → Casino Legend);
 * Boardwalk shipped `level` as a bare number, which is a score with no story attached.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT A FIELD. A rank is derived from `level`, which is itself
 * derived from `xp` — so this is the same argument `xp.ts` makes about `level`, one rung further
 * up. Storing a rank would be a THIRD copy of one fact, and the award site that bumps xp but
 * forgets the rank leaves an account whose badge says Gold forever. There is nothing to forget to
 * write, because there is nothing written: `rankForLevel` is a lookup over a frozen ladder.
 *
 * WHY IT IS NOT IN `xp.ts`. `xp.ts` owns the CURVE — the arithmetic that turns a number into a
 * level and a progress bar. This owns the VOCABULARY. They change for different reasons (retuning
 * the curve is a balance decision; renaming a rank is a copy decision), and the 800-line ceiling
 * is a ratchet against files that accumulate every neighbouring concern.
 *
 * A RANK IS NOT A `title` COSMETIC, and the two are deliberately separate. `equippedTitle` (see
 * `store/catalog`) is something you BUY or EARN and choose to wear; a rank is something you simply
 * ARE at a given level, and you cannot equip, unequip or purchase it. They render side by side on
 * the profile card, and the distinction is what stops "Card Shark" (bought) and "High Roller"
 * (reached) from being the same kind of thing to a reader. V1_FEATURE_GAPS.md #6 asks for exactly
 * this split — "if titles also become purchasable cosmetics, that's #5, kept separate."
 *
 * Pure, like everything else here: no React, no clock, no profile object. It takes a level.
 */

/** One rung. `minLevel` is INCLUSIVE — you hold this rank from that level until the next rung. */
export interface Rank {
  /** Stable id. Not rendered; it is what a test (or a later cosmetic gate) names a rung by. */
  readonly id: string;
  /** What a player sees. */
  readonly name: string;
  /** The first level that holds this rank. */
  readonly minLevel: number;
}

/**
 * The ladder, ascending, and it MUST stay ascending — `rankForLevel` walks it backwards and
 * `tests/ranks.test.ts` asserts the ordering rather than trusting the author of the next rung.
 *
 * The names are v1's, unchanged, because they are the one thing about v1's progression people
 * actually remember. The THRESHOLDS are not v1's, because v1's XP curve is not this one: here
 * `LEVEL_STEP` is 500 and a win pays 100 XP (`XP_BY_OUTCOME`), so level 10 is ~22,500 XP — a few
 * hundred hands — and level 50 is ~612,500, which is a long-haul number rather than an afternoon.
 * The rungs are placed so that the first one lands early (a new player renames themselves from
 * "Newcomer" inside a session, which is the whole morale point) and the last one is genuinely far,
 * matching the achievement chains' Platinum tiers at level 50.
 *
 * Level 1 MUST be covered. A ladder whose first rung starts above 1 would make `rankForLevel(1)`
 * undefined, and the caller would need a fallback that is a second, unnamed rank.
 */
export const RANKS: readonly Rank[] = Object.freeze([
  { id: 'newcomer', name: 'Newcomer', minLevel: 1 },
  { id: 'bronze', name: 'Bronze', minLevel: 3 },
  { id: 'silver', name: 'Silver', minLevel: 6 },
  { id: 'gold', name: 'Gold', minLevel: 10 },
  { id: 'high_roller', name: 'High Roller', minLevel: 15 },
  { id: 'vip', name: 'VIP Gambler', minLevel: 25 },
  { id: 'legend', name: 'Casino Legend', minLevel: 50 },
]);

/**
 * The rank a level holds. Total: every finite level ≥ 1 has one, and anything below 1 (or not a
 * number at all) reads as level 1 rather than throwing — this renders in the top bar on every
 * frame, and `xp.ts` makes the same call for the same reason.
 *
 * Walks the ladder from the top so the FIRST match is the highest rung reached; a forward scan
 * would need a lookahead to know it had passed the right one.
 */
export function rankForLevel(level: number): Rank {
  const l = Number.isFinite(level) ? Math.floor(level) : 1;
  for (let i = RANKS.length - 1; i >= 0; i -= 1) {
    const rank = RANKS[i];
    if (rank !== undefined && l >= rank.minLevel) return rank;
  }
  // Unreachable while the ladder starts at 1 — `tests/ranks.test.ts` pins that — but a non-null
  // return beats a `!` that would become a crash the day someone edits the first rung.
  return RANKS[0] ?? { id: 'newcomer', name: 'Newcomer', minLevel: 1 };
}

/**
 * The next rung up, or `null` at the top of the ladder. This is what turns a rank from a label
 * into a goal — "Silver at level 6" is a reason to play another hand, where "Bronze" alone is a
 * sticker. `null` is the honest answer at Casino Legend and the UI renders nothing rather than
 * inventing a rung above the last one.
 */
export function nextRankAfterLevel(level: number): Rank | null {
  const l = Number.isFinite(level) ? Math.floor(level) : 1;
  return RANKS.find((rank) => rank.minLevel > l) ?? null;
}
