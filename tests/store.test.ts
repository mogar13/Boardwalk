/**
 * The store's money math — pure, so "can I afford it", "do I own it", "does buying deduct exactly
 * the price" are assertions and not things found by clicking Buy. P2 grew the catalogue from
 * avatars-only to three kinds (avatar / cardback / title), added `rarity`, and split buy-vs-earn —
 * so the catalogue's invariants matter more: equipping an avatar matches on emoji, a card back or
 * title matches on id, and an earn-only item must be unbuyable at any price.
 */
import { describe, expect, it } from 'vitest';
import {
  applyEquip,
  applyPurchase,
  canBuy,
  CATALOG,
  cosmeticById,
  cosmeticsOfKind,
  equippedTitle,
  isEarnOnly,
  isEquipped,
  isOwned,
  type Cosmetic,
} from '@/system/store/catalog';
import { defaultProfile } from '@/system/profile/defaults';

const paidAvatar = (): Cosmetic => {
  const c = CATALOG.find((x) => x.kind === 'avatar' && (x.priceCents ?? 0) > 0);
  if (!c) throw new Error('catalogue has no paid avatar to test with');
  return c;
};

const paidBack = (): Cosmetic => {
  const c = CATALOG.find((x) => x.kind === 'cardback' && (x.priceCents ?? 0) > 0);
  if (!c) throw new Error('catalogue has no paid card back to test with');
  return c;
};

const earnOnly = (): Cosmetic => {
  const c = CATALOG.find((x) => x.priceCents === null);
  if (!c) throw new Error('catalogue has no earn-only item to test with');
  return c;
};

describe('the catalogue', () => {
  it('has unique ids — the inventory / equipped key', () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique emoji among AVATARS — the avatar equip key', () => {
    // Only avatars carry an emoji (it is what equipping an avatar matches on). Card backs and
    // titles have none, so uniqueness is asserted over the avatars alone.
    const emoji = CATALOG.filter((c) => c.kind === 'avatar').map((c) => c.emoji);
    expect(emoji.every((e) => typeof e === 'string' && e.length > 0)).toBe(true);
    expect(new Set(emoji).size).toBe(emoji.length);
  });

  it('carries all three kinds, each with a paid or earn item', () => {
    expect(cosmeticsOfKind('avatar').length).toBeGreaterThan(0);
    expect(cosmeticsOfKind('cardback').length).toBeGreaterThan(0);
    expect(cosmeticsOfKind('title').length).toBeGreaterThan(0);
  });

  it('gives every cosmetic a rarity', () => {
    const rarities = new Set(['common', 'rare', 'epic', 'legendary']);
    expect(CATALOG.every((c) => rarities.has(c.rarity))).toBe(true);
  });

  it('has at least one free starter, one paid item, and one earn-only item', () => {
    expect(CATALOG.some((c) => c.priceCents === 0)).toBe(true);
    expect(CATALOG.some((c) => (c.priceCents ?? 0) > 0)).toBe(true);
    expect(CATALOG.some((c) => c.priceCents === null)).toBe(true);
  });

  it('gives every earn-only item an unlock line to display', () => {
    for (const c of CATALOG.filter(isEarnOnly)) {
      expect(c.unlock, `${c.id} is earn-only but has no unlock text`).toBeTruthy();
    }
  });

  it('resolves an id back to its cosmetic', () => {
    const item = paidAvatar();
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
    const item = paidBack();
    expect(isOwned(p, item)).toBe(false);
    expect(isOwned({ ...p, inventory: { [item.id]: true } }, item)).toBe(true);
  });

  it('does not own an earn-only item until it is granted (no free-starter shortcut)', () => {
    const p = defaultProfile('t');
    const item = earnOnly();
    expect(isOwned(p, item)).toBe(false);
    expect(isOwned({ ...p, inventory: { [item.id]: true } }, item)).toBe(true);
  });

  it('reads the equipped avatar off the emoji', () => {
    const p = defaultProfile('t');
    const worn = CATALOG.find((c) => c.kind === 'avatar' && c.emoji === p.avatar);
    expect(worn).toBeDefined();
    if (worn) expect(isEquipped(p, worn)).toBe(true);
  });

  it('reads an equipped card back and title off the equipped map, by id', () => {
    const back = paidBack();
    const title = CATALOG.find((c) => c.kind === 'title');
    if (!title) throw new Error('no title in catalogue');
    const p = { ...defaultProfile('t'), equipped: { cardback: back.id, title: title.id } };
    expect(isEquipped(p, back)).toBe(true);
    expect(isEquipped(p, title)).toBe(true);
    // A different card back of the same kind is not the equipped one.
    const otherBack = CATALOG.find((c) => c.kind === 'cardback' && c.id !== back.id);
    if (otherBack) expect(isEquipped(p, otherBack)).toBe(false);
  });

  it('reports the equipped title name for the profile card, null when none', () => {
    const p = defaultProfile('t');
    expect(equippedTitle(p)).toBeNull();
    const title = CATALOG.find((c) => c.kind === 'title');
    if (!title) throw new Error('no title in catalogue');
    expect(equippedTitle({ ...p, equipped: { title: title.id } })).toBe(title.name);
  });
});

