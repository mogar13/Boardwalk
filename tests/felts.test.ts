/**
 * A felt is an image, and the only way `feltSrc` goes wrong is by naming a file that is not there.
 * The mapping typechecks whatever string it returns, so — exactly like the card art and the sound
 * registry — only a disk check proves it. This walks every felt in the registry AND every `felt`
 * cosmetic in the shared catalogue against `public/felts/`.
 *
 * THE TWO HALVES MATTER SEPARATELY. The registry could resolve perfectly while the catalogue sells
 * an id the registry has never heard of: the store card renders, the purchase succeeds, the money
 * leaves, and the table stays bare. So the catalogue is walked as its own case rather than trusted
 * to match by inspection — the same shape as `tests/cards.test.ts`'s store-cosmetic case, and for
 * the same reason it was written there.
 *
 * The base path is stripped to a basename before the disk check, so the test is independent of
 * `import.meta.env.BASE_URL` (`/` here, `/Boardwalk/` in production).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FELTS, FELT_IDS, feltSrc } from '@/system/felt/felts';
import { CATALOG } from '@boardwalk/game-logic';

const FELT_DIR = fileURLToPath(new URL('../public/felts/', import.meta.url));

/** The last path segment — the filename, without any base-path prefix. */
function basename(src: string): string {
  return src.slice(src.lastIndexOf('/') + 1);
}

describe('feltSrc', () => {
  it('resolves every registered felt to a file on disk', () => {
    expect(FELT_IDS.length).toBeGreaterThan(0);
    const missing = FELT_IDS.filter((id) => {
      const src = feltSrc(id);
      return src === null || !existsSync(FELT_DIR + basename(src));
    });
    expect(missing, `felt art missing from public/felts/: ${missing.join(', ')}`).toEqual([]);
  });

  it('maps each id to its own distinct file', () => {
    // Two ids pointing at one image is a store selling the same felt twice under two names, which
    // a disk check alone would happily call green.
    const files = FELT_IDS.map((id) => FELTS[id]);
    expect(new Set(files).size).toBe(files.length);
  });

  it('returns null for nothing-equipped and for an unknown id', () => {
    // `null` is a real answer here, not a failure: no felt is the default, and an id that outlived
    // its art must degrade to a bare table rather than a broken background.
    expect(feltSrc(undefined)).toBeNull();
    expect(feltSrc('ft_does_not_exist')).toBeNull();
  });

  it('is base-path-aware', () => {
    const src = feltSrc('ft_green');
    expect(src).not.toBeNull();
    expect(src).toContain('felts/');
  });
});

describe('the store felt cosmetics', () => {
  const felts = CATALOG.filter((c) => c.kind === 'felt');

  it('sells at least one felt, and every one of them resolves to art on disk', () => {
    expect(felts.length).toBeGreaterThan(0);
    const broken = felts
      .filter((c) => {
        const src = feltSrc(c.id);
        return src === null || !existsSync(FELT_DIR + basename(src));
      })
      .map((c) => c.id);
    expect(broken, `catalogue felts with no art: ${broken.join(', ')}`).toEqual([]);
  });

  it('has no free starter — the default is no felt at all', () => {
    // The deliberate asymmetry with card backs, which MUST have a free default because there is no
    // such thing as not drawing the back of a face-down card. A starter felt would instead repaint
    // all five boards for every existing account on deploy.
    expect(felts.filter((c) => c.priceCents === 0)).toEqual([]);
  });

  it('is all buyable — no earn-only felt without a grant site', () => {
    // An earn-only cosmetic needs an achievement that grants it (P3's mechanism). None of the
    // chains grant a felt, so an earn-only felt here would be unobtainable at any price or skill.
    expect(felts.filter((c) => c.priceCents === null)).toEqual([]);
  });
});
