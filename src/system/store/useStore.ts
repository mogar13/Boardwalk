import { useCallback } from 'react';
import { useAuthStore } from '@/system/auth/authStore';
import { formatDollars } from '@/system/profile/money';
import { applyEquip, applyPurchase, canBuy, isOwned, type Cosmetic } from '@/system/store/catalog';
import { useConfirm, useToast } from '@/ui';

/**
 * `useStore()` — buy and equip. The money math is pure (`catalog.ts`, tested); this adds the
 * confirm, the toast, and the re-check after the confirm that keeps a purchase honest.
 */
export interface StoreApi {
  /**
   * Confirm, then buy — spends the price, grants ownership. Fire-and-forget: the confirm and the
   * write are async inside, but the API is `=> void`, because a buy is a UI action (a click), not
   * a thing a caller awaits. Refusals are toasted, so nothing is lost by not returning a promise.
   */
  readonly buy: (item: Cosmetic) => void;
  /** Wear an owned cosmetic. A no-op on something not owned — the button is only shown for owned items. */
  readonly equip: (item: Cosmetic) => void;
}

export function useStore(): StoreApi {
  const mutateProfile = useAuthStore((s) => s.mutateProfile);
  const { confirm } = useConfirm();
  const toast = useToast();

  const buy = useCallback(
    (item: Cosmetic) => {
      const before = useAuthStore.getState().profile;
      if (before === null) return;

      const check = canBuy(before, item);
      if (!check.ok) {
        toast.warning(check.error);
        return;
      }
      // `canBuy` already refused an earn-only (null-priced) item, so the price is a real number
      // here — narrow it for the confirm/label below rather than trusting the `??` to paper over a
      // bug. If this is ever null past the guard, that is a `canBuy` regression, not a $0 purchase.
      const price = item.priceCents;
      if (price === null) return;

      // The async part is an implementation detail behind a void API — kicked off here and left to
      // run. Spending real bankroll is worth a confirm, and the label names the cost, never "OK":
      // `ActionLabel` would reject a vague one at compile time; this one says what it does.
      void (async () => {
        const ok = await confirm({
          title: `Buy ${item.name}?`,
          body: `Spend ${formatDollars(price)} from your bankroll on ${item.name}.`,
          confirmLabel: `Spend ${formatDollars(price)}`,
        });
        if (!ok) return;

        // Re-read and re-check AFTER the confirm: the bankroll could have moved while the dialog was
        // open (a daily claim, a settled hand), and buying against the pre-dialog balance is how an
        // affordable purchase becomes an overdraft.
        const fresh = useAuthStore.getState().profile;
        if (fresh === null) return;
        const recheck = canBuy(fresh, item);
        if (!recheck.ok) {
          toast.warning(recheck.error);
          return;
        }

        try {
          await mutateProfile(applyPurchase(fresh, item));
          toast.success(`${item.name} — yours`);
        } catch {
          toast.error('Purchase failed — try again.');
        }
      })();
    },
    [confirm, mutateProfile, toast]
  );

  const equip = useCallback(
    (item: Cosmetic) => {
      const p = useAuthStore.getState().profile;
      if (p === null || !isOwned(p, item)) return;
      void mutateProfile(applyEquip(p, item)).catch(() => {
        toast.error('Could not equip that — try again.');
      });
    },
    [mutateProfile, toast]
  );

  return { buy, equip };
}
