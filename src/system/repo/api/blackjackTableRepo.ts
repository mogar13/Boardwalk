/**
 * THE BLACKJACK TABLE'S SEAM TO THE REFEREE — `apiUnoRepo` with the stake moved, not removed.
 *
 * UNO's `start` carries no stake because the TABLE's ante is stamped on the room and the referee
 * reads it there. Blackjack's `open` carries no stake either, and the reason is different and worth
 * keeping straight: there is no table stake at all. Each chair names its own, every round, on
 * `act({type:'bet'})` — which is the one place in this game a client sends a number, and it is a
 * decision about its OWN money that `checkBet` bounds against the ledger before a card is dealt.
 *
 * There is deliberately NO local/Firebase twin, exactly as UNO has none. The room-LESS blackjack
 * hand keeps its offline twin (`local/blackjackRepo.ts`) because one player's hand can be dealt by a
 * reducer; a TABLE cannot, because the only client-side dealer available is one player's browser
 * holding the deck and the hole card for everybody. `repos.blackjackTable` is `null` without the
 * game server and the board says so.
 */
import type { RoomSocket } from '@/system/repo/api/socket';
import type {
  BlackjackTableActionInput,
  BlackjackTableRepo,
  BlackjackTableStartInput,
  Profile,
  RepoResult,
} from '@/system/repo/types';

/**
 * A socket reply, narrowed to the profile the seam answers with. A null means something is wrong
 * rather than "no profile" — surfaced as a refusal instead of adopted, because adopting a null
 * would blank a live top bar.
 */
function asResult(
  reply: { ok: true; value?: unknown } | { ok: false; error: string }
): RepoResult<Profile> {
  if (!reply.ok) return { ok: false, error: reply.error };
  const profile = reply.value as Profile | null | undefined;
  return profile == null
    ? { ok: false, error: 'The table answered without a profile.' }
    : { ok: true, value: profile };
}

export function apiBlackjackTableRepo(socket: RoomSocket): BlackjackTableRepo {
  return {
    async open(gameId, roomId, input: BlackjackTableStartInput) {
      return asResult(await socket.request({ t: 'bjStart', gameId, roomId, nonce: input.nonce }));
    },

    async act(gameId, roomId, input: BlackjackTableActionInput) {
      return asResult(
        await socket.request({
          t: 'bjAction',
          gameId,
          roomId,
          nonce: input.nonce,
          move: input.move,
        })
      );
    },
  };
}
