import { describe, expect, it } from 'vitest';
import { handOverlapRem, opponentSlots, slotsOn } from '@/games/uno/seatLayout';

/**
 * WHERE EVERYONE SITS. The board's layout is the half of v1's UNO that a wrapping row of opponents
 * cannot reproduce, and it is worth a test rather than an eyeball because the failures are quiet:
 * a seat rendered twice, a seat rendered nowhere, or a table whose reading order is not the order
 * of play all LOOK like a table. Only counting them catches it.
 */

describe('opponentSlots', () => {
  it('seats every opponent exactly once, at every table size', () => {
    for (let n = 2; n <= 7; n += 1) {
      for (let me = 0; me < n; me += 1) {
        const slots = opponentSlots(me, n);
        const seated = slots.map((s) => s.seat);
        expect(seated).toHaveLength(n - 1);
        expect(new Set(seated).size).toBe(n - 1); // nobody twice
        expect(seated).not.toContain(me); // and never yourself
        expect(seated.every((s) => s >= 0 && s < n)).toBe(true);
      }
    }
  });

  it('reproduces v1s three fixed arrangements', () => {
    // Heads-up: one opponent, directly opposite.
    expect(opponentSlots(0, 2)).toEqual([{ seat: 1, side: 'top' }]);
    // Three-handed: flanking, nobody opposite.
    expect(opponentSlots(0, 3).map((s) => s.side)).toEqual(['left', 'right']);
    // Four-handed: left, top, right.
    expect(opponentSlots(0, 4).map((s) => s.side)).toEqual(['left', 'top', 'right']);
  });

  it('runs bottom → left → top → right, so reading clockwise is reading turn order', () => {
    // Seat 0 is me; play reaches 1, then 2, then 3. The next player up sits at the BOTTOM of the
    // left column, which is why `left` comes out reversed — a flex column renders top-down.
    const slots = opponentSlots(0, 4);
    expect(slots).toEqual([
      { seat: 1, side: 'left' },
      { seat: 2, side: 'top' },
      { seat: 3, side: 'right' },
    ]);
  });

  it('orders a two-deep column with the next player nearest you', () => {
    // Six opponents: two per side. Play reaches 1 then 2 up the left, so 2 renders ABOVE 1.
    const left = slotsOn(opponentSlots(0, 7), 'left').map((s) => s.seat);
    expect(left).toEqual([2, 1]);
  });

  it('is relative to my seat, not absolute', () => {
    // Sitting at seat 2 of four, play reaches 3, 0, 1 — the same shape, rotated.
    expect(opponentSlots(2, 4)).toEqual([
      { seat: 3, side: 'left' },
      { seat: 0, side: 'top' },
      { seat: 1, side: 'right' },
    ]);
  });

  it('balances the sides at every size (no side more than one deeper than another)', () => {
    for (let n = 2; n <= 7; n += 1) {
      const slots = opponentSlots(0, n);
      const left = slotsOn(slots, 'left').length;
      const right = slotsOn(slots, 'right').length;
      // The two columns always match — a lopsided table is the thing an "even distribution"
      // formula got wrong at five seats, which is why this is a lookup.
      expect(left).toBe(right);
    }
  });

  it('degrades rather than throwing: a spectator reads the table, a lone seat has no opponents', () => {
    expect(opponentSlots(-1, 4)).toHaveLength(3); // no seat of my own → read it from seat 0
    expect(opponentSlots(0, 1)).toEqual([]);
    expect(opponentSlots(0, 0)).toEqual([]);
    expect(opponentSlots(9, 3)).toHaveLength(2); // a seat off the end of the table
  });

  it('slotsOn partitions the slots and loses none', () => {
    const slots = opponentSlots(0, 7);
    const parts = [...slotsOn(slots, 'left'), ...slotsOn(slots, 'top'), ...slotsOn(slots, 'right')];
    expect(parts).toHaveLength(slots.length);
    expect(new Set(parts.map((s) => s.seat)).size).toBe(slots.length);
  });
});

describe('handOverlapRem', () => {
  it('is loose for a comfortable hand and tightens as the hand grows', () => {
    const seven = handOverlapRem(7);
    const fifteen = handOverlapRem(15);
    expect(fifteen).toBeGreaterThan(seven);
  });

  it('never tightens past the point where a card is a stripe', () => {
    // The property that matters: no hand size, however silly, collapses the fan.
    for (let n = 0; n <= 60; n += 1) {
      const overlap = handOverlapRem(n);
      expect(overlap).toBeGreaterThanOrEqual(2.1);
      expect(overlap).toBeLessThanOrEqual(3.5);
    }
  });

  it('keeps the opening hand of seven at the loosest setting', () => {
    // The deal is what people see first, and seven cards fit without tightening at all.
    expect(handOverlapRem(7)).toBe(2.1);
  });
});
