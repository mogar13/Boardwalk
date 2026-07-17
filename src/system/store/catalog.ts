/**
 * The store catalogue and its money math — pure, so "can I afford this" is a unit test, not a
 * thing discovered in the UI.
 *
 * WHY AVATARS AND NOTHING ELSE, IN PHASE 4. A cosmetic has to have a reader to exist here, or
 * it is `loadout.color` — v1's cosmetic field written by the hub and read by nothing, a row in
 * the defect table. An equipped avatar has a reader TODAY: the top bar and the profile card
 * both render `profile.avatar`. A card back or a table felt does not — nothing draws a table
 * until Phase 6 — so those wait for the game that reads them. Selling them now would be
 * building the exact dead cosmetic this project catalogued as a mistake.
 *
 * WHY OWNING AND EQUIPPING ARE SEPARATE. `inventory` is the set you may equip; `avatar` is the
 * one you did. Collapsing them (equip-on-buy, no inventory) means re-buying to switch back,
 * and losing an avatar you paid for the moment you try another. Two concepts, two fields, both
 * on the profile.
 */
import { DEFAULT_AVATAR } from '@/system/profile/defaults';
import { formatDollars } from '@/system/profile/money';
import type { Profile } from '@/system/profile/types';

export type CosmeticKind = 'avatar';

export interface Cosmetic {
  /** Stable id — the key under `profile.inventory`. Never renamed; a rename orphans what people bought. */
  readonly id: string;
  readonly name: string;
  /** The avatar itself. Unique across the catalogue, because equipping matches on it. */
  readonly emoji: string;
  /** Price in cents. 0 means a starter — owned by everyone, never sold, never in `inventory`. */
  readonly priceCents: number;
  readonly kind: CosmeticKind;
}

/**
 * The catalogue. Starters first (free, everyone owns them), then the ladder of paid avatars,
 * climbing in price so the expensive ones read as something you worked toward. The default
 * avatar is the first starter, so a fresh account already "owns" what it is wearing.
 */
export const CATALOG: readonly Cosmetic[] = [
  { id: 'av_person', name: 'Newcomer', emoji: DEFAULT_AVATAR, priceCents: 0, kind: 'avatar' },
  { id: 'av_smile', name: 'Regular', emoji: '🙂', priceCents: 0, kind: 'avatar' },
  { id: 'av_dice', name: 'Roller', emoji: '🎲', priceCents: 0, kind: 'avatar' },

  { id: 'av_cowboy', name: 'Gambler', emoji: '🤠', priceCents: 100_000, kind: 'avatar' },
  { id: 'av_tophat', name: 'The House', emoji: '🎩', priceCents: 250_000, kind: 'avatar' },
  { id: 'av_clover', name: 'Lucky', emoji: '🍀', priceCents: 500_000, kind: 'avatar' },
  { id: 'av_crown', name: 'Royalty', emoji: '👑', priceCents: 1_000_000, kind: 'avatar' },
  { id: 'av_shark', name: 'Card Shark', emoji: '🦈', priceCents: 1_500_000, kind: 'avatar' },
  { id: 'av_diamond', name: 'High Society', emoji: '💎', priceCents: 2_500_000, kind: 'avatar' },
  { id: 'av_fire', name: 'On a Heater', emoji: '🔥', priceCents: 4_000_000, kind: 'avatar' },
  { id: 'av_rocket', name: 'Moonshot', emoji: '🚀', priceCents: 7_500_000, kind: 'avatar' },
  { id: 'av_dragon', name: 'Whale', emoji: '🐉', priceCents: 10_000_000, kind: 'avatar' },
];

/** Lookup by id, for turning a stored `inventory` key back into a cosmetic. */
export function cosmeticById(id: string): Cosmetic | undefined {
  return CATALOG.find((c) => c.id === id);
}

/** Owned = free starter, or bought (in `inventory`). The gate equip and buy both read. */
export function isOwned(profile: Profile, item: Cosmetic): boolean {
  return item.priceCents === 0 || item.id in profile.inventory;
}

/** Currently worn. Matches on emoji, which is why the catalogue's emoji are unique. */
export function isEquipped(profile: Profile, item: Cosmetic): boolean {
  return profile.avatar === item.emoji;
}

export type PurchaseCheck = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * May this be bought? Values, not exceptions — the card renders the reason under the price.
 * Already-owned is a refusal and not a silent no-op, because a "Buy" button on something you
 * own is the bug, and this is what the button's disabled state is computed from.
 */
export function canBuy(profile: Profile, item: Cosmetic): PurchaseCheck {
  if (isOwned(profile, item)) return { ok: false, error: 'Already yours.' };
  if (profile.bankrollCents < item.priceCents) {
    return { ok: false, error: `Costs ${formatDollars(item.priceCents)}.` };
  }
  return { ok: true };
}

/**
 * Buy it: spend the price, add the id to the inventory set. Returns a NEW profile — the caller
 * persists it. Assumes `canBuy` passed (the hook checks first); the bankroll is floored at 0 so
 * a mis-ordered call cannot write a negative, which the rules would refuse anyway.
 *
 * A starter (price 0) is never bought — `canBuy` refuses it as already-owned — so this never
 * adds a free id to `inventory`, which keeps the set to things actually purchased.
 */
export function applyPurchase(profile: Profile, item: Cosmetic): Profile {
  return {
    ...profile,
    bankrollCents: Math.max(0, profile.bankrollCents - item.priceCents),
    inventory: { ...profile.inventory, [item.id]: true },
  };
}

/**
 * Equip it: set `avatar` to its emoji. Returns a NEW profile. Ownership is the caller's check
 * (the hook), so this stays a pure setter — but the store UI only offers Equip on owned items,
 * and `isOwned` is the same predicate the buy path uses, so the two cannot disagree about what
 * is equippable.
 */
export function applyEquip(profile: Profile, item: Cosmetic): Profile {
  return { ...profile, avatar: item.emoji };
}
