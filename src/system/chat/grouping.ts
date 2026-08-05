import type { ChatMessage } from '@/system/chat/types';

/**
 * HOW A CHAT LOG IS READ, as pure functions — the shape half of the ordering `messageKey` already
 * owns. A room's chat is a flat list of every message ever sent, and rendered one-line-per-message
 * with the author repeated each time, it grows out of the panel and off the page: a player firing
 * the same line twelve times costs twelve names, twelve lines and twelve times the height, for one
 * fact ("they said that, a lot").
 *
 * Two collapses, and the line between them is ORDER — neither may make the log claim something that
 * did not happen:
 *
 *   1. CONSECUTIVE messages from one author share a name. The name is written once, above the run.
 *   2. Within such a run, IDENTICAL messages in a row become one line and a repeat count.
 *
 * Both are strictly local: a different author in between breaks a run, and a different message in
 * between breaks a repeat. Collapsing across a gap would be the obvious "tidier" version and it is
 * a lie — two people alternating would render as two solid blocks and the conversation would read
 * in an order nobody sent it in. That is the same rule the OS enforces on room state with `seq` and
 * on chat with `messageKey`: the log's job is to say what happened, in the order it happened.
 *
 * No clock anywhere, deliberately. Grouping "by time window" is the usual chat idiom and it is
 * unavailable here on purpose — a client picks its own `ts`, and CLAUDE.md's rule is that nothing
 * orders by wall-clock. Adjacency is a property of the ORDER, which the key already guarantees.
 */

export interface ChatLine {
  /** The key of the FIRST message on this line — stable across the repeats that fold into it. */
  readonly key: string;
  readonly text: string;
  /** How many times in a row this exact text was sent. `1` for an ordinary message. */
  readonly repeat: number;
}

export interface ChatGroup {
  /** The key of the message that opened the run. Stable as long as the run's head is. */
  readonly key: string;
  readonly uid: string;
  /** The author's name as of the message that opened the run. */
  readonly name: string;
  readonly lines: readonly ChatLine[];
}

/**
 * Fold an ordered message list into author runs. Input order is preserved exactly and the input is
 * never mutated; messages are expected in send order (which is what `messageKey` sorting gives).
 */
export function groupMessages(messages: readonly ChatMessage[]): readonly ChatGroup[] {
  const groups: { key: string; uid: string; name: string; lines: ChatLine[] }[] = [];

  for (const message of messages) {
    const run = groups[groups.length - 1];

    // A different author ends the run — including the same person under a new account, since a
    // name is denormalized copy and `uid` is the thing the rules pin.
    if (run === undefined || run.uid !== message.uid) {
      groups.push({
        key: message.key,
        uid: message.uid,
        name: message.name,
        lines: [{ key: message.key, text: message.text, repeat: 1 }],
      });
      continue;
    }

    const last = run.lines[run.lines.length - 1];
    if (last !== undefined && last.text === message.text) {
      run.lines[run.lines.length - 1] = { ...last, repeat: last.repeat + 1 };
      continue;
    }

    run.lines.push({ key: message.key, text: message.text, repeat: 1 });
  }

  return groups;
}
