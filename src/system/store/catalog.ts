/**
 * The store catalogue and its money math — pure, so "can I afford this" is a unit test, not a
 * thing discovered in the UI.
 *
 * THE RULE THAT SHAPES THIS FILE: a cosmetic must have a READER or it is `loadout.color` —
 * v1's cosmetic field written by the hub and read by nothing, a row in the defect table. That is
 * why every kind here ships WITH the code that renders it:
 *
 *   • `avatar`   → the top bar and the profile card (`profile.avatar`) — since Phase 4.
 *   • `cardback` → the card games' face-down art (`useEquippedCardBack` → `cardBackSrc`) — P2.
 *   • `title`    → the profile card, next to the name (`profile.equipped.title`) — P2.
 *
 * WHY OWNING AND EQUIPPING ARE SEPARATE. `inventory` is the set you may equip; `avatar` /
 * `equipped` is the one you did. Collapsing them (equip-on-buy, no inventory) means re-buying to
 * switch back, and losing a cosmetic you paid for the moment you try another. Two concepts, two
 * fields, both on the profile.
 *
 * RARITY IS PURE STATUS. `rarity` drives the store card's tier styling and the pack-pull odds
 * (`@/system/store/packs`, P4) — and NOTHING functional. A legendary card back deals the same cards. It is the scarcity
 * signal the store was missing, not a gameplay lever.
 *
 * EARN-VS-BUY. Chips buy flair; skill buys prestige. A cosmetic with `priceCents: null` is
 * EARN-ONLY — not for sale at any price, granted by the achievement pipeline (P3), and shown in
 * the store locked with its `unlock` line. That split is the whole fix for "paying for emojis
 * feels cheap": the best titles cannot be bought, so wearing one means you earned it.
 */
import { DEFAULT_AVATAR } from '@/system/profile/defaults';
import { formatDollars } from '@/system/profile/money';
import type { Profile } from '@/system/profile/types';

/** The cosmetic families, each with a reader (see the header). `title` and `cardback` land in P2. */
export type CosmeticKind = 'avatar' | 'cardback' | 'title';

/** Scarcity tier. Pure status — drives store styling and (P4) pack odds, never gameplay. */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface Cosmetic {
  /** Stable id — the key under `profile.inventory`. Never renamed; a rename orphans what people bought. */
  readonly id: string;
  readonly name: string;
  readonly kind: CosmeticKind;
  readonly rarity: Rarity;
  /**
   * Price in cents. `0` = a starter (owned by everyone, never sold, never in `inventory`).
   * `null` = EARN-ONLY — not buyable at any price; the achievement pipeline grants it (P3). The
   * `null`/`0` distinction matters: a starter is free-and-owned, an earn-only is unowned-until-earned.
   */
  readonly priceCents: number | null;
  /**
   * AVATARS ONLY: the emoji that IS the avatar. Equipping an avatar matches on it, so it is
   * unique across the avatar rows. Card backs and titles have no emoji — they render their art
   * (`cardBackSrc`) or their text.
   */
  readonly emoji?: string;
  /** EARN-ONLY cosmetics: how you unlock it, shown on the locked store card ("Win 100 games of Chess"). */
  readonly unlock?: string;
}

/**
 * The catalogue. Avatars first (as Phase 4 shipped them), then the card backs (P2's flagship
 * reader) climbing the rarity ladder, then the titles — two buyable, two earn-only. The default
 * avatar and the default card back are both free starters, so a fresh account already owns what
 * it is wearing.
 */
