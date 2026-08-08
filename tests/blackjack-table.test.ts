/**
 * BLACKJACK AT A TABLE — the multi-seat container, and the three things that can go wrong in it
 * that cannot go wrong in the one-seat game.
 *
 * The RULES are not re-tested here. `tests/blackjack.test.ts` owns ace-soft scoring, the settle
 * matrix, the 3:2 chip, the dealer's stand value and the insurance arithmetic, and this container
 * imports every one of those rather than restating them — so a case below asserting that a natural
 * pays 3:2 would be asserting that `payoutCents` equals itself. What is asserted here is what only
 * several chairs at one table can get wrong:
 *
 *   • THE ORDER. A chair that stood, busted or was dealt a natural is a hole in the turn order, and
 *     a turn that lands in one is a table waiting on a player who has nothing to do.
 *   • THE PEEK, AT A TABLE. Slice 1's war story with more seats: the dealer must settle a natural
 *     before ANY chair acts, or a second stake goes down on a round that was already over. Every
 *     existing assertion about `settle` passes while that is live, because nothing asks it.
 *   • THE PROJECTION. One hole card, hidden from EVERY seat including the host's, and no deck.
 *
 * Every case drives the REAL transition. `dealRound` takes its deck rather than shuffling, which is
 * the seam that makes an exact table possible without stubbing a global — the same seam the
 * one-seat `deal` action has had since Phase 6.
 */
import { describe, it, expect } from 'vitest';
import {
  AI_WAGER_CENTS,
  applyMove,
  canDoubleAt,
  canInsureAt,
  chooseAiMove,
  freshDeck,
  handValue,
  insuranceStake,
  isBust,
  openRound,
  payoutCents,
  pendingSeats,
  roundOver,
  shuffle,
  spotPayout,
  toPublic,
  type BlackjackTable,
  type Card,
  type Rank,
  type Suit,
} from '@boardwalk/game-logic/games/blackjack';

function c(rank: Rank, suit: Suit = 'spades'): Card {
  return { rank, suit };
}
function hand(...ranks: Rank[]): Card[] {
  return ranks.map((r) => c(r));
}
/** A deck whose head is dealt in the table's own order, padded so draws never run dry. */
function stacked(...ranks: Rank[]): Card[] {
  return [...hand(...ranks), ...freshDeck()];
}
/** Hand the reducer an exact deck, whatever it asks for. */
const from = (deck: readonly Card[]) => () => deck;

/** Open a round and put every named chair's stake down, dealing from `deck` on the last bet. */
function dealt(
  seated: boolean[],
  bets: readonly { seat: number; cents: number }[],
  deck: readonly Card[]
): BlackjackTable {
  let table = openRound(seated, 0);
  for (const bet of bets) {
    table = applyMove(table, bet.seat, { type: 'bet', wagerCents: bet.cents }, from(deck));
  }
  return table;
}

/** Two chairs, both playing, dealt from an exact deck. Order: s0, s1, dealer-up, s0, s1, hole. */
function twoUp(deck: readonly Card[], cents = 1_000): BlackjackTable {
  return dealt(
    [true, true],
    [
      { seat: 0, cents },
      { seat: 1, cents },
    ],
    deck
  );
}

