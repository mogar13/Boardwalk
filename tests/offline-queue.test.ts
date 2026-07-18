import { describe, expect, it } from 'vitest';
import { TICKET_BATCH, TICKET_LOW } from '@boardwalk/game-logic';
import {
  OFFLINE_STORAGE_KEY,
  OUTBOX_CAP,
  addTickets,
  emptyOffline,
  enqueue,
  needsTopUp,
  parseOffline,
  resolve,
  restamp,
  serializeOffline,
  takeTicket,
  topUpWant,
  type OfflineState,
  type QueuedSettle,
  type SettleIntent,
} from '@/system/offline/queue';

/**
 * The pure half of offline banking. The wire half is guarded server-side
 * (`boardwalk-api/tests/tickets.test.ts`, where the replay attack is demonstrated end to end).
 */

const settle = (nonce: string, gameId = 'chess'): SettleIntent => ({
  kind: 'settle',
  nonce,
  gameId,
  outcome: 'win',
  payoutCents: 0,
});

const entry = (nonce: string, stampedAt = 1000): QueuedSettle => ({ intent: settle(nonce), stampedAt });

const withTickets = (n: number): OfflineState =>
  addTickets(
    { ...emptyOffline('dev-1'), enabled: true },
    Array.from({ length: n }, (_, i) => `t${String(i)}`)
  );

describe('the ticket book', () => {
  it('spends in issue order', () => {
    const first = takeTicket(withTickets(3));
    expect(first?.ticket).toBe('t0');
    expect(first?.state.tickets).toEqual(['t1', 't2']);
  });

  it('RETURNS NULL WHEN EXHAUSTED — it never mints its own', () => {
    // The bound, as a type-level fact: there is no branch here that produces a nonce. An exhausted
    // client stops banking; it does not fall back to inventing one.
    expect(takeTicket(withTickets(0))).toBeNull();
  });

  it('never holds more than a batch, even if the server over-grants', () => {
    const state = addTickets(withTickets(TICKET_BATCH), ['extra-1', 'extra-2']);
    expect(state.tickets).toHaveLength(TICKET_BATCH);
  });

  it('tops up below the low-water mark and not above it', () => {
    expect(needsTopUp(withTickets(TICKET_LOW))).toBe(false);
    expect(needsTopUp(withTickets(TICKET_LOW - 1))).toBe(true);
    expect(topUpWant(withTickets(TICKET_LOW))).toBe(TICKET_BATCH - TICKET_LOW);
  });

  it('stops asking once the server says tickets are not required', () => {
    expect(needsTopUp({ ...withTickets(0), enabled: false })).toBe(false);
    // …but an UNKNOWN server (never asked) must still ask, or the first settle after sign-in
    // would go out with a self-minted nonce and eat a 409 on a server that does enforce.
    expect(needsTopUp({ ...withTickets(0), enabled: null })).toBe(true);
  });
});

describe('the outbox', () => {
  it('banks in order and resolves by nonce', () => {
    let state = enqueue(enqueue(emptyOffline('d'), entry('a')), entry('b'));
    expect(state.queue.map((e) => e.intent.nonce)).toEqual(['a', 'b']);
    state = resolve(state, 'a');
    expect(state.queue.map((e) => e.intent.nonce)).toEqual(['b']);
  });

  it('resolving something absent is a no-op, not a throw (a double-flush is normal)', () => {
    const state = enqueue(emptyOffline('d'), entry('a'));
    expect(resolve(state, 'nope').queue).toHaveLength(1);
  });

  it('drops the OLDEST at the cap', () => {
    let state = emptyOffline('d');
    for (let i = 0; i < OUTBOX_CAP + 3; i += 1) state = enqueue(state, entry(`n${String(i)}`));
    expect(state.queue).toHaveLength(OUTBOX_CAP);
    expect(state.queue[0]?.intent.nonce).toBe('n3');
    expect(state.queue.at(-1)?.intent.nonce).toBe(`n${String(OUTBOX_CAP + 2)}`);
  });

  it('the cap is the batch — one bound, not two', () => {
    expect(OUTBOX_CAP).toBe(TICKET_BATCH);
  });
});

