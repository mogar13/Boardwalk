/**
 * A dice set is SIX images, and the only way `diceSrc` goes wrong is by naming a file that is not
 * there. The mapping typechecks whatever string it builds, so — exactly like the felt, card and
 * sound registries — only a disk check proves it. This walks every face of every set in the
 * registry AND every `dice` cosmetic in the shared catalogue against `public/dice/`.
 *
 * THE TWO HALVES MATTER SEPARATELY, for `felts.test.ts`'s reason: the registry could resolve
 * perfectly while the catalogue sells an id the registry has never heard of, and then the store
 * card renders, the purchase succeeds, the money leaves, and the table rolls the starter set.
 *
 * SIX FACES IS THE PART THAT IS NEW. A felt or a card back is one file, so a half-staged set is a
 * failure mode neither of those tests could have. A set missing only its 6 would look completely
 * fine until somebody rolled well.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DICE, DICE_IDS, DEFAULT_DICE, diceSrc, type Pips } from '@/system/dice/dice';
import { CATALOG } from '@boardwalk/game-logic';

const DICE_DIR = fileURLToPath(new URL('../public/dice/', import.meta.url));
const FACES: readonly Pips[] = [1, 2, 3, 4, 5, 6];

/** The last path segment — the filename, without any base-path prefix. */
function basename(src: string): string {
  return src.slice(src.lastIndexOf('/') + 1);
}

describe('diceSrc', () => {
  it('resolves all six faces of every registered set to a file on disk', () => {
    const missing: string[] = [];
    for (const id of DICE_IDS)
      for (const face of FACES) {
        const file = basename(diceSrc(id, face));
        if (!existsSync(`${DICE_DIR}${file}`)) missing.push(`${id}/${String(face)} → ${file}`);
      }
    expect(missing, `dice art missing from public/dice/: ${missing.join(', ')}`).toEqual([]);
  });

  it('gives every set six DISTINCT files', () => {
    // A set whose faces collide is a set that shows the same number twice, which in this game is
    // not a cosmetic bug — it is a wrong count on a challenge.
    for (const id of DICE_IDS) {
      const files = FACES.map((f) => basename(diceSrc(id, f)));
      expect(new Set(files).size, `${id} reuses a face image`).toBe(6);
    }
  });

  it('maps each set to its own art, not a shared image', () => {
    // Two ids pointing at one set is the store selling the same dice twice under two names.
    const stems = Object.values(DICE);
    expect(new Set(stems).size).toBe(stems.length);
  });

  it('falls back to the default for an unknown or absent id rather than 404ing', () => {
    // An id can outlive its art — a retired set still sitting in someone's `equipped`. A die drawn
    // in the starter set is a correct die; a broken image is a visibly broken table. This is the
    // CARD BACK fallback, deliberately not the felt's `null`: there is no "draw no die".
    const fallback = basename(diceSrc(undefined, 3));
    expect(basename(diceSrc('dc_nonexistent', 3))).toBe(fallback);
    expect(existsSync(`${DICE_DIR}${fallback}`)).toBe(true);
    expect(fallback).toBe(basename(diceSrc(DEFAULT_DICE, 3)));
  });

  it('gives a known id its OWN art, not the fallback', () => {
    // Without this the fallback case above would pass just as well if `diceSrc` ignored its input.
    expect(basename(diceSrc('dc_ember', 5))).not.toBe(basename(diceSrc(DEFAULT_DICE, 5)));
  });

  it('is base-path aware', () => {
    expect(diceSrc('dc_ivory', 1)).toContain('dice/');
  });
});

describe('the dice catalogue', () => {
  const dice = CATALOG.filter((c) => c.kind === 'dice');

  it('sells at least one set, and every one resolves to art', () => {
    expect(dice.length).toBeGreaterThan(0);
    const missing = dice
      .filter((c) => !FACES.every((f) => existsSync(`${DICE_DIR}${basename(diceSrc(c.id, f))}`)))
      .map((c) => c.id);
    expect(missing, `catalogue dice with no art: ${missing.join(', ')}`).toEqual([]);
  });

  it('every catalogue set is REGISTERED — not merely resolvable via the fallback', () => {
    // The fallback would make the case above pass for an id the registry has never heard of, so
    // this is the half that actually catches "sold but not staged".
    const unregistered = dice.filter((c) => !(c.id in DICE)).map((c) => c.id);
    expect(unregistered).toEqual([]);
  });

  it('has exactly one free starter, and it is the default', () => {
    // Unlike a felt (where nothing-equipped is a real state), a die must always draw, so the free
    // starter is what an unequipped player rolls.
    const free = dice.filter((c) => c.priceCents === 0);
    expect(free.map((c) => c.id)).toEqual([DEFAULT_DICE]);
  });

  it('is all buyable — no earn-only set without a grant site', () => {
    // An earn-only cosmetic needs an achievement that grants it. No chain grants dice, so an
    // earn-only set here would be unobtainable at any price or skill.
    expect(dice.filter((c) => c.priceCents === null)).toEqual([]);
  });
});
