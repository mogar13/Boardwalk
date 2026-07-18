import { feltSrc } from '@/system/felt/felts';
import { useAuthStore } from '@/system/auth/authStore';

/**
 * The player's equipped FELT as a ready-to-draw image URL, or `null` for no felt — the reader that
 * makes a `felt` cosmetic a real thing and not `loadout.color`. All five boards call this and hand
 * the result to `<Card felt={…}>`.
 *
 * The profile coupling lives here, deliberately NOT in `felts.ts` — the same split `cards.ts` /
 * `useEquippedCardBack` established in P2. A SELECTOR, so a board re-renders when the equipped
 * felt changes and not on every chip that moves.
 *
 * WHY THIS RESOLVES THE URL AND `useEquippedCardBack` RETURNS AN ID. A card back id travels
 * further — `CardView` picks between a face and a back per card, so the game needs the id, not one
 * URL. A felt has exactly one consumer shape (the surface behind everything), so resolving here
 * means no board ever imports `felts.ts` and no board can forget the `null` case: the prop is
 * `string | null` and TypeScript makes them handle it.
 */
export function useEquippedFelt(): string | null {
  return useAuthStore((s) => feltSrc(s.profile?.equipped.felt));
}
