/**
 * How an equipped DICE SET becomes six images — the Phase-E sibling of `@/system/felt/felts` and
 * `@/system/cards/cards`, built to the same split: this module owns the id→art mapping and knows
 * NOTHING of the profile, price or rarity. The READER (`useEquippedDice`) is the one place that
 * knows a dice set is an equipped field, and the board passes the id in.
 *
 * THIS KIND HAS BEEN DECLARED AND WITHHELD SINCE P2. `catalog.ts` named `dice` as a cosmetic with
 * abundant art in the trove and NO READER, and refused to stage it: "staging art for them while the
 * union is open is precisely the `loadout.color` mistake in its most tempting form." This file is
 * the reader arriving, in the same commit as the rows it reads — which is the whole rule, and the
 * reason it could not land a phase earlier.
 *
 * The direct ancestor is in the archive: v1's Liar's Dice had a `getDicePrefix()` that read
 * `SystemProfile.data.inventory` into a variable it never used and returned the string
 * `"dieWhite_border"` unconditionally. A cosmetic read with no effect. That is exactly what this
 * kind is not allowed to be.
 *
 * IT TAKES A FACE, WHICH FELT AND CARDBACK DO NOT. A felt is one image and a card back is one
 * image; a dice set is SIX, so the resolver is `diceSrc(id, pips)` and the map's value is a
 * filename STEM rather than a filename. The stem is still an explicit map entry and not a regex
 * over the id, for `cards.ts`'s reason: an unlisted id should be a miss the fallback catches, not a
 * string that builds a 404. `tests/dice.test.ts` resolves all six faces of every entry against
 * `public/dice/` on disk, because a filename typechecks however wrong it is.
 *
 * THERE IS A DEFAULT, unlike the felt. `feltSrc(undefined)` is `null` because a bare table is a
 * real table; there is no such thing as not drawing a die you are holding, so a missing set is a
 * hole where a die should be. That makes this structurally a CARD BACK, not a felt — free starter
 * included.
 */

/** A die face. Mirrors the rulebook's `Face` without importing it — art knows nothing of rules. */
export type Pips = 1 | 2 | 3 | 4 | 5 | 6;

/** Dice cosmetic id → the filename stem under `public/dice/`. Ids match `CATALOG`. */
export const DICE: Readonly<Record<string, string>> = {
  dc_ivory: 'ivory',
  dc_bone: 'bone',
  dc_crimson: 'crimson',
  dc_ember: 'ember',
};

/** Every dice id the art registry knows, for iteration (the disk test walks these). */
export const DICE_IDS = Object.keys(DICE);

/**
 * The free starter, and what an unknown or absent id falls back to. Every account has this without
 * buying anything, which is what lets the board render a die before the player owns a cosmetic.
 */
export const DEFAULT_DICE = 'dc_ivory';

/** The art root, base-path-aware — `/Boardwalk/` in prod, `/` in dev/test. Same as `felts.ts`. */
const DICE_ROOT = `${import.meta.env.BASE_URL}dice/`;

/**
 * The image for one face of an equipped dice set.
 *
 * An UNKNOWN id resolves to the DEFAULT set rather than a broken URL — an id can outlive its art (a
 * retired set still sitting in someone's `equipped`), and a die drawn in the starter set is a
 * correct die where a 404 is a visibly broken one. Same fallback shape as `cardBackSrc`, and
 * deliberately NOT `feltSrc`'s `null`: there is no honest "draw no die".
 */
export function diceSrc(diceId: string | undefined, pips: Pips): string {
  const stem = DICE[diceId ?? DEFAULT_DICE] ?? DICE[DEFAULT_DICE] ?? 'ivory';
  return `${DICE_ROOT}${stem}-${String(pips)}.png`;
}
