import { useCallback } from 'react';
import type { GameManifest } from '@/games/registry';
import { useAuthStore } from '@/system/auth/authStore';
import { useGameContext } from '@/system/economy/gameContext';
import { applyResult, type ResultReport } from '@/system/economy/result';
import { useToast } from '@/ui';

/**
 * `useGame()` — a game's window on the OS. Its manifest, and `reportResult` — the one call that
 * settles a hand.
 *
 * This is the hook wrapping `applyResult`, and it is deliberately thin: all the correctness is in
 * the pure function (tested in economy.test.ts), and all this adds is the three impure things a
 * pure function must not do — read the current profile, stamp `Date.now()`, and tell the player
 * what happened. One call updates bankroll, stats, XP and achievements together, because
 * `applyResult` returns them as one object and `mutateProfile` persists it as one write. There is
 * no way to credit three of the four, which was the entire v1 failure.
 */
export interface GameApi {
  readonly manifest: GameManifest;
  /**
   * Settle a result. Fire-and-forget: it updates the store optimistically and persists in the
   * background, so the table does not block on a round-trip. A failed save is toasted and
   * reverted by `mutateProfile`, not thrown at the game — a game should not have to handle the
   * network to report a win.
   */
  readonly reportResult: (report: ResultReport) => void;
}

export function useGame(): GameApi {
  const { manifest } = useGameContext();
  const mutateProfile = useAuthStore((s) => s.mutateProfile);
  const toast = useToast();

  const reportResult = useCallback(
    (report: ResultReport) => {
      // Read the LATEST profile at call time, not a render-time snapshot — a hand can settle
      // several renders after the component that reads `useProfile` last updated, and applying a
      // result to a stale bankroll is how money goes wrong.
      const profile = useAuthStore.getState().profile;
      if (profile === null) return;

      const applied = applyResult(profile, manifest.id, report, Date.now());
      void mutateProfile(applied.profile).catch(() => {
        toast.error('Could not save your result — check your connection.');
      });
      // Gold-adjacent flourish stays as a plain success toast: an achievement is a moment, not a
      // sign, and the theme keeps status toots flat on purpose. One toast per badge unlocked.
      for (const a of applied.unlocked) {
        toast.success(`${a.emoji}  ${a.name} unlocked`);
      }
    },
    [manifest.id, mutateProfile, toast]
  );

  return { manifest, reportResult };
}
