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

/** The available card-back colours in the staged set (5 designs each). */
export type CardBack = 'red' | 'green' | 'blue';

/**
 * A card back, e.g. `/Boardwalk/cards/standard/cardBack_red3.png`. `design` is 1–5; it is clamped
 * into range rather than trusted, so a caller passing a loop index cannot 404 the image.
 */
export function cardBackSrc(color: CardBack = 'blue', design = 1): string {
  const n = Math.min(5, Math.max(1, Math.trunc(design)));
  return `${CARD_ROOT}standard/cardBack_${color}${String(n)}.png`;
}
