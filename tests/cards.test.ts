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
import {
  cardBackSrc,
  cardSrc,
  CARD_BACKS,
  CARD_BACK_IDS,
  DEFAULT_CARD_BACK,
  isRed,
  RANKS,
  SUITS,
  type Card,
} from '@/system/cards/cards';
import { CATALOG } from '@boardwalk/game-logic';

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
  it('resolves the default back, and every registered back id, to a file on disk', () => {
    // The equipped card back is a cosmetic id → art file mapping; a filename typechecks however
    // wrong it is, so only a disk walk proves each one resolves. Same discipline as the deck above.
    expect(existsSync(STANDARD_DIR + basename(cardBackSrc()))).toBe(true);
    const missing = CARD_BACK_IDS.map((id) => cardBackSrc(id))
      .map(basename)
      .filter((file) => !existsSync(STANDARD_DIR + file));
    expect(missing, `unresolved card-back art: ${missing.join(', ')}`).toEqual([]);
  });

  it('falls back to the default for an unknown or absent id rather than 404ing', () => {
    // A legacy or hand-edited `equipped.cardback` must never break a render — an id not in the
    // registry resolves to the default back, the free starter every account owns.
    const def = basename(cardBackSrc(DEFAULT_CARD_BACK));
    expect(basename(cardBackSrc())).toBe(def);
    expect(basename(cardBackSrc('cb_does_not_exist'))).toBe(def);
    expect(DEFAULT_CARD_BACK in CARD_BACKS).toBe(true);
  });

  it('maps a known id to its own file', () => {
    expect(basename(cardBackSrc('cb_red3'))).toBe('cardBack_red3.png');
    expect(basename(cardBackSrc('cb_green4'))).toBe('cardBack_green4.png');
  });
});

describe('the store card-back cosmetics', () => {
  it('every cardback cosmetic id is a registered back that resolves on disk', () => {
    // The store sells card backs by cosmetic id; each must be a real art key, or the store offers
    // a cosmetic the games cannot draw. This is the catalog↔art link the disk check enforces.
    const backs = CATALOG.filter((c) => c.kind === 'cardback');
    expect(backs.length).toBeGreaterThan(0);
    const unresolved = backs
      .filter((c) => !(c.id in CARD_BACKS) || !existsSync(STANDARD_DIR + basename(cardBackSrc(c.id))))
      .map((c) => c.id);
    expect(unresolved, `cardback cosmetics with no art: ${unresolved.join(', ')}`).toEqual([]);
  });

  it('the default card back is a free starter in the catalogue', () => {
    const starter = CATALOG.find((c) => c.id === DEFAULT_CARD_BACK);
    expect(starter?.kind).toBe('cardback');
    expect(starter?.priceCents).toBe(0);
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
