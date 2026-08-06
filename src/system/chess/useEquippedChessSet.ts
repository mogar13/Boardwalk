import { chessSet, type ChessSet } from '@/system/chess/chessSets';
import { useAuthStore } from '@/system/auth/authStore';

/**
 * The player's equipped CHESS SET, resolved — the reader that makes a `chessset` cosmetic real and
 * not `loadout.color`. Chess's board is the only caller, which is the point: a set is the identity
 * of one game's table, not a global.
 *
 * The profile coupling lives here and NOT in `chessSets.ts`, the same split `cards.ts` /
 * `useEquippedCardBack` established in P2 and `felts.ts` / `useEquippedFelt` repeated in P5. A
 * SELECTOR, so the board re-renders when the set changes rather than on every unrelated profile
 * write.
 *
 * IT RETURNS THE WHOLE SET, not a URL like `useEquippedFelt` does, because a chess set has two
 * consumers inside one component: the squares need class names and each of 32 pieces needs its own
 * image. That is the same reason `useEquippedCardBack` returns an id — when the art varies per
 * element, resolving to one URL here would just mean resolving again in the board.
 *
 * NEVER NULL. `chessSet` falls back to the free starter, so the board always has something to
 * draw and never has to branch on "no set equipped" — an account that has bought nothing is
 * wearing `cs_classic`, which is a real set rather than an absence.
 */
export function useEquippedChessSet(): ChessSet {
  return useAuthStore((s) => chessSet(s.profile?.equipped.chessset));
}
