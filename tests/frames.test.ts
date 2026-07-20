/**
 * A frame has no art, so there is no disk check to run — its "asset" is a theme token, and the way
 * it goes wrong is different in kind from a missing file.
 *
 * THE THING THAT WOULD ACTUALLY ROT is the pairing. A frame is drawn in its RARITY's colour (see
 * `@/system/frame/frames` for why it borrows the rarity ladder rather than minting hues), and that
 * is a fact held in two places: the catalogue entry's `rarity`, and this registry's tone. Re-tier a
 * frame in the catalogue — a perfectly ordinary re-pricing — and its ring keeps the old colour,
 * so a legendary frame renders in common grey and the store's own scarcity signal lies. Nothing
 * about that fails to compile, and no disk check can see it.
 *
 * So this file guards the JOIN: every catalogue frame is registered, every registered id is real,
 * and the tone equals the rarity.
 */
import { describe, it, expect } from 'vitest';
import { FRAMES, FRAME_IDS, frameTone } from '@/system/frame/frames';
import { RARITY_RING } from '@/system/store/rarity';
import { CATALOG, type Rarity } from '@boardwalk/game-logic';

const catalogueFrames = CATALOG.filter((c) => c.kind === 'frame');

describe('the frame registry', () => {
  it('registers every frame the catalogue sells', () => {
    expect(catalogueFrames.length).toBeGreaterThan(0);
    const unregistered = catalogueFrames.filter((c) => !(c.id in FRAMES)).map((c) => c.id);
    expect(unregistered, `catalogue frames with no tone: ${unregistered.join(', ')}`).toEqual([]);
  });

  it('registers nothing the catalogue does not sell', () => {
    // The other direction. A tone for an id nobody can buy is dead data — the frame-shaped version
    // of a cosmetic with no reader.
    const ids = new Set(catalogueFrames.map((c) => c.id));
    const orphans = FRAME_IDS.filter((id) => !ids.has(id));
    expect(orphans, `tones for frames not in the catalogue: ${orphans.join(', ')}`).toEqual([]);
  });

  it("each frame's tone equals its catalogue rarity", () => {
    // The assertion this file exists for. Held in two places, so it is checked rather than assumed.
    const drifted = catalogueFrames
      .filter((c) => FRAMES[c.id] !== c.rarity)
      .map((c) => `${c.id}: tone ${String(FRAMES[c.id])} vs rarity ${c.rarity}`);
    expect(drifted, `frame tone disagrees with rarity: ${drifted.join('; ')}`).toEqual([]);
  });

  it('every tone has a ring class, and it is a flat border token', () => {
    // The glow budget is the reason `frame` could ship at all: it borrows the rarity ladder's
    // already-cleared flat hues. A ring class carrying a shadow/glow utility would be this kind
    // quietly minting a new neon meaning, which PROGRESSION_PLAN.md says gets the FRAME cut, not
    // the budget raised.
    for (const id of FRAME_IDS) {
      const tone = frameTone(id) as Rarity;
      const cls = RARITY_RING[tone];
      expect(cls, `no ring class for tone ${tone}`).toBeTruthy();
      expect(
        cls.startsWith('border-rarity-'),
        `${id} ring is not a flat rarity border: ${cls}`
      ).toBe(true);
      expect(cls).not.toMatch(/shadow|glow/);
    }
  });

  it('returns null for nothing-equipped and for an unknown id', () => {
    // No ring is the default and a permanent, legitimate state — a bare avatar is what every
    // account has rendered since Phase 4.
    expect(frameTone(undefined)).toBeNull();
    expect(frameTone('fr_does_not_exist')).toBeNull();
  });

  it('has no free starter and no earn-only frame', () => {
    // Same reasoning as felts: no starter, so an account that buys nothing looks exactly as it did
    // before P5; and no earn-only frame, because no achievement chain grants one.
    expect(catalogueFrames.filter((c) => c.priceCents === 0)).toEqual([]);
    expect(catalogueFrames.filter((c) => c.priceCents === null)).toEqual([]);
  });
});
