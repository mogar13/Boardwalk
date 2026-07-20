/**
 * Liar's Dice — the rulebook, and the projection that keeps the game a game.
 *
 * Written before a single pixel, the usual order. The two blocks that matter most are the bid
 * ladder (v1's was broken in a way that made 1s a free win) and the projection (a leak here does
 * not skew the game, it ends it while leaving it looking played).
 */
import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  applyAction,
  chooseAiAction,
  countFace,
  deal,
  DICE_PER_PLAYER,
  handFor,
  isLegalRaise,
  isPalifico,
  livingSeats,
  publicView,
  rollDice,
  totalDice,
  type Face,
  type LiarsDiceMatch,
} from '@boardwalk/game-logic/games/liars-dice';

/** An rng that walks a fixed list, so a test can name the exact table it wants. */
function seq(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

/** An rng that always rolls `face` — the die is `floor(r * 6) + 1`, so aim at the band's middle. */
const always =
  (face: Face): (() => number) =>
  () =>
    (face - 1) / 6 + 0.01;

/** Build a match with exact cups, bypassing the roll. */
function table(
  dice: readonly (readonly Face[])[],
  over: Partial<LiarsDiceMatch> = {}
): LiarsDiceMatch {
  return {
    dice: dice.map((d) => d.slice()),
    turn: 0,
    bid: null,
    phase: 'bidding',
    palificoSeat: -1,
    lockedFace: -1,
    resolution: null,
    winner: -1,
    round: 0,
    ...over,
  };
}

describe('the deal', () => {
  it('gives every seat five dice and opens on seat 0', () => {
    const m = deal(4, seq([0.1, 0.3, 0.5, 0.7, 0.9, 0.2]));
    expect(m.dice).toHaveLength(4);
    for (const hand of m.dice) expect(hand).toHaveLength(DICE_PER_PLAYER);
    expect(m.turn).toBe(0);
    expect(m.bid).toBeNull();
    expect(m.winner).toBe(-1);
    expect(totalDice(m)).toBe(20);
  });

  it('clamps the table to 2..6 seats rather than sizing anything by a literal', () => {
    // v1 hardcoded [5,5,5,5] regardless of player count, so 2- and 3-player games could never be
    // won: two ghost seats sat at five dice forever and the alive-count never reached 1.
    expect(deal(1, always(3)).dice).toHaveLength(2);
    expect(deal(9, always(3)).dice).toHaveLength(6);
    expect(deal(3, always(3)).dice).toHaveLength(3);
  });

  it('rolls only real faces, and is deterministic for a fixed rng', () => {
    const rng = () => 0.5;
    const a = rollDice(5, rng);
    const b = rollDice(5, rng);
    expect(a).toEqual(b);
    for (const d of a) expect(d).toBeGreaterThanOrEqual(1);
    for (const d of a) expect(d).toBeLessThanOrEqual(6);
  });
});

describe('counting, and wilds', () => {
  it('counts 1s as every face outside palifico', () => {
    const m = table([
      [1, 3, 3],
      [1, 5, 6],
    ]);
    expect(countFace(m, 3)).toBe(4); // two 3s + two 1s
    expect(countFace(m, 5)).toBe(3); // one 5 + two 1s
  });

  it('does NOT double-count 1s on a bid of 1s', () => {
    // v1 counted `val === face || val === 1` unconditionally, so a bid of 1s counted every 1
    // twice — the bid that is already hardest to make was also the easiest to satisfy.
    const m = table([
      [1, 1, 4],
      [1, 2, 2],
    ]);
    expect(countFace(m, 1)).toBe(3);
  });

  it('kills wilds in palifico', () => {
    const m = table(
      [
        [1, 3],
        [1, 3],
      ],
      { palificoSeat: 0 }
    );
    expect(isPalifico(m)).toBe(true);
    expect(countFace(m, 3)).toBe(2); // the 1s are just 1s now
  });
});

describe('the bid ladder', () => {
  const m = table([
    [2, 2, 3, 4, 5],
    [2, 3, 3, 6, 6],
  ]);

  it('accepts more dice at any face, or the same dice at a higher face', () => {
    const at = table(m.dice, { bid: { quantity: 3, face: 4 } });
    expect(isLegalRaise(at, { quantity: 4, face: 2 })).toBe(true);
    expect(isLegalRaise(at, { quantity: 3, face: 5 })).toBe(true);
    expect(isLegalRaise(at, { quantity: 3, face: 4 })).toBe(false);
    expect(isLegalRaise(at, { quantity: 3, face: 3 })).toBe(false);
    expect(isLegalRaise(at, { quantity: 2, face: 6 })).toBe(false);
  });

  it('halves the quantity switching TO 1s, and doubles-plus-one switching OFF', () => {
    // THE RULE V1 DID NOT HAVE. It ordered faces [2,3,4,5,6,1] and treated 1s as merely the top,
    // so "three 1s" raised "three 6s" for free despite being about twice as hard to make.
    const seven5s = table(m.dice, { bid: { quantity: 7, face: 5 } });
    expect(isLegalRaise(seven5s, { quantity: 4, face: 1 })).toBe(true); // ceil(7/2) = 4
    expect(isLegalRaise(seven5s, { quantity: 3, face: 1 })).toBe(false);

    const four1s = table(m.dice, { bid: { quantity: 4, face: 1 } });
    expect(isLegalRaise(four1s, { quantity: 9, face: 2 })).toBe(true); // 4*2+1 = 9
    expect(isLegalRaise(four1s, { quantity: 8, face: 6 })).toBe(false);
    // And within 1s it is the ordinary rule.
    expect(isLegalRaise(four1s, { quantity: 5, face: 1 })).toBe(true);
  });

  it('refuses a quantity beyond the dice that exist, or a non-integer', () => {
    // v1's stepper capped at a literal 40 regardless of the table, and its bot escalated by +1
    // forever, so both could bid more dice than were in play.
    expect(isLegalRaise(m, { quantity: 11, face: 3 })).toBe(false);
    expect(isLegalRaise(m, { quantity: 10, face: 3 })).toBe(true);
    expect(isLegalRaise(m, { quantity: 2.5, face: 3 })).toBe(false);
    expect(isLegalRaise(m, { quantity: 0, face: 3 })).toBe(false);
  });

  it('locks the face in palifico and allows quantity only', () => {
    const p = table(m.dice, { palificoSeat: 1, bid: { quantity: 2, face: 4 } });
    expect(isLegalRaise(p, { quantity: 3, face: 4 })).toBe(true);
    expect(isLegalRaise(p, { quantity: 3, face: 5 })).toBe(false);
    expect(isLegalRaise(p, { quantity: 2, face: 5 })).toBe(false);
  });

  it('refuses opening on 1s while they are WILD, and allows it in palifico where they are not', () => {
    // Opening on wilds would force the whole table into the doubling conversion from the first
    // word of the round. In palifico there is no conversion, so there is nothing to ban — and
    // getting this backwards is what hung the bot: it opened palifico on 1s, the reducer refused,
    // and a refused bot action is a no-op, so the table stalled on an unchanged state.
    const ordinary = table(m.dice);
    expect(isLegalRaise(ordinary, { quantity: 2, face: 1 })).toBe(false);
    expect(isLegalRaise(ordinary, { quantity: 2, face: 4 })).toBe(true);

    const p = table(m.dice, { palificoSeat: 1 });
    expect(isLegalRaise(p, { quantity: 2, face: 1 })).toBe(true);
    expect(isLegalRaise(p, { quantity: 2, face: 4 })).toBe(true);
  });
});

describe('challenge', () => {
  it('costs the bidder a die when the bid was a lie', () => {
    const m = table(
      [
        [2, 2, 3],
        [4, 5, 6],
      ],
      { bid: { quantity: 5, face: 2 }, turn: 1 }
    );
    const next = applyAction(m, 1, { type: 'challenge' });
    expect(next.resolution?.callerWon).toBe(true);
    expect(next.resolution?.actual).toBe(2);
    expect(next.dice[0]).toHaveLength(2); // the bidder paid
    expect(next.dice[1]).toHaveLength(3);
    expect(next.phase).toBe('reveal');
  });

  it('costs the challenger a die when the bid was good', () => {
    const m = table(
      [
        [2, 2, 1],
        [2, 5, 6],
      ],
      { bid: { quantity: 3, face: 2 }, turn: 1 }
    );
    const next = applyAction(m, 1, { type: 'challenge' });
    expect(next.resolution?.actual).toBe(4); // three 2s + one wild
    expect(next.resolution?.callerWon).toBe(false);
    expect(next.dice[1]).toHaveLength(2);
    expect(next.dice[0]).toHaveLength(3);
  });

  it('is a no-op with no standing bid, rather than a crash', () => {
    const m = table([
      [2, 2],
      [3, 3],
    ]);
    expect(applyAction(m, 0, { type: 'challenge' })).toBe(m);
  });
});

describe('spot-on', () => {
  it('costs EVERY other living seat a die when exactly right', () => {
    const m = table(
      [
        [2, 2, 5],
        [2, 4, 6],
        [3, 3, 3],
      ],
      { bid: { quantity: 3, face: 2 }, turn: 2 }
    );
    const next = applyAction(m, 2, { type: 'spotOn' });
    expect(next.resolution?.actual).toBe(3);
    expect(next.resolution?.callerWon).toBe(true);
    expect(next.dice[0]).toHaveLength(2);
    expect(next.dice[1]).toHaveLength(2);
    expect(next.dice[2]).toHaveLength(3); // the caller keeps theirs
    expect(next.resolution?.losers).toEqual([0, 1]);
  });

  it('costs only the caller when wrong', () => {
    const m = table(
      [
        [2, 2, 5],
        [2, 4, 6],
        [3, 3, 3],
      ],
      { bid: { quantity: 4, face: 2 }, turn: 2 }
    );
    const next = applyAction(m, 2, { type: 'spotOn' });
    expect(next.resolution?.callerWon).toBe(false);
    expect(next.dice[2]).toHaveLength(2);
    expect(next.dice[0]).toHaveLength(3);
    expect(next.dice[1]).toHaveLength(3);
  });

  it('counts wilds toward exactness, so the asymmetry is judged on the real table', () => {
    const m = table(
      [
        [1, 2, 5],
        [2, 4, 6],
      ],
      { bid: { quantity: 3, face: 2 }, turn: 1 }
    );
    const next = applyAction(m, 1, { type: 'spotOn' });
    expect(next.resolution?.actual).toBe(3); // two 2s + one wild
    expect(next.resolution?.callerWon).toBe(true);
  });
});

describe('elimination and the win', () => {
  it('knocks a seat out at zero dice and names it in the resolution', () => {
    const m = table([[4], [2, 2, 2]], { bid: { quantity: 5, face: 4 }, turn: 1 });
    const next = applyAction(m, 1, { type: 'challenge' });
    expect(next.resolution?.eliminated).toEqual([0]);
    expect(livingSeats(next)).toEqual([1]);
  });

  it('ends the match when one seat is left — and a 2-player match CAN be won', () => {
    // The v1 defect this whole file is paid for: `dieCounts` was always length 4, so the alive
    // count never dropped below 2 and only a 4-player game could reach the win branch at all.
    const m = table([[4], [2, 2]], { bid: { quantity: 5, face: 4 }, turn: 1 });
    const next = applyAction(m, 1, { type: 'challenge' });
    expect(next.phase).toBe('finished');
    expect(next.winner).toBe(1);
  });

  it('a 3-player match can be won too', () => {
    const m = table([[4], [2, 2], [5, 5]], { bid: { quantity: 9, face: 4 }, turn: 1 });
    const mid = applyAction(m, 1, { type: 'challenge' });
    expect(mid.winner).toBe(-1); // two seats still live
    expect(mid.phase).toBe('reveal');
  });

  it('a finished match refuses every further action', () => {
    const done = table([[], [2, 2]], { phase: 'finished', winner: 1 });
    expect(applyAction(done, 1, { type: 'bid', quantity: 1, face: 2 })).toBe(done);
    expect(advanceRound(done, always(3))).toBe(done);
  });
});

describe('rounds and palifico', () => {
  it('re-rolls every living cup and keeps the counts', () => {
    const m = table(
      [
        [2, 2],
        [3, 3, 3],
      ],
      {
        phase: 'reveal',
        resolution: {
          kind: 'challenge',
          caller: 1,
          bid: { quantity: 1, face: 2 },
          actual: 1,
          callerWon: false,
          losers: [1],
          eliminated: [],
        },
      }
    );
    const next = advanceRound(m, always(6));
    expect(next.phase).toBe('bidding');
    expect(next.dice[0]).toEqual([6, 6]);
    expect(next.dice[1]).toEqual([6, 6, 6]);
    expect(next.bid).toBeNull();
    expect(next.resolution).toBeNull();
    expect(next.round).toBe(1);
  });

  it('opens palifico when the opener is down to one die, and clears it after', () => {
    const m = table([[2], [3, 3, 3]], { phase: 'reveal' });
    const next = advanceRound(m, always(4));
    expect(next.palificoSeat).toBe(0);
    expect(isPalifico(next)).toBe(true);

    const later = advanceRound(
      table(
        [
          [2, 2],
          [3, 3],
        ],
        { phase: 'reveal', palificoSeat: 0 }
      ),
      always(4)
    );
    expect(later.palificoSeat).toBe(-1);
  });

  it('locks the face to whatever the palifico opener names', () => {
    const p = table([[2], [3, 3]], { palificoSeat: 0, turn: 0 });
    const opened = applyAction(p, 0, { type: 'bid', quantity: 2, face: 4 });
    expect(opened.lockedFace).toBe(4);
    expect(isLegalRaise(opened, { quantity: 3, face: 5 })).toBe(false);
    expect(isLegalRaise(opened, { quantity: 3, face: 4 })).toBe(true);
  });

  it('does not open palifico when only one seat is left standing', () => {
    const m = table([[2], []], { phase: 'reveal' });
    expect(advanceRound(m, always(4)).palificoSeat).toBe(-1);
  });
});

describe('turn authority and totality', () => {
  const m = table([
    [2, 2, 2],
    [3, 3, 3],
  ]);

  it('refuses an action from the wrong seat', () => {
    // v1 gated the controls with CSS `pointer-events` and trusted `activeTurn`, so a console call
    // during a bot's turn recorded YOUR bid as the BOT's.
    expect(applyAction(m, 1, { type: 'bid', quantity: 2, face: 3 })).toBe(m);
  });

  it('refuses an illegal bid without throwing, so the referee can pass the wire straight in', () => {
    const at = table(m.dice, { bid: { quantity: 4, face: 4 } });
    expect(applyAction(at, 0, { type: 'bid', quantity: 2, face: 2 })).toBe(at);
    expect(applyAction(at, 0, { type: 'bid', quantity: 99, face: 2 })).toBe(at);
    expect(applyAction(at, 0, { type: 'bid', quantity: 5, face: 9 as Face })).toBe(at);
  });

  it('refuses an action from an eliminated seat', () => {
    const out = table([[], [3, 3]], { turn: 0 });
    expect(applyAction(out, 0, { type: 'bid', quantity: 1, face: 3 })).toBe(out);
  });

  it('refuses actions during the reveal — the referee steps out of it, not a player', () => {
    const rev = table(m.dice, { phase: 'reveal' });
    expect(applyAction(rev, 0, { type: 'bid', quantity: 1, face: 2 })).toBe(rev);
  });

  it('never mutates its input', () => {
    const before = JSON.stringify(m);
    applyAction(m, 0, { type: 'bid', quantity: 3, face: 3 });
    applyAction(m, 0, { type: 'challenge' });
    advanceRound(m, always(3));
    expect(JSON.stringify(m)).toBe(before);
  });

  it('passes the turn to the next LIVING seat, wrapping', () => {
    const gappy = table([[2, 2], [], [3, 3]], { turn: 0 });
    expect(applyAction(gappy, 0, { type: 'bid', quantity: 1, face: 2 }).turn).toBe(2);
    const wrap = table([[2, 2], [], [3, 3]], { turn: 2, bid: { quantity: 1, face: 2 } });
    expect(applyAction(wrap, 2, { type: 'bid', quantity: 2, face: 2 }).turn).toBe(0);
  });
});

describe('the projection — what a player may see', () => {
  const m = table(
    [
      [1, 2, 3],
      [4, 5, 6],
      [2, 2],
    ],
    { bid: { quantity: 3, face: 2 }, turn: 1 }
  );

  it("carries counts and never another seat's faces", () => {
    const view = publicView(m);
    expect(view.counts).toEqual([3, 3, 2]);
    expect(view.revealed).toEqual([]);
    expect(view.bid).toEqual({ quantity: 3, face: 2 });
    expect(view.total).toBe(8);
  });

  it('has no field for the dice at all — the guard is structural, not a filter', () => {
    // The failure this guards against is a FIELD APPEARING. A test that only checked the fields it
    // knows about would pass happily while a new one leaked every cup on the table.
    const view = publicView(m);
    expect('dice' in view).toBe(false);
    const wire = JSON.stringify(view);
    expect(wire).not.toContain('"dice"');
    // And no cup's contents are reachable anywhere in the serialised payload while bidding.
    expect(JSON.parse(wire)).toEqual(expect.objectContaining({ revealed: [] }));
  });

  it('opens every cup at the reveal, and only then', () => {
    const revealed = publicView({ ...m, phase: 'reveal' });
    expect(revealed.revealed).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [2, 2],
    ]);
    expect(publicView({ ...m, phase: 'bidding' }).revealed).toEqual([]);
    expect(publicView({ ...m, phase: 'finished' }).revealed).toHaveLength(3);
  });

  it("hands a seat its own cup and nobody else's", () => {
    expect(handFor(m, 0)).toEqual({ dice: [1, 2, 3] });
    expect(handFor(m, 2)).toEqual({ dice: [2, 2] });
    expect(handFor(m, 9)).toEqual({ dice: [] });
  });

  it('copies rather than aliasing, so a caller cannot reach back into the match', () => {
    const hand = handFor(m, 0);
    expect(hand.dice).not.toBe(m.dice[0]);
    const view = publicView({ ...m, phase: 'reveal' });
    expect(view.revealed[0]).not.toBe(m.dice[0]);
  });
});

