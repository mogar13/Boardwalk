/**
 * The multiplayer pure logic — seats, ordering, lifecycle — proven without a room or a game in
 * sight. This is the phase's mitigation for building `useRoom` before its Phase 6 caller exists:
 * the correctness lives HERE, in functions a game will call but that need no game to be right,
 * exactly the way Phase 4 put the economy's correctness in `applyResult` before a game bet a chip.
 */
import { describe, expect, it } from 'vitest';
import {
  aiSeatName,
  aiSeatsToDrive,
  claimSeat,
  emptyTable,
  firstClaimableIndex,
  humanCapacity,
  humanCount,
  isMyTurn,
  localSeatIds,
  localSeatName,
  mySeatIndex,
  plannedSeats,
  releaseSeat,
  tableIsFull,
  tableSizeChoices,
} from '@/system/room/seats';
import { registry } from '@/games/registry';
import { seatRangeFor } from '@/system/room/modes';
import { ANTE_RUNGS_CENTS, anteChoices, DEFAULT_ANTE_CENTS, parseAnte } from '@/system/room/ante';
import { STARTING_BANKROLL_CENTS, validateBet } from '@boardwalk/game-logic';
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
  it('counts an OPEN chair as a human this table could hold', () => {
    // `humanCapacity`'s whole reason to exist, and it only matters BEFORE the deal. A planned
    // online table is the host plus a row of open chairs, and `tableBacking` asked with
    // `humanCount` would answer "one human — the house banks this" and lock UNO's bot tier at
    // `sharp` on the strength of a guess that nobody else will ever join.
    expect(humanCapacity(seats)).toBe(3);
    expect(humanCapacity([human(ME), ai(), ai()])).toBe(1); // an AI table: no chair to walk into
    expect(humanCapacity([])).toBe(0);
  });
});

/**
 * A ROOM GAME HAS SOMEBODY OPPOSITE (plans/done/GAME_LAUNCH_MODAL.md §5.5) — stated as a rule over
 * the whole registry rather than as a fix to the one manifest that broke it, because the next game
 * to get this wrong will get it wrong the same way.
 *
 * Tic-Tac-Toe declared `{ min: 1, max: 2 }`, meaning "one human is enough" — true of the GAME and
 * false of the TABLE. `modes` already carries "you can play this alone" (`'ai'`), so conflating the
 * two put a 1 in a seat range, `tableSizeChoices` offered `[1, 2]`, the lobby defaults to
 * `seats.min`, and the default Tic-Tac-Toe table was ONE chair — which `tableIsFull` calls full and
 * `canStart` lights up, on a board whose `seats[1]` is `undefined`. It survived because the seat
 * picker was a small unlabelled row on a page nobody looked at twice.
 *
 * **IT USED TO SAY "AT LEAST TWO CHAIRS", AND THAT WAS THE RIGHT RULE COUNTED THE WRONG WAY.** The
 * property is an OPPONENT; chairs were merely how you counted one until Blackjack needed a table of
 * one. Its opponent is the dealer, who draws to 17, beats you or busts, and never takes a seat — so
 * a one-chair blackjack table has somebody opposite and a one-chair UNO table has a person alone in
 * a room. Counting chairs cannot tell those apart, and the cost of it not being able to was real:
 * when Blackjack's room-less `'solo'` mode was deleted, the two-chair minimum left the entrance
 * offering "Solo / AI" and then seating a bot beside you with no way to ask it to leave.
 *
 * So the manifest DECLARES `dealerPlays` and this asks for an opponent from either source. That is
 * `betting.house`'s shape — a fact only the game can know, declared rather than inferred — and the
 * bijection below is what stops it becoming decoration.
 *
 * A SOLO game is exempt by construction, not by exception: it never mounts a lobby at all.
 */
