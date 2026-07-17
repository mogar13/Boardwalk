/**
 * The multiplayer pure logic — seats, ordering, lifecycle — proven without a room or a game in
 * sight. This is the phase's mitigation for building `useRoom` before its Phase 6 caller exists:
 * the correctness lives HERE, in functions a game will call but that need no game to be right,
 * exactly the way Phase 4 put the economy's correctness in `applyResult` before a game bet a chip.
 */
import { describe, expect, it } from 'vitest';
import {
  aiSeatsToDrive,
  claimSeat,
  emptyTable,
  firstClaimableIndex,
  humanCount,
  isMyTurn,
  localSeatIds,
  mySeatIndex,
  releaseSeat,
  tableIsFull,
} from '@/system/room/seats';
import { applyIfFresh, isFresh, nextSeq } from '@/system/room/ordering';
import { teardownPlan } from '@/system/room/lifecycle';
import type { RoomSnapshot, Seat } from '@/system/room/types';

const ME = 'uid-me';
const YOU = 'uid-you';

const human = (uid: string, name = uid): Seat => ({ kind: 'human', name, uid });
const ai = (name = 'CPU'): Seat => ({ kind: 'ai', name, uid: null });
const open = (): Seat => ({ kind: 'open', name: '', uid: null });

describe('emptyTable', () => {
  it('is N open seats, and does not alias one object across the array', () => {
    const seats = emptyTable(3);
    expect(seats).toHaveLength(3);
    expect(seats.every((s) => s.kind === 'open')).toBe(true);
    // A `.fill({})` bug would make all three the same reference — mutating one would move all.
    expect(seats[0]).not.toBe(seats[1]);
  });
});

describe('firstClaimableIndex — open before ai', () => {
  it('takes the first open seat when one exists', () => {
    expect(firstClaimableIndex([human(YOU), open(), ai()])).toBe(1);
  });

  it('falls back to the first ai seat only when no seat is open', () => {
    expect(firstClaimableIndex([human(YOU), ai(), ai()])).toBe(1);
  });

  it('is -1 when every seat is held by a human', () => {
    expect(firstClaimableIndex([human(YOU), human(ME)])).toBe(-1);
  });
});