describe('the house', () => {
  it('challenges a bid the table cannot plausibly cover', () => {
    const m = table(
      [
        [2, 2, 3, 4, 5],
        [6, 6, 6, 6, 6],
      ],
      { bid: { quantity: 9, face: 3 }, turn: 1 }
    );
    expect(chooseAiAction(m, 1, () => 0.9).type).toBe('challenge');
  });

  it('bids rather than calling when the bid is plausible', () => {
    const m = table(
      [
        [3, 3, 3, 4, 5],
        [3, 3, 6, 6, 6],
      ],
      { bid: { quantity: 3, face: 3 }, turn: 1 }
    );
    const action = chooseAiAction(m, 1, () => 0.9);
    expect(action.type).toBe('bid');
  });

  it('only ever returns a LEGAL action', () => {
    // v1's bot escalated `quantity + 1` forever with no cap against the dice in play, and never
    // used the same-quantity-higher-face rung at all.
    for (let s = 0; s < 40; s += 1) {
      const rng = seq([s / 40, ((s * 7) % 10) / 10, ((s * 3) % 10) / 10]);
      const m = deal(4, rng);
      const withBid = table(m.dice, { bid: { quantity: 3, face: 4 }, turn: 2 });
      const action = chooseAiAction(withBid, 2, rng);
      if (action.type === 'bid') {
        expect(isLegalRaise(withBid, { quantity: action.quantity, face: action.face })).toBe(true);
      } else {
        expect(['challenge', 'spotOn']).toContain(action.type);
      }
    }
  });

  it('opens with a legal bid when there is nothing to raise', () => {
    const m = table(
      [
        [4, 4, 4, 2, 5],
        [1, 1, 3, 3, 6],
      ],
      { turn: 0 }
    );
    const action = chooseAiAction(m, 0, () => 0.5);
    expect(action.type).toBe('bid');
    if (action.type === 'bid') {
      expect(isLegalRaise(m, { quantity: action.quantity, face: action.face })).toBe(true);
    }
  });

  it('takes the halved 1s rung when a high bid makes it the cheapest raise', () => {
    // v1's `bestFace` loop started at 2, so the house could never bid 1s at all — half the ladder
    // unreachable forever. The rung that matters is the CONVERSION: against a tall bid, switching
    // to 1s at `ceil(q/2)` is far cheaper than one more die, and a bot that cannot spell it is
    // forced to either over-bid or call.
    const m = table(
      [
        [1, 1, 1, 2, 3],
        [2, 3, 4, 5, 6],
      ],
      {
        bid: { quantity: 6, face: 4 },
        turn: 0,
      }
    );
    // Holding three wilds, "three 1s" is a claim it can nearly cover alone — far safer than the
    // seven-of-a-face the quantity rung would force. Ranking by risk-per-face is what finds it.
    const action = chooseAiAction(m, 0, () => 0.9);
    expect(action).toEqual({ type: 'bid', quantity: 3, face: 1 });
    expect(isLegalRaise(m, { quantity: 3, face: 1 })).toBe(true);
  });

  it('never returns an action the reducer would refuse — including the opening bid', () => {
    // A refused bot action is a NO-OP, and a no-op on a bot's turn stalls the table forever with
    // nobody able to move. So the house choosing from a filtered legal set is load-bearing, not
    // tidiness. Palifico + a cup full of 1s is the case that actually hung.
    const scenarios: LiarsDiceMatch[] = [
      table(
        [
          [1, 1, 1],
          [2, 3, 4],
        ],
        { palificoSeat: 0, turn: 0 }
      ),
      table(
        [
          [1, 1, 1, 1, 1],
          [2, 3, 4, 5, 6],
        ],
        { turn: 0 }
      ),
      table([[6], [1, 1]], { palificoSeat: 0, turn: 0 }),
      table(
        [
          [2, 2],
          [3, 3],
        ],
        { bid: { quantity: 4, face: 6 }, turn: 0 }
      ),
    ];
    for (const m of scenarios) {
      for (let s = 0; s < 12; s += 1) {
        const action = chooseAiAction(m, m.turn, seq([s / 12, 0.3, 0.7, 0.95]));
        // The real assertion: the reducer MOVES. An illegal action returns the input identity.
        expect(applyAction(m, m.turn, action)).not.toBe(m);
      }
    }
  });

  it('respects palifico — never leaves the locked face', () => {
    const p = table([[2], [3, 3, 3]], { palificoSeat: 0, bid: { quantity: 2, face: 5 }, turn: 1 });
    for (let s = 0; s < 20; s += 1) {
      const action = chooseAiAction(p, 1, seq([s / 20, 0.4, 0.8]));
      if (action.type === 'bid') expect(action.face).toBe(5);
    }
  });

  it('drives a whole match to a winner without stalling', () => {
    // The end-to-end property v1 could not satisfy at ANY player count below four.
    const rng = seq([0.13, 0.77, 0.41, 0.92, 0.05, 0.63, 0.28, 0.84, 0.51, 0.36, 0.7, 0.19]);
    let m = deal(3, rng);
    for (let step = 0; step < 500 && m.winner === -1; step += 1) {
      m =
        m.phase === 'reveal'
          ? advanceRound(m, rng)
          : applyAction(m, m.turn, chooseAiAction(m, m.turn, rng));
    }
    expect(m.winner).toBeGreaterThanOrEqual(0);
    expect(m.phase).toBe('finished');
    expect(livingSeats(m)).toHaveLength(1);
  });
});
