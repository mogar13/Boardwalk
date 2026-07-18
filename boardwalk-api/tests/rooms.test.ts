import { describe, expect, it } from 'vitest';
import { RoomStore } from '../src/rooms/store';
import { claimSeat, emptyTable, releaseSeat, seatsHeldBy } from '../src/rooms/seats';
import type { SeatOccupant } from '../src/rooms/types';

const ada: SeatOccupant = { uid: 'ada', name: 'Ada' };
const bob: SeatOccupant = { uid: 'bob', name: 'Bob' };

// A store with a fixed clock so keys/timestamps are deterministic in assertions.
const fixedStore = (t = 1_000): RoomStore => new RoomStore(() => t);

// Create a room and return its minted code — the common test preamble.
function room(store: RoomStore, seats = 4, host: SeatOccupant = ada): string {
  const res = store.create('chess', host, seats);
  if (!res.ok) throw new Error(res.error);
  return res.roomId;
}

describe('seats (pure)', () => {
  it('claims an open seat and never mutates the input', () => {
    const table = emptyTable(3);
    const claimed = claimSeat(table, 1, ada);
    expect(claimed.ok).toBe(true);
    if (claimed.ok) expect(claimed.seats[1]).toEqual({ kind: 'human', name: 'Ada', uid: 'ada' });
    expect(table[1]).toEqual({ kind: 'open', name: '', uid: null });
  });

  it('refuses another human seat (taken) and an out-of-range index', () => {
    const seated = claimSeat(emptyTable(2), 0, ada);
    if (!seated.ok) throw new Error('setup');
    expect(claimSeat(seated.seats, 0, bob)).toEqual({ ok: false, reason: 'taken' });
    expect(claimSeat(seated.seats, 5, bob)).toEqual({ ok: false, reason: 'out-of-range' });
  });

  it('re-claiming a seat you already hold is idempotent (a resend is harmless)', () => {
    const seated = claimSeat(emptyTable(2), 0, ada);
    if (!seated.ok) throw new Error('setup');
    const again = claimSeat(seated.seats, 0, ada);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.seats[0]).toEqual({ kind: 'human', name: 'Ada', uid: 'ada' });
  });

  it('claims an ai seat but only after an open one exists elsewhere', () => {
    // open-before-ai is the joiner rule; a claim at a specific ai index is still allowed.
    const seats = [
      { kind: 'ai' as const, name: 'CPU', uid: null },
      { kind: 'open' as const, name: '', uid: null },
    ];
    expect(claimSeat(seats, 0, ada).ok).toBe(true);
  });

  it('release becomes an AI mid-game and an open chair in the lobby', () => {
    const seated = claimSeat(emptyTable(2), 0, ada);
    if (!seated.ok) throw new Error('setup');
    expect(releaseSeat(seated.seats, 0, 'ai')[0]).toEqual({ kind: 'ai', name: 'Ada', uid: null });
    expect(releaseSeat(seated.seats, 0, 'open')[0]).toEqual({ kind: 'open', name: '', uid: null });
  });

  it('seatsHeldBy finds every seat a uid holds', () => {
    const seats = [
      { kind: 'human' as const, name: 'Ada', uid: 'ada' },
      { kind: 'ai' as const, name: 'CPU', uid: null },
      { kind: 'human' as const, name: 'Ada2', uid: 'ada' },
    ];
    expect(seatsHeldBy(seats, 'ada')).toEqual([0, 2]);
    expect(seatsHeldBy(seats, 'nobody')).toEqual([]);
  });
});

describe('RoomStore — create + snapshot', () => {
  it('mints a 4-char code, seats the host at 0, opens the rest', () => {
    const store = fixedStore();
    const roomId = room(store);
    expect(roomId).toMatch(/^[A-Z2-9]{4}$/);
    const snap = store.snapshot('chess', roomId);
    expect(snap?.meta).toEqual({ host: 'ada', status: 'waiting', createdAt: 1_000, seq: 0 });
    expect(snap?.seats[0]).toEqual({ kind: 'human', name: 'Ada', uid: 'ada' });
    expect(snap?.seats.slice(1)).toEqual([
      { kind: 'open', name: '', uid: null },
      { kind: 'open', name: '', uid: null },
      { kind: 'open', name: '', uid: null },
    ]);
    expect(snap?.state).toBeNull();
    expect(snap?.presence).toEqual({});
  });

  it('snapshot is null for a room that does not exist', () => {
    expect(fixedStore().snapshot('chess', 'ZZZZ')).toBeNull();
  });

  it('refuses a non-positive seat count', () => {
    expect(fixedStore().create('chess', ada, 0).ok).toBe(false);
  });
});

