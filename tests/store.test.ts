/**
 * The store's money math — pure, so "can I afford it", "do I own it", "does buying deduct
 * exactly the price" are assertions and not things found by clicking Buy. The catalogue's own
 * invariants (unique ids, unique emoji) are tested too, because equipping matches on emoji and
 * inventory keys on id — a duplicate in either is a silent bug the moment two cosmetics collide.
 */
import { describe, expect, it } from 'vitest';
import {
  applyEquip,
  applyPurchase,
  canBuy,
  CATALOG,
  cosmeticById,
  isEquipped,
  isOwned,
  type Cosmetic,
} from '@/system/store/catalog';
import { defaultProfile } from '@/system/profile/defaults';

const paid = (): Cosmetic => {
  const c = CATALOG.find((x) => x.priceCents > 0);
  if (!c) throw new Error('catalogue has no paid item to test with');
  return c;
};

describe('the catalogue', () => {
  it('has unique ids — the inventory key', () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique emoji — the equip key', () => {
    const emoji = CATALOG.map((c) => c.emoji);
    expect(new Set(emoji).size).toBe(emoji.length);
  });

  it('has at least one free starter and one paid item', () => {
    expect(CATALOG.some((c) => c.priceCents === 0)).toBe(true);
    expect(CATALOG.some((c) => c.priceCents > 0)).toBe(true);
  });

  it('resolves an id back to its cosmetic', () => {
    const item = paid();
    expect(cosmeticById(item.id)).toEqual(item);
    expect(cosmeticById('nope')).toBeUndefined();
  });
});

describe('ownership and equipping', () => {
  it('owns every free starter without buying', () => {
    const p = defaultProfile('t');
    for (const c of CATALOG.filter((x) => x.priceCents === 0)) {
      expect(isOwned(p, c)).toBe(true);
    }
  });

  it('does not own a paid item until it is in the inventory', () => {
    const p = defaultProfile('t');
    const item = paid();
    expect(isOwned(p, item)).toBe(false);
    expect(isOwned({ ...p, inventory: { [item.id]: true } }, item)).toBe(true);
  });

  it('reads the equipped avatar off the emoji', () => {
    const p = defaultProfile('t');
    const worn = CATALOG.find((c) => c.emoji === p.avatar);
    expect(worn).toBeDefined();
    if (worn) expect(isEquipped(p, worn)).toBe(true);
  });
});

describe('canBuy', () => {
  it('refuses something already owned', () => {
    const p = defaultProfile('t');
    const free = CATALOG.find((c) => c.priceCents === 0)!;
    const check = canBuy(p, free);
    expect(check.ok).toBe(false);
  });

  it('refuses when the bankroll is short', () => {
    const item = paid();
    const p = { ...defaultProfile('t'), bankrollCents: item.priceCents - 1 };
    expect(canBuy(p, item).ok).toBe(false);
  });

  it('allows an affordable, unowned item', () => {
    const item = paid();
    const p = { ...defaultProfile('t'), bankrollCents: item.priceCents };
    expect(canBuy(p, item).ok).toBe(true);
  });
});

describe('applyPurchase / applyEquip', () => {
  it('deducts exactly the price and grants ownership', () => {
    const item = paid();
    const p = { ...defaultProfile('t'), bankrollCents: item.priceCents + 12_345 };
    const next = applyPurchase(p, item);
    expect(next.bankrollCents).toBe(12_345);
    expect(isOwned(next, item)).toBe(true);
  });

  it('does not mutate the profile it was handed', () => {
    const item = paid();
    const p = { ...defaultProfile('t'), bankrollCents: item.priceCents };
    const frozen = JSON.stringify(p);
    applyPurchase(p, item);
    expect(JSON.stringify(p)).toBe(frozen);
  });

  it('equips by setting the avatar to the emoji', () => {
    const item = paid();
    const p = defaultProfile('t');
    expect(applyEquip(p, item).avatar).toBe(item.emoji);
  });
});
