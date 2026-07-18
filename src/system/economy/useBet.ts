import { useCallback, useState } from 'react';
import { mintNonce, useAuthStore } from '@/system/auth/authStore';
import {
  clampBet,
  maxBet,
  validateBet,
  type BetBounds,
  type BetCheck,
} from '@boardwalk/game-logic';
import { useGameContext } from '@/system/economy/gameContext';
import { useBankroll } from '@/system/profile/useProfile';
import { useToast } from '@/ui';

/**
 * `useBet()` — the chip rack. Bounds from the manifest, balance from the store, math from
 * `bet.ts`. It is the wiring v1's `validateAndCommit()` was trying to be and could not, because
 * v1 built the shared function and left the six games to wire it however each liked. Here the
 * math is shared (pure, tested) and the rack is shared (this hook), so a game gets both and hand-
 * rolls neither.
 *
 * `commit()` is the ONLY way a wager leaves the bankroll — it deducts through `mutateProfile`,
 * the same single writer everything else uses. Payouts come back through `reportResult`. Two
 * events, per ARCHITECTURE.md, and neither is a `money += x` a game can spell.
 */
export interface BetApi {
  /** The staged bet, in cents. Always a legal amount — `set`/`add` snap it. */
  readonly amountCents: number;
  readonly bounds: BetBounds;
  /** The largest bet the bankroll and table allow right now — for an "all in" chip. */
  readonly maxCents: number;
  /** Whether `amountCents` is a legal, affordable bet, and if not, why (to render under the rack). */
  readonly check: BetCheck;
  readonly canCommit: boolean;
  /** Set the bet, snapped into `[min, maxCents]`. */
  readonly set: (cents: number) => void;
  /** Add a chip, snapped. `add(-100)` removes one. */
  readonly add: (cents: number) => void;
  /** Back to the table minimum. */
  readonly clear: () => void;
  /**
   * Take the bet: deduct it from the bankroll and return the staked cents, or `null` if the
   * amount is not legal against the live balance. The caller keeps the returned cents to pass as
   * `wagerCents` when it later calls `reportResult` — so the wager the achievement sees is the
   * exact one that left the bankroll.
   */
  readonly commit: () => number | null;
}

/** A game with no betting still renders; this keeps the hooks unconditional before the guard throw. */
const NO_BETTING: BetBounds = { min: 0, max: 0 };

export function useBet(): BetApi {
  const { manifest } = useGameContext();
  const bounds: BetBounds = manifest.betting ?? NO_BETTING;
  const balance = useBankroll();
  const applyEconomy = useAuthStore((s) => s.applyEconomy);
  const toast = useToast();
  const [amountCents, setAmount] = useState(bounds.min);

  const set = useCallback(
    (cents: number) => setAmount(clampBet(cents, balance, bounds)),
    [balance, bounds]
  );
  const add = useCallback(
    (cents: number) => setAmount((a) => clampBet(a + cents, balance, bounds)),
    [balance, bounds]
  );
  const clear = useCallback(
    () => setAmount(clampBet(bounds.min, balance, bounds)),
    [balance, bounds]
  );

  const commit = useCallback((): number | null => {
    const profile = useAuthStore.getState().profile;
    if (profile === null) return null;
    // Re-validate against the LIVE balance, not the staged amount's render-time balance: another
    // bet could have settled between staging and committing.
    const checked = validateBet(amountCents, profile.bankrollCents, bounds);
    if (!checked.ok) return null;

    // STAYS SYNCHRONOUS, on purpose. The server is the referee (Phase B) but a game calls this
    // inline — `const wager = bet.commit(); if (wager === null) return;` — and making it async
    // would rewrite every table's deal path to satisfy a boundary that is not theirs. So the
    // local check decides whether the chip leaves the rack, the deduction renders immediately,
    // and the server's answer reconciles a beat later. The two disagree only if the client's
    // balance was stale, and then the server wins and the bet is reverted with a toast.
    void applyEconomy(
      {
        kind: 'bet',
        nonce: mintNonce(),
        gameId: manifest.id,
        amountCents: checked.amountCents,
      },
      { ...profile, bankrollCents: profile.bankrollCents - checked.amountCents }
    ).then(
      (result) => {
        if (!result.ok) toast.error(result.error);
      },
      () => toast.error('Could not place your bet — check your connection.')
    );
    return checked.amountCents;
  }, [amountCents, bounds, applyEconomy, manifest.id, toast]);

  // The guard, AFTER every hook so the hook order is unconditional (rules-of-hooks). A betting
  // game never trips it; a non-betting game that wrongly renders a rack fails loudly here.
  if (manifest.betting === undefined) {
    throw new Error(
      `useBet() was called for "${manifest.id}", which declares no betting in its manifest. ` +
        'A game with no economy has no chip rack — check manifest.betting before rendering one.'
    );
  }

  const maxCents = maxBet(balance, bounds);
  const check = validateBet(amountCents, balance, bounds);
  return { amountCents, bounds, maxCents, check, canCommit: check.ok, set, add, clear, commit };
}