export const CATALOG: readonly Cosmetic[] = [
  // ── Avatars ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'av_person',
    name: 'Newcomer',
    kind: 'avatar',
    rarity: 'common',
    emoji: DEFAULT_AVATAR,
    priceCents: 0,
  },
  { id: 'av_smile', name: 'Regular', kind: 'avatar', rarity: 'common', emoji: '🙂', priceCents: 0 },
  { id: 'av_dice', name: 'Roller', kind: 'avatar', rarity: 'common', emoji: '🎲', priceCents: 0 },

  {
    id: 'av_cowboy',
    name: 'Gambler',
    kind: 'avatar',
    rarity: 'common',
    emoji: '🤠',
    priceCents: 100_000,
  },
  {
    id: 'av_tophat',
    name: 'The House',
    kind: 'avatar',
    rarity: 'common',
    emoji: '🎩',
    priceCents: 250_000,
  },
  {
    id: 'av_clover',
    name: 'Lucky',
    kind: 'avatar',
    rarity: 'rare',
    emoji: '🍀',
    priceCents: 500_000,
  },
  {
    id: 'av_crown',
    name: 'Royalty',
    kind: 'avatar',
    rarity: 'rare',
    emoji: '👑',
    priceCents: 1_000_000,
  },
  {
    id: 'av_shark',
    name: 'Card Shark',
    kind: 'avatar',
    rarity: 'rare',
    emoji: '🦈',
    priceCents: 1_500_000,
  },
  {
    id: 'av_diamond',
    name: 'High Society',
    kind: 'avatar',
    rarity: 'epic',
    emoji: '💎',
    priceCents: 2_500_000,
  },
  {
    id: 'av_fire',
    name: 'On a Heater',
    kind: 'avatar',
    rarity: 'epic',
    emoji: '🔥',
    priceCents: 4_000_000,
  },
  {
    id: 'av_rocket',
    name: 'Moonshot',
    kind: 'avatar',
    rarity: 'legendary',
    emoji: '🚀',
    priceCents: 7_500_000,
  },
  {
    id: 'av_dragon',
    name: 'Whale',
    kind: 'avatar',
    rarity: 'legendary',
    emoji: '🐉',
    priceCents: 10_000_000,
  },

  // ── Card backs (the P2 flagship: read by every standard-deck game) ───────────────────────────
  // Each id is a `CARD_BACKS` key, so the art resolves through `cardBackSrc`; `tests/cards.test.ts`
  // proves every one is a file on disk. `cb_blue1` is the free starter and the default back.
  // P4 filled the ladder out to all fifteen staged backs: a pack needs DEPTH or every pull is a
  // duplicate by the third open, which turns the gamble into a dust vending machine.
  { id: 'cb_blue1', name: 'Classic', kind: 'cardback', rarity: 'common', priceCents: 0 },
  { id: 'cb_red1', name: 'Crimson', kind: 'cardback', rarity: 'common', priceCents: 40_000 },
  { id: 'cb_green1', name: 'Clover', kind: 'cardback', rarity: 'common', priceCents: 40_000 },
  { id: 'cb_blue2', name: 'Azure', kind: 'cardback', rarity: 'common', priceCents: 40_000 },
  { id: 'cb_red2', name: 'Scarlet', kind: 'cardback', rarity: 'common', priceCents: 40_000 },
  { id: 'cb_green2', name: 'Emerald', kind: 'cardback', rarity: 'common', priceCents: 40_000 },
  { id: 'cb_blue3', name: 'Sapphire', kind: 'cardback', rarity: 'rare', priceCents: 250_000 },
  { id: 'cb_red3', name: 'Ruby', kind: 'cardback', rarity: 'rare', priceCents: 250_000 },
  { id: 'cb_blue4', name: 'Indigo', kind: 'cardback', rarity: 'rare', priceCents: 250_000 },
  { id: 'cb_green3', name: 'Fern', kind: 'cardback', rarity: 'rare', priceCents: 250_000 },
  { id: 'cb_green4', name: 'Jade', kind: 'cardback', rarity: 'epic', priceCents: 900_000 },
  { id: 'cb_blue5', name: 'Cobalt', kind: 'cardback', rarity: 'epic', priceCents: 900_000 },
  { id: 'cb_red4', name: 'Garnet', kind: 'cardback', rarity: 'epic', priceCents: 900_000 },
  { id: 'cb_red5', name: 'Inferno', kind: 'cardback', rarity: 'legendary', priceCents: 6_000_000 },
  {
    id: 'cb_green5',
    name: 'Viridian',
    kind: 'cardback',
    rarity: 'legendary',
    priceCents: 6_000_000,
  },

  // ── Titles ───────────────────────────────────────────────────────────────────────────────────
  // Two buyable (chips buy flair), two EARN-ONLY (skill buys prestige — `priceCents: null`, granted
  // by an achievement chain in P3, shown locked until then). The earn-only pair is the whole point
  // of the split: no amount of chips wears "Grandmaster".
  { id: 'ttl_regular', name: 'Regular', kind: 'title', rarity: 'common', priceCents: 150_000 },
  {
    id: 'ttl_highroller',
    name: 'High Roller',
    kind: 'title',
    rarity: 'rare',
    priceCents: 1_000_000,
  },
  {
    id: 'ttl_thehouse',
    name: 'The House',
    kind: 'title',
    rarity: 'epic',
    priceCents: null,
    unlock: 'Win 100 hands of Blackjack',
  },
  {
    id: 'ttl_grandmaster',
    name: 'Grandmaster',
    kind: 'title',
    rarity: 'legendary',
    priceCents: null,
    unlock: 'Win 100 games of Chess',
  },
];

