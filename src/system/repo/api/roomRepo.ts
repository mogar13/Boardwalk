import type { RoomSocket, Reply } from '@/system/repo/api/socket';
import type { OpenTable, RoomSnapshot } from '@/system/room/types';
import type { RepoResult, RoomRepo, Unsubscribe } from '@/system/repo/types';

/**
 * The `RoomRepo` over the WebSocket referee (BACKEND_PLAN.md Phase C) — the server-authoritative
 * replacement for `firebase/roomRepo`, built against the SAME interface so the composition root swaps
 * one for the other and no game, hook, or component is touched. That is the whole payoff of the seam.
 *
 * The referee ARBITRATES rather than reconciles, which simplifies this file against the Firebase one:
 *   • `claimSeat` — the server holds the single seat array and applies the claim atomically, so the
 *     claim-then-verify re-read (and its lost-race handling) is gone; the reply IS the truth.
 *   • `patchState` — the server owns `seq` and bumps it on write. There is no client transaction, so
 *     the producer runs HERE against the last snapshot this socket saw (`latestState`), and the
 *     result is sent as plain data. Turn-based play has one writer at a time, so last-write-wins on
 *     data is correct; ordering is still the server's monotonic seq, never a wall clock.
 *   • hidden hands live in the server's per-room `privates`, delivered to the owning seat only — the
 *     same owner-only guarantee `hands/` gave via rules, now enforced by never SENDING the frame.
 */

/** Map a reply to a `RepoResult<T>` — the shape create/claimSeat promise. */
function asResult<T>(reply: Reply): RepoResult<T> {
  return reply.ok ? { ok: true, value: reply.value as T } : { ok: false, error: reply.error };
}

/** A void op: resolve on success, throw on refusal — mirroring a Firebase write rejected by a rule. */
function asVoid(reply: Reply): void {
  if (!reply.ok) throw new Error(reply.error);
}

export function apiRoomRepo(socket: RoomSocket): RoomRepo {
  return {
    async create(gameId, init): Promise<RepoResult<string>> {
      const reply = await socket.request({
        t: 'create',
        gameId,
        host: init.host,
        seatCount: init.seatCount,
        visibility: init.visibility,
      });
      return asResult<string>(reply);
    },

    subscribe<TPublic>(
      gameId: string,
      roomId: string,
      listener: (snapshot: RoomSnapshot<TPublic> | null) => void
    ): Unsubscribe {
      return socket.subscribeRoom(gameId, roomId, (snap) =>
        listener(snap as RoomSnapshot<TPublic> | null)
      );
    },

    subscribeOpenTables(listener: (tables: readonly OpenTable[]) => void): Unsubscribe {
      return socket.subscribeOpen(listener);
    },

    async claimSeat(gameId, roomId, index, who): Promise<RepoResult<void>> {
      const reply = await socket.request({ t: 'claimSeat', gameId, roomId, index, who });
      return asResult<void>(reply);
    },

    async releaseSeat(gameId, roomId, index, fallback): Promise<void> {
      // Idempotent at the server (a non-owner is a no-op ok), so never throws — resolve regardless.
      await socket.request({ t: 'releaseSeat', gameId, roomId, index, fallback });
    },

    async setAi(gameId, roomId, index, name): Promise<void> {
      asVoid(await socket.request({ t: 'setAi', gameId, roomId, index, name }));
    },

    async patchState<TPublic>(
      gameId: string,
      roomId: string,
      produce: (prev: TPublic | null) => TPublic
    ): Promise<void> {
      // No client transaction — the server owns seq. Apply the producer to the last snapshot this
      // socket saw and send the result; the server bumps seq atomically with the write.
      const prev = socket.latestState(gameId, roomId) as TPublic | null;
      const data = produce(prev);
      asVoid(await socket.request({ t: 'patchState', gameId, roomId, data }));
    },

    async setStatus(gameId, roomId, status): Promise<void> {
      asVoid(await socket.request({ t: 'setStatus', gameId, roomId, status }));
    },

    async writePrivate<TPrivate>(
      gameId: string,
      roomId: string,
      index: number,
      data: TPrivate
    ): Promise<void> {
      asVoid(await socket.request({ t: 'writePrivate', gameId, roomId, index, data }));
    },

    subscribePrivate<TPrivate>(
      gameId: string,
      roomId: string,
      index: number,
      listener: (data: TPrivate | null) => void
    ): Unsubscribe {
      return socket.subscribePrivate(gameId, roomId, index, (data) =>
        listener((data ?? null) as TPrivate | null)
      );
    },

    trackPresence(gameId, roomId, _uid): Unsubscribe {
      // The server takes the uid from the verified socket, not this argument — the same anti-forgery
      // reason the gateway ignores a client-asserted identity everywhere else.
      return socket.trackPresence(gameId, roomId);
    },

    armDisconnect(): void {
      // DELIBERATE NO-OP. The gateway owns crash recovery on this path: it sees the socket die,
      // and it is the arbiter of seats, so it releases them itself — with a grace period a client
      // could not implement, since the client in question is the one that vanished. Arming
      // anything here would be the second implementation of the leave rule that
      // plans/done/CRASH_RECOVERY.md exists to avoid, and it would race the server that is already
      // doing the job.
    },

    async remove(gameId, roomId): Promise<void> {
      // Host-gated but idempotent at the server (a non-host is a no-op ok), so never throws.
      await socket.request({ t: 'remove', gameId, roomId });
    },
  };
}
