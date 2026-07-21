import { useCallback } from 'react';
import { mintNonce, useAuthStore } from '@/system/auth/authStore';
import { REFILL_FLOOR_CENTS, formatMoney, refillGrantFor } from '@boardwalk/game-logic';
import { useProfile } from '@/system/profile/useProfile';
import { useAudio } from '@/system/audio/useAudio';
import { useToast } from '@/ui';

/**
 * `useRefill()` — the bankrupt top-up's brain (V1_FEATURE_GAPS.md #10). `available` for whether to
 * offer it, `grantCents` for what to put on the button, `refill` for the click.
 *
 * It is a sibling of `useDailyReward`, deliberately: same optimistic-then-authoritative shape, same
 * single-intent write, same toast-on-refusal. The one difference is WHERE THE ANSWER LIVES. The
 * daily card can compute its own status because `daily` is a profile field the client holds; this
 * one cannot, because the once-a-day limit is counted off the referee's ledger. So `available` is
 * only ever the honest half of the question — "are you broke" — and "have you had one today" is
 * answered by the server, once, as a refusal the player reads.
 *
 * That asymmetry is a deliberate cost, not an oversight. The alternative is a `lastRefillDay` on
 * the profile so the button could gray itself out, which means a second stored copy of a fact the
 * ledger already holds, a `$other: false` rules change to deploy by hand, and a SQLite column —
 * all so a button can be disabled instead of answering. The rule this repo keeps landing on is
 * that a derived fact beats a stored one; this is that rule costing something for once, and it is
 * still the right side.
 */
export interface RefillApi {
  /** Is the bankroll low enough to offer a top-up? `false` when signed out. */
  readonly available: boolean;
  /** What a top-up would grant right now, in cents. 0 when unavailable. */
  readonly grantCents: number;
  /** The floor a top-up lifts you to — for a card that wants to name it. */
  readonly floorCents: number;
  /** Take the top-up. A no-op when unavailable; the UI should not be offering it then. */
  readonly refill: () => void;
}

export function useRefill(): RefillApi {
  const profile = useProfile();
  const applyEconomy = useAuthStore((s) => s.applyEconomy);
  const toast = useToast();
  const { play } = useAudio();

  const grant = profile === null ? null : refillGrantFor(profile.bankrollCents);

  const refill = useCallback(() => {
    const p = useAuthStore.getState().profile;
    if (p === null) return;
    const grantCents = refillGrantFor(p.bankrollCents);
    if (grantCents === null) return; // solvent — the card would not have offered it

    // The optimistic profile lands the player exactly on the floor, which is what the server will
    // compute too. It is a GUESS all the same — if the day's top-up is already spent, the answer
    // below replaces this with the authoritative profile and the balance snaps back.
    const next = { ...p, bankrollCents: p.bankrollCents + grantCents };

    void applyEconomy({ kind: 'refill', nonce: mintNonce() }, next).then(
      (applied) => {
        if (!applied.ok) {
          toast.warning(applied.error);
          return;
        }
        // `chip` and not `jackpot` or `win`: this is money arriving, but it is not a payout, and a
        // celebration for going broke would be the audio equivalent of congratulating a player on
        // losing. The role split P5 argued for, applied to the one case that most invites the
        // wrong sound.
        play('chip');
        toast.success(`Topped up to ${formatMoney(applied.value.profile.bankrollCents)}`);
      },
      () => {
        toast.error('Could not top up — try again.');
      }
    );
  }, [applyEconomy, play, toast]);

  return {
    available: grant !== null,
    grantCents: grant ?? 0,
    floorCents: REFILL_FLOOR_CENTS,
    refill,
  };
}
