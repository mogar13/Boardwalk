/**
 * WHERE THE CHAIRS SIT — the arc, pinned.
 *
 * `seatArc` is the whole reason a blackjack table stops rendering as a wrapped flex row, and every
 * way it can be wrong produces a picture that looks completely fine. A layout that places a seat
 * twice draws a table with a duplicate player; one that drops a seat draws a table that is simply
 * missing somebody, and neither throws, logs, or fails a typecheck. That is the same argument
 * `tests/uno-layout.test.ts` makes for its own lookup, and it is why the geometry is a pure
 * function rather than class names inline in the board.
 *
 * Sizes are read off the REAL registry rather than a fixture, so what is asserted is a fact about
 * the game this app actually ships: get `seats` wrong in the manifest and this goes red here
 * rather than in a browser.
 */
import { describe, it, expect } from 'vitest';
import { seatArc } from '@/games/blackjack/seatLayout';
import { registry } from '@/games/registry';

/** Every table size blackjack can actually be dealt at — the solo hand plus the lobby's range. */
function declaredSizes(): number[] {
  const seats = registry.find((g) => g.manifest.id === 'blackjack')?.manifest.seats;
  if (seats === undefined) throw new Error('blackjack is not registered');
  const sizes = [1]; // the room-less hand: one chair, no lobby
  for (let n = seats.min; n <= seats.max; n += 1) sizes.push(n);
  return sizes;
}

describe('seatArc — every chair, exactly once', () => {
  it('places each seat once and only once, in seat order, at every size the game deals', () => {
    for (const count of declaredSizes()) {
      const slots = seatArc(count);
      expect(slots, `size ${String(count)}`).toHaveLength(count);
      // Array order IS seat order — the property that makes reading the table left to right read
      // the order of play, and the one that would silently break if this ever started rotating
      // the arc to centre the local player the way UNO's circular layout does.
      expect(slots.map((s) => s.seat)).toEqual(Array.from({ length: count }, (_, i) => i));
    }
  });

  it('never invents a seat that is not at the table', () => {
    for (const count of declaredSizes()) {
      for (const slot of seatArc(count)) {
        expect(slot.seat).toBeGreaterThanOrEqual(0);
        expect(slot.seat).toBeLessThan(count);
      }
    }
  });
});

describe('seatArc — the curve', () => {
  it('is symmetric: the two ends of the arc sit at the same height', () => {
    for (const count of declaredSizes()) {
      const drops = seatArc(count).map((s) => s.dropRem);
      for (let i = 0; i < drops.length; i += 1) {
        const mirrored = drops[drops.length - 1 - i];
        expect(drops[i], `size ${String(count)}, seat ${String(i)}`).toBeCloseTo(
          mirrored ?? -1,
          10
        );
      }
    }
  });

  it('runs DEEPEST in the middle — the half-moon, not a bowl the wrong way up', () => {
    // The dealer stands at the straight edge, so a chair in the middle of the arc is furthest from
    // it and lowest on screen. Inverting this is a one-character edit (`1 - t*t` → `t*t`) that
    // renders a perfectly tidy table with the curve bending the wrong way.
    for (const count of declaredSizes()) {
      const drops = seatArc(count).map((s) => s.dropRem);
      const deepest = Math.max(...drops);
      const middle = drops[Math.floor((drops.length - 1) / 2)];
      expect(middle, `size ${String(count)}`).toBeCloseTo(deepest, 10);
      // and the ends are the shallowest
      expect(drops[0]).toBeCloseTo(Math.min(...drops), 10);
    }
  });

  it('rises monotonically from the middle out to each end', () => {
    for (const count of declaredSizes()) {
      const drops = seatArc(count).map((s) => s.dropRem);
      const mid = (drops.length - 1) / 2;
      for (let i = 1; i < drops.length; i += 1) {
        const prev = drops[i - 1] ?? 0;
        const here = drops[i] ?? 0;
        // Left half descends toward the middle; right half climbs back out.
        if (i <= mid)
          expect(here, `size ${String(count)} seat ${String(i)}`).toBeGreaterThanOrEqual(
            prev - 1e-9
          );
        else
          expect(here, `size ${String(count)} seat ${String(i)}`).toBeLessThanOrEqual(prev + 1e-9);
      }
    }
  });

  it('keeps every chair ON the curve — including the smallest table', () => {
    // THE `ARC_SPAN` CASE. At a span of exactly 1 the outermost chairs land where the drop is
    // zero, so a two-handed table — the smallest this game deals — would sit both players on the
    // flat, level with the dealer, with no curve between them at all. That renders as two hands in
    // a row, which is the thing this module exists to stop.
    for (const count of declaredSizes()) {
      for (const slot of seatArc(count)) {
        expect(slot.dropRem, `size ${String(count)} seat ${String(slot.seat)}`).toBeGreaterThan(0);
      }
    }
  });

  it('seats a solo hand at the deepest point of the arc', () => {
    const slots = seatArc(1);
    expect(slots).toHaveLength(1);
    expect(slots[0]?.seat).toBe(0);
    // The same depth the middle of a bigger table gets — one player sits at the front of the arc.
    const four = seatArc(4).map((s) => s.dropRem);
    expect(slots[0]?.dropRem).toBeGreaterThanOrEqual(Math.max(...four));
  });
});

describe('seatArc — degradations', () => {
  it('answers an empty table rather than throwing', () => {
    // Reachable from a room snapshot that has not loaded yet. A board that draws no chairs for a
    // beat recovers on the next frame; one that throws takes the page down.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(seatArc(bad), String(bad)).toEqual([]);
    }
  });

  it('floors a fractional count instead of producing a fractional seat index', () => {
    expect(seatArc(3.7).map((s) => s.seat)).toEqual([0, 1, 2]);
  });

  it('hands back a fresh array each call — it is read in render', () => {
    expect(seatArc(4)).not.toBe(seatArc(4));
    expect(seatArc(4)).toEqual(seatArc(4));
  });
});
