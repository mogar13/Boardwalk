/**
 * The rematch handshake, proven without a room, a socket or a game — the same split every other
 * multiplayer rule in this repo takes (`tests/room.test.ts`): the correctness lives in pure
 * functions, and the component is the thin part that calls them.
 *
 * The properties that actually matter are the ones a hand-rolled per-game "play again" got wrong:
 * a bot must never be waited for (it would stall the table forever), a departed player's ghost vote
 * must never satisfy the tally (it would let one player restart a two-player game alone), and an
 * empty table must never read as agreement (`every` over an empty list is `true` — the trap that
 * would make a seatless room restart itself on a loop).
 */
import { describe, expect, it } from 'vitest';
import { castVotes, haveVoted, rematchTally, restartGate } from '@/system/room/rematch';
import type { Seat } from '@/system/room/types';

const human = (uid: string, name = uid): Seat => ({ kind: 'human', name, uid });
const ai = (name = 'CPU'): Seat => ({ kind: 'ai', name, uid: null });
const open = (): Seat => ({ kind: 'open', name: '', uid: null });

describe('castVotes', () => {
  it('records a vote per seat and leaves the input untouched', () => {
    const before = {};
    const after = castVotes(before, [1]);
    expect(after).toEqual({ '1': true });
    expect(before).toEqual({});
  });

  it('votes for every local seat at once — one hot-seat screen holds several humans', () => {
    expect(castVotes(undefined, [0, 1])).toEqual({ '0': true, '1': true });
  });

  it('is idempotent — a double-tap is one vote', () => {
    expect(castVotes(castVotes(undefined, [2]), [2])).toEqual({ '2': true });
  });

  it('keeps the votes already cast', () => {
    expect(castVotes({ '0': true }, [1])).toEqual({ '0': true, '1': true });
  });
});

describe('rematchTally', () => {
  const table = [human('a'), human('b')];

  it('asks every human seat and nobody else', () => {
    const seats = [human('a'), ai(), open(), human('b')];
    expect(rematchTally(undefined, seats).needed).toEqual([0, 3]);
  });

  it('does not agree until every human has asked', () => {
    expect(rematchTally(undefined, table).agreed).toBe(false);
    expect(rematchTally({ '0': true }, table).agreed).toBe(false);
    expect(rematchTally({ '0': true, '1': true }, table).agreed).toBe(true);
  });

  // The whole reason a bot is not asked: a table that waits for a seat nothing drives never
  // restarts. This is also what keeps a leaver from freezing the game — their seat becomes an AI.
  it('agrees on one human vote when the rest of the table is bots', () => {
    const seats = [human('a'), ai(), ai(), ai()];
    expect(rematchTally({ '0': true }, seats)).toMatchObject({ needed: [0], agreed: true });
  });

  it('ignores a ghost vote from a seat that is no longer human', () => {
    // 'b' asked for a rematch, then left; the seat was handed to a bot. 'a' has NOT asked, and one
    // player must not be able to restart a two-player game on a departed opponent's old vote.
    const votes = { '1': true } as const;
    expect(rematchTally(votes, [human('a'), ai()])).toMatchObject({
      needed: [0],
      voted: [],
      agreed: false,
    });
  });

  it('never agrees at a table with no humans in it', () => {
    // `every` over an empty list is `true`, so the naive version restarts an empty room forever.
    expect(rematchTally({ '0': true }, [ai(), ai()]).agreed).toBe(false);
    expect(rematchTally({}, []).agreed).toBe(false);
  });

  it('counts the votes it is waiting on', () => {
    const seats = [human('a'), human('b'), human('c'), ai()];
    const tally = rematchTally({ '0': true, '2': true }, seats);
    expect(tally.needed).toEqual([0, 1, 2]);
    expect(tally.voted).toEqual([0, 2]);
    expect(tally.agreed).toBe(false);
  });
});

describe('haveVoted', () => {
  it('is true only when every seat this screen holds has asked', () => {
    expect(haveVoted({ '0': true }, [0])).toBe(true);
    expect(haveVoted({ '0': true }, [0, 1])).toBe(false);
    expect(haveVoted({ '0': true, '1': true }, [0, 1])).toBe(true);
  });

  it('is false for a spectator, who holds no seat and is asked nothing', () => {
    expect(haveVoted({ '0': true }, [])).toBe(false);
  });

  it('is false with no votes at all', () => {
    expect(haveVoted(undefined, [0])).toBe(false);
  });
});

/**
 * THE HOST'S ONCE-PER-HANDSHAKE GATE.
 *
 * This is the half that moves money. There is a window between the host writing the next round and
 * the snapshot that clears the votes arriving back, and every re-render inside it sees an agreed
 * tally — so without a gate a betting table deals twice and antes twice.
 *
 * The gate used to be a ref keyed on `round`, which quietly assumed a round number never repeats
 * across restarts. True of every game that restarts by patching its own state; FALSE of a
 * referee-dealt match, where "again" is a new row whose rulebook starts at `round: 0`. These drive
 * the gate the way the effect does — carrying `fired` across calls — because any SINGLE call looks
 * correct under either scheme and only a sequence tells them apart.
 */
function driveHost(agreements: readonly boolean[]): number {
  let fired = false;
  let restarts = 0;
  for (const agreed of agreements) {
    const gate = restartGate(agreed, fired);
    fired = gate.fired;
    if (gate.fire) restarts += 1;
  }
  return restarts;
}

describe('restartGate', () => {
  it('never fires while the table has not agreed', () => {
    expect(driveHost([false, false, false])).toBe(0);
  });

  it('fires once on agreement and not again while the votes still stand', () => {
    // The window: the restart is away, the new state has not arrived, and the effect re-runs.
    expect(driveHost([true, true, true, true])).toBe(1);
  });

  it('re-arms when the votes clear, which is the next round arriving', () => {
    expect(driveHost([true, true, false, false, true, true])).toBe(2);
  });

  it('deals a SECOND rematch when two matches end on the SAME round number', () => {
    // Liar's Dice restarts `round` at 0 with every match, so match one and match two can both end
    // at round 3 — and they will, often, because matches of the same size take a similar number of
    // rounds. The round-keyed ref read the second agreement as a repeat of the first: every human
    // presses Ready ✓, the tally agrees, and nothing deals. Nothing throws and nothing logs.
    //
    // FALSIFY by restoring the old scheme (`if (ref.current === round) return; ref.current = round`)
    // with a round that repeats — this case drops to 1 while every other case here stays green,
    // which is exactly how it shipped.
    const matchOne = [true, true]; // agreed at round 3, plus a re-render inside the window
    const dealt = [false, false]; // the referee's fresh projection lands; votes gone
    const matchTwo = [true, true]; // round 3 again, a genuinely new handshake
    expect(driveHost([...matchOne, ...dealt, ...matchTwo])).toBe(2);
  });

  it('re-arms on a lost agreement even if it had already fired', () => {
    // The flag must not survive the votes it belongs to, or the table restarts exactly once ever.
    expect(restartGate(false, true)).toEqual({ fire: false, fired: false });
  });

  it('is total over its four inputs', () => {
    expect(restartGate(true, false)).toEqual({ fire: true, fired: true });
    expect(restartGate(true, true)).toEqual({ fire: false, fired: true });
    expect(restartGate(false, false)).toEqual({ fire: false, fired: false });
    expect(restartGate(false, true)).toEqual({ fire: false, fired: false });
  });
});