describe('re-stamping a retired ticket', () => {
  it('swaps the nonce, spends exactly one ticket, and keeps the queue position', () => {
    const state = enqueue(enqueue(withTickets(2), entry('old')), entry('other'));
    const out = restamp(state, 'old');
    expect(out).not.toBeNull();
    expect(out?.intent.nonce).toBe('t0');
    expect(out?.state.tickets).toEqual(['t1']);
    expect(out?.state.queue.map((e) => e.intent.nonce)).toEqual(['t0', 'other']);
    // The payload is otherwise untouched — a re-stamp changes the coupon, never the result.
    expect(out?.state.queue[0]?.intent).toMatchObject({ gameId: 'chess', outcome: 'win' });
  });

  it('refuses when there is no ticket to re-stamp with, rather than retrying forever', () => {
    expect(restamp(enqueue(withTickets(0), entry('old')), 'old')).toBeNull();
  });

  it('refuses for an entry that is not queued', () => {
    expect(restamp(withTickets(2), 'ghost')).toBeNull();
  });
});

describe('persistence', () => {
  it('round-trips', () => {
    const state = enqueue(withTickets(3), entry('a', 42));
    expect(parseOffline(serializeOffline(state), 'other')).toEqual(state);
  });

  it('keeps the PERSISTED device id over a freshly generated one', () => {
    // Losing this would renumber the device on every load, orphaning every outstanding ticket.
    const state = { ...emptyOffline('sticky'), enabled: true };
    expect(parseOffline(serializeOffline(state), 'brand-new').deviceId).toBe('sticky');
  });

  it('degrades to empty on garbage rather than throwing', () => {
    // This runs at boot on data a user can edit. A throw here is an app that will not start.
    for (const raw of ['', '{', 'null', '[]', '{"tickets":"nope"}', '{"queue":5}']) {
      expect(() => parseOffline(raw, 'd')).not.toThrow();
      expect(parseOffline(raw, 'd').queue).toEqual([]);
    }
    expect(parseOffline(null, 'd')).toEqual(emptyOffline('d'));
  });

  it('drops queue entries that are not well-formed settles', () => {
    const raw = JSON.stringify({
      deviceId: 'd',
      enabled: true,
      tickets: ['t0', 7, null],
      queue: [
        { intent: { kind: 'settle', nonce: 'ok', gameId: 'chess', outcome: 'win', payoutCents: 0 }, stampedAt: 1 },
        { intent: { kind: 'purchase', nonce: 'x', itemId: 'i' }, stampedAt: 1 }, // not a settle
        { intent: { kind: 'settle', nonce: '', gameId: 'chess', outcome: 'win', payoutCents: 0 }, stampedAt: 1 },
        { intent: { kind: 'settle', nonce: 'n', gameId: 'chess', outcome: 'sideways', payoutCents: 0 }, stampedAt: 1 },
        { intent: { kind: 'settle', nonce: 'n', gameId: 'chess', outcome: 'win', payoutCents: 0 } }, // no stamp
      ],
    });
    const state = parseOffline(raw, 'fallback');
    expect(state.queue.map((e) => e.intent.nonce)).toEqual(['ok']);
    expect(state.tickets).toEqual(['t0']);
  });

  it('a hostile payload cannot smuggle a non-settle intent into the outbox', () => {
    // The outbox is the one place an intent is replayed from storage, so it is the one place a
    // hand-edited localStorage could try to introduce a `purchase` or a `daily`.
    const raw = JSON.stringify({
      deviceId: 'd',
      queue: [{ intent: { kind: 'daily', nonce: 'free-money' }, stampedAt: 1 }],
    });
    expect(parseOffline(raw, 'd').queue).toEqual([]);
  });

  it('clamps an over-long persisted queue and ticket book', () => {
    const raw = JSON.stringify({
      deviceId: 'd',
      tickets: Array.from({ length: 500 }, (_, i) => `t${String(i)}`),
      queue: Array.from({ length: 500 }, (_, i) => entry(`n${String(i)}`)),
    });
    const state = parseOffline(raw, 'd');
    expect(state.tickets).toHaveLength(TICKET_BATCH);
    expect(state.queue).toHaveLength(OUTBOX_CAP);
    // Kept the NEWEST results, same direction as the live cap.
    expect(state.queue.at(-1)?.intent.nonce).toBe('n499');
  });

  it('the storage key is versioned', () => {
    expect(OFFLINE_STORAGE_KEY).toMatch(/\.v\d+$/);
  });
});