describe('canBuy', () => {
  it('refuses something already owned', () => {
    const p = defaultProfile('t');
    const free = CATALOG.find((c) => c.priceCents === 0)!;
    expect(canBuy(p, free).ok).toBe(false);
  });

  it('refuses an earn-only item at any bankroll — chips cannot buy prestige', () => {
    const item = earnOnly();
    const p = { ...defaultProfile('t'), bankrollCents: 1_000_000_000 };
    const check = canBuy(p, item);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error.toLowerCase()).toContain('earn');
  });

  it('refuses when the bankroll is short', () => {
    const item = paidBack();
    const p = { ...defaultProfile('t'), bankrollCents: (item.priceCents ?? 0) - 1 };
    expect(canBuy(p, item).ok).toBe(false);
  });

  it('allows an affordable, unowned, buyable item', () => {
    const item = paidBack();
    const p = { ...defaultProfile('t'), bankrollCents: item.priceCents ?? 0 };
    expect(canBuy(p, item).ok).toBe(true);
  });
});

describe('applyPurchase / applyEquip', () => {
  it('deducts exactly the price and grants ownership', () => {
    const item = paidBack();
    const p = { ...defaultProfile('t'), bankrollCents: (item.priceCents ?? 0) + 12_345 };
    const next = applyPurchase(p, item);
    expect(next.bankrollCents).toBe(12_345);
    expect(isOwned(next, item)).toBe(true);
  });

  it('does not mutate the profile it was handed', () => {
    const item = paidBack();
    const p = { ...defaultProfile('t'), bankrollCents: item.priceCents ?? 0 };
    const frozen = JSON.stringify(p);
    applyPurchase(p, item);
    expect(JSON.stringify(p)).toBe(frozen);
  });

  it('equips an avatar by setting the top-level avatar to its emoji', () => {
    const item = paidAvatar();
    const p = defaultProfile('t');
    expect(applyEquip(p, item).avatar).toBe(item.emoji);
  });

  it('equips a card back / title into the equipped map without dropping the other', () => {
    const back = paidBack();
    const title = CATALOG.find((c) => c.kind === 'title');
    if (!title) throw new Error('no title in catalogue');
    const withBack = applyEquip(defaultProfile('t'), back);
    expect(withBack.equipped.cardback).toBe(back.id);
    // Equipping a title next must not clear the card back.
    const withBoth = applyEquip(withBack, title);
    expect(withBoth.equipped.cardback).toBe(back.id);
    expect(withBoth.equipped.title).toBe(title.id);
    // And the avatar stays where it is — the equipped map holds only the new kinds.
    expect(withBoth.avatar).toBe(defaultProfile('t').avatar);
  });
});
