/**
 * `unoCardSrc` builds a filename from a card, and the only way it goes wrong is by naming a file
 * that is not there — a `block` where the art says `skip`, a colour subfolder that does not exist.
 * The mapping typechecks whatever string it returns, so, exactly like the standard deck and the
 * sound registry, only a DISK check proves the art resolves. This walks the full 108-card deck plus
 * the wilds and the back against `public/cards/uno/`.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unoBackSrc, unoCardSrc } from '@/games/uno/art';
import { freshDeck } from '@boardwalk/game-logic/games/uno';

const UNO_DIR = fileURLToPath(new URL('../public/cards/uno/', import.meta.url));

/** The path under `cards/uno/`, independent of `import.meta.env.BASE_URL` (`/` here, `/Boardwalk/` in prod). */
function rel(src: string): string {
  const marker = 'cards/uno/';
  return src.slice(src.indexOf(marker) + marker.length);
}

describe('unoCardSrc', () => {
  it('builds a path for all 108 cards that exists on disk', () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(108);
    const missing = deck
      .map(unoCardSrc)
      .map(rel)
      .filter((p) => !existsSync(UNO_DIR + p));
    expect(missing, `unresolved UNO art: ${[...new Set(missing)].join(', ')}`).toEqual([]);
  });

  it('maps the action kinds to their v1 filenames', () => {
    expect(rel(unoCardSrc({ id: 'x', color: 'red', kind: 'skip', value: -1 }))).toBe(
      'red/block_red.png'
    );
    expect(rel(unoCardSrc({ id: 'x', color: 'blue', kind: 'reverse', value: -1 }))).toBe(
      'blue/inverse_blue.png'
    );
    expect(rel(unoCardSrc({ id: 'x', color: 'green', kind: 'draw2', value: -1 }))).toBe(
      'green/2plus_green.png'
    );
    expect(rel(unoCardSrc({ id: 'x', color: 'yellow', kind: 'number', value: 0 }))).toBe(
      'yellow/0_yellow.png'
    );
  });

  it('maps both wilds to their colourless single files', () => {
    expect(rel(unoCardSrc({ id: 'x', color: 'wild', kind: 'wild', value: -1 }))).toBe(
      'wild/wild_card.png'
    );
    expect(rel(unoCardSrc({ id: 'x', color: 'wild', kind: 'wild4', value: -1 }))).toBe(
      'wild/4_plus.png'
    );
  });

  it('resolves the card back to a real file', () => {
    expect(existsSync(UNO_DIR + rel(unoBackSrc()))).toBe(true);
  });
});