describe('openRound', () => {
  it('seats exactly the chairs it was told about, and waits on all of them', () => {
    const table = openRound([true, false, true], 3);
    expect(table.phase).toBe('betting');
    expect(table.round).toBe(3);
    expect(table.turn).toBe(-1);
    expect(table.spots.map((s) => s.seated)).toEqual([true, false, true]);
    // The empty chair is not waited on. This is the whole reason `seated` exists: a table that
    // waits for a chair nobody is in never deals, and nothing on screen says why.
    expect(pendingSeats(table)).toEqual([0, 2]);
  });

  it('refuses a bet from a chair that is not in the round, and from one that already bet', () => {
    const open = openRound([true, false], 0);
    expect(applyMove(open, 1, { type: 'bet', wagerCents: 1_000 })).toBe(open);
    expect(applyMove(open, 9, { type: 'bet', wagerCents: 1_000 })).toBe(open);
    const once = applyMove(
      open,
      0,
      { type: 'bet', wagerCents: 1_000 },
      from(stacked('5', 'K', '9', '7'))
    );
    // One chair, so that bet dealt the round; a second bet is refused by the phase as well.
    expect(once.phase).toBe('player');
    expect(applyMove(once, 0, { type: 'bet', wagerCents: 500 })).toBe(once);
  });

  it('refuses a stake that is not a positive integer number of cents', () => {
    const open = openRound([true, true], 0);
    for (const bad of [0, -100, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(applyMove(open, 0, { type: 'bet', wagerCents: bad })).toBe(open);
    }
    // A fractional stake dies at `validateBet` the moment money moves, and a negative one would
    // reach the ledger as a row that PAYS the player to sit down.
  });
});

describe('the deal', () => {
  it('waits for every seated chair and then deals two each, plus two to the dealer', () => {
    let table = openRound([true, true, true], 0);
    table = applyMove(table, 0, { type: 'bet', wagerCents: 1_000 });
    expect(table.phase).toBe('betting');
    table = applyMove(table, 2, { type: 'bet', wagerCents: 2_000 });
    expect(table.phase).toBe('betting'); // seat 1 has not bet
    expect(pendingSeats(table)).toEqual([1]);
    table = applyMove(
      table,
      1,
      { type: 'bet', wagerCents: 500 },
      from(shuffle(freshDeck(), () => 0.5))
    );
    expect(table.phase).toBe('player');
    expect(table.spots[0]?.cards).toHaveLength(2);
    expect(table.spots[1]?.cards).toHaveLength(2);
    expect(table.spots[2]?.cards).toHaveLength(2);
    expect(table.dealer).toHaveLength(2);
    expect(table.spots.map((s) => s.wagerCents)).toEqual([1_000, 500, 2_000]);
  });

  it('deals a chair at a time and then the dealer, so one playing chair is the solo order', () => {
    // [player, dealer, player, dealer] — byte for byte what the one-seat reducer's `deal` consumes.
    const table = dealt([true, false], [{ seat: 0, cents: 1_000 }], stacked('5', 'K', '9', '7'));
    expect(table.spots[0]?.cards).toEqual(hand('5', '9'));
    expect(table.dealer).toEqual(hand('K', '7'));
  });

  it('deals nothing to a chair that is not in the round', () => {
    const table = dealt(
      [true, false, true],
      [
        { seat: 0, cents: 1_000 },
        { seat: 2, cents: 1_000 },
      ],
      stacked('5', '9', 'K', '6', '4', '7')
    );
    expect(table.spots[0]?.cards).toEqual(hand('5', '6'));
    expect(table.spots[1]?.cards).toEqual([]);
    expect(table.spots[2]?.cards).toEqual(hand('9', '4'));
    expect(table.dealer).toEqual(hand('K', '7'));
  });

  it('opens on the first chair that has to act, skipping one dealt a natural', () => {
    // s0 gets A,K = natural; s1 gets 5,9 = 14 and has to play.
    const table = twoUp(stacked('A', '5', '6', 'K', '9', '7'));
    expect(table.spots[0]?.done).toBe(true);
    expect(table.spots[0]?.result).toBeNull(); // scored at the settle, with everybody else
    expect(table.turn).toBe(1);
  });

  it('settles the whole round when every chair was dealt a natural', () => {
    // THE STALL THIS CAUGHT, and the reason it is a case rather than an afterthought: with nobody
    // left to act the deal used to leave the round in `'player'` with `turn: -1`, which no client
    // and no bot can advance and which `pendingSeats` reports as waiting for nobody. A table that
    // hangs looks exactly like a table that is thinking.
    const table = twoUp(stacked('A', 'A', '6', 'K', 'K', '7')); // both chairs A,K ; dealer 6,7
    expect(roundOver(table)).toBe(true);
    expect(table.turn).toBe(-1);
    expect(table.spots[0]?.result).toBe('blackjack');
    expect(table.spots[1]?.result).toBe('blackjack');
  });
});

describe('the peek — slice 1, at a table', () => {
  it('settles EVERY chair at the deal when the dealer has a natural, before anyone acts', () => {
    // Dealer K,A = natural. s0 has 5,9=14 and s1 has 10,6=16 — both would have played on.
    const table = twoUp(stacked('5', '10', 'K', '9', '6', 'A'));
    expect(roundOver(table)).toBe(true);
    expect(table.turn).toBe(-1);
    expect(table.spots[0]?.result).toBe('lose');
    expect(table.spots[1]?.result).toBe('lose');
  });

  it('offers no double once the dealer natural has settled the round — the second stake', () => {
    // THE BUG SLICE 1 FIXED, one container out. `canDoubleAt` is true on the opening two cards, so
    // without the peek a chair could put a second stake on a round that was already over and the
    // house would take both. Asserted per chair, because a table gets it wrong once per seat.
    const table = twoUp(stacked('5', '10', 'K', '9', '6', 'A'));
    expect(canDoubleAt(table, 0)).toBe(false);
    expect(canDoubleAt(table, 1)).toBe(false);
    expect(applyMove(table, 0, { type: 'double' })).toBe(table);
    expect(applyMove(table, 1, { type: 'double' })).toBe(table);
    expect(applyMove(table, 0, { type: 'hit' })).toBe(table);
  });

  it('leaves an ordinary round completely alone — additivity', () => {
    // Dealer K,7 = 17, no natural. Nothing about the peek may be visible at a table it does not fire
    // at, which is the assertion that says this whole rule is invisible to the game that shipped.
    const table = twoUp(stacked('5', '10', 'K', '9', '6', '7'));
    expect(table.phase).toBe('player');
    expect(table.turn).toBe(0);
    expect(canDoubleAt(table, 0)).toBe(true);
  });

  it('a dealer natural pushes a chair that also has one, and beats the chair that does not', () => {
    // One `settle` call per chair over ONE finished dealer hand — a table cannot read one dealer
    // total two ways.
    const table = twoUp(stacked('A', '5', 'K', 'K', '9', 'A'));
    expect(table.spots[0]?.result).toBe('push');
    expect(table.spots[1]?.result).toBe('lose');
  });
});

describe('insurance at a table', () => {
  /** An Ace up, so the round opens on the offer rather than the peek. Dealer's hole is the 6th card. */
  const aceUp = (hole: Rank) => twoUp(stacked('5', '10', 'A', '9', '6', hole));

  it('offers every playing chair and nobody else, and waits for all of them', () => {
    const table = dealt(
      [true, true, false],
      [
        { seat: 0, cents: 1_000 },
        { seat: 1, cents: 1_000 },
      ],
      stacked('5', '10', 'A', '9', '6', 'K')
    );
    expect(table.phase).toBe('insurance');
    expect(canInsureAt(table, 0)).toBe(true);
    expect(canInsureAt(table, 1)).toBe(true);
    expect(canInsureAt(table, 2)).toBe(false); // not in the round
    expect(pendingSeats(table)).toEqual([0, 1]);
  });

  it('DOES NOT PEEK until the last chair has answered', () => {
    // The bit the others are still paying for. A table that peeked on the first answer would end
    // the round — and reveal the hole card — under a chair that was still deciding.
    const table = aceUp('K');
    const one = applyMove(table, 0, { type: 'insure' });
    expect(one.phase).toBe('insurance');
    expect(roundOver(one)).toBe(false);
    const both = applyMove(one, 1, { type: 'decline' });
    expect(roundOver(both)).toBe(true);
  });

  it('pays 2:1 plus the stake back to the chair that insured, and nothing to the one that did not', () => {
    let table = aceUp('K'); // dealer A,K = natural
    table = applyMove(table, 0, { type: 'insure' });
    table = applyMove(table, 1, { type: 'decline' });
    const stake = insuranceStake(1_000);
    expect(table.spots[0]?.insuranceCents).toBe(stake);
    expect(table.spots[0]?.insurancePaidCents).toBe(stake * 3);
    expect(table.spots[1]?.insuranceCents).toBe(0);
    expect(table.spots[1]?.insurancePaidCents).toBe(0);
    // AND THE HAND IS STILL LOST for both. A side bet never moves whether the hand was won —
    // `settle` is not told about it.
    expect(table.spots[0]?.result).toBe('lose');
    expect(table.spots[1]?.result).toBe('lose');
    // Insured, the chair comes out exactly level: it staked 1000 + 500 and got back 1500.
    expect(spotPayout(table.spots[0]!)).toBe(1_500);
    expect(spotPayout(table.spots[1]!)).toBe(0);
  });

  it('costs exactly the side stake when the dealer has no natural, and the round plays on', () => {
    let table = aceUp('7'); // dealer A,7 = soft 18
    table = applyMove(table, 0, { type: 'insure' });
    table = applyMove(table, 1, { type: 'decline' });
    expect(table.phase).toBe('player');
    expect(table.turn).toBe(0);
    expect(table.spots[0]?.insuranceCents).toBe(insuranceStake(1_000));
    expect(table.spots[0]?.insurancePaidCents).toBe(0);
  });

  it('answers once and only once, and hit/stand/double are refused while the offer stands', () => {
    const table = aceUp('7');
    const answered = applyMove(table, 0, { type: 'decline' });
    expect(applyMove(answered, 0, { type: 'insure' })).toBe(answered);
    expect(applyMove(answered, 0, { type: 'decline' })).toBe(answered);
    for (const move of ['hit', 'stand', 'double'] as const) {
      expect(applyMove(table, 0, { type: move })).toBe(table);
    }
    // And the other direction: the offer is not answerable once the round is playing.
    const playing = twoUp(stacked('5', '10', 'K', '9', '6', '7'));
    expect(applyMove(playing, 0, { type: 'insure' })).toBe(playing);
  });

  it('CANNOT SEE THE HOLE CARD — the security property', () => {
    // `canInsureAt` is projected to every seat while `dealer[1]` is withheld from all of them, so an
    // offer that consulted what the dealer TOTALS would hand over the bit the player is paying for,
    // for free, and nothing on any screen would look wrong. Two tables differing ONLY in the hole
    // card must be indistinguishable through this predicate — and through the whole projection.
    const natural = aceUp('K');
    const not = aceUp('7');
    for (const seat of [0, 1, 2]) {
      expect(canInsureAt(natural, seat)).toBe(canInsureAt(not, seat));
    }
    expect(toPublic(natural)).toEqual(toPublic(not));
  });

  it('floors an odd stake — the parseInt chip with the sign flipped', () => {
    let table = twoUp(stacked('5', '10', 'A', '9', '6', '7'), 999);
    table = applyMove(table, 0, { type: 'insure' });
    expect(table.spots[0]?.insuranceCents).toBe(499);
  });
});

describe('turn order', () => {
  it('hands the turn on when a chair stands, and skips one that is already done', () => {
    const table = twoUp(stacked('5', '10', 'K', '9', '6', '7')); // s0 14, s1 16, dealer 17
    expect(table.turn).toBe(0);
    const stood = applyMove(table, 0, { type: 'stand' });
    expect(stood.turn).toBe(1);
    expect(stood.spots[0]?.done).toBe(true);
    expect(roundOver(stood)).toBe(false); // s1 has not acted
  });

  it('refuses a move from a chair that is not on turn, and from one that is done', () => {
    const table = twoUp(stacked('5', '10', 'K', '9', '6', '7'));
    expect(applyMove(table, 1, { type: 'hit' })).toBe(table);
    expect(applyMove(table, 1, { type: 'stand' })).toBe(table);
    expect(applyMove(table, 1, { type: 'double' })).toBe(table);
    const stood = applyMove(table, 0, { type: 'stand' });
    expect(applyMove(stood, 0, { type: 'hit' })).toBe(stood);
  });

  it('carries the turn past a busted chair without ending the round', () => {
    // s0: 10,6 = 16, hits a 9 → 25 bust. s1: 10,7 = 17 and still has to act.
    const table = twoUp(stacked('10', '10', 'K', '6', '7', '7', '9'));
    const bust = applyMove(table, 0, { type: 'hit' });
    expect(isBust(bust.spots[0]?.cards ?? [])).toBe(true);
    expect(bust.spots[0]?.done).toBe(true);
    expect(bust.turn).toBe(1);
    expect(roundOver(bust)).toBe(false);
    // A busted chair's result is still null until the settle — one place computes every result.
    expect(bust.spots[0]?.result).toBeNull();
  });

  it('never lands the turn on a chair with nothing to do, over a whole three-handed round', () => {
    // s0 is dealt a natural (done at the deal), s1 plays, s2 plays. The turn must go 1 → 2 → over.
    let table = dealt(
      [true, true, true],
      [
        { seat: 0, cents: 1_000 },
        { seat: 1, cents: 1_000 },
        { seat: 2, cents: 1_000 },
      ],
      stacked('A', '5', '9', 'K', 'K', '10', '7', '9', '6')
    );
    expect(table.turn).toBe(1);
    table = applyMove(table, 1, { type: 'stand' });
    expect(table.turn).toBe(2);
    table = applyMove(table, 2, { type: 'stand' });
    expect(roundOver(table)).toBe(true);
    expect(table.turn).toBe(-1);
  });

  it('plays the dealer out ONCE, for everybody, when the last chair finishes', () => {
    // Dealer 10,6 = 16, must draw. Both chairs stand on made hands, and both are scored against the
    // SAME finished dealer hand — this is the case a per-seat dealer would get wrong invisibly.
    let table = twoUp(stacked('K', 'K', '10', '9', '8', '6', '5')); // s0 19, s1 18, dealer 16 + 5 = 21
    table = applyMove(table, 0, { type: 'stand' });
    table = applyMove(table, 1, { type: 'stand' });
    expect(roundOver(table)).toBe(true);
    expect(handValue(table.dealer).total).toBe(21);
    expect(table.spots[0]?.result).toBe('lose');
    expect(table.spots[1]?.result).toBe('lose');
  });
});

describe('the double', () => {
  it('takes one card, doubles the recorded stake and stands', () => {
    const table = twoUp(stacked('5', '10', 'K', '6', '9', '7', '9')); // s0 11, doubles into a 9 → 20
    const doubled = applyMove(table, 0, { type: 'double' });
    expect(doubled.spots[0]?.cards).toHaveLength(3);
    expect(doubled.spots[0]?.wagerCents).toBe(2_000);
    expect(doubled.spots[0]?.doubled).toBe(true);
    expect(doubled.spots[0]?.done).toBe(true);
    expect(doubled.turn).toBe(1); // the turn moved on, it did not settle
  });

  it('is offered on the opening two cards only, and only on turn', () => {
    const table = twoUp(stacked('5', '10', 'K', '6', '9', '7', '2'));
    expect(canDoubleAt(table, 0)).toBe(true);
    expect(canDoubleAt(table, 1)).toBe(false); // not on turn
    const hit = applyMove(table, 0, { type: 'hit' });
    expect(canDoubleAt(hit, 0)).toBe(false); // three cards
    expect(applyMove(hit, 0, { type: 'double' })).toBe(hit);
  });

  it('settles a doubled chair over the DOUBLED stake', () => {
    let table = twoUp(stacked('5', '10', '9', '6', '9', '7', 'K')); // s0 11 + K = 21, dealer 16 + …
    table = applyMove(table, 0, { type: 'double' });
    table = applyMove(table, 1, { type: 'stand' });
    expect(roundOver(table)).toBe(true);
    const spot = table.spots[0]!;
    expect(spot.wagerCents).toBe(2_000);
    // One `payoutCents` over the doubled figure covers BOTH stakes — the solo settle's rule.
    expect(spotPayout(spot)).toBe(payoutCents(spot.result!, 2_000));
  });
});

describe('the projection', () => {
  it('carries ONE dealer card while a round is live, and reveals at the settle', () => {
    const live = twoUp(stacked('5', '10', 'K', '9', '6', '7'));
    expect(toPublic(live).dealer).toHaveLength(1);
    let table = applyMove(live, 0, { type: 'stand' });
    table = applyMove(table, 1, { type: 'stand' });
    expect(toPublic(table).dealer.length).toBeGreaterThanOrEqual(2);
  });

  it('has no deck field, at any phase, in the serialised payload', () => {
    // The structural guarantee, asserted the way the referee's tests assert it: through JSON,
    // because that is what actually crosses the wire. `BlackjackTableState` has no `deck` to
    // forget to strip, so this is what proves the type is the whole story.
    const betting = openRound([true, true], 0);
    const live = twoUp(stacked('5', '10', 'K', '9', '6', '7'));
    const offered = twoUp(stacked('5', '10', 'A', '9', '6', '7'));
    let settled = applyMove(live, 0, { type: 'stand' });
    settled = applyMove(settled, 1, { type: 'stand' });
    for (const table of [betting, live, offered, settled]) {
      const wire = JSON.stringify(toPublic(table));
      expect(wire).not.toContain('"deck"');
    }
    // And the live table's hole card is genuinely gone rather than reordered somewhere.
    expect(JSON.stringify(toPublic(live)).length).toBeLessThan(JSON.stringify(live).length);
  });

  it('shows every chair every other chair’s cards — this game has no private channel', () => {
    const table = twoUp(stacked('5', '10', 'K', '9', '6', '7'));
    const view = toPublic(table);
    expect(view.spots[0]?.cards).toEqual(hand('5', '9'));
    expect(view.spots[1]?.cards).toEqual(hand('10', '6'));
  });

  it('quotes the insurance PRICE while the offer stands and the CHARGE once it is taken', () => {
    const offered = twoUp(stacked('5', '10', 'A', '9', '6', '7'), 999);
    expect(toPublic(offered).spots[0]?.insuranceCents).toBe(499);
    const taken = applyMove(offered, 0, { type: 'insure' });
    expect(toPublic(taken).spots[0]?.insuranceCents).toBe(499);
    expect(toPublic(taken).spots[0]?.insured).toBe(true);
    // A chair that never insured reports 0 and `insured: false` — what tells the two zeroes apart.
    expect(toPublic(taken).spots[1]?.insured).toBe(false);
  });

  it('says who the table is waiting for, in every phase', () => {
    const betting = openRound([true, true], 0);
    expect(toPublic(betting).pending).toEqual([0, 1]);
    const live = twoUp(stacked('5', '10', 'K', '9', '6', '7'));
    expect(toPublic(live).pending).toEqual([0]);
    let settled = applyMove(live, 0, { type: 'stand' });
    settled = applyMove(settled, 1, { type: 'stand' });
    expect(toPublic(settled).pending).toEqual([]);
  });
});

describe('the house', () => {
  it('bets, declines insurance, and plays basic hitting and standing', () => {
    const betting = openRound([true, true], 0);
    expect(chooseAiMove(betting, 0)).toEqual({ type: 'bet', wagerCents: AI_WAGER_CENTS });
    const offered = twoUp(stacked('5', '10', 'A', '9', '6', '7'));
    // Insurance is the bet basic strategy always declines, so a bot that took it would be losing
    // the house's own measured edge back on a side bet nobody asked it to make.
    expect(chooseAiMove(offered, 0)).toEqual({ type: 'decline' });
  });

  it('hits a stiff hand against a strong up-card and stands against a weak one', () => {
    const vsTen = twoUp(stacked('10', '5', 'K', '6', '9', '7')); // s0 16 vs dealer K
    expect(chooseAiMove(vsTen, 0)).toEqual({ type: 'hit' });
    const vsFive = twoUp(stacked('10', '5', '5', '6', '9', '7')); // s0 16 vs dealer 5
    expect(chooseAiMove(vsFive, 0)).toEqual({ type: 'stand' });
  });

  it('never stands on a soft hand it cannot bust', () => {
    const soft = twoUp(stacked('A', '5', 'K', '6', '9', '7')); // s0 A,6 = soft 17
    expect(chooseAiMove(soft, 0)).toEqual({ type: 'hit' });
  });

  it('PLAYS WHOLE ROUNDS TO A SETTLE, with every move ACCEPTED', () => {
    // The rule this exists for: an illegal bot move is not a crash, it is a no-op on a turn only
    // the bot can take, and the table then waits forever. Only playing to the END catches it —
    // a case that asserts one legal move would pass while the table hung on the next one.
    let seed = 1;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 400; round += 1) {
      const seats = 2 + (round % 3); // 2, 3 and 4 chairs
      let table = openRound(
        Array.from({ length: seats }, () => true),
        round
      );
      let guard = 0;
      while (!roundOver(table)) {
        guard += 1;
        expect(guard).toBeLessThan(200); // a stall is the failure, so it must not be a hang
        const seat = pendingSeats(table)[0];
        expect(seat).toBeDefined();
        const before = table;
        table = applyMove(table, seat!, chooseAiMove(table, seat!), () =>
          shuffle(freshDeck(), rng)
        );
        // EVERY move must CHANGE the table. A bot move the reducer refuses returns the same object.
        expect(table).not.toBe(before);
      }
      // And every chair that played got a result, over one dealer hand.
      for (const spot of table.spots) expect(spot.result).not.toBeNull();
    }
  });

  it('never runs the deck dry, at the largest table this game seats', () => {
    // A fresh 52 holds 340 pips counting aces as 1, and a hand stops the moment it passes 21, so
    // five hands can consume at most ~160. `drawOne` throws rather than degrading, so the arithmetic
    // in the header is fuzzed rather than trusted.
    let seed = 99;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 2_000; round += 1) {
      let table = openRound([true, true, true, true], round);
      let guard = 0;
      while (!roundOver(table)) {
        // A refused move returns the SAME table, so a loop driven off `pendingSeats` spins forever
        // rather than failing if anything here stops advancing. A guard, not a hang: a suite that
        // has to be killed reports nothing at all, which is worse than a red line.
        guard += 1;
        expect(guard).toBeLessThan(300);
        const seat = pendingSeats(table)[0]!;
        // `hit` wherever it is legal, which draws far harder than any bot or player would.
        const move =
          table.phase === 'player' ? ({ type: 'hit' } as const) : chooseAiMove(table, seat);
        table = applyMove(table, seat, move, () => shuffle(freshDeck(), rng));
      }
      expect(table.deck.length).toBeGreaterThan(0);
    }
  });
});

