import { DEFAULT_DICE } from '@/system/dice/dice';
import { useAuthStore } from '@/system/auth/authStore';

/**
 * The player's equipped DICE SET, as an id — the reader that makes a `dice` cosmetic a real thing
 * and not `loadout.color`.
 *
 * The profile coupling lives here, deliberately NOT in `dice.ts` — the split P2 established with
 * `cards.ts` / `useEquippedCardBack`. A SELECTOR, so the board re-renders when the equipped set
 * changes and not on every chip that moves.
 *
 * WHY THIS RETURNS AN ID AND `useEquippedFelt` RESOLVES A URL. A felt has exactly one consumer
 * shape, so resolving it here means no board imports the art module. A dice set has six faces and
 * the board decides which face each die shows, so the id has to travel — the same reason
 * `useEquippedCardBack` returns an id rather than one URL.
 *
 * IT NEVER RETURNS UNDEFINED. There is no "no dice" state the way there is a "no felt" state, so a
 * signed-out or unequipped player gets the free starter and the board has no null case to forget.
 */
export function useEquippedDice(): string {
  return useAuthStore((s) => s.profile?.equipped.dice ?? DEFAULT_DICE);
}
