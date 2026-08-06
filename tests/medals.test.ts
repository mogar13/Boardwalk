import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { medalSrc } from '@/system/progress/medals';
import { ACHIEVEMENTS, TIER_ORDER } from '@boardwalk/game-logic';

/**
 * TIER MEDAL ART, resolved against the disk — the same category as `tests/cards.test.ts`,
 * `tests/felts.test.ts` and `tests/dice.test.ts`. A filename is a string and typechecks however
 * wrong it is; only the disk can say whether the image exists. What makes it worth a file of its
 * own is the blast radius: the tier medal is drawn on EVERY chain rung of the achievement shelf,
 * so one bad filename is a wall of broken images rather than one missing card.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const onDisk = (src: string) =>
  join(ROOT, 'public', src.replace(/^\/+/, '').replace(/^Boardwalk\//, ''));

describe('tier medals', () => {
  it('resolves every tier to art that is on disk', () => {
    for (const tier of TIER_ORDER) {
      const src = medalSrc(tier);
      expect(existsSync(onDisk(src)), `missing medal art for ${tier} → ${src}`).toBe(true);
    }
  });

  it('gives every tier its OWN file', () => {
    // Two tiers sharing one image is a ladder that does not climb — and it looks deliberate,
    // which is why a count check would never find it. The whole point of replacing the emoji was
    // that the four rungs must read as an ordered family.
    const files = TIER_ORDER.map((t) => medalSrc(t));
    expect(new Set(files).size).toBe(TIER_ORDER.length);
  });

  it('covers every tier the catalogue actually uses', () => {
    // Driven off the REAL achievements rather than off `TIER_ORDER` alone: the guard that matters
    // is "every tier a badge asks for has art", and a chain using a tier the ladder does not list
    // would otherwise be caught by nothing. `medalSrc` is total over `Tier`, so this is really
    // asserting the catalogue stays inside the union — cheap, and it fails loudly if it drifts.
    const used = new Set(ACHIEVEMENTS.map((a) => a.tier).filter((t) => t !== undefined));
    expect(used.size).toBeGreaterThan(0);
    for (const tier of used) {
      expect(existsSync(onDisk(medalSrc(tier))), `no art for in-use tier ${tier}`).toBe(true);
    }
  });

  it('is base-path aware, so production does not 404', () => {
    expect(medalSrc('gold')).toContain(import.meta.env.BASE_URL);
  });
});
