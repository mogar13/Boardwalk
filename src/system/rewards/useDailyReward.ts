import { useCallback, useState } from 'react';
import { mintNonce, useAuthStore } from '@/system/auth/authStore';
import { formatMoney } from '@/system/profile/money';
import { useProfile } from '@/system/profile/useProfile';
import { claimDaily, dailyStatus, type DailyStatus } from '@/system/rewards/daily';
import { useToast } from '@/ui';

/**
 * `useDailyReward()` — the streak card's brain. `status` for what to render, `claim` for the
 * button. Correctness (is it claimable, what does it pay, does the streak continue) is all in
 * pure `daily.ts`; this adds the clock and the toast, and the ONE thing that makes it safe: the
 * money and the clock advance in a SINGLE profile write, so a claim can never pay without
 * ticking the day, or tick the day without paying.
 */
export interface DailyRewardApi {
  /** Where the streak stands, recomputed each render against the current clock. `null` when signed out. */
  readonly status: DailyStatus | null;
  /** Claim today's reward. A no-op if it is not claimable — the UI should not offer it then. */
  readonly claim: () => void;
}

export function useDailyReward(): DailyRewardApi {
  const profile = useProfile();
  const applyEconomy = useAuthStore((s) => s.applyEconomy);
  const toast = useToast();

  // The day, snapshotted once at mount. `Date.now()` is impure and must not run during render, so
  // it goes in a `useState` initializer — which runs exactly once — rather than in the render body.
  // A snapshot is right for this: "is it a new day" only changes at midnight, and the claim handler
  // below reads a fresh clock anyway, so a card left open across midnight simply waits for a refresh
  // to offer the next day rather than recomputing every frame.
  const [nowMs] = useState(() => Date.now());
  const status = profile === null ? null : dailyStatus(profile.daily, nowMs);

  const claim = useCallback(() => {
    const p = useAuthStore.getState().profile;
    if (p === null) return;
    const result = claimDaily(p.daily, Date.now());
    if (result === null) return; // already claimed today; the card would not have offered it

    const next = {
      ...p,
      bankrollCents: p.bankrollCents + result.rewardCents,
      daily: result.state,
    };
    // The intent carries NO clock. `claimDaily` above still runs against `Date.now()` because the
    // card needs something to show instantly, but the streak and the reward that actually land
    // are computed from the server's time — so the oldest cheat in a client-authoritative economy
    // (wind the device clock forward, claim again) has nothing to act on.
    void applyEconomy({ kind: 'daily', nonce: mintNonce() }, next).then(
      (applied) => {
        if (!applied.ok) {
          toast.warning(applied.error);
          return;
        }
        // Announce the SERVER'S streak, not the one we guessed — they agree unless the local
        // clock was off, and in that case the honest number is the one that was banked.
        toast.success(
          `Day ${String(applied.value.daily.streak)} — ${formatMoney(result.rewardCents)} claimed`
        );
      },
      () => {
        toast.error('Could not claim your reward — try again.');
      }
    );
  }, [applyEconomy, toast]);

  return { status, claim };
}
