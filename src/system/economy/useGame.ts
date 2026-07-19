import { useCallback } from 'react';
import type { GameManifest } from '@/games/registry';
import { mintNonce, useAuthStore } from '@/system/auth/authStore';
import { useGameContext } from '@/system/economy/gameContext';
import { applyResult, type ResultReport } from '@boardwalk/game-logic';
import { useToast } from '@/ui';
import { useAudio } from '@/system/audio/useAudio';
import { useOfflineStore } from '@/system/offline/offlineStore';
import type { SettleIntent } from '@/system/offline/queue';

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
  const applyEconomy = useAuthStore((s) => s.applyEconomy);
  const toast = useToast();
  const { play } = useAudio();

  const reportResult = useCallback(
    (report: ResultReport) => {
      // Read the LATEST profile at call time, not a render-time snapshot — a hand can settle
      // several renders after the component that reads `useProfile` last updated, and applying a
      // result to a stale bankroll is how money goes wrong.
      const profile = useAuthStore.getState().profile;
      if (profile === null) return;

      const applied = applyResult(profile, manifest.id, report, Date.now());

      // The result becomes an INTENT. Note what travels and what does not: the outcome, the
      // payout, and any FEATS the game observed — but never the new bankroll, never the XP,
      // never a stat count, and since Phase D never an achievement id either. The server
      // recomputes all of those from the outcome and its own tables, so a tampered client can
      // misreport what happened in a hand it played but cannot report a hand it did not play
      // into a fortune, and cannot award itself a badge at all.
      //
      // `applied` is still computed above, and it is now a PREDICTION: it drives the optimistic
      // profile and the unlock toast, and the authoritative profile the server answers with
      // replaces it a beat later.
      //
      // OFFLINE HARDENING. The nonce is a server-signed TICKET when the referee issues them, and a
      // self-minted string only where there is no referee to verify one (a fresh clone, the
      // emulator, `VITE_API_ECONOMY=0`). `acquireNonce()` answers null when the book is empty on a
      // server that DOES enforce, and that null is the bound doing its job: there is no branch here
      // that mints a nonce to paper over an exhausted budget, because that branch is the hole.
      void (async () => {
        const { ticket, required } = await useOfflineStore.getState().acquireNonce();
        if (ticket === null && required) {
          // The bound, as the player experiences it: offline, out of credits, and told so plainly
          // rather than shown a result that silently never lands.
          toast.error(
            "You're offline and out of saved-result credits — this game won't be ranked."
          );
          return;
        }

        const intent: SettleIntent = {
          kind: 'settle',
          nonce: ticket ?? mintNonce(),
          gameId: manifest.id,
          outcome: report.outcome,
          payoutCents: Math.round(report.payoutCents ?? 0),
          ...(report.feats !== undefined ? { feats: report.feats } : {}),
        };

        await applyEconomy(intent, applied.profile).then(
          (result) => {
            if (!result.ok) toast.error(result.error);
          },
          () => {
            // THE BANKING PATH. Before this, a network failure dropped the intent — nonce and all —
            // so the result was simply LOST, and a "retry" would have minted a different nonce and
            // defeated the server's idempotency anyway. Now the intent is kept VERBATIM, ticket
            // included, and re-sent on reconnect: the same nonce arriving twice moves the ledger
            // once, which `boardwalk-api/tests/tickets.test.ts` demonstrates against a real replay.
            //
            // Only when a ticket was actually spent. Without one there is nothing bounding a queue,
            // and an unbounded queue of self-minted nonces is the hole rather than the fix.
            if (ticket !== null) {
              useOfflineStore.getState().bank(intent, Date.now());
              toast.success("Saved — we'll rank this when you're back online.");
            } else {
              toast.error('Could not save your result — check your connection.');
            }
          }
        );
      })();
      // Gold-adjacent flourish stays as a plain success toast: an achievement is a moment, not a
      // sign, and the theme keeps status toots flat on purpose. One toast per badge unlocked.
      for (const a of applied.unlocked) {
        toast.success(`${a.emoji}  ${a.name} unlocked`);
      }
      // ONE stinger for the batch, not one per badge. A result that completes a chain tier can
      // unlock several at once, and playing the role per badge would stack identical takes into a
      // machine-gun — the exact failure the registry's variation pools exist to prevent, arriving
      // instead through the caller. The toasts still stack; only the sound is collapsed.
      if (applied.unlocked.length > 0) play('unlock');
    },
    [manifest.id, applyEconomy, toast, play]
  );

  return { manifest, reportResult };
}
