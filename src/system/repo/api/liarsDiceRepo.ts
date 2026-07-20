/**
 * The Liar's Dice seam, over the room socket — Phase E's client half.
 *
 * It is the thinnest repo in the tree. Blackjack's answers with the hand AND the profile, because
 * a solo table has no other road for either. This one answers with the profile ALONE: the new table
 * arrives over the room subscription and the player's own private node, on the same two channels it
 * reaches everyone else by, so there is one code path for "the match moved" rather than two — the
 * same reason UNO routes the host's own moves through the wire instead of short-circuiting them.
 *
 * The profile has to come back, though, and a first draft that answered `void` proved it the
 * expensive way: `start` takes every human's ante and a settling action pays the pot, and neither
 * of those travels over a room subscription.
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
  Profile,
  RepoResult,
} from '@/system/repo/types';

/**
 * A socket reply, narrowed to the profile the seam answers with.
 *
 * The referee always has a profile for an authenticated caller, so a null here means something is
 * wrong rather than "no profile" — it is surfaced as a refusal instead of being adopted, because
 * adopting a null would blank a live top bar.
 */
function asResult(reply: { ok: true; value?: unknown } | { ok: false; error: string }): RepoResult<Profile> {
  if (!reply.ok) return { ok: false, error: reply.error };
  const profile = reply.value as Profile | null | undefined;
  return profile == null
    ? { ok: false, error: 'The table answered without a profile.' }
    : { ok: true, value: profile };
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