describe('every room game has somebody opposite', () => {
  const roomGames = registry.filter((g) => g.manifest.modes.some((m) => m !== 'solo'));

  it('has room games to be true of', () => {
    expect(roomGames.length).toBeGreaterThan(0);
  });

  it('declares a one-chair table only where a dealer plays', () => {
    for (const { manifest } of roomGames) {
      const floor = manifest.dealerPlays === true ? 1 : 2;
      expect(
        manifest.seats.min,
        `${manifest.id}: a room with one chair and no dealer is not a table`
      ).toBeGreaterThanOrEqual(floor);
      expect(manifest.seats.max, `${manifest.id}: max below min`).toBeGreaterThanOrEqual(
        manifest.seats.min
      );
    }
  });

  /**
   * THE BIJECTION, and it is what keeps `dealerPlays` from rotting into a flag somebody sets out of
   * politeness. Its ONLY effect is permitting a one-chair table, so a game that declares it and
   * still floors at two has declared nothing — the `loadout.color` failure, in a manifest — and a
   * game that floors at one WITHOUT it has smuggled Tic-Tac-Toe's bug back past the case above.
   * Asserted as two sets so both directions fail loudly and separately.
   */
  it('declares the flag exactly where it changes something', () => {
    const dealt = roomGames
      .filter((g) => g.manifest.dealerPlays === true)
      .map((g) => g.manifest.id);
    const oneChair = roomGames.filter((g) => g.manifest.seats.min === 1).map((g) => g.manifest.id);
    expect([...dealt].sort()).toEqual([...oneChair].sort());
  });

  it('so the smallest table the lobby can create is startable, with an opponent in it', () => {
    // `seats.min` is the default seat count and `canStart` needs a FULL table with a human in it.
    // The one-chair table passed that check too — which is exactly why the assertion is about who
    // is OPPOSITE and not about `tableIsFull`: a table of one is full, and whether it is a table
    // depends entirely on whether anything is playing against you.
    for (const { manifest } of roomGames) {
      const smallest = plannedSeats({
        seatCount: manifest.seats.min,
        host: { uid: ME, name: 'Ada' },
        fill: 'ai',
      });
      expect(smallest.length, `${manifest.id}`).toBe(manifest.seats.min);
      expect(tableIsFull(smallest), `${manifest.id}: an AI table is not startable`).toBe(true);
      expect(humanCount(smallest), `${manifest.id}`).toBe(1);
      // Somebody to play against — a bot in another chair, or the dealer, who has none.
      const opponents =
        smallest.length - humanCount(smallest) + (manifest.dealerPlays === true ? 1 : 0);
      expect(opponents, `${manifest.id}: nobody opposite`).toBeGreaterThanOrEqual(1);
    }
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
/**
 * A TABLE YOU OPEN FOR OTHER PEOPLE HAS A CHAIR FOR ONE — `seatRangeFor`, the mode's own view of a
 * manifest's seat range.
 *
 * It exists because `seats.min` is a fact about the GAME and "online" is a fact about the TABLE, and
 * Blackjack is where they came apart: its dealer is an opponent who takes no chair, so `min: 1` is
 * true of the game at every table it deals — and a one-chair ONLINE table has no chair for anybody
 * else, comes up full, and is auto-started by the entrance on the spot. "Play Online" would deal a
 * solo hand at a table nobody can join and the room browser would (correctly) never list it.
 *
 * Nothing about that throws, charges wrongly or renders badly, which is why it is a rule with a
 * guard rather than something anyone would notice.
 */
describe('seatRangeFor — the smallest table a way in may open', () => {
  it('leaves every non-online mode exactly as the manifest declared it', () => {
    const range = { min: 1, max: 4 };
    expect(seatRangeFor(range, 'ai')).toEqual(range);
    expect(seatRangeFor(range, 'hotseat')).toEqual(range);
  });

  it('floors an online table at two chairs', () => {
    expect(seatRangeFor({ min: 1, max: 4 }, 'online')).toEqual({ min: 2, max: 4 });
  });

  it('leaves a range that already floors at two alone, at every mode', () => {
    // Additivity: this must be invisible to the five games that never declared a one-chair table.
    const range = { min: 2, max: 7 };
    for (const mode of ['ai', 'hotseat', 'online'] as const) {
      expect(seatRangeFor(range, mode)).toEqual(range);
    }
  });

  it('never pushes a range past its own maximum', () => {
    // A game that genuinely cannot seat two is left as it is rather than handed min > max, which
    // `tableSizeChoices` would answer with an empty picker and the lobby with a table it cannot
    // create. There is no such game today; the clamp is what keeps that from being a surprise.
    expect(seatRangeFor({ min: 1, max: 1 }, 'online')).toEqual({ min: 1, max: 1 });
  });

  /**
   * Read off the REAL registry: every size an online table can be created at must leave a chair
   * for somebody, or the mode is a lie. This is the assertion the composition case in
   * `tests/auto-seat.test.ts` rests on, stated where the range is decided.
   */
  it('offers no online size that seats nobody but the host, over the real registry', () => {
    let sawOnline = false;
    for (const { manifest } of registry) {
      if (!manifest.modes.includes('online')) continue;
      sawOnline = true;
      const range = seatRangeFor(manifest.seats, 'online');
      const sizes = tableSizeChoices(range);
      for (const n of sizes.length > 0 ? sizes : [range.min]) {
        expect(n, `${manifest.id} online`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(sawOnline).toBe(true);
  });
});

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

/**
 * THE PLAN **IS** THE PREVIEW (plans/done/GAME_LAUNCH_MODAL.md §5.1). The lobby draws `plannedSeats`
 * before the table exists and the create path produces it, so what is at stake here is a PROMISE:
 * a preview that disagrees with what gets created is worse than no preview at all.
 *
 * v1 had this property for free — one `buildSeats(count)` called from both places. Here it is
 * worth a guard because the two EXECUTIONS genuinely differ: an AI fill is a boolean the referee
 * applies inside `store.create`, a local fill is a loop of claims from the host's own client, and
 * an online table is neither. So the composition is asserted rather than assumed.
 *
 * WHAT THIS CANNOT REACH, said rather than faked: the referee's `fillWithAi` lives in
 * `boardwalk-api`, which is outside this workspace and has its own suite. Both sides pin the
 * `CPU <n>` literal in their own tests (`boardwalk-api/tests/rooms.test.ts` asserts the created
 * table reads exactly `CPU 2`/`CPU 3`/`CPU 4`) and the join between them is a comment. Nothing
 * static spans the two packages, and pretending otherwise with a test that compares a copy of the
 * rule to the rule is the vacuous guard CLAUDE.md's Enforcement note warns about.
 */
describe('plannedSeats — the plan is the preview', () => {
  const HOST = { uid: ME, name: 'Ada' };

  /** Every size a real game can actually be created at: the picker's rungs, or `min` when it draws none. */
  const declaredSizes = (range: { min: number; max: number }): number[] => {
    const choices = tableSizeChoices(range);
    return choices.length > 0 ? choices : [range.min];
  };

  it('seats the host at index 0 and NOBODY else, at every size every real game declares', () => {
    // Read off the REAL registry rather than a fixture, the way `tableSizeChoices` is: the shape of
    // a planned table has to be a fact about the manifests this app ships, not about a hand-picked
    // number that happens to work. A second host seat is the failure that looks fine on screen —
    // two rows both saying "Ada" — and immediately makes `mySeatIndex` answer the wrong chair.
    for (const { manifest } of Object.values(registry)) {
      for (const n of declaredSizes(manifest.seats)) {
        for (const fill of ['ai', 'local', 'none'] as const) {
          const seats = plannedSeats({ seatCount: n, host: HOST, fill });
          expect(seats).toHaveLength(n);
          expect(seats[0]).toEqual({ kind: 'human', name: 'Ada', uid: ME });
          expect(seats.filter((s) => s.name === 'Ada')).toHaveLength(1);
          // Every chair is spoken for, or deliberately open — never `undefined`, which is what a
          // preview rendered off a sparse array would show as a blank row.
          expect(
            seats.every((s) => s.kind === 'human' || s.kind === 'ai' || s.kind === 'open')
          ).toBe(true);
          // A name a player reads, on every chair that has an occupant — and a DISTINCT one. An
          // unnamed bot renders as the "…" placeholder `SeatList` falls back to, which reads as a
          // seat still loading; two chairs both saying "CPU 2" is a table nobody can talk about.
          // Only occupied chairs are named: an open seat's name is '' by construction, so it is the
          // one label that legitimately repeats.
          const named = seats.filter((s) => s.kind !== 'open').map((s) => s.name);
          expect(named.every((name) => name !== '')).toBe(true);
          expect(new Set(named).size).toBe(named.length);
        }
      }
    }
  });

  it('fills every other chair with the house, one-based, holding no uid', () => {
    expect(plannedSeats({ seatCount: 4, host: HOST, fill: 'ai' })).toEqual([
      { kind: 'human', name: 'Ada', uid: ME },
      { kind: 'ai', name: 'CPU 2', uid: null },
      { kind: 'ai', name: 'CPU 3', uid: null },
      { kind: 'ai', name: 'CPU 4', uid: null },
    ]);
    // ONE-BASED, and pinned as a literal because the referee's own `fillWithAi` writes the same
    // string from its own copy of this rule. A bot chair carrying a uid would be refused by the
    // RTDB seat validator outright ("a uid you write must be your own"), so `null` is not cosmetic.
    expect(aiSeatName(0)).toBe('CPU 1');
    expect(aiSeatName(6)).toBe('CPU 7');
  });

  it('fills every other chair with a LOCAL human, under the host’s own uid', () => {
    // Hot-seat is several seats ONE account holds — the rules pin a seat's uid to the writer, so a
    // shared screen cannot be several uids, and only the display label varies. A `null` uid here
    // would make the extra players bots and hand their turns to a driver Chess does not ship.
    expect(plannedSeats({ seatCount: 2, host: HOST, fill: 'local' })).toEqual([
      { kind: 'human', name: 'Ada', uid: ME },
      { kind: 'human', name: 'Player 2', uid: ME },
    ]);
    expect(localSeatName(1)).toBe('Player 2');
  });

  it('leaves the rest open for an online table, which is a decision and not an omission', () => {
    // §5.3: a public table that comes up full starts before anyone can walk up to it.
    expect(plannedSeats({ seatCount: 3, host: HOST, fill: 'none' })).toEqual([
      { kind: 'human', name: 'Ada', uid: ME },
      open(),
      open(),
    ]);
  });

  it('is exactly what the hot-seat claim loop produces', () => {
    // THE COMPOSITION, and the one place the two executions can genuinely be compared here: the
    // lobby creates an unfilled table and then CLAIMS each remaining chair. If the preview and the
    // loop disagree about the label or the uid, the host watches a table they did not ask for
    // assemble itself one chair at a time.
    for (const n of [2, 3, 5]) {
      let seats: readonly Seat[] = plannedSeats({ seatCount: n, host: HOST, fill: 'none' });
      for (let i = 1; i < n; i += 1) {
        const claimed = claimSeat(seats, i, { uid: HOST.uid, name: localSeatName(i) });
        if (!claimed.ok) throw new Error(`the loop could not take seat ${String(i)}`);
        seats = claimed.seats;
      }
      expect(seats).toEqual(plannedSeats({ seatCount: n, host: HOST, fill: 'local' }));
    }
  });

  it('is [] rather than a phantom chair when no host can be seated', () => {
    // Fed by a manifest range and a picker, so it is only wrong when something else already went
    // wrong — and a lobby drawing an empty preview beats one that throws on render. `SeatPreview`
    // renders nothing for `[]`, which is why the empty array is the honest answer and not `[host]`.
    for (const seatCount of [0, -1, 0.5, Number.NaN]) {
      expect(plannedSeats({ seatCount, host: HOST, fill: 'ai' })).toEqual([]);
    }
  });

  it('hands back a fresh array every time, aliasing nothing', () => {
    // It is read in render and passed straight to a component. A shared reference between the
    // preview and the create call would let one mutate what the other is drawing.
    const a = plannedSeats({ seatCount: 3, host: HOST, fill: 'ai' });
    const b = plannedSeats({ seatCount: 3, host: HOST, fill: 'ai' });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a[1]).not.toBe(b[1]);
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

  it('every rung a game offers is also typeable, so the two controls cannot disagree', () => {
    // The rungs and the field are two ways to name one value, and the only thing that would make
    // them different controls is a rung the field refuses. Read off the REAL registry so it is a
    // fact about the games this app ships.
    for (const { manifest } of Object.values(registry)) {
      if (manifest.betting === undefined) continue;
      for (const cents of anteChoices(manifest.betting)) {
        if (cents === 0) continue; // "None" is the button's job, deliberately — see parseAnte
        const typed = parseAnte((cents / 100).toFixed(2), manifest.betting);
        expect(typed, `a rung of ${String(cents)} is not typeable`).toEqual({ ok: true, cents });
      }
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

  it('offers NO table stake for a per-seat game, and the whole ladder for every other one', () => {
    // BLACKJACK IS THE ONE GAME WITH NO TABLE ANTE — a chair names its own stake, every round, from
    // the board. Nothing charges a room ante there, so drawing the picker would set a number that
    // moves no money and then make the lobby print "$25 a seat · winner takes the pot" over a game
    // that has no pot at all.
    //
    // Which is not a payout bug and would never surface as one. It is a sentence that is simply
    // wrong forever and looks completely fine — the failure `tableBacking` already exists to have
    // caught once, one field earlier. `[0]` is what "draw nothing" is spelled as (the lobby gates
    // on `length > 1`), so a control that cannot change the outcome is never rendered.
    expect(anteChoices({ min: 500, max: 50_000, perSeat: true })).toEqual([0]);
    // ADDITIVITY: a game that does NOT declare it keeps every rung it had, so adding the flag
    // retuned nobody's picker — UNO's ladder in particular must not have moved.
    expect(anteChoices({ min: 500, max: 50_000 })).toEqual([0, 500, 2_500, 10_000, 50_000]);

    // And over the REAL registry, in both directions, because the property is about the games this
    // app ships rather than about a fixture: a per-seat game offers only "nothing", and every other
    // betting game still offers at least one real stake.
    let sawPerSeat = false;
    let sawTableAnte = false;
    for (const { manifest } of Object.values(registry)) {
      if (manifest.betting === undefined) continue;
      if (manifest.betting.perSeat === true) {
        sawPerSeat = true;
        expect(anteChoices(manifest.betting)).toEqual([0]);
      } else {
        sawTableAnte = true;
        expect(anteChoices(manifest.betting).length).toBeGreaterThan(1);
      }
    }
    // Both halves must have been reached, or a sweep that silently matched nothing reports success
    // forever — the trap `tests/doc-links.test.ts` pins about its own walkers.
    expect(sawPerSeat).toBe(true);
    expect(sawTableAnte).toBe(true);
  });
});

/**
 * A HAND-TYPED STAKE — the rung ladder's finer grain, and the one control on this panel whose input
 * is free text a person wrote.
 *
 * The ladder is six denominations, which is the right default and the wrong ceiling: "$25 or $100,
 * nothing between" is a picker deciding something the people at the table are better placed to
 * decide. What makes the field worth guarding rather than trusting is that every way it can be
 * wrong ends at a LEDGER: a fractional result dies at `validateBet` (which refuses rather than
 * rounds — v1's `parseInt` chip) at the exact moment money moves, with the host already sat down,
 * and an out-of-range one is a table the game never said it could be played at.
 */
const UNO_BETTING = { min: 2_500, max: 100_000, house: true } as const;
const cents = (r: ReturnType<typeof parseAnte>): number | string => (r.ok ? r.cents : r.error);

describe('parseAnte — a stake somebody typed', () => {
  it('reads the shapes a person actually types', () => {
    expect(cents(parseAnte('250', UNO_BETTING))).toBe(25_000);
    expect(cents(parseAnte('$250', UNO_BETTING))).toBe(25_000);
    expect(cents(parseAnte('  250  ', UNO_BETTING))).toBe(25_000);
    expect(cents(parseAnte('1,000', UNO_BETTING))).toBe(100_000);
    expect(cents(parseAnte('$1,000.00', UNO_BETTING))).toBe(100_000);
    expect(cents(parseAnte('25.5', UNO_BETTING))).toBe(2_550);
    expect(cents(parseAnte('25.50', UNO_BETTING))).toBe(2_550);
  });

  it('lands on EXACT cents for the amounts a float multiply gets wrong', () => {
    // `Number('12.10') * 100` is 1209.9999999999998 and `Number('770.10') * 100` is
    // 77009.99999999999 — the obvious implementation, and it produces a fractional number of cents
    // that `validateBet` then refuses at the exact moment money moves. Every value here is one a
    // `.toFixed(2)` round trip produces, so it is reachable by pressing a rung and editing it.
    //
    // THE EXPECTED NUMBERS ARE LITERALS, and that is the whole point of this case. The first draft
    // asserted `got === Math.round(Number(dollars) * 100)`, which is a test comparing the rule to a
    // copy of the rule — and it stayed GREEN when the parser was falsified to exactly that
    // expression, because `Math.round` is a correct implementation at two decimal places. What is
    // actually being guarded is "an exact integer, and the right one", so both halves are stated
    // without arithmetic.
    const table: readonly (readonly [string, number])[] = [
      ['12.10', 1_210],
      ['770.10', 77_010],
      ['335.70', 33_570],
      ['29.30', 2_930],
      ['881.10', 88_110],
      ['0.07', 7],
      ['1.005', -1], // three places: refused outright, never rounded to 100 or 101
    ];
    for (const [dollars, expected] of table) {
      const r = parseAnte(dollars, { min: 1, max: 10_000_000 });
      if (expected < 0) {
        expect(r.ok, `${dollars} should be refused`).toBe(false);
        continue;
      }
      expect(r.ok, dollars).toBe(true);
      const got = r.ok ? r.cents : Number.NaN;
      expect(Number.isInteger(got), `${dollars} → ${String(got)} is not whole cents`).toBe(true);
      expect(got, dollars).toBe(expected);
    }
  });

  it('refuses a third decimal place rather than rounding it away', () => {
    // The `parseInt` war story on the INPUT side of the same number. Truncating `25.505` to $25.50
    // is a table priced at something nobody typed; refusing it is a table priced at what they did.
    expect(parseAnte('25.505', UNO_BETTING).ok).toBe(false);
    expect(parseAnte('250.001', UNO_BETTING).ok).toBe(false);
  });

  it('refuses text that is not an amount, and says so rather than reading a prefix', () => {
    // `parseFloat('25abc')` is 25 — the failure mode where a typo silently becomes a stake.
    for (const junk of [
      '',
      '   ',
      'abc',
      '25abc',
      '2.5.0',
      '-250',
      '1e3',
      '25 000',
      '$$250',
      '.',
    ]) {
      expect(parseAnte(junk, UNO_BETTING).ok, junk).toBe(false);
    }
  });

  it('holds the game’s own range at both ends, and refuses ZERO', () => {
    expect(parseAnte('24.99', UNO_BETTING).ok).toBe(false);
    expect(cents(parseAnte('25', UNO_BETTING))).toBe(2_500);
    expect(cents(parseAnte('1000', UNO_BETTING))).toBe(100_000);
    expect(parseAnte('1000.01', UNO_BETTING).ok).toBe(false);
    // Not a rejection of "play for nothing" — that is the "None" rung. A field that silently means
    // the same thing as a button is two controls for one value.
    expect(parseAnte('0', UNO_BETTING).ok).toBe(false);
  });

  it('answers rather than throws when the game is not played for money, or says nonsense about it', () => {
    // Unreachable from the panel (no `betting` draws no ante control), and total anyway: a branch a
    // caller has to remember to guard is a branch somebody will not.
    expect(parseAnte('25', undefined).ok).toBe(false);
    expect(parseAnte('25', { min: 100_000, max: 100 }).ok).toBe(false); // reversed
    expect(parseAnte('25', { min: Number.NaN, max: 100_000 }).ok).toBe(false);
    expect(parseAnte('25', { min: 100, max: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it('every error names what to do, because a field that only says "no" makes you guess', () => {
    // `Input`'s own rule — "Bet more than $2" beats "Invalid". The range message must carry the
    // numbers, since "out of range" is exactly the error a reader cannot act on.
    for (const junk of ['', 'abc', '25.505', '10']) {
      const r = parseAnte(junk, UNO_BETTING);
      expect(r.ok).toBe(false);
      expect(r.ok ? '' : r.error.length, junk).toBeGreaterThan(8);
    }
    const low = parseAnte('10', UNO_BETTING);
    expect(low.ok ? '' : low.error).toContain('$25');
    expect(low.ok ? '' : low.error).toContain('$1,000');
  });

  it('anything it ACCEPTS is a bet the economy will take — the property the whole parser exists for', () => {
    // The real bound, stated as a property rather than as a list of examples: a stake that parses
    // and then dies at `validateBet` is a create button that works and a deal that fails, which is
    // the worst possible place to find out. Swept over the REAL registry so it holds for the games
    // this app ships, at a balance that can cover the table max.
    for (const { manifest } of Object.values(registry)) {
      const betting = manifest.betting;
      if (betting === undefined) continue;
      const bounds = { min: betting.min, max: betting.max };
      for (const raw of [
        '25',
        '25.01',
        '25.99',
        '100',
        '333.33',
        '999.99',
        '1000',
        '0.005',
        '1e2',
        '-5',
        '12.345',
      ]) {
        const parsed = parseAnte(raw, betting);
        if (!parsed.ok) continue;
        const check = validateBet(parsed.cents, betting.max, bounds);
        expect(check.ok, `${raw} → ${String(parsed.cents)}: ${check.ok ? '' : check.error}`).toBe(
          true
        );
      }
    }
  });
});