/** Lookup by id, for turning a stored `inventory` / `equipped` key back into a cosmetic. */
export function cosmeticById(id: string): Cosmetic | undefined {
  return CATALOG.find((c) => c.id === id);
}

/** All cosmetics of one kind, in catalogue order — the store sections one grid per kind. */
export function cosmeticsOfKind(kind: CosmeticKind): readonly Cosmetic[] {
  return CATALOG.filter((c) => c.kind === kind);
}

/** Owned = free starter, or bought / earned (in `inventory`). The gate equip and buy both read. */
export function isOwned(profile: Profile, item: Cosmetic): boolean {
  return item.priceCents === 0 || item.id in profile.inventory;
}

/** Not buyable at any price — the earn-only tier, granted by achievements (P3), never sold. */
export function isEarnOnly(item: Cosmetic): boolean {
  return item.priceCents === null;
}

/**
 * Currently worn. Kind-aware: an avatar matches on its emoji (top-level `profile.avatar`), a card
 * back or title on its id in the `equipped` map. Same shape of check for all three, different field.
 */
export function isEquipped(profile: Profile, item: Cosmetic): boolean {
  switch (item.kind) {
    case 'avatar':
      return profile.avatar === item.emoji;
    case 'cardback':
      return profile.equipped.cardback === item.id;
    case 'title':
      return profile.equipped.title === item.id;
  }
}

export type PurchaseCheck = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * May this be bought? Values, not exceptions — the card renders the reason under the price.
 * Already-owned is a refusal (a "Buy" button on something you own is the bug). An earn-only item
 * is refused with its unlock line, because chips cannot buy it at all — that is the point of it.
 */
export function canBuy(profile: Profile, item: Cosmetic): PurchaseCheck {
  if (isOwned(profile, item)) return { ok: false, error: 'Already yours.' };
  if (item.priceCents === null) {
    return { ok: false, error: item.unlock ? `Earn it — ${item.unlock}.` : 'Earn it.' };
  }
  if (profile.bankrollCents < item.priceCents) {
    return { ok: false, error: `Costs ${formatDollars(item.priceCents)}.` };
  }
  return { ok: true };
}

/**
 * Buy it: spend the price, add the id to the inventory set. Returns a NEW profile — the caller
 * persists it. Assumes `canBuy` passed (the hook checks first, so an earn-only or unaffordable
 * item never reaches here); the bankroll is floored at 0 so a mis-ordered call cannot write a
 * negative, which the rules would refuse anyway.
 *
 * A starter (price 0) is never bought — `canBuy` refuses it as already-owned — so this never adds
 * a free id to `inventory`, which keeps the set to things actually purchased or earned.
 */
export function applyPurchase(profile: Profile, item: Cosmetic): Profile {
  const cost = item.priceCents ?? 0;
  return {
    ...profile,
    bankrollCents: Math.max(0, profile.bankrollCents - cost),
    inventory: { ...profile.inventory, [item.id]: true },
  };
}

/**
 * Equip it. Returns a NEW profile. Ownership is the caller's check (the hook), so this stays a
 * pure setter — the store UI only offers Equip on owned items, and `isOwned` is the same predicate
 * the buy path uses, so the two cannot disagree about what is equippable.
 *
 * Kind decides the field: an avatar sets top-level `avatar` (unchanged since Phase 4), a card back
 * or title sets its id into the `equipped` map — spread, so equipping a title never drops the
 * card back and vice versa.
 */
export function applyEquip(profile: Profile, item: Cosmetic): Profile {
  switch (item.kind) {
    case 'avatar':
      return { ...profile, avatar: item.emoji ?? profile.avatar };
    case 'cardback':
      return { ...profile, equipped: { ...profile.equipped, cardback: item.id } };
    case 'title':
      return { ...profile, equipped: { ...profile.equipped, title: item.id } };
  }
}

/**
 * The equipped title's display name, or `null` if none. The profile card's reader — kept here so
 * "which title am I wearing" has one answer, computed from the same catalogue the store sells.
 */
export function equippedTitle(profile: Profile): string | null {
  const id = profile.equipped.title;
  if (id === undefined) return null;
  return cosmeticById(id)?.name ?? null;
}
