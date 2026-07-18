import { useAuthStore } from '@/system/auth/authStore';
import type { Profile } from '@boardwalk/game-logic';

/**
 * Re-exported, not redefined. `formatMoney` moved to the pure `@/system/profile/money` so
 * `economy/bet.ts` can format a bet-limit message without importing this store-coupled file;
 * the components that already say `import { formatMoney } from '@/system/profile/useProfile'`
 * keep working, because there is still exactly one definition and this is a pointer to it.
 */
export { formatMoney, formatDollars } from '@boardwalk/game-logic';

/**
 * The player, or `null` if nobody is signed in.
 *
 * A SELECTOR, NOT THE STORE. `useAuthStore((s) => s.profile)` re-renders only components
 * that read the profile, and from Phase 4 this object changes on every hand of blackjack.
 * Handing out the whole store — or a context — would re-render the entire tree on every
 * chip. ARCHITECTURE.md picked Zustand for exactly this sentence.
 */
export function useProfile(): Profile | null {
  return useAuthStore((s) => s.profile);
}

/**
 * The bankroll, in integer cents. READONLY. There is no setter, and that is the design.
 *
 * ARCHITECTURE.md and CLAUDE.md both lead with this, and the v1 defect table is why:
 *
 *   • `SystemUI.money` is a setter, so 40+ call sites do `money += payout` by hand.
 *   • `recordWin(gameId)` takes ONE argument, and those same 40+ sites pass it a payout
 *     it silently discards — the money and the record of the money were never the same
 *     call.
 *   • So `big_win` ("win $1,000+ in one bet") has ZERO unlock sites. Nothing ever knew a
 *     payout. The achievement shipped and could not fire.
 *
 * The fix is not "remember to call both". It is that there is nothing here to call. A
 * number cannot be assigned back through a hook that returns a number, so from Phase 4 the
 * only way money moves is `useBet()` for wagers and `reportResult({outcome, payout})` for
 * payouts — one call that updates bankroll, stats, XP and achievements together, which is
 * also what finally makes `big_win` implementable.
 *
 * RIGHT NOW, IN PHASE 2, THAT IS FREE: no mutator exists anywhere, so nothing can spell
 * `money += x` even by accident. Phase 4's job is to add the writers without adding a
 * setter. Do not add one here to make a test easier.
 *
 * Returns 0 when signed out — not null. Every caller renders a balance, and `?? 0` at
 * fifteen call sites is fifteen chances to write `?? 5000`.
 */
export function useBankroll(): number {
  return useAuthStore((s) => s.profile?.bankrollCents ?? 0);
}
