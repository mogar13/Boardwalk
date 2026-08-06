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
  tableSizeChoices,
} from '@/system/room/seats';
import { registry } from '@/games/registry';
import { ANTE_RUNGS_CENTS, anteChoices, DEFAULT_ANTE_CENTS } from '@/system/room/ante';
import { STARTING_BANKROLL_CENTS } from '@boardwalk/game-logic';
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
    // A zero-seat table is not "full" — `[].every` is vacuously true, so this is the guard.
    expect(tableIsFull([])).toBe(false);
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
    meta: { host, status: 'playing', createdAt: 0, seq: 1, anteCents: 0, houseRules: {} },
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

/**
 * HOW BIG A TABLE THE HOST MAY BUILD. Before this, the lobby created every room at `seats.max` and
 * `canStart` demands a FULL table — so `seats.min` was decoration, and a game declaring 2–7 had
 * exactly one real size. The declaration is the source of truth now, which is why the last test
 * reads the REAL registry rather than a fixture: a manifest whose range is a single number gets no
 * control, and that has to be a fact about the manifest, not about a hand-written example.
 */
describe('tableSizeChoices', () => {
  it('offers every size in the range, inclusive', () => {
    expect(tableSizeChoices({ min: 2, max: 7 })).toEqual([2, 3, 4, 5, 6, 7]);
    expect(tableSizeChoices({ min: 2, max: 3 })).toEqual([2, 3]);
  });

  it('offers NOTHING when the range holds one size', () => {
    // Chess. A picker with one button is a control that cannot change the outcome, which is worse
    // than no control — the same reason the visibility toggle is hidden on an AI table.
    expect(tableSizeChoices({ min: 2, max: 2 })).toEqual([]);
  });

  it('collapses a nonsensical range instead of producing a broken picker', () => {
    expect(tableSizeChoices({ min: 5, max: 2 })).toEqual([]); // reversed
    expect(tableSizeChoices({ min: 0, max: 4 })).toEqual([]); // a zero-seat table
    expect(tableSizeChoices({ min: 2.5, max: 6 })).toEqual([]); // half a player
    expect(tableSizeChoices({ min: Number.NaN, max: 6 })).toEqual([]);
  });

  it('every choice it offers is a table the lobby can actually start', () => {
    // `canStart` needs a FULL table with at least one human, so every offered size must be at
    // least 1 (a chair for the host) and within the manifest's own declared bounds. A picker that
    // offers a size the game refuses is a Start button that never lights up.
    for (const { manifest } of Object.values(registry)) {
      for (const n of tableSizeChoices(manifest.seats)) {
        expect(n).toBeGreaterThanOrEqual(manifest.seats.min);
        expect(n).toBeLessThanOrEqual(manifest.seats.max);
        expect(tableIsFull(emptyTable(n).map(() => human(ME)))).toBe(true);
      }
    }
  });
});

describe('anteChoices — what a chair may cost', () => {
  it('always offers "nothing", and offers it first', () => {
    // `betting` on a manifest means a game CAN be played for money, never that it must be. A picker
    // with no zero rung turns a betting game into a gambling-only one — and zero is also the
    // default, because money must never leave an account because a control went unnoticed.
    expect(anteChoices({ min: 100, max: 100_000 })[0]).toBe(0);
    expect(anteChoices(undefined)).toEqual([0]);
    expect(DEFAULT_ANTE_CENTS).toBe(0);
  });

  it('offers exactly the rungs inside the range, ascending', () => {
    // UNO's declared range reproduces v1's own ladder: NONE / $25 / $100 / $500 / $1K.
    expect(anteChoices({ min: 2_500, max: 100_000 })).toEqual([0, 2_500, 10_000, 50_000, 100_000]);
    expect(anteChoices({ min: 100, max: 2_500 })).toEqual([0, 100, 500, 2_500]);
  });

  it('collapses to a control that draws nothing when the range admits no rung', () => {
    // `tableSizeChoices`'s rule: one option is a control that cannot change the outcome. The lobby
    // gates on `length > 1`, so this is what "draw no ante picker at all" looks like.
    expect(anteChoices({ min: 1, max: 99 })).toEqual([0]);
    expect(anteChoices({ min: 200_000, max: 300_000 })).toEqual([0]);
  });

  it('collapses garbage rather than rendering a broken picker', () => {
    expect(anteChoices({ min: 50_000, max: 100 })).toEqual([0]); // reversed
    expect(anteChoices({ min: Number.NaN, max: 100_000 })).toEqual([0]);
    expect(anteChoices({ min: 100, max: Number.POSITIVE_INFINITY })).toEqual([0]);
  });

  it('the rungs ascend and never repeat, which is the whole of a readable picker', () => {
    // A ladder out of order does not throw — it renders its buttons in the wrong order forever.
    // The same shape of rot `rankForLevel`'s ascending-ladder invariant exists to catch.
    for (let i = 1; i < ANTE_RUNGS_CENTS.length; i += 1) {
      expect(ANTE_RUNGS_CENTS[i]).toBeGreaterThan(ANTE_RUNGS_CENTS[i - 1] as number);
    }
  });

  it('every stake it offers is integer cents a fresh account could cover — read off the REAL registry', () => {
    // Two failures, both of which typecheck and neither of which throws:
    //   • a fractional rung — `validateBet` REFUSES a fractional bet rather than rounding it (v1's
    //     `parseInt` dropped blackjack's 3:2 chip), so the Create button would fail at the exact
    //     moment money moved;
    //   • a rung above the opening bankroll — a betting mode nobody can ever open, which is the
    //     seat-picker rule ("every size it offers is one the lobby can actually start") in money.
    for (const { manifest } of Object.values(registry)) {
      for (const cents of anteChoices(manifest.betting)) {
        expect(Number.isInteger(cents)).toBe(true);
        expect(cents).toBeGreaterThanOrEqual(0);
        expect(cents).toBeLessThanOrEqual(STARTING_BANKROLL_CENTS);
      }
    }
  });
});
