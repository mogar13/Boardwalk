import {
  limitToLast,
  onValue,
  orderByKey,
  query,
  ref,
  remove as dbRemove,
  set,
} from 'firebase/database';
import { firebaseDb } from '@/system/repo/firebase/app';
import { messageKey } from '@/system/chat/messageKey';
import type { ChatMessage } from '@/system/chat/types';
import type { ChatRepo, RepoResult, Unsubscribe } from '@/system/repo/types';

/**
 * `chat/<gameId>/<roomId>` — room chat, behind the seam. Separate from `roomRepo` because a
 * message and a game state have different shapes, lifetimes and RULES: a message's `uid` is
 * pinned to `auth.uid` by `database.rules.json` so an author cannot be forged, which is the fix
 * for v1's exact bug (chat trusted a client-asserted identity — and a client-asserted `isDev`
 * badge alongside it).
 *
 * A message is filed under its ordering KEY (`messageKey`), not a `push()` id, so RTDB returns
 * messages already in send order and the client never re-sorts — the "never order by wall-clock"
 * rule the room's `seq` enforces, applied to chat.
 */

/**
 * Exported for `roomRepo.armDisconnect`, which arms the crash-recovery teardown as ONE atomic
 * multi-path write and therefore has to name the chat node alongside the room and hands nodes.
 * Sequential deletes cannot do this job: every one of those three delete rules authorises against
 * `rooms/<g>/<r>/meta/host`, so whichever delete lands first takes the host check away from the
 * others and they orphan. In a single update every rule evaluates against the PRE-write root.
 */
export const CHAT = (g: string, r: string) => `chat/${g}/${r}`;

/**
 * Per-sender tiebreak so two messages in the same millisecond get distinct keys. Module-level and
 * monotonic; it only has to be unique within THIS client's stream (the key's timestamp separates
 * clients), so a plain counter is enough and no coordination is needed.
 */
let counter = 0;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Wire → domain, defensively: a malformed child becomes a message with empty fields, never a crash. */
function readMessages(wire: unknown): ChatMessage[] {
  if (typeof wire !== 'object' || wire === null) return [];
  return (
    Object.entries(wire as Record<string, unknown>)
      .map(([id, raw]) => {
        const m = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
        return { uid: str(m.uid), name: str(m.name), text: str(m.text), key: str(m.key) || id };
      })
      // The keys already sort into send order; sorting here makes that independent of the object's
      // enumeration order rather than trusting it.
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  );
}

export const firebaseChatRepo: ChatRepo = {
  async send(gameId, roomId, message): Promise<RepoResult<void>> {
    const key = messageKey(Date.now(), counter);
    counter += 1;
    // The message is filed AT its key. `uid` is written as the sender's own — the rules refuse it
    // otherwise, so this is the only value that can succeed. A rejection (offline, rate-limited) is
    // returned as a value, not thrown: `send` is a `RepoResult` method (types.ts) and its one caller
    // (`useChat`) fires it as `void`, so a thrown rejection would be an unhandled promise rejection.
    try {
      await set(ref(firebaseDb(), `${CHAT(gameId, roomId)}/${key}`), {
        uid: message.uid,
        name: message.name,
        text: message.text,
        key,
      });
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: 'Message not sent.' };
    }
  },

  subscribe(gameId, roomId, listener, limit): Unsubscribe {
    // orderByKey + limitToLast: the last `limit` messages, in key (send) order, straight from the
    // server. No client-side windowing, no growing-forever listener.
    const q = query(ref(firebaseDb(), CHAT(gameId, roomId)), orderByKey(), limitToLast(limit));
    return onValue(q, (snap) => {
      listener(readMessages(snap.val()));
    });
  },

  async clear(gameId, roomId): Promise<void> {
    const chatRef = ref(firebaseDb(), CHAT(gameId, roomId));
    await dbRemove(chatRef).catch(() => set(chatRef, null));
  },
};
