import { DEFAULT_CARD_BACK } from '@/system/cards/cards';
import { useAuthStore } from '@/system/auth/authStore';

/**
 * The player's EQUIPPED card-back id — the reader that makes a `cardback` cosmetic a real thing
 * and not `loadout.color`. A card game calls this and hands the id to `cardBackSrc`, so the
 * face-down art on its felt is the one the player chose in the store.
 *
 * This is where the profile coupling lives, deliberately NOT in `cards.ts`: the art module stays
 * pure (id → file), and this hook is the one place that knows a card back is an equipped profile
 * field. A SELECTOR, like `useProfile`/`useBankroll`, so a game re-renders only when the equipped
 * back actually changes — not on every chip.
 *
 * Falls back to `DEFAULT_CARD_BACK` when signed out, when `equipped` is empty (a fresh account,
 * or an object RTDB stripped on the wire), or when nothing is equipped — the same starter every
 * account owns, so there is always a valid back to draw.
 */
export function useEquippedCardBack(): string {
  return useAuthStore((s) => s.profile?.equipped.cardback ?? DEFAULT_CARD_BACK);
}
