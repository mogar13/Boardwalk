/**
 * The chat ordering key, as pure functions. No Firebase, no React — `tests/chat.test.ts` proves
 * the ordering property in milliseconds.
 *
 * v1's chat key, carried over: `ts.padStart(15) + counter.padStart(6)`, so a plain ASCII sort of
 * the keys equals send order. Two reasons it is a string and not a numeric timestamp:
 *
 *   1. It is the RTDB KEY the message is filed under, and RTDB returns children in key order, so
 *      an ASCII-sortable key means "read the messages" already returns them sorted — no client
 *      re-sort, no `orderByChild`.
 *   2. Wall-clock alone is not enough: two messages in the same millisecond would collide on a
 *      pure-timestamp key and one would overwrite the other. The `counter` is a per-sender
 *      tiebreak that makes the key unique even inside one millisecond.
 *
 * This is NOT security and does not try to be — a client picks its own `ts`, so keys are
 * best-effort chronological, which is all a chat log needs. The message's `uid` is what the
 * rules pin; the key just orders.
 */

/** Epoch-ms fits in 13 digits until the year 2286; 15 leaves comfortable headroom. */
const TS_WIDTH = 15;
/** A per-sender counter; 6 digits is a million messages before it wraps within a millisecond. */
const COUNTER_WIDTH = 6;

/**
 * Build the key. Both parts zero-padded to a FIXED width, because ASCII sort only equals numeric
 * order when the strings are the same length — `"10" < "9"` as text, but `"0010" > "0009"`. The
 * fixed widths are the whole trick.
 */
export function messageKey(tsMs: number, counter: number): string {
  const ts = Math.max(0, Math.floor(tsMs));
  const c = Math.max(0, Math.floor(counter));
  return (
    String(ts).padStart(TS_WIDTH, '0') +
    String(c % 10 ** COUNTER_WIDTH).padStart(COUNTER_WIDTH, '0')
  );
}

/** Longest a chat message may be. Matches the `text` length cap in `database.rules.json`. */
export const MAX_MESSAGE_LENGTH = 500;

/**
 * Clean a message for storage: trim, and cap at `MAX_MESSAGE_LENGTH`. Returns `null` for a
 * message that is empty after trimming — an all-whitespace message is not a message, and the
 * caller drops it rather than storing a blank row. Capping here (not just refusing) means a long
 * paste is truncated to something sendable rather than bounced with an error mid-conversation.
 */
export function sanitizeMessage(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, MAX_MESSAGE_LENGTH);
}
