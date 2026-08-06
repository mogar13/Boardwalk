/**
 * UNO's seam to the referee — `apiLiarsDiceRepo` with one field missing, and the missing field is
 * the design.
 *
 * `start` does not take a stake. It cannot: the table's ante is stamped on the room at create and
 * the referee reads it from there, so there is no argument here for a client to fill in and no
 * frame field for one to travel in. A repo that accepted an `anteCents` would be a repo whose
 * caller could charge a table more than it agreed to, and the point of a dealt game is that the
 * client says nothing about the money.
 *
 * There is deliberately NO local/Firebase twin. Blackjack has one because a solo hand can be dealt
 * by a reducer; UNO cannot, because the only client-side dealer available is one player's browser
 * holding everybody's hand — which is exactly what this replaced. `repos.uno` is `null` without the
 * game server, and the board says so rather than degrading into a game it cannot honestly play.
 */
import type { RoomSocket } from '@/system/repo/api/socket';
import type {
  Profile,
  RepoResult,
  UnoMoveInput,
  UnoRepo,
  UnoStartInput,
} from '@/system/repo/types';

/**
 * A socket reply, narrowed to the profile the seam answers with.
 *
 * The referee always has a profile for an authenticated caller, so a null here means something is
 * wrong rather than "no profile" — surfaced as a refusal instead of being adopted, because adopting
 * a null would blank a live top bar.
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

export function apiUnoRepo(socket: RoomSocket): UnoRepo {
  return {
    async start(gameId, roomId, input: UnoStartInput) {
      return asResult(
        await socket.request({
          t: 'unoStart',
          gameId,
          roomId,
          nonce: input.nonce,
          // A difficulty, and the only thing this frame carries that a client chose. It cannot move
          // a chip; the ante — which can — is not here.
          level: input.level,
        })
      );
    },

    async move(gameId, roomId, input: UnoMoveInput) {
      return asResult(
        await socket.request({
          t: 'unoMove',
          gameId,
          roomId,
          nonce: input.nonce,
          move: input.move,
        })
      );
    },
  };
}
