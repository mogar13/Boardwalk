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
  applyUnequip,
  canBuy,
  CATALOG,
  cosmeticById,
  cosmeticsOfKind,
  type CosmeticKind,
  equippedTitle,
  isEarnOnly,
  isEquipped,
  isOwned,
  isUnequippable,
  type Cosmetic,
} from '@boardwalk/game-logic';
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

  it('carries every declared kind, each with at least one item', () => {
    // WRITTEN AS A LIST, THIS WENT STALE TWICE. It named three kinds while the catalogue carried
    // five (P5's felt and frame never got a line), and passed the whole time — a test that lists
    // what it knows about cannot notice a kind it does not. Driving it off the union means a new
    // `CosmeticKind` is red here until something is actually for sale under it.
    const kinds: readonly CosmeticKind[] = [
      'avatar',
      'cardback',
      'title',
      'felt',
      'frame',
      'dice',
      'chessset',
    ];
    for (const kind of kinds) {
      expect(cosmeticsOfKind(kind).length, `no cosmetics of kind ${kind}`).toBeGreaterThan(0);
    }
    // And the list above is exhaustive over the union: an omission is a compile error, not a
    // silently unchecked kind.
    const exhaustive: Record<CosmeticKind, true> = {
      avatar: true,
      cardback: true,
      title: true,
      felt: true,
      frame: true,
      dice: true,
      chessset: true,
    };
    expect(Object.keys(exhaustive).sort()).toEqual([...kinds].sort());
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

/**
 * TAKING SOMETHING OFF — the half the store had no way to spell.
 *
 * An equipped cosmetic drew a dead "Equipped" label and nothing else, so every kind was a one-way
 * door: there is no "none" row to equip, so the only way out of a felt was buying a different felt.
 * That is loudest for the felt (it draws under all six boards at once — buy one to look at it and
 * every game has it for good), and identical for the other five kinds.
 *
 * WHAT CAN GO WRONG IS ENTIRELY ABOUT PERSISTENCE, which is why these cases are about the SHAPE of
 * the result rather than about a boolean. Both writers rebuild `equipped` from what is present —
 * the API's `coerceUpsert` reconstructs it key by key, `firebaseProfileRepo.save` writes the whole
 * profile object at its own path — so an ABSENT key clears and a key carrying `undefined` only
 * happens to clear, because `JSON.stringify` drops it before either sees it. Deleting is the same
 * outcome on purpose instead of by accident, and `'felt' in equipped` is the only assertion that
 * can tell the two apart.
 */
describe('applyUnequip — equipped is a state you can leave', () => {
  const felt = (): Cosmetic => {
    const item = cosmeticsOfKind('felt')[0];
    if (!item) throw new Error('no felt in catalogue');
    return item;
  };

  it('removes the KEY rather than setting it undefined', () => {
    const worn = applyEquip(defaultProfile('t'), felt());
    expect(worn.equipped.felt).toBe(felt().id);

    const bare = applyUnequip(worn, 'felt');
    expect(bare.equipped.felt).toBeUndefined();
    // The assertion that distinguishes a deleted key from a present-but-undefined one. A profile
    // carrying `{ felt: undefined }` reads identically through every accessor above and survives
    // `Object.keys`, which is exactly how it would reach a writer that iterates.
    expect('felt' in bare.equipped).toBe(false);
  });

  it('leaves every other equipped kind alone', () => {
    const back = paidBack();
    const title = CATALOG.find((c) => c.kind === 'title');
    if (!title) throw new Error('no title in catalogue');
    let p = applyEquip(defaultProfile('t'), back);
    p = applyEquip(p, title);
    p = applyEquip(p, felt());

    const bare = applyUnequip(p, 'felt');
    expect(bare.equipped.cardback).toBe(back.id);
    expect(bare.equipped.title).toBe(title.id);
    expect(bare.avatar).toBe(defaultProfile('t').avatar);
  });

  it('does not mutate the profile it was handed', () => {
    const worn = applyEquip(defaultProfile('t'), felt());
    const frozen = JSON.stringify(worn);
    applyUnequip(worn, 'felt');
    expect(JSON.stringify(worn)).toBe(frozen);
  });

  it('is a no-op by IDENTITY when nothing of that kind is worn', () => {
    // Returned unchanged rather than rebuilt, so a redundant call cannot re-render anything that
    // is watching the profile — the identity discipline `setOptionValue` and `setTableRule` hold.
    const p = defaultProfile('t');
    expect(applyUnequip(p, 'felt')).toBe(p);
  });

  it('takes every kind off, and each one leaves nothing behind', () => {
    // Swept over the CATALOGUE rather than over one kind, because "the store sells it, so it can
    // be taken off" has to be true of the kind that is added next, not just of the six today.
    for (const kind of ['cardback', 'title', 'felt', 'frame', 'dice', 'chessset'] as const) {
      const item = cosmeticsOfKind(kind)[0];
      if (!item) continue;
      const bare = applyUnequip(applyEquip(defaultProfile('t'), item), kind);
      expect(kind in bare.equipped, kind).toBe(false);
    }
  });

  /**
   * THE AVATAR IS NOT A KIND YOU CAN TAKE OFF, and it is excluded by TYPE rather than by a branch.
   * `Profile.avatar` is a required string that the top bar, the leaderboard row and the profile
   * card all render unconditionally, so "no avatar" is three surfaces drawing an empty span.
   *
   * There is nothing to call and assert here — the point is that `applyUnequip(p, 'avatar')` does
   * not compile — so what is asserted is the narrowing that keeps a UI from reaching it: the store
   * card gates its Take-off button on `isUnequippable`, and this is the predicate that gate uses.
   */
  it('narrows the avatar out, so no caller can reach it', () => {
    const avatars = cosmeticsOfKind('avatar');
    expect(avatars.length).toBeGreaterThan(0);
    for (const a of avatars) expect(isUnequippable(a), a.id).toBe(false);
    for (const c of CATALOG.filter((c) => c.kind !== 'avatar')) {
      expect(isUnequippable(c), c.id).toBe(true);
    }
  });
});
