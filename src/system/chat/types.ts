/**
 * What a chat MESSAGE is. Domain shape, no Firebase — the wire shape (all-optional) lives in
 * `@/system/repo/firebase/chatRepo`, same split as everywhere else.
 */

export interface ChatMessage {
  /**
   * The author's account. Written as `auth.uid` and PINNED to it by `database.rules.json`
   * (`uid === auth.uid`), which is the fix for v1's exact bug: chat trusted a client-asserted
   * identity on every message, so anyone could forge who a message came from (and, in v1, a
   * `isDev` badge alongside it). Here the server refuses a message whose `uid` is not the
   * sender's, so a name in the chat is the name of the account that sent it.
   */
  readonly uid: string;
  /** The author's display name at send time. Denormalized so history renders without a lookup. */
  readonly name: string;
  /** The message text — sanitized (trimmed, length-capped) before it is ever stored. */
  readonly text: string;
  /**
   * The ordering key. An ASCII-sortable string (see `messageKey`), NOT a timestamp field, so
   * the client can sort by key and get send order without a clock comparison — the same "never
   * order by wall-clock" rule the room's `seq` enforces, applied to chat.
   */
  readonly key: string;
}
