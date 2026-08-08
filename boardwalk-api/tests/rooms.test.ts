import { describe, expect, it } from 'vitest';
import { RoomStore } from '../src/rooms/store';
import { claimSeat, emptyTable, fillWithAi, releaseSeat, seatsHeldBy } from '../src/rooms/seats';
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

  it('fillWithAi seats the house in the empty chairs and leaves the taken ones alone', () => {
    const seated = claimSeat(emptyTable(4), 0, ada);
    if (!seated.ok) throw new Error('setup');
    const filled = fillWithAi(seated.seats);
    // One-based, matching what `SeatList` writes when a host fills a chair by hand: the two paths
    // seat the same table, so a chair must not be called "CPU 2" by one and "CPU 1" by the other.
    expect(filled).toEqual([
      { kind: 'human', name: 'Ada', uid: 'ada' },
      { kind: 'ai', name: 'CPU 2', uid: null },
      { kind: 'ai', name: 'CPU 3', uid: null },
      { kind: 'ai', name: 'CPU 4', uid: null },
    ]);
    // The input is untouched — every seat function here returns a new array.
    expect(seated.seats[1]).toEqual({ kind: 'open', name: '', uid: null });
  });

  it('fillWithAi never displaces a human and never renames a bot that is already sitting', () => {
    // The second half is not tidiness: a mid-game leaver's chair is released to `'ai'` CARRYING
    // their display name, so relabelling it "CPU 3" would erase who had been sitting there.
    const seats = [
      { kind: 'human' as const, name: 'Ada', uid: 'ada' },
      { kind: 'human' as const, name: 'Bob', uid: 'bob' },
      { kind: 'ai' as const, name: 'Cleo', uid: null },
      { kind: 'open' as const, name: '', uid: null },
    ];
    expect(fillWithAi(seats)).toEqual([
      { kind: 'human', name: 'Ada', uid: 'ada' },
      { kind: 'human', name: 'Bob', uid: 'bob' },
      { kind: 'ai', name: 'Cleo', uid: null },
      { kind: 'ai', name: 'CPU 4', uid: null },
    ]);
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
    // A table created with no stake plays for nothing, and one that agreed to no house rules plays
    // the game as it comes — which between them is every table of every game but UNO today.
    expect(snap?.meta).toEqual({
      host: 'ada',
      status: 'waiting',
      createdAt: 1_000,
      seq: 0,
      anteCents: 0,
      houseRules: {},
    });
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

  /**
   * THE STAKE IS STAMPED AT CREATE AND VISIBLE TO EVERYONE.
   *
   * A guest has to know what a chair costs before sitting in it, and game state is `null` until the
   * host deals — so if the ante travelled in the projection, the money would have moved before the
   * number arrived. Being room meta is what lets the lobby price the table for a joiner.
   */
  it('stamps the host-chosen ante onto the room, where every subscriber can read it', () => {
    const store = fixedStore();
    const res = store.create('uno', ada, 4, 'public', 2_500);
    if (!res.ok) throw new Error(res.error);
    expect(store.snapshot('uno', res.roomId)?.meta.anteCents).toBe(2_500);
  });

  /**
   * A STAKE IS THE ONE NUMBER IN THIS SYSTEM A BROWSER GETS TO CHOOSE, so it is sanitised at the
   * only moment it crosses the wire. Money is integer cents everywhere — `bet.ts` REFUSES a
   * fractional bet rather than rounding it, for the reason v1's `parseInt` gave — and none of these
   * should be able to reach a ledger row.
   */
  it('floors a hostile stake to a non-negative integer rather than letting it reach the ledger', () => {
    const store = fixedStore();
    const stamp = (ante: number): number => {
      const res = store.create('uno', ada, 4, 'public', ante);
      if (!res.ok) throw new Error(res.error);
      return store.snapshot('uno', res.roomId)?.meta.anteCents ?? -1;
    };
    expect(stamp(2_500.9)).toBe(2_500); // a fractional chip
    expect(stamp(-5_000)).toBe(0); // a negative stake would PAY the table to sit down
    expect(stamp(Number.NaN)).toBe(0);
    expect(stamp(Number.POSITIVE_INFINITY)).toBe(0);
  });

  /**
   * The ante is write-once, and nothing exposes a setter. This is the property that makes "you
   * cannot raise the stakes on a player who already sat down" true by construction rather than by
   * anyone remembering — v1 pushed a retuned ante to the room on change, so the number you agreed
   * to was not necessarily the number you paid.
   */
  it('never changes once stamped — seats, status, state and presence all leave it alone', () => {
    const store = fixedStore();
    const res = store.create('uno', ada, 4, 'public', 10_000);
    if (!res.ok) throw new Error(res.error);
    const { roomId } = res;
    store.claimSeat('uno', roomId, 1, bob);
    store.setAi('uno', roomId, 2, 'CPU');
    store.addPresence('uno', roomId, bob.uid);
    store.patchState('uno', roomId, { anything: true });
    store.setStatus('uno', roomId, 'playing');
    expect(store.snapshot('uno', roomId)?.meta.anteCents).toBe(10_000);
  });

  /**
   * HOUSE RULES ARE THE ANTE'S SIBLING, and every property asserted for the stake above holds for
   * them with the money taken out and the fairness left in (plans/done/UNO_HOUSE_RULES.md §1).
   *
   * Slice 1 ships every rule OFF, so none of this changes what a hand does. What it fixes in place
   * is WHERE a rule lives: on the room, chosen once, readable by everyone, and not the property of
   * whoever presses Deal.
   */
  it('stamps the host-chosen house rules onto the room, where every subscriber can read them', () => {
    const store = fixedStore();
    const res = store.create('uno', ada, 4, 'public', 0, { stack: true });
    if (!res.ok) throw new Error(res.error);
    expect(store.snapshot('uno', res.roomId)?.meta.houseRules).toEqual({ stack: true });
    // And the dealer reads them from exactly there — never off a frame.
    expect(store.rulesOf('uno', res.roomId)).toEqual({ stack: true });
  });

  it('answers no rules for a room that does not exist, rather than undefined', () => {
    // `rulesOf` feeds a deal. A missing room reading as anything but "plays it straight" would be a
    // rule somebody's hand gets played under — the same failure `anteOf` returns `0` to avoid.
    expect(fixedStore().rulesOf('uno', 'ZZZZ')).toEqual({});
  });

  /**
   * A TABLE THAT COMES UP SEATED (plans/done/GAME_LAUNCH_MODAL.md §5.2).
   *
   * An AI table used to mean claiming a chair and then pressing "Add CPU" once per remaining seat
   * before Start would light — six clicks on a 7-seat UNO table, to play alone. `fillAi` seats them
   * in the same construction as the host, so the table is never observably half-filled.
   */
  it('seats the house in every chair but the host’s when the create asks for it', () => {
    const store = fixedStore();
    const res = store.create('uno', ada, 4, 'private', 0, undefined, true);
    if (!res.ok) throw new Error(res.error);
    const seats = store.snapshot('uno', res.roomId)?.seats;
    // The host is still seat 0 and still a human — filling chairs must not fill THEIRS.
    expect(seats?.[0]).toEqual({ kind: 'human', name: 'Ada', uid: 'ada' });
    expect(seats?.slice(1)).toEqual([
      { kind: 'ai', name: 'CPU 2', uid: null },
      { kind: 'ai', name: 'CPU 3', uid: null },
      { kind: 'ai', name: 'CPU 4', uid: null },
    ]);
  });

  /**
   * THE DEPLOY-ORDER CASE, and the reason this field is optional rather than required. A new client
   * always meets an old referee at some point, and the reverse: an absent `fillAi` must read as the
   * honest default — today's table of open chairs — not as anything a client has to remember to
   * turn OFF. Asserted alongside `false` and `undefined` so the default cannot drift to truthy.
   */
  it('an absent fillAi is no fill at all — the table this store made before the field existed', () => {
    const store = fixedStore();
    for (const fill of [undefined, false]) {
      const res = store.create('uno', ada, 3, 'public', 0, undefined, fill);
      if (!res.ok) throw new Error(res.error);
      expect(store.snapshot('uno', res.roomId)?.seats.slice(1)).toEqual([
        { kind: 'open', name: '', uid: null },
        { kind: 'open', name: '', uid: null },
      ]);
    }
  });

  /**
   * A ONE-CHAIR TABLE HAS NOTHING TO FILL, and asking must not invent a chair or throw. Reachable
   * today: Tic-Tac-Toe declares `seats: { min: 1, max: 2 }` and the lobby defaults to `min`
   * (§5.5 — the manifest fix is slice 2's, and this is the referee not caring either way).
   */
  it('fills nothing on a table with no other chairs', () => {
    const store = fixedStore();
    const res = store.create('tic-tac-toe', ada, 1, 'private', 0, undefined, true);
    if (!res.ok) throw new Error(res.error);
    expect(store.snapshot('tic-tac-toe', res.roomId)?.seats).toEqual([
      { kind: 'human', name: 'Ada', uid: 'ada' },
    ]);
  });

  it('defaults to no rules for a client that sends none', () => {
    const store = fixedStore();
    const res = store.create('uno', ada, 4, 'public', 0);
    if (!res.ok) throw new Error(res.error);
    expect(store.snapshot('uno', res.roomId)?.meta.houseRules).toEqual({});
  });

  /**
   * A RULE BAG IS A THING A BROWSER GETS TO CHOOSE, so its SHAPE is bounded at the one moment it
   * crosses the wire — the same place and for the same reason the stake is floored. The server
   * still does not interpret a key (that is the game's resolver's job, at the deal); it only
   * refuses to store, and re-broadcast on a PUBLIC listing, whatever a browser felt like sending.
   */
  it('bounds a hostile rule bag: only true booleans, sane ids, and a cap on how many', () => {
    const store = fixedStore();
    const stamp = (raw: unknown): Record<string, boolean> => {
      const res = store.create('uno', ada, 4, 'public', 0, raw);
      if (!res.ok) throw new Error(res.error);
      return { ...store.snapshot('uno', res.roomId)?.meta.houseRules };
    };
    // Only a literal `true` is on — an "off" rule takes no space, so every reader sees one
    // spelling of off and `{}` is the only way to say "nothing".
    expect(stamp({ stack: false, crossStack: 'yes', playToLast: 1 })).toEqual({});
    expect(stamp({ stack: true })).toEqual({ stack: true });
    // Not an object at all.
    for (const junk of [null, undefined, 42, 'stack', [{ stack: true }]]) {
      expect(stamp(junk)).toEqual({});
    }
    // A key cannot be a kilobyte of text, and there cannot be a thousand of them — a listing
    // frame's size is not a stranger's to choose.
    expect(stamp({ ['x'.repeat(33)]: true })).toEqual({});
    const flood = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`r${String(i)}`, true])
    );
    expect(Object.keys(stamp(flood))).toHaveLength(16);
  });

  /**
   * WRITE-ONCE, exactly as the ante is. This is what makes "nobody can change the game under a
   * player who already sat down" true by construction rather than by anyone remembering.
   *
   * It matters more than it looks: a table advertised as plain UNO that acquires stacking after a
   * guest takes a chair is a different game than the one they agreed to, and unlike a raised ante
   * it costs them nothing measurable — so nothing would ever surface it. Falsified by adding a
   * setter and calling it here.
   */
  it('never changes once stamped — seats, status, state and presence all leave them alone', () => {
    const store = fixedStore();
    const res = store.create('uno', ada, 4, 'public', 0, { stack: true, playToLast: true });
    if (!res.ok) throw new Error(res.error);
    const { roomId } = res;
    store.claimSeat('uno', roomId, 1, bob);
    store.setAi('uno', roomId, 2, 'CPU');
    store.addPresence('uno', roomId, bob.uid);
    store.patchState('uno', roomId, { anything: true, houseRules: { stack: false } });
    store.setStatus('uno', roomId, 'playing');
    expect(store.snapshot('uno', roomId)?.meta.houseRules).toEqual({
      stack: true,
      playToLast: true,
    });
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

/**
 * THE PUBLIC INDEX (V1_FEATURE_GAPS #9). Every case here is a table that must NOT be advertised,
 * because every one of them is a "Join" button that leads somewhere the player cannot sit — which
 * is precisely what v1's hub scanner did, listing rooms by existence and apologising with a
 * stale-room GC afterwards.
 */
describe('RoomStore — the open-table index', () => {
  /** Create a room AND declare presence, which is what makes it listable at all. */
  function live(store: RoomStore, gameId: string, visibility: 'public' | 'private' = 'public'): string {
    const res = store.create(gameId, ada, 4, visibility);
    if (!res.ok) throw new Error(res.error);
    store.addPresence(gameId, res.roomId, ada.uid);
    return res.roomId;
  }

  it('lists a waiting public table somebody is at, with the counts a joiner needs', () => {
    const store = fixedStore();
    const roomId = live(store, 'uno');
    store.claimSeat('uno', roomId, 1, bob);
    expect(store.listOpen()).toEqual([
      {
        gameId: 'uno',
        roomId,
        hostName: 'Ada',
        players: 2,
        openSeats: 2,
        seatCount: 4,
        anteCents: 0,
        houseRules: {},
        createdAt: 1_000,
      },
    ]);
  });

  /**
   * THE PRICE IS ON THE POSTER. The stake is the fact most likely to decide whether a stranger
   * sits down, so a listing that shows "3/4 seats" and not "$500 a hand" advertises the wrong
   * number — and the player finds out by losing the money.
   *
   * It is still a poster and not a window: a price, never a pot total, never a uid, never a roster.
   */
  it('carries the stake, so a browser can price a table before joining it', () => {
    const store = fixedStore();
    const res = store.create('uno', ada, 4, 'public', 50_000);
    if (!res.ok) throw new Error(res.error);
    store.addPresence('uno', res.roomId, ada.uid);
    const listing = store.listOpen()[0];
    expect(listing?.anteCents).toBe(50_000);
    // Still a poster: nothing about who is at the table or what they hold.
    expect(JSON.stringify(listing)).not.toContain('ada');
  });

  /**
   * AND SO ARE THE RULES, one step across from the price. "UNO" and "UNO with stacking and places"
   * are different enough games that it changes whether a stranger wants the chair — a browser that
   * lists the second as the first is advertising the wrong game, and the player finds out by being
   * dealt one they did not pick.
   */
  it('carries the house rules, so a browser can tell what game a table is playing', () => {
    const store = fixedStore();
    const res = store.create('uno', ada, 4, 'public', 0, { stack: true, crossStack: true });
    if (!res.ok) throw new Error(res.error);
    store.addPresence('uno', res.roomId, ada.uid);
    expect(store.listOpen()[0]?.houseRules).toEqual({ stack: true, crossStack: true });
  });

  it('drops a table the moment it starts — a listing that outlives the deal sends joiners at a game in progress', () => {
    const store = fixedStore();
    const roomId = live(store, 'uno');
    store.setStatus('uno', roomId, 'playing');
    expect(store.listOpen()).toEqual([]);
    store.setStatus('uno', roomId, 'finished');
    expect(store.listOpen()).toEqual([]);
  });

  it('never lists a private table — the code is the only way in', () => {
    const store = fixedStore();
    live(store, 'uno', 'private');
    expect(store.listOpen()).toEqual([]);
  });

  it('never lists a table nobody is present at (the ghost room v1 advertised)', () => {
    const store = fixedStore();
    const res = store.create('uno', ada, 4);
    if (!res.ok) throw new Error(res.error);
    // Created but nobody has declared presence yet, and the same shape a room takes in the window
    // between its last player leaving and the reaper collecting it.
    expect(store.listOpen()).toEqual([]);
    store.addPresence('uno', res.roomId, ada.uid);
    expect(store.listOpen()).toHaveLength(1);
    store.removePresence('uno', res.roomId, ada.uid);
    expect(store.listOpen()).toEqual([]);
  });

  it('counts an AI chair as joinable, because a person displaces the house', () => {
    const store = fixedStore();
    const roomId = live(store, 'uno');
    store.setAi('uno', roomId, 1, 'CPU 2');
    store.setAi('uno', roomId, 2, 'CPU 3');
    store.setAi('uno', roomId, 3, 'CPU 4');
    // A table padded with bots is exactly the table a browser exists to fill; counting only empty
    // chairs would hide it.
    expect(store.listOpen()[0]).toMatchObject({ players: 1, openSeats: 3, seatCount: 4 });
  });

  /**
   * A TABLE THAT CAME UP SEATED IS STILL A TABLE YOU CAN WALK UP TO. `fillAi` writes `ai` chairs,
   * and an `ai` chair is joinable (the test above), so an AI-filled table must be indistinguishable
   * from a hand-filled one to the index — same listing, same counts. The alternative, filling
   * chairs and thereby hiding the table, would make §5.4's "Fill with CPUs" a way to accidentally
   * take your own table off the board.
   */
  it('lists a table that came up bot-filled, exactly as if the chairs were filled by hand', () => {
    const store = fixedStore();
    const res = store.create('uno', ada, 4, 'public', 0, undefined, true);
    if (!res.ok) throw new Error(res.error);
    store.addPresence('uno', res.roomId, ada.uid);
    expect(store.listOpen()[0]).toMatchObject({ players: 1, openSeats: 3, seatCount: 4 });
  });

  it('drops a table with no claimable chair left', () => {
    const store = fixedStore();
    const res = store.create('chess', ada, 2);
    if (!res.ok) throw new Error(res.error);
    store.addPresence('chess', res.roomId, ada.uid);
    store.claimSeat('chess', res.roomId, 1, bob);
    expect(store.listOpen()).toEqual([]);
  });

  it('keeps naming the host after their seat is handed to a bot mid-grace', () => {
    // `hostName` is stamped at create rather than read out of seats[0], so a disconnect blip does
    // not relabel somebody's table "CPU".
    const store = fixedStore();
    const roomId = live(store, 'uno');
    store.releaseSeat('uno', roomId, 0, 'ai');
    expect(store.listOpen()[0]?.hostName).toBe('Ada');
  });

  it('orders newest first, breaking ties by code so an unchanged index is byte-stable', () => {
    let now = 1_000;
    const store = new RoomStore(() => now);
    const first = live(store, 'uno');
    now = 2_000;
    const second = live(store, 'chess');
    const list = store.listOpen();
    expect(list.map((r) => r.roomId)).toEqual([second, first]);
    expect(store.listOpen()).toEqual(list);
  });

  it('spans games — the index is global, and filtering to one is the reader’s business', () => {
    const store = fixedStore();
    live(store, 'uno');
    live(store, 'chess');
    expect(new Set(store.listOpen().map((r) => r.gameId))).toEqual(new Set(['uno', 'chess']));
  });
});
