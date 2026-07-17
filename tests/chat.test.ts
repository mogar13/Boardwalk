/**
 * The chat ordering key. The one property that matters — ASCII sort of the keys equals send
 * order — proven directly, because it is the property v1 paid for and the reason the key is a
 * padded string and not a number.
 */
import { describe, expect, it } from 'vitest';
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
