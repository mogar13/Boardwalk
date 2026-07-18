/**
 * How an equipped FELT becomes an image — the P5 sibling of `@/system/cards/cards`, and built to
 * the same split: this module owns the id→file mapping and knows NOTHING of the profile, price or
 * rarity. The READER (`useEquippedFelt`) is the one place that knows a felt is an equipped field,
 * and the board passes the id in. That is what keeps a pure art module from importing the store.
 *
 * WHY A MAP AND NOT A TEMPLATE. `ft_green` → `felt-green.png` could be a regex, and `cards.ts`
 * explains why it is not: an unlisted id should be a miss the fallback catches, not a string that
 * builds a 404. `tests/felts.test.ts` resolves every entry against `public/felts/` on disk,
 * because a filename typechecks however wrong it is.
 *
 * THERE IS NO DEFAULT FELT, and that is the design. `feltSrc(undefined)` is `null` — no image
 * layer, which is the plain `bg-base-200` table every board has drawn since Phase 6. So a player
 * who buys nothing sees exactly what they saw yesterday, and the felt is additive on a live
 * system. Contrast `cards.ts`, which MUST have a default: there is no such thing as not drawing
 * the back of a face-down card, so a missing back is a hole where a card should be.
 */

/** Felt cosmetic id → the file under `public/felts/` that pictures it. Ids match `CATALOG`. */
export const FELTS: Readonly<Record<string, string>> = {
  ft_green: 'felt-green.png',
  ft_blue: 'felt-blue.png',
  ft_red: 'felt-red.png',
};

/** Every felt id the art registry knows, for iteration (the disk test walks these). */
export const FELT_IDS = Object.keys(FELTS);

/** The art root, base-path-aware — `/Boardwalk/` in prod, `/` in dev/test. Same as `cards.ts`. */
const FELT_ROOT = `${import.meta.env.BASE_URL}felts/`;

/**
 * The image for an equipped felt id, or `null` for "draw no felt" — which is both the signed-out
 * case and the nothing-equipped case, and is a legitimate, permanent state rather than an error.
 *
 * An UNKNOWN id also resolves to `null` rather than a broken URL: an id can outlive its art (a
 * retired felt still sitting in someone's `equipped`), and a table with no felt is a correct table
 * where a 404'd background is a visibly broken one. Same reasoning as `cardBackSrc`'s fallback,
 * different destination, because here "none" is a real answer.
 */
export function feltSrc(feltId: string | undefined): string | null {
  if (feltId === undefined) return null;
  const file = FELTS[feltId];
  return file === undefined ? null : `${FELT_ROOT}${file}`;
}
