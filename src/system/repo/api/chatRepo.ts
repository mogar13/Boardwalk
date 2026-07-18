import type { RoomSocket, Reply } from '@/system/repo/api/socket';
import type { ChatMessage } from '@/system/chat/types';
import type { ChatRepo, RepoResult, Unsubscribe } from '@/system/repo/types';

/**
 * Room chat over the WebSocket referee (BACKEND_PLAN.md Phase C) — the server-authoritative twin of
 * `firebase/chatRepo`, same interface, so the swap touches only the composition root.
 *
 * The referee stamps the ordering key and PINS the author to the socket's verified uid (the v1
 * forged-author fix, previously a `database.rules.json` rule, now the gateway's job), so this file
 * sends `{ uid, name, text }` and never computes a key — `messageKey` is the server's now, one clock,
 * no cross-client skew.
 */

function asResult(reply: Reply): RepoResult<void> {
  return reply.ok ? { ok: true, value: undefined } : { ok: false, error: reply.error };
}

export function apiChatRepo(socket: RoomSocket): ChatRepo {
  return {
    async send(gameId, roomId, message): Promise<RepoResult<void>> {
      // A rejected send (offline, forged author, empty) is a value the composer shows, not a throw.
      const reply = await socket.request({ t: 'chatSend', gameId, roomId, message });
      return asResult(reply);
    },

    subscribe(
      gameId,
      roomId,
      listener: (messages: readonly ChatMessage[]) => void,
      limit: number
    ): Unsubscribe {
      return socket.subscribeChat(gameId, roomId, listener, limit);
    },

    async clear(gameId, roomId): Promise<void> {
      // Host-gated but idempotent at the server (a non-host is a no-op ok), so never throws.
      await socket.request({ t: 'chatClear', gameId, roomId });
    },
  };
}
