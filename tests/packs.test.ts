/**
 * PACKS — the variable-reward loop, tested where it is pure. A pack is the one store mechanic
 * whose behaviour you cannot check by looking: "legendary is 2%" and "a duplicate refunds dust"
 * are claims about a distribution, and clicking Open a hundred times is not a test. `openPack` is
 * seeded, so every one of them is an assertion here.
 *
 * The two that matter most are the invariants a pack could quietly break:
 *   • it can never drop an EARN-ONLY cosmetic (P2/P3's prestige tier — a pack that could roll
 *     "Grandmaster" would let chips buy the one thing chips must not buy), and
 *   • it can never drop a free STARTER (everyone owns those; a guaranteed dud dressed as a pull).
 * Both are asserted over the real catalogue AND exhaustively over the roll, because the filter
 * being right today does not stop a future catalogue row from landing in a pool.
 */
import { describe, expect, it } from 'vitest';
import { defaultProfile } from '@/system/profile/defaults';
import { CATALOG, isEarnOnly, type Cosmetic, type Rarity } from '@/system/store/catalog';
import {
  canOpen,
  dustFor,
  openPack,
  PACKS,
  packById,
  packPool,
  type Pack,
} from '@/system/store/packs';
import type { Profile } from '@/system/profile/types';

const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/** Indexed access with the check the strict config wants — a missing pack is a broken catalogue. */
const packAt = (i: number): Pack => {
  const p = PACKS[i];
  if (!p) throw new Error(`no pack at index ${i}`);
  return p;
};

const rich = (over: Partial<Profile> = {}): Profile => ({
  ...defaultProfile('Tester'),
  bankrollCents: 100_000_000,
  ...over,
});

/** Every distinct item a pack can produce, found by exhausting a wide band of seeds. */
function reachable(packId: string, seeds = 4000): Set<string> {
  const pack = packById(packId);
  if (!pack) throw new Error(`no pack ${packId}`);
  const out = new Set<string>();
  for (let s = 0; s < seeds; s++) {
    const { pull } = openPack(rich(), pack, s);
    if (pull) out.add(pull.item.id);
  }
  return out;
}