describe('RoomStore — seat arbitration', () => {
  it('the second claimant of the same open seat loses (the race dies server-side)', () => {
    const store = fixedStore();
    const roomId = room(store);
    expect(store.claimSeat('chess', roomId, 1, ada)).toEqual({ ok: true });
    expect(store.claimSeat('chess', roomId, 1, bob)).toEqual({ ok: false, error: 'taken' });
  });

  it('reports out-of-range and no-room distinctly', () => {
    const store = fixedStore();
    const roomId = room(store, 2);
    expect(store.claimSeat('chess', roomId, 9, bob)).toEqual({ ok: false, error: 'out-of-range' });
    expect(store.claimSeat('chess', 'ZZZZ', 0, bob)).toEqual({ ok: false, error: 'no-room' });
  });

  it('releaseSeat / setAi reshape the table', () => {
    const store = fixedStore();
    const roomId = room(store);
    store.claimSeat('chess', roomId, 1, bob);
    store.releaseSeat('chess', roomId, 1, 'ai');
    expect(store.snapshot('chess', roomId)?.seats[1]).toEqual({ kind: 'ai', name: 'Bob', uid: null });
    store.setAi('chess', roomId, 2, 'CPU 2');
    expect(store.snapshot('chess', roomId)?.seats[2]).toEqual({ kind: 'ai', name: 'CPU 2', uid: null });
    store.setAi('chess', roomId, 2, null);
    expect(store.snapshot('chess', roomId)?.seats[2]).toEqual({ kind: 'open', name: '', uid: null });
  });
});

describe('RoomStore — state ordering', () => {
  it('patchState bumps seq monotonically and stores the data', () => {
    const store = fixedStore();
    const roomId = room(store);
    store.patchState('chess', roomId, { fen: 'start' });
    expect(store.snapshot('chess', roomId)?.meta.seq).toBe(1);
    store.patchState('chess', roomId, { fen: 'e4' });
    const snap = store.snapshot('chess', roomId);
    expect(snap?.meta.seq).toBe(2);
    expect(snap?.state).toEqual({ fen: 'e4' });
  });

  it('setStatus moves the lifecycle', () => {
    const store = fixedStore();
    const roomId = room(store);
    store.setStatus('chess', roomId, 'playing');
    expect(store.snapshot('chess', roomId)?.meta.status).toBe('playing');
  });
});

describe('RoomStore — private hands', () => {
  it('stores and reads a per-seat private node, and it never appears in the public snapshot', () => {
    const store = fixedStore();
    const roomId = room(store);
    store.writePrivate('chess', roomId, 0, { hand: ['red-5'] });
    expect(store.getPrivate('chess', roomId, 0)).toEqual({ hand: ['red-5'] });
    expect(store.getPrivate('chess', roomId, 1)).toBeNull();
    // The public snapshot carries no hint of the hand.
    expect(JSON.stringify(store.snapshot('chess', roomId))).not.toContain('red-5');
  });
});

describe('RoomStore — presence + GC signal', () => {
  it('add/remove presence, and removing the last present uid signals GC', () => {
    const store = fixedStore();
    const roomId = room(store);
    store.addPresence('chess', roomId, 'ada');
    store.addPresence('chess', roomId, 'bob');
    expect(store.snapshot('chess', roomId)?.presence).toEqual({ ada: true, bob: true });
    expect(store.removePresence('chess', roomId, 'ada')).toBe(false);
    expect(store.removePresence('chess', roomId, 'bob')).toBe(true); // now empty ⇒ GC
  });
});

describe('RoomStore — chat', () => {
  it('stamps ascending keys in send order and returns the last N', () => {
    const store = new RoomStore(() => 42);
    const roomId = room(store);
    const a = store.chatSend('chess', roomId, { uid: 'ada', name: 'Ada', text: 'hi' });
    const b = store.chatSend('chess', roomId, { uid: 'bob', name: 'Bob', text: 'yo' });
    expect(a && b && a.key < b.key).toBe(true);
    expect(store.chatMessages('chess', roomId, 10).map((m) => m.text)).toEqual(['hi', 'yo']);
    expect(store.chatMessages('chess', roomId, 1).map((m) => m.text)).toEqual(['yo']);
  });

  it('clear empties the log', () => {
    const store = fixedStore();
    const roomId = room(store);
    store.chatSend('chess', roomId, { uid: 'ada', name: 'Ada', text: 'hi' });
    store.chatClear('chess', roomId);
    expect(store.chatMessages('chess', roomId, 10)).toEqual([]);
  });
});

describe('RoomStore — remove', () => {
  it('deletes the room so a later snapshot is null', () => {
    const store = fixedStore();
    const roomId = room(store);
    store.remove('chess', roomId);
    expect(store.snapshot('chess', roomId)).toBeNull();
    expect(store.has('chess', roomId)).toBe(false);
  });
});
