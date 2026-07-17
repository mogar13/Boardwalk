/**
 * `cardSrc` is a filename built from a suit and a rank, and the only way it goes wrong is by
 * naming a file that is not there — a case-slipped suit, a `'T'` where the art says `'10'`. The
 * mapping typechecks whatever string it returns, so, exactly like the sound registry, only a disk
 * check proves the 52 cards resolve. This walks the full deck against `public/cards/standard/`.
 *
 * The base path is stripped to a basename before the disk check, so the test is independent of
 * `import.meta.env.BASE_URL` (which is `/` here and `/Boardwalk/` in production) — what is being
 * verified is the FILENAME the mapping produces, not the deploy prefix.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cardBackSrc, cardSrc, isRed, RANKS, SUITS, type Card } from '@/system/cards/cards';

const STANDARD_DIR = fileURLToPath(new URL('../public/cards/standard/', import.meta.url));

/** The last path segment — the filename, without any base-path prefix. */
function basename(src: string): string {
  return src.slice(src.lastIndexOf('/') + 1);
}

const FULL_DECK: Card[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));

describe('cardSrc', () => {
  it('builds a path for all 52 cards that exists on disk', () => {
    expect(FULL_DECK).toHaveLength(52);
    const missing = FULL_DECK.map(cardSrc)
      .map(basename)
      .filter((file) => !existsSync(STANDARD_DIR + file));
    expect(missing, `unresolved card art: ${missing.join(', ')}`).toEqual([]);
  });

  it('capitalises the suit and keeps 10 as two characters', () => {
    expect(basename(cardSrc({ suit: 'spades', rank: 'A' }))).toBe('cardSpadesA.png');
    expect(basename(cardSrc({ suit: 'hearts', rank: '10' }))).toBe('cardHearts10.png');
    expect(basename(cardSrc({ suit: 'clubs', rank: 'K' }))).toBe('cardClubsK.png');
  });
});

describe('cardBackSrc', () => {
  it('resolves the default back to a real file', () => {
    expect(existsSync(STANDARD_DIR + basename(cardBackSrc()))).toBe(true);
  });

  it('clamps the design index into 1–5 rather than 404ing', () => {
    expect(basename(cardBackSrc('red', 0))).toBe('cardBack_red1.png');
    expect(basename(cardBackSrc('red', 99))).toBe('cardBack_red5.png');
    expect(basename(cardBackSrc('green', 3))).toBe('cardBack_green3.png');
    expect(existsSync(STANDARD_DIR + basename(cardBackSrc('blue', 4)))).toBe(true);
  });
});

describe('isRed', () => {
  it('is true for hearts and diamonds only', () => {
    expect(isRed({ suit: 'hearts', rank: 'A' })).toBe(true);
    expect(isRed({ suit: 'diamonds', rank: '7' })).toBe(true);
    expect(isRed({ suit: 'spades', rank: 'A' })).toBe(false);
    expect(isRed({ suit: 'clubs', rank: 'K' })).toBe(false);
  });
});