describe('the pack catalogue', () => {
  it('has unique ids', () => {
    const ids = PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('publishes odds that sum to 1 — the displayed table IS the roll', () => {
    for (const pack of PACKS) {
      const total = RARITIES.reduce((sum, r) => sum + pack.odds[r], 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });

  it('prices every pack in integer cents, above zero', () => {
    for (const pack of PACKS) {
      expect(Number.isInteger(pack.priceCents)).toBe(true);
      expect(pack.priceCents).toBeGreaterThan(0);
    }
  });

  it('gives every pack a pool with at least one item at every weighted rarity', () => {
    // A weight over an empty bucket is a published rate that can never pay out.
    for (const pack of PACKS) {
      const pool = packPool(pack);
      expect(pool.length).toBeGreaterThan(0);
      for (const r of RARITIES) {
        if (pack.odds[r] > 0) {
          expect(pool.filter((c) => c.rarity === r).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('resolves a pack by id, and misses cleanly', () => {
    expect(packById('pk_backs')?.name).toBe('Card Back Pack');
    expect(packById('nope')).toBeUndefined();
  });
});

describe('the pool — what a pack may never contain', () => {
  it('excludes every EARN-ONLY cosmetic, in every pack', () => {
    expect(CATALOG.some(isEarnOnly)).toBe(true); // the guard is guarding something
    for (const pack of PACKS) {
      expect(packPool(pack).filter(isEarnOnly)).toEqual([]);
    }
  });

  it('excludes every free STARTER, in every pack', () => {
    expect(CATALOG.some((c) => c.priceCents === 0)).toBe(true);
    for (const pack of PACKS) {
      expect(packPool(pack).filter((c) => c.priceCents === 0)).toEqual([]);
    }
  });

  it('only draws from the kinds the pack declares', () => {
    for (const pack of PACKS) {
      for (const item of packPool(pack)) {
        expect(pack.kinds).toContain(item.kind);
      }
    }
  });

  it('never ROLLS an earn-only or a starter, across thousands of seeds', () => {
    // The stronger form: not just "the filter is right", but "nothing else reaches the pull".
    for (const pack of PACKS) {
      for (const id of reachable(pack.id)) {
        const item = CATALOG.find((c) => c.id === id) as Cosmetic;
        expect(item.priceCents).not.toBeNull();
        expect(item.priceCents).toBeGreaterThan(0);
      }
    }
  });
});

describe('canOpen', () => {
  const pack = packAt(0);

  it('allows an affordable open on an incomplete collection', () => {
    expect(canOpen(rich(), pack)).toEqual({ ok: true });
  });

  it('refuses when the bankroll is short, naming the price', () => {
    const check = canOpen(rich({ bankrollCents: pack.priceCents - 1 }), pack);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain('Costs');
  });

  it('refuses a pack whose pool you have completed — a fee, not a gamble', () => {
    const inventory = Object.fromEntries(packPool(pack).map((c) => [c.id, true as const]));
    const check = canOpen(rich({ inventory }), pack);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain('own everything');
  });
});

describe('openPack — the roll', () => {
  const pack = packAt(0);

  it('is deterministic in the seed', () => {
    const a = openPack(rich(), pack, 12345);
    const b = openPack(rich(), pack, 12345);
    expect(a.pull?.item.id).toBe(b.pull?.item.id);
    expect(a.profile.bankrollCents).toBe(b.profile.bankrollCents);
  });

  it('spends exactly the price and grants the item on a fresh pull', () => {
    const before = rich();
    const { profile, pull } = openPack(before, pack, 7);
    expect(pull?.duplicate).toBe(false);
    expect(pull?.dustCents).toBe(0);
    expect(profile.bankrollCents).toBe(before.bankrollCents - pack.priceCents);
    expect(profile.inventory[pull?.item.id ?? '']).toBe(true);
  });

  it('refunds rarity-scaled dust on a duplicate, and grants nothing', () => {
    // Pull once, then pull the SAME seed against a profile that already owns the result.
    const first = openPack(rich(), pack, 7);
    const id = first.pull?.item.id ?? '';
    const owner = rich({ inventory: { [id]: true } });

    const { profile, pull } = openPack(owner, pack, 7);
    expect(pull?.item.id).toBe(id);
    expect(pull?.duplicate).toBe(true);
    expect(pull?.dustCents).toBe(dustFor(pack, pull?.item.rarity ?? 'common'));
    expect(pull?.dustCents).toBeGreaterThan(0);
    expect(profile.bankrollCents).toBe(
      owner.bankrollCents - pack.priceCents + (pull?.dustCents ?? 0)
    );
    expect(Object.keys(profile.inventory)).toEqual([id]); // nothing new
  });

  it('a duplicate never profits — dust is at most the price', () => {
    for (const p of PACKS) {
      for (const r of RARITIES) {
        expect(dustFor(p, r)).toBeGreaterThan(0);
        expect(dustFor(p, r)).toBeLessThanOrEqual(p.priceCents);
        expect(Number.isInteger(dustFor(p, r))).toBe(true);
      }
    }
  });

  it('floors the bankroll at 0 rather than writing a negative', () => {
    const { profile } = openPack(rich({ bankrollCents: 10 }), pack, 3);
    expect(profile.bankrollCents).toBeGreaterThanOrEqual(0);
  });

  it('never mutates the profile it was handed', () => {
    const before = rich();
    const snapshot = JSON.stringify(before);
    openPack(before, pack, 99);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('leaves every other profile field untouched', () => {
    const before = rich({ xp: 4200, achievements: { first_win: 111 } });
    const { profile } = openPack(before, pack, 21);
    expect(profile.xp).toBe(4200);
    expect(profile.achievements).toEqual({ first_win: 111 });
    expect(profile.equipped).toEqual(before.equipped);
  });

  it('can reach EVERY item in its pool — no unreachable row', () => {
    // A catalogue row a pack advertises but can never produce is the pack's `loadout.color`.
    for (const p of PACKS) {
      const got = reachable(p.id);
      for (const item of packPool(p)) expect(got.has(item.id)).toBe(true);
    }
  });

  it('rolls each rarity within a hair of its published rate', () => {
    // The claim the pack card makes to the player, checked against the generator that backs it.
    const N = 20_000;
    for (const p of PACKS) {
      const counts: Record<string, number> = {};
      for (let s = 0; s < N; s++) {
        const { pull } = openPack(rich(), p, s);
        if (pull) counts[pull.item.rarity] = (counts[pull.item.rarity] ?? 0) + 1;
      }
      for (const r of RARITIES) {
        if (p.odds[r] === 0) continue;
        expect((counts[r] ?? 0) / N).toBeCloseTo(p.odds[r], 1);
      }
    }
  });
});
