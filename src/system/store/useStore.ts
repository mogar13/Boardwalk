import { useCallback } from 'react';
import { mintNonce, useAuthStore } from '@/system/auth/authStore';
import {
  applyEquip,
  applyPurchase,
  canBuy,
  formatDollars,
  isOwned,
  type Cosmetic,
} from '@boardwalk/game-logic';
import { canOpen, openPack, type Pack, type PackPull } from '@/system/store/packs';
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
  /**
   * Confirm, then open a pack — spends the price, grants the pull (or credits dust on a duplicate).
   *
   * UNLIKE `buy`, THIS ONE RESOLVES WITH ITS RESULT, and the asymmetry is deliberate: a purchase's
   * outcome is known before you click, so a toast is the whole feedback; a pack's outcome IS the
   * product, and the caller has to render the reveal. Resolves `null` when nothing happened —
   * cancelled, refused, or the write failed — so the reveal simply does not open.
   */
  readonly open: (pack: Pack) => Promise<PackPull | null>;
}

export function useStore(): StoreApi {
  const mutateProfile = useAuthStore((s) => s.mutateProfile);
  const applyEconomy = useAuthStore((s) => s.applyEconomy);
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
          // The intent names the ITEM, not the price. `applyPurchase(fresh, item)` still runs —
          // it is what the player sees instantly — but the charge that lands is the server's own
          // lookup, so a client that rewrote the catalogue in memory buys nothing cheaper.
          const result = await applyEconomy(
            { kind: 'purchase', nonce: mintNonce(), itemId: item.id },
            applyPurchase(fresh, item)
          );
          if (result.ok) toast.success(`${item.name} — yours`);
          else toast.warning(result.error);
        } catch {
          toast.error('Purchase failed — try again.');
        }
      })();
    },
    [confirm, applyEconomy, toast]
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

  const open = useCallback(
    async (pack: Pack): Promise<PackPull | null> => {
      const before = useAuthStore.getState().profile;
      if (before === null) return null;

      const check = canOpen(before, pack);
      if (!check.ok) {
        toast.warning(check.error);
        return null;
      }

      const ok = await confirm({
        title: `Open the ${pack.name}?`,
        body: `Spend ${formatDollars(pack.priceCents)} on one random cosmetic. Duplicates refund dust.`,
        confirmLabel: `Spend ${formatDollars(pack.priceCents)}`,
      });
      if (!ok) return null;

      // Re-read and re-check AFTER the confirm — same reason as `buy`: the bankroll can move while
      // the dialog is open, and a pack opened against a stale balance is an overdraft.
      const fresh = useAuthStore.getState().profile;
      if (fresh === null) return null;
      const recheck = canOpen(fresh, pack);
      if (!recheck.ok) {
        toast.warning(recheck.error);
        return null;
      }

      // The seed is minted HERE, not inside `openPack` — the roll stays pure and testable, and the
      // impurity sits in the hook where every other impurity in this file already lives.
      const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      const { profile: after, pull } = openPack(fresh, pack, seed);
      if (pull === null) return null;

      try {
        await mutateProfile(after);
        return pull;
      } catch {
        toast.error('Could not open that pack — try again.');
        return null;
      }
    },
    [confirm, mutateProfile, toast]
  );

  return { buy, equip, open };
}
