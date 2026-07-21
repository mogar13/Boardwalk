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
import { castVotes, haveVoted, rematchTally } from '@/system/room/rematch';
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