describe('totality and immutability', () => {
  it('leaves the input untouched', () => {
    const table = twoUp(stacked('5', '10', 'K', '9', '6', '7'));
    const before = JSON.stringify(table);
    applyMove(table, 0, { type: 'hit' });
    applyMove(table, 0, { type: 'stand' });
    applyMove(table, 0, { type: 'double' });
    expect(JSON.stringify(table)).toBe(before);
  });

  it('shares the structure of chairs that did not move', () => {
    const table = twoUp(stacked('5', '10', 'K', '9', '6', '7'));
    const after = applyMove(table, 0, { type: 'hit' });
    expect(after.spots[1]).toBe(table.spots[1]);
    expect(after.spots[0]).not.toBe(table.spots[0]);
  });

  it('refuses every move once the round is settled', () => {
    let table = twoUp(stacked('5', '10', 'K', '9', '6', '7'));
    table = applyMove(table, 0, { type: 'stand' });
    table = applyMove(table, 1, { type: 'stand' });
    expect(roundOver(table)).toBe(true);
    for (const move of ['hit', 'stand', 'double', 'insure', 'decline'] as const) {
      expect(applyMove(table, 0, { type: move })).toBe(table);
    }
    expect(applyMove(table, 0, { type: 'bet', wagerCents: 1_000 })).toBe(table);
    expect(pendingSeats(table)).toEqual([]);
  });
});
