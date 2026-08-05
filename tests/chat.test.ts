/**
 * The chat ordering key. The one property that matters — ASCII sort of the keys equals send
 * order — proven directly, because it is the property v1 paid for and the reason the key is a
 * padded string and not a number.
 *
 * Plus the log's SHAPE (`groupMessages`), which is the same property one level up: both collapses
 * are local, so neither can render a conversation in an order nobody sent it in.
 */
import { describe, expect, it } from 'vitest';
import { groupMessages } from '@/system/chat/grouping';
import type { ChatMessage } from '@/system/chat/types';
import { MAX_MESSAGE_LENGTH, messageKey, sanitizeMessage } from '@/system/chat/messageKey';

describe('messageKey — ASCII sort equals send order', () => {
  it('orders two messages by timestamp', () => {
    const a = messageKey(1_000, 0);
    const b = messageKey(2_000, 0);
    expect(a < b).toBe(true);
  });

  it('breaks a same-millisecond tie by counter', () => {
    const a = messageKey(1_000, 0);
    const b = messageKey(1_000, 1);
    expect(a < b).toBe(true);
    expect(a).not.toBe(b);
  });

  it('sorts a larger timestamp after a smaller one AS TEXT — the fixed-width trick', () => {
    // The whole reason for padding: as raw numbers-in-strings, "10000" < "9000" lexically.
    // Padded to a fixed width, the later time sorts later.
    const earlier = messageKey(9_000, 0);
    const later = messageKey(10_000, 0);
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('produces a fixed-length key regardless of magnitude', () => {
    expect(messageKey(1, 1)).toHaveLength(messageKey(999_999_999_999, 999_999).length);
  });

  it('a realistic shuffled batch sorts back into send order', () => {
    const now = 1_700_000_000_000;
    const sent = [
      messageKey(now, 0),
      messageKey(now, 1),
      messageKey(now + 5, 0),
      messageKey(now + 5, 1),
      messageKey(now + 200, 0),
    ];
    const shuffled = [sent[3], sent[0], sent[4], sent[1], sent[2]];
    expect(shuffled.slice().sort()).toEqual(sent);
  });

  it('floors fractional inputs rather than producing a ragged key', () => {
    expect(messageKey(1_000.9, 2.9)).toBe(messageKey(1_000, 2));
  });

  it('wraps the counter within its width rather than overflowing the key length', () => {
    // Counter is mod 10^6; a millionth message in one ms wraps to 0 rather than widening the key.
    expect(messageKey(1_000, 1_000_000)).toBe(messageKey(1_000, 0));
  });
});

describe('sanitizeMessage', () => {
  it('trims surrounding whitespace', () => {
    expect(sanitizeMessage('  hi  ')).toBe('hi');
  });

  it('rejects an all-whitespace message as null, not a blank row', () => {
    expect(sanitizeMessage('   ')).toBeNull();
    expect(sanitizeMessage('')).toBeNull();
  });

  it('truncates a long paste to the cap rather than bouncing it', () => {
    const long = 'x'.repeat(MAX_MESSAGE_LENGTH + 50);
    expect(sanitizeMessage(long)).toHaveLength(MAX_MESSAGE_LENGTH);
  });
});

describe('groupMessages — a long log said short, without lying about the order', () => {
  let n = 0;
  const msg = (uid: string, text: string, name = uid): ChatMessage => ({
    uid,
    name,
    text,
    key: messageKey(1_700_000_000_000 + (n += 1), n),
  });

  it('writes one name over a run of messages from the same author', () => {
    const groups = groupMessages([msg('a', 'one'), msg('a', 'two'), msg('a', 'three')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe('a');
    expect(groups[0]?.lines.map((l) => l.text)).toEqual(['one', 'two', 'three']);
  });

  it('collapses a run of IDENTICAL messages to one line and a count', () => {
    // The case that prompted this: twelve of the same line is twelve names and twelve lines of
    // height for one fact. Note the count, not the lines.
    const groups = groupMessages(Array.from({ length: 12 }, () => msg('a', 'same')));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.lines).toHaveLength(1);
    expect(groups[0]?.lines[0]?.repeat).toBe(12);
    expect(groups[0]?.lines[0]?.text).toBe('same');
  });

  it('never collapses across another author — the order stays honest', () => {
    // A→B→A is three runs, not "A twice then B". Collapsing across the gap is the tidier-looking
    // version and it renders a conversation nobody had.
    const groups = groupMessages([msg('a', 'hi'), msg('b', 'hi'), msg('a', 'hi')]);
    expect(groups.map((g) => g.uid)).toEqual(['a', 'b', 'a']);
    expect(groups.every((g) => g.lines.length === 1 && g.lines[0]?.repeat === 1)).toBe(true);
  });

  it('never collapses repeats separated by a different message from the same author', () => {
    const groups = groupMessages([msg('a', 'hi'), msg('a', 'bye'), msg('a', 'hi')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.lines.map((l) => [l.text, l.repeat])).toEqual([
      ['hi', 1],
      ['bye', 1],
      ['hi', 1],
    ]);
  });

  it('groups on uid, not on the display name — a name is copy, a uid is pinned', () => {
    // Two accounts may share a name (nothing stops it), and one account may have renamed between
    // messages. `uid` is the field `database.rules.json` pins to `auth.uid`; the name is not.
    const shared = groupMessages([msg('a', 'x', 'mogar'), msg('b', 'y', 'mogar')]);
    expect(shared).toHaveLength(2);
    const renamed = groupMessages([msg('a', 'x', 'old'), msg('a', 'y', 'new')]);
    expect(renamed).toHaveLength(1);
    expect(renamed[0]?.name).toBe('old'); // the run's head names it
  });

  it('keys every group among its siblings, and every line among its own', () => {
    // React only needs a key unique among SIBLINGS, which is exactly what this asserts — a group
    // deliberately shares the key of its first line, since both name the same message.
    const groups = groupMessages([
      msg('a', 'one'),
      msg('a', 'one'),
      msg('a', 'two'),
      msg('b', 'two'),
    ]);
    const groupKeys = groups.map((g) => g.key);
    expect(new Set(groupKeys).size).toBe(groupKeys.length);
    for (const g of groups) {
      const lineKeys = g.lines.map((l) => l.key);
      expect(new Set(lineKeys).size).toBe(lineKeys.length);
    }
    // A folded repeat keeps the key of the message that OPENED it, so the line does not remount
    // (and lose its place on screen) every time somebody says the same thing again.
    expect(groups[0]?.lines[0]?.key).toBe(groups[0]?.key);
  });

  it('returns nothing for an empty log, and does not mutate its input', () => {
    expect(groupMessages([])).toEqual([]);
    const input = [msg('a', 'one'), msg('a', 'one')];
    const copy = structuredClone(input);
    groupMessages(input);
    expect(input).toEqual(copy);
  });
});