describe('claimSeat — the pure half of claim-then-verify', () => {
  it('seats a human in an open chair and does not mutate the input', () => {
    const before = [open(), open()];
    const result = claimSeat(before, 0, { uid: ME, name: 'Me' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seats[0]).toEqual({ kind: 'human', name: 'Me', uid: ME });
    expect(before[0]?.kind).toBe('open'); // input untouched
  });

  it('can claim an ai seat — that is what keeps drop-in working', () => {
    const result = claimSeat([ai()], 0, { uid: ME, name: 'Me' });
    expect(result.ok).toBe(true);
  });

  it('refuses a seat another human already holds — "taken", not a throw', () => {
    const result = claimSeat([human(YOU)], 0, { uid: ME, name: 'Me' });
    expect(result).toEqual({ ok: false, reason: 'taken' });
  });

  it('refuses an out-of-range index', () => {
    const result = claimSeat([open()], 5, { uid: ME, name: 'Me' });
    expect(result).toEqual({ ok: false, reason: 'out-of-range' });
  });
});

describe('releaseSeat — the fallback is the whole point', () => {
  it("hands a leaving human's seat back to an AI so the table stays alive", () => {
    const next = releaseSeat([human(ME, 'Me')], 0, 'ai');
    expect(next[0]).toEqual({ kind: 'ai', name: 'Me', uid: null });
  });

  it('opens the seat instead when asked — the lobby case', () => {
    const next = releaseSeat([human(ME, 'Me')], 0, 'open');
    expect(next[0]).toEqual({ kind: 'open', name: '', uid: null });
  });

  it('never mutates the input array', () => {
    const before = [human(ME)];
    releaseSeat(before, 0, 'ai');
    expect(before[0]?.kind).toBe('human');
  });
});

describe('localSeatIds — three modes, one seat array', () => {
  // A 3-seat table: me, you, and a bot.
  const seats = [human(ME), human(YOU), ai()];

  it('online / vs-AI (not shared): only my own human seat', () => {
    expect(localSeatIds({ seats, myUid: ME, sharedScreen: false })).toEqual([0]);
  });

  it('hot-seat (shared screen): every human seat, so the local click follows the turn', () => {
    // The Monopoly bug: an un-attributed click belongs to whoever's turn it is, not always the
    // first human. Both human seats are local; the AI seat is not (it is driven, not clicked).
    expect(localSeatIds({ seats, myUid: ME, sharedScreen: true })).toEqual([0, 1]);
  });

  it('never includes an AI seat, in either mode', () => {
    expect(localSeatIds({ seats, myUid: ME, sharedScreen: true })).not.toContain(2);
    expect(localSeatIds({ seats, myUid: ME, sharedScreen: false })).not.toContain(2);
  });
});

describe('isMyTurn — the same predicate in all three modes', () => {
  const seats = [human(ME), human(YOU)];
  it('is true when the current seat is one I control', () => {
    const mine = localSeatIds({ seats, myUid: ME, sharedScreen: false });
    expect(isMyTurn(mine, 0)).toBe(true);
    expect(isMyTurn(mine, 1)).toBe(false);
  });
  it('follows the turn across both seats in hot-seat', () => {
    const mine = localSeatIds({ seats, myUid: ME, sharedScreen: true });
    expect(isMyTurn(mine, 0)).toBe(true);
    expect(isMyTurn(mine, 1)).toBe(true);
  });
});

describe('aiSeatsToDrive — the host, and only the host, runs the bots', () => {
  const seats = [human(ME), ai(), ai()];
  it('is every AI seat when I am the host', () => {
    expect(aiSeatsToDrive(seats, true)).toEqual([1, 2]);
  });
  it('is empty when I am not the host — a guest never fights the host for a bot move', () => {
    expect(aiSeatsToDrive(seats, false)).toEqual([]);
  });
});

describe('mySeatIndex / tableIsFull / humanCount', () => {
  const seats = [human(YOU), open(), ai(), human(ME)];
  it('finds my seat by uid', () => {
    expect(mySeatIndex(seats, ME)).toBe(3);
    expect(mySeatIndex(seats, 'nobody')).toBe(-1);
  });
  it('is not full while an open seat remains', () => {
    expect(tableIsFull(seats)).toBe(false);
    expect(tableIsFull([human(ME), ai()])).toBe(true);
  });
  it('counts only humans', () => {
    expect(humanCount(seats)).toBe(2);
  });
});

describe('ordering — never by wall-clock', () => {
  it('nextSeq only ever adds one', () => {
    expect(nextSeq(0)).toBe(1);
    expect(nextSeq(41)).toBe(42);
  });

  it('isFresh is strictly-greater: an equal seq (a redelivered write) is stale', () => {
    expect(isFresh(5, 4)).toBe(true);
    expect(isFresh(5, 5)).toBe(false);
    expect(isFresh(4, 5)).toBe(false);
  });

  it('applyIfFresh keeps the newer of two values regardless of arrival order', () => {
    const s3 = { value: 'three', seq: 3 };
    const s5 = { value: 'five', seq: 5 };
    // A late packet carrying seq 3 cannot clobber the seq 5 already shown.
    expect(applyIfFresh(s5, s3)).toBe(s5);
    // A genuine advance is taken.
    expect(applyIfFresh(s3, s5)).toBe(s5);
  });

  it('survives a shuffled delivery order and lands on the highest seq', () => {
    const deliveries = [
      { value: 'a', seq: 1 },
      { value: 'd', seq: 4 },
      { value: 'b', seq: 2 },
      { value: 'c', seq: 3 },
      { value: 'd-again', seq: 4 }, // duplicate, must not replace
    ];
    let current = { value: 'seed', seq: 0 };
    for (const d of deliveries) current = applyIfFresh(current, d);
    expect(current).toEqual({ value: 'd', seq: 4 });
  });
});

describe('teardownPlan — only the host clears shared state', () => {
  const snap = (
    host: string,
    presence: Record<string, true>,
    seats: Seat[]
  ): RoomSnapshot<unknown> => ({
    meta: { host, status: 'playing', createdAt: 0, seq: 1 },
    seats,
    state: null,
    presence,
  });

  it('a guest clears only their presence and their seat — never chat, never the room', () => {
    const s = snap(YOU, { [ME]: true, [YOU]: true }, [human(YOU), human(ME)]);
    const plan = teardownPlan(s, ME);
    expect(plan).toContainEqual({ target: 'presence' });
    expect(plan).toContainEqual({ target: 'seat', seatIndex: 1 });
    expect(plan).not.toContainEqual({ target: 'chat' });
    expect(plan.some((p) => p.target === 'room')).toBe(false);
  });

  it('the host also clears chat', () => {
    const s = snap(ME, { [ME]: true, [YOU]: true }, [human(ME), human(YOU)]);
    const plan = teardownPlan(s, ME);
    expect(plan).toContainEqual({ target: 'chat' });
    // ...but NOT the room, because someone else is still present.
    expect(plan.some((p) => p.target === 'room')).toBe(false);
  });

  it('the last host out removes the whole room', () => {
    const s = snap(ME, { [ME]: true }, [human(ME), ai()]);
    const plan = teardownPlan(s, ME);
    expect(plan).toContainEqual({ target: 'room' });
    // ...and does NOT also release the seat: that write is a read-then-write which, racing the
    // room delete, can re-create a seat leaf under a room with no meta — an unremovable orphan.
    // Removing the room frees the seat. (Regression guard for the zombie-room race.)
    expect(plan.some((p) => p.target === 'seat')).toBe(false);
  });

  it('omits the seat step when I hold no seat (a spectator leaving)', () => {
    const s = snap(YOU, { [ME]: true, [YOU]: true }, [human(YOU), ai()]);
    const plan = teardownPlan(s, ME);
    expect(plan.some((p) => p.target === 'seat')).toBe(false);
  });
});
