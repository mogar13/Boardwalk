/**
 * How a playing card becomes an image — pure string-building over the staged art in
 * `public/cards/standard/`, so any card game (Blackjack first, then War/Solitaire/UNO) maps a
 * card to a `<img src>` the same way, and a test can assert every one of the 52 resolves to a
 * file that is actually on disk.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. This module owns the ART MAPPING only — a card's suit/rank
 * and the filename that pictures it. It does NOT own deck construction, shuffling, or a game's
 * scoring (Blackjack's ace-as-1-or-11, say): that is a game's tested `logic/`, and hoisting it
 * here before a SECOND card game repeats it would be the premature-engine mistake ARCHITECTURE.md
 * keeps refusing. The art is the thing that genuinely repeats and is staged now, so the art
 * mapping is what gets a shared home — nothing more.
 *
 * The filenames are the Kenney set's, kept verbatim (`cardSpadesA.png`, `cardHearts10.png`,
 * `cardBack_red3.png`) so the deck could be re-dropped from the source pack without a rename step.
 */

/** The four suits, spelled as the art files capitalise them. */
export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];

/** Ranks low-to-high in display order. `'10'` is two chars in the filename, not `'T'`. */
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

/** A single card. Suit + rank is the whole identity; colour/value are derived, never stored. */
export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** Hearts and diamonds are red; spades and clubs are black. Derived, so it cannot drift. */
export function isRed(card: Card): boolean {
  return card.suit === 'hearts' || card.suit === 'diamonds';
}

/** The art root, base-path-aware. `import.meta.env.BASE_URL` is `/Boardwalk/` in prod, `/` in dev/test. */
const CARD_ROOT = `${import.meta.env.BASE_URL}cards/`;

/** Suit as the filename spells it: `spades` → `Spades`. */
function suitToken(suit: Suit): string {
  return suit.charAt(0).toUpperCase() + suit.slice(1);
}

/** The face image for a card, e.g. `/Boardwalk/cards/standard/cardSpadesA.png`. */
export function cardSrc(card: Card): string {
  return `${CARD_ROOT}standard/card${suitToken(card.suit)}${card.rank}.png`;
}

/**
 * THE CARD-BACK ART REGISTRY — a cosmetic id → the file that pictures it. This is the ART half
 * of an equippable card back (kind `'cardback'` in `@/system/store/catalog`): cards.ts owns the
 * id→file map and knows NOTHING of price, rarity, or the profile — that keeps the pure art module
 * from importing the store, and lets the game pass a back id in without cards.ts reaching for a
 * player. The catalogue references these same ids for the store metadata, and
 * `tests/cards.test.ts` resolves every one to a file on disk (a filename typechecks however wrong
 * it is — only a disk check catches a stray).
 *
 * The id encodes the staged filename it maps to (`cb_red3` → `cardBack_red3.png`), so the two
 * cannot drift, but the mapping is kept explicit rather than regex'd so an unlisted id is a
 * lookup miss (→ the default), never a guessed 404.
 */
export const CARD_BACKS: Readonly<Record<string, string>> = {
  cb_blue1: 'cardBack_blue1.png',
  cb_blue2: 'cardBack_blue2.png',
  cb_blue3: 'cardBack_blue3.png',
  cb_blue4: 'cardBack_blue4.png',
  cb_blue5: 'cardBack_blue5.png',
  cb_green1: 'cardBack_green1.png',
  cb_green2: 'cardBack_green2.png',
  cb_green3: 'cardBack_green3.png',
  cb_green4: 'cardBack_green4.png',
  cb_green5: 'cardBack_green5.png',
  cb_red1: 'cardBack_red1.png',
  cb_red2: 'cardBack_red2.png',
  cb_red3: 'cardBack_red3.png',
  cb_red4: 'cardBack_red4.png',
  cb_red5: 'cardBack_red5.png',
};

/** The back a fresh account wears — the free starter, owned by everyone (see the catalogue). */
export const DEFAULT_CARD_BACK = 'cb_blue1';

/** Every card-back id, for the disk test and any UI that needs to enumerate them. */
export const CARD_BACK_IDS = Object.keys(CARD_BACKS);

/**
 * A card back, e.g. `/Boardwalk/cards/standard/cardBack_red3.png`. The game passes the player's
 * EQUIPPED back id (via `useEquippedCardBack`); an unknown or absent id falls back to the default
 * rather than 404ing, so a legacy or hand-edited `equipped.cardback` can never break a render.
 */
export function cardBackSrc(back?: string): string {
  const file = (back !== undefined && CARD_BACKS[back]) || CARD_BACKS[DEFAULT_CARD_BACK];
  return `${CARD_ROOT}standard/${file}`;
}
