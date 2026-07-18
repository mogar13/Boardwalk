import { useCallback, useRef, useState } from 'react';
import { achievementById, type Profile } from '@boardwalk/game-logic';
import { mintNonce, useAuthStore } from '@/system/auth/authStore';
import {
  repos,
  type BlackjackMove,
  type BlackjackTurn,
  type HandView,
  type RepoResult,
} from '@/system/repo';
import { useToast } from '@/ui';

/**
 * `useBlackjackTable()` — the dealt hand, as a hook.
 *
 * This is the sibling of `useBet`/`reportResult` for the one game the client no longer settles. Its
 * shape is the same bargain: all the correctness is behind the seam (`BlackjackRepo`), and this
 * adds only the three impure things the seam cannot do — mint a nonce per request, keep the hand
 * the board renders, and tell the player when a request is refused.
 *
 * WHY THE GAME'S NAME IS IN `system/`. Everywhere else the rule holds that the OS knows about
 * seats, money and rooms while a game knows about cards. Here the referee owns a rulebook, so the
 * seam under this hook already spells `/blackjack/deal`, and the honest options were this or a game
 * reaching directly into `repos` and the auth store — which would put the composition root's one
 * job (nobody outside it names an implementation) and the store's one job (no game touches the
 * profile) inside `src/games`. One file in the OS that says "blackjack" is the cheaper of those.
 *
 * THERE IS NO MODE HERE, and there deliberately is not one to read. Whether a referee dealt this
 * hand or the local reducer did is decided once, in the composition root, and every line below is
 * identical either way — the same rule `localSeatIds` applies to hot-seat: the branch collapses at
 * one call site and the caller above it never learns there was one.
 */
export interface BlackjackTable {
  /** The hand as the dealer projects it, or `null` at the empty table (waiting for a bet). */
  readonly hand: HandView | null;
  /** A request is in flight. The board disables its buttons on this rather than tracking its own. */
  readonly busy: boolean;
  readonly deal: (wagerCents: number) => void;
  readonly play: (move: BlackjackMove) => void;
  /** Clear a settled hand back to the chip rack. Local — there is nothing to tell the dealer. */
  readonly nextHand: () => void;
}

/**
 * Toast whatever the AUTHORITATIVE profile unlocked, by diffing the badge set.
 *
 * `reportResult` can toast from `applyResult`'s own `unlocked` list because the client computed it.
 * Nothing computes it here — the referee awards badges from its own tables and Phase D took the
 * ability to ask for one off the wire entirely — so the only way to know is to compare the profile
 * we had with the profile we were handed. Which is the better shape anyway: it toasts what the
 * player was actually granted rather than what we predicted they would be.
 */
function toastUnlocks(
  before: Profile | null,
  after: Profile,
  success: (message: string) => void
): void {
  if (before === null) return;
  for (const id of Object.keys(after.achievements)) {
    if (id in before.achievements) continue;
    const badge = achievementById.get(id);
    // An id the client's catalogue does not carry is a server that is ahead of this build. Silence
    // beats rendering a raw id at the player.
    if (badge !== undefined) success(`${badge.emoji}  ${badge.name} unlocked`);
  }
}

export function useBlackjackTable(): BlackjackTable {
  const [hand, setHand] = useState<HandView | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // The in-flight guard is a REF and not the `busy` state, because two clicks in one frame both
  // read the pre-render state and would both pass. A ref is written synchronously, so the second
  // one loses — which matters here in a way it does not on a cosmetic button: the loser would be a
  // second deal, a second stake, and a hand the player did not ask for.
  const inFlight = useRef(false);
  // A mirror of `hand` a callback can read synchronously. `play` needs the id of the hand it is
  // acting on, and reading it through a `setHand` updater would put a network call inside a state
  // updater — which StrictMode double-invokes in dev, so it would deal two hands on one click.
  const handRef = useRef<HandView | null>(null);
  const putHand = useCallback((next: HandView | null) => {
    handRef.current = next;
    setHand(next);
  }, []);

  const send = useCallback(
    (request: (uid: string, nonce: string) => Promise<RepoResult<BlackjackTurn>>) => {
      const { session, profile } = useAuthStore.getState();
      if (session === null || inFlight.current) return;

      inFlight.current = true;
      setBusy(true);
      void request(session.uid, mintNonce())
        .then(
          (result) => {
            if (!result.ok) {
              // A refusal is ordinary game state ("insufficient funds for that double"), so it is
              // rendered and the hand is left exactly as it was — not cleared, because the player
              // is still holding it.
              toast.error(result.error);
              return;
            }
            useAuthStore.getState().adoptProfile(result.value.profile);
            toastUnlocks(profile, result.value.profile, toast.success);
            putHand(result.value.hand);
          },
          () => toast.error('The dealer could not be reached — check your connection.')
        )
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    },
    [toast, putHand]
  );

  const deal = useCallback(
    (wagerCents: number) => {
      send((uid, nonce) => repos.blackjack.deal(uid, { nonce, wagerCents }));
    },
    [send]
  );

  const play = useCallback(
    (move: BlackjackMove) => {
      const current = handRef.current;
      // No hand, nothing to play. Beyond that this does not second-guess the move: the dealer
      // refuses one that is not this player's hand, or not awaiting a move, so a stale click is a
      // rendered refusal rather than a rule re-derived here and eventually disagreeing.
      if (current === null) return;
      send((uid, nonce) => repos.blackjack.move(uid, { nonce, handId: current.handId, move }));
    },
    [send]
  );

  const nextHand = useCallback(() => putHand(null), [putHand]);

  return { hand, busy, deal, play, nextHand };
}
