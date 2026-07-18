import type { Card } from '@boardwalk/game-logic/games/uno';

/**
 * A UNO card → its staged image, and the back. This is NOT in `logic/` on purpose: it reads
 * `import.meta.env.BASE_URL` to build a base-path-aware URL (so links work under `/Boardwalk/`),
 * which makes it browser-coupled — the same reason `system/cards` lives outside a game's pure
 * `logic/`. `system/cards` itself only knows the STANDARD 52-card deck (`cardSrc` builds
 * `cards/standard/…`), so UNO owns its own art map here rather than bending that one.
 *
 * The kind→token mapping mirrors the filenames on disk (v1's naming, kept): `skip`→`block`,
 * `reverse`→`inverse`, `draw2`→`2plus`; a number is its own digit; wilds are colourless single
 * files. `tests/uno-art.test.ts` resolves every one of the 108 cards to a file actually on disk —
 * a filename is a string and typechecks however wrong it is, so only a disk check catches a typo.
 */

const ROOT = `${import.meta.env.BASE_URL}cards/uno/`;

const TOKEN: Record<Exclude<Card['kind'], 'wild' | 'wild4'>, string> = {
  number: '', // replaced by the digit
  skip: 'block',
  reverse: 'inverse',
  draw2: '2plus',
};

/** The image path for a card face. */
export function unoCardSrc(card: Card): string {
  if (card.kind === 'wild') return `${ROOT}wild/wild_card.png`;
  if (card.kind === 'wild4') return `${ROOT}wild/4_plus.png`;
  const token = card.kind === 'number' ? String(card.value) : TOKEN[card.kind];
  return `${ROOT}${card.color}/${token}_${card.color}.png`;
}

/** The face-down back, shown for every opponent's cards. */
export function unoBackSrc(): string {
  return `${ROOT}card-back/card_back.png`;
}
