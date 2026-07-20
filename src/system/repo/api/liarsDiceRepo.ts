/**
 * The Liar's Dice seam, over the room socket — Phase E's client half.
 *
 * It is the thinnest repo in the tree, and that is the point. Blackjack's repo answers each call
 * with the whole hand and the whole profile, because a solo table has no other road for the state
 * to arrive by. This one answers with nothing: the player is already subscribed to the room and to
 * their own seat, so the referee's reply to an action is simply "accepted", and the new table
 * arrives on the same two channels it arrives on for everyone else at the table. One code path for
 * "the match moved", not two — the same reason UNO routes the host's own moves through the wire
 * rather than short-circuiting them locally.
 *
 * THERE IS NO LOCAL TWIN. `local/blackjackRepo.ts` exists so a fresh clone with no API can still
 * play blackjack, and that works because a solo game's referee can honestly live in the tab. This
 * game's referee cannot: a local dealer would be one player's browser holding everyone's dice,
 * which is the arrangement this whole phase exists to refuse. So the game is online-only by
 * construction, and its manifest says so rather than degrading into something weaker that looks
 * the same.
 */
import type { RoomSocket } from '@/system/repo/api/socket';
import type {
  LiarsDiceActionInput,
  LiarsDiceRepo,
  LiarsDiceStartInput,
  RepoResult,
} from '@/system/repo/types';

/** A socket reply, narrowed to the `RepoResult<void>` the seam speaks. */
function asResult(reply: { ok: true; value?: unknown } | { ok: false; error: string }): RepoResult<void> {
  return reply.ok ? { ok: true, value: undefined } : { ok: false, error: reply.error };
}

export function apiLiarsDiceRepo(socket: RoomSocket): LiarsDiceRepo {
  return {
    async start(gameId, roomId, input: LiarsDiceStartInput) {
      return asResult(
        await socket.request({
          t: 'ldStart',
          gameId,
          roomId,
          nonce: input.nonce,
          anteCents: input.anteCents,
        })
      );
    },

    async act(gameId, roomId, input: LiarsDiceActionInput) {
      return asResult(
        await socket.request({
          t: 'ldAction',
          gameId,
          roomId,
          nonce: input.nonce,
          action: input.action,
        })
      );
    },
  };
}
