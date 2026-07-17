import { useCallback, useEffect, useState } from 'react';
import { sanitizeMessage } from '@/system/chat/messageKey';
import type { ChatMessage } from '@/system/chat/types';
import { useProfile } from '@/system/profile/useProfile';
import { repos } from '@/system/repo';
import { useRoomContext } from '@/system/room/roomContext';

/**
 * `useChat()` — the room's chat. It owns its OWN subscription (chat is a separate node with
 * separate rules from game state), torn down on unmount like everything else here, and exposes the
 * messages plus a `send`.
 *
 * `send` sanitizes before it writes and drops an empty message rather than storing a blank row,
 * and it seats the message under the sender's real `uid` — which the rules pin to `auth.uid`, so a
 * forged author is refused at the server. That pin is the fix for v1's exact bug: chat trusted a
 * client-asserted identity, so anyone could forge who a message (and its dev badge) came from.
 */
const MESSAGE_LIMIT = 100;

export interface ChatApi {
  readonly messages: readonly ChatMessage[];
  /** Fire-and-forget: a chat send is not something a caller awaits. Empty input is dropped. */
  readonly send: (text: string) => void;
}

export function useChat(): ChatApi {
  const { identity } = useRoomContext();
  const { gameId, roomId, myUid } = identity;
  const myName = useProfile()?.name ?? 'Player';
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);

  useEffect(() => {
    return repos.chat.subscribe(gameId, roomId, setMessages, MESSAGE_LIMIT);
  }, [gameId, roomId]);

  const send = useCallback(
    (text: string) => {
      const clean = sanitizeMessage(text);
      if (clean === null) return;
      void repos.chat.send(gameId, roomId, { uid: myUid, name: myName, text: clean });
    },
    [gameId, roomId, myUid, myName]
  );

  return { messages, send };
}
