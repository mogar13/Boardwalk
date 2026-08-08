/**
 * Blackjack's rules, pure and therefore testable to the last case — the whole reason the game's
 * `logic/` is a hookless module (ARCHITECTURE.md's build order: extract logic → test logic → draw
 * UI). Blackjack's assigned coverage is the CASINO ECONOMY, so the load-bearing assertions here are
 * the settle matrix and the integer-safe 3:2 payout — the exact spot v1 dropped a chip through
 * `parseInt` — plus the ace-soft scoring and the dealer's fixed strategy, which are where the subtle
 * rule bugs hide.
 */
import { describe, it, expect } from 'vitest';
import {
  type Card,
  type Rank,
  type Suit,
  canDouble,
  canInsure,
  dealerShouldHit,
  insurancePayout,
  insuranceStake,
  drawOne,
  freshDeck,
  handValue,
  initialState,
  isBlackjack,
  isBust,
  payoutCents,
  playDealer,
  reducer,
  resultOutcome,
  settle,
  shuffle,
} from '@boardwalk/game-logic/games/blackjack';

/** Compact card builder: `c('A')` is the ace of spades; suit rarely matters to the rules. */
function c(rank: Rank, suit: Suit = 'spades'): Card {
  return { rank, suit };
}
/** A hand from ranks, for readable value/settle cases. */
function hand(...ranks: Rank[]): Card[] {
  return ranks.map((r) => c(r));
}

describe('handValue', () => {
  it('sums number and face cards', () => {
    expect(handValue(hand('5', '9')).total).toBe(14);
    expect(handValue(hand('K', 'Q')).total).toBe(20);
    expect(handValue(hand('10', 'J', '2')).total).toBe(22);
  });

  it('counts an ace as 11 when it fits (soft), 1 when it does not (hard)', () => {
    expect(handValue(hand('A', '6'))).toEqual({ total: 17, soft: true });
    expect(handValue(hand('A', '6', '10'))).toEqual({ total: 17, soft: false });
    expect(handValue(hand('A', 'K'))).toEqual({ total: 21, soft: true });
  });

  it('demotes only as many aces as needed', () => {
    expect(handValue(hand('A', 'A'))).toEqual({ total: 12, soft: true }); // 11 + 1
    expect(handValue(hand('A', 'A', '9'))).toEqual({ total: 21, soft: true }); // 11 + 1 + 9
    expect(handValue(hand('A', 'A', 'K', 'K'))).toEqual({ total: 22, soft: false }); // both aces = 1
  });
});

describe('isBlackjack / isBust', () => {
  it('is a natural only on two cards totalling 21', () => {
    expect(isBlackjack(hand('A', 'K'))).toBe(true);
    expect(isBlackjack(hand('A', '10'))).toBe(true);
    expect(isBlackjack(hand('7', '7', '7'))).toBe(false); // 21 on three cards is not a blackjack
    expect(isBlackjack(hand('K', '9'))).toBe(false);
  });
  it('busts over 21', () => {
    expect(isBust(hand('K', 'Q', '5'))).toBe(true);
    expect(isBust(hand('K', 'Q'))).toBe(false);
    expect(isBust(hand('A', 'K', 'K'))).toBe(false); // 21, ace demoted
  });
});

describe('dealerShouldHit — stands on all 17s', () => {
  it('hits below 17, stands at 17 and up', () => {
    expect(dealerShouldHit(hand('10', '6'))).toBe(true); // 16
    expect(dealerShouldHit(hand('10', '7'))).toBe(false); // 17
    expect(dealerShouldHit(hand('K', 'Q'))).toBe(false); // 20
  });
  it('stands on soft 17 (does not hit it)', () => {
    expect(dealerShouldHit(hand('A', '6'))).toBe(false); // soft 17
    expect(dealerShouldHit(hand('A', '5'))).toBe(true); // soft 16
  });
});

describe('deck + shuffle', () => {
  it('is 52 distinct cards', () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((d) => `${d.rank}-${d.suit}`)).size).toBe(52);
  });

  it('shuffles to a permutation without mutating the input, deterministically for a fixed rng', () => {
    const deck = freshDeck();
    // A tiny seeded LCG — deterministic, so the assertion is stable without stubbing Math.random.
    let s = 12345;
    const rng = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const a = shuffle(deck, rng);
    expect(deck.map((d) => d.rank + d.suit)).toEqual(freshDeck().map((d) => d.rank + d.suit)); // input untouched
    expect(a).toHaveLength(52);
    expect(new Set(a.map((d) => `${d.rank}-${d.suit}`)).size).toBe(52); // same multiset, no loss/dupe
    expect(a.map((d) => d.rank + d.suit)).not.toEqual(deck.map((d) => d.rank + d.suit)); // actually moved
  });

  it('draws the top card and throws on an empty deck', () => {
    const { card, deck } = drawOne(hand('A', 'K', '5'));
    expect(card).toEqual(c('A'));
    expect(deck).toHaveLength(2);
    expect(() => drawOne([])).toThrow();
  });
});

describe('playDealer', () => {
  it('draws until 17+ then stops', () => {
    // Dealer holds 6+9=15, then the deck feeds a 5 → 20, stand.
    const { dealer, deck } = playDealer(hand('6', '9'), hand('5', 'K'));
    expect(handValue(dealer).total).toBe(20);
    expect(deck).toHaveLength(1); // only the 5 was taken
  });
  it('stands immediately on a pat hand', () => {
    const { dealer, deck } = playDealer(hand('K', '8'), hand('5'));
    expect(dealer).toHaveLength(2);
    expect(deck).toHaveLength(1);
  });
  it('can bust', () => {
    const { dealer } = playDealer(hand('K', '6'), hand('J')); // 16 → +10 = 26
    expect(isBust(dealer)).toBe(true);
  });
});

describe('settle — the outcome matrix', () => {
  it('player bust always loses, even against a bust-bound dealer', () => {
    expect(settle(hand('K', 'Q', '5'), hand('6', '5'))).toBe('lose');
  });
  it('both naturals push; player natural pays; dealer natural beats a non-natural 21', () => {
    expect(settle(hand('A', 'K'), hand('A', 'Q'))).toBe('push');
    expect(settle(hand('A', 'K'), hand('9', '9'))).toBe('blackjack');
    expect(settle(hand('7', '7', '7'), hand('A', 'K'))).toBe('lose'); // 21 on 3 cards vs natural
  });
  it('beats, loses to, and ties the dealer by total', () => {
    expect(settle(hand('K', '9'), hand('K', '7'))).toBe('win'); // 19 vs 17
    expect(settle(hand('K', '7'), hand('K', '9'))).toBe('lose'); // 17 vs 19
    expect(settle(hand('K', '9'), hand('K', '9'))).toBe('push'); // 19 vs 19
    expect(settle(hand('K', '9'), hand('K', 'Q', '5'))).toBe('win'); // dealer busts
  });
});

describe('payoutCents — integer-safe, gross returned', () => {
  it('pays even money, push returns the stake, a loss returns nothing', () => {
    expect(payoutCents('win', 1000)).toBe(2000);
    expect(payoutCents('push', 1000)).toBe(1000);
    expect(payoutCents('lose', 1000)).toBe(0);
  });
  it('pays a natural 3:2 as stake + winnings', () => {
    expect(payoutCents('blackjack', 1000)).toBe(2500); // $10 → $25 back, net +$15
    expect(payoutCents('blackjack', 500)).toBe(1250); // $5 → $12.50 back
  });
  it('floors the odd half-cent instead of dropping the chip (the v1 parseInt bug)', () => {
    // wager 505¢: winnings = floor(757.5) = 757, total 1262 — an integer, never NaN or a float.
    const p = payoutCents('blackjack', 505);
    expect(p).toBe(1262);
    expect(Number.isInteger(p)).toBe(true);
  });
  it('maps results to the economy outcome', () => {
    expect(resultOutcome('blackjack')).toBe('win');
    expect(resultOutcome('win')).toBe('win');
    expect(resultOutcome('push')).toBe('push');
    expect(resultOutcome('lose')).toBe('loss');
  });
});

// ── The reducer ──────────────────────────────────────────────────────────────────────────────────

/** A deck whose first four cards are dealt player, dealer, player, dealer; the rest feeds hits. */
function stackedDeck(order: Card[]): Card[] {
  return [...order, ...freshDeck()]; // pad so draws never run dry
}

describe('reducer', () => {
  it('deals two to each and opens the player turn, bumping handId', () => {
    const deck = stackedDeck(hand('5', 'K', '9', '7')); // player 5,9=14 ; dealer K,7=17
    const s = reducer(initialState(), { type: 'deal', deck, wagerCents: 1000 });
    expect(s.phase).toBe('player');
    expect(s.player).toHaveLength(2);
    expect(s.dealer).toHaveLength(2);
    expect(s.wagerCents).toBe(1000);
    expect(s.handId).toBe(1);
  });

  it('settles immediately on a dealt natural', () => {
    const deck = stackedDeck(hand('A', '9', 'K', '7')); // player A,K = 21 natural ; dealer 9,7
    const s = reducer(initialState(), { type: 'deal', deck, wagerCents: 1000 });
    expect(s.phase).toBe('settled');
    expect(s.result).toBe('blackjack');
  });

  it('hit stays in play, or busts to a loss', () => {
    const base = reducer(initialState(), {
      type: 'deal',
      deck: stackedDeck(hand('10', 'K', '6', '7', '9', '5')), // player 10,6=16 ; hit 9 → 25 bust
      wagerCents: 1000,
    });
    const bust = reducer(base, { type: 'hit' });
    expect(bust.phase).toBe('settled');
    expect(bust.result).toBe('lose');
  });

  it('stand runs the dealer out and settles', () => {
    const deck = stackedDeck(hand('K', '10', '9', '6', '5')); // player 19 ; dealer 16, hits 5 → 21
    const dealt = reducer(initialState(), { type: 'deal', deck, wagerCents: 1000 });
    const done = reducer(dealt, { type: 'stand' });
    expect(done.phase).toBe('settled');
    expect(handValue(done.dealer).total).toBe(21);
    expect(done.result).toBe('lose'); // 19 vs 21
  });

  it('double takes one card, doubles the wager, and stands', () => {
    const deck = stackedDeck(hand('5', 'K', '6', '7', '9')); // player 5,6=11 ; double draws 9 → 20 ; dealer K,7=17
    const dealt = reducer(initialState(), { type: 'deal', deck, wagerCents: 1000 });
    expect(canDouble(dealt)).toBe(true);
    const done = reducer(dealt, { type: 'double' });
    expect(done.doubled).toBe(true);
    expect(done.wagerCents).toBe(2000);
    expect(done.player).toHaveLength(3);
    expect(done.phase).toBe('settled');
    expect(done.result).toBe('win'); // 20 vs 17
  });

  it('ignores illegal actions for the phase, and newHand resets but keeps handId', () => {
    const settled = reducer(initialState(), {
      type: 'deal',
      deck: stackedDeck(hand('A', '9', 'K', '7')), // instant natural → settled
      wagerCents: 1000,
    });
    expect(reducer(settled, { type: 'hit' })).toBe(settled); // no-op, same reference
    const next = reducer(settled, { type: 'newHand' });
    expect(next.phase).toBe('betting');
    expect(next.player).toHaveLength(0);
    expect(next.handId).toBe(1); // preserved, so the next deal is handId 2
    expect(canDouble(next)).toBe(false);
  });
});

// ── The peek, and insurance ──────────────────────────────────────────────────────────────────────
//
// Two rules that are really one: the dealer looks at the hole card for a natural, and insurance is
// the bet you are offered because that look is about to happen. They landed together for that
// reason, and the peek is the half that was MISSING rather than new — see `peek` in the rulebook
// for what its absence was costing.

describe('the peek', () => {
  it('settles a dealt DEALER natural at the deal, and the player never gets to double into it', () => {
    // Dealer K,A = 21 with the KING up, so there is no insurance offer in the way — this is the
    // plain peek. Before this rule the hand ran on to `phase: 'player'`.
    const deck = stackedDeck(hand('5', 'K', '9', 'A')); // player 5,9=14 ; dealer K,A = natural
    const s = reducer(initialState(), { type: 'deal', deck, wagerCents: 1000 });

    expect(s.phase).toBe('settled');
    expect(s.result).toBe('lose');

    // THE MONEY HALF, and the whole reason this is a defect rather than a tidiness point. The hand
    // is over, so `canDouble` is false and a double is a no-op — where before it was offered on the
    // opening two cards regardless, took a SECOND stake, and `settle` then took both. A real table
    // ends the hand before anyone acts and takes one.
    expect(canDouble(s)).toBe(false);
    expect(reducer(s, { type: 'double' })).toBe(s);
    expect(s.wagerCents).toBe(1000);
    expect(s.doubled).toBe(false);
  });

  it('does NOT peek behind an ACE, because that is the hand insurance exists for', () => {
    // The same dealer natural, dealt the other way round: A up, K in the hole. Peeking here would
    // end the hand before the offer could be made, and insurance would be unreachable forever.
    const deck = stackedDeck(hand('5', 'A', '9', 'K')); // dealer A,K = natural, ACE showing
    const s = reducer(initialState(), { type: 'deal', deck, wagerCents: 1000 });

    expect(s.phase).toBe('insurance');
    expect(s.result).toBeNull();
    expect(canInsure(s)).toBe(true);
  });

  it('leaves an ordinary hand exactly where it was', () => {
    // Additivity: the overwhelming majority of hands have neither an ace up nor a dealer natural,
    // and this rule must be invisible to every one of them.
    const deck = stackedDeck(hand('5', 'K', '9', '7')); // dealer K,7 = 17
    const s = reducer(initialState(), { type: 'deal', deck, wagerCents: 1000 });
    expect(s.phase).toBe('player');
    expect(canInsure(s)).toBe(false);
  });

  it('still settles a PLAYER natural against an ace up, rather than offering insurance', () => {
    // The documented simplification: a real table would offer even money here. Declining it is the
    // honest outcome, and this asserts we take that branch rather than stranding a won hand in the
    // insurance phase.
    const deck = stackedDeck(hand('A', 'A', 'K', '9')); // player A,K = natural ; dealer A,9 = soft 20
    const s = reducer(initialState(), { type: 'deal', deck, wagerCents: 1000 });
    expect(s.phase).toBe('settled');
    expect(s.result).toBe('blackjack');
  });
});

describe('insurance', () => {
  /** A hand sitting on the insurance offer, with the hole card chosen by the caller. */
  const offered = (holeCard: Rank, wagerCents = 1000) =>
    reducer(initialState(), {
      type: 'deal',
      deck: stackedDeck(hand('5', 'A', '9', holeCard)),
      wagerCents,
    });

  it('costs half the wager, FLOORED, on an odd stake', () => {
    // v1 wrote `currentBets[activeSeat] / 2` and put a half-chip into a float bankroll. This is the
    // same defect as the 3:2 `parseInt` chip with the sign flipped, so it gets the same treatment.
    expect(insuranceStake(1001)).toBe(500);
    expect(insuranceStake(1000)).toBe(500);
    expect(insuranceStake(1)).toBe(0);
    expect(Number.isInteger(insuranceStake(333))).toBe(true);
    expect(offered('K', 1001).insuranceCents).toBe(0); // not staked until taken
    expect(reducer(offered('K', 1001), { type: 'insure' }).insuranceCents).toBe(500);
  });

  it('pays 2:1 PLUS the stake back when the dealer has the natural, and the hand is still LOST', () => {
    const s = reducer(offered('K'), { type: 'insure' });
    expect(s.phase).toBe('settled');
    expect(s.insuranceCents).toBe(500);
    expect(s.insurancePaidCents).toBe(1500); // 500 back + 1000 at 2:1
    expect(insurancePayout(500)).toBe(1500);

    // THE SIDE BET DOES NOT WIN THE HAND. `settle` is never told about it, which is what keeps
    // "did this player beat the dealer" a question about the cards. v1 called `recordWin` here.
    expect(s.result).toBe('lose');
  });

  it('is simply lost when the dealer has no natural, and the hand plays on', () => {
    const s = reducer(offered('7'), { type: 'insure' }); // dealer A,7 = soft 18
    expect(s.phase).toBe('player');
    expect(s.insuranceCents).toBe(500);
    expect(s.insurancePaidCents).toBe(0);
    expect(s.result).toBeNull();
    expect(canDouble(s)).toBe(true); // the hand is live and ordinary from here
  });

  it('declining stakes nothing and triggers the same peek', () => {
    const caught = reducer(offered('K'), { type: 'decline' });
    expect(caught.phase).toBe('settled');
    expect(caught.result).toBe('lose');
    expect(caught.insuranceCents).toBe(0);
    expect(caught.insurancePaidCents).toBe(0);

    const safe = reducer(offered('7'), { type: 'decline' });
    expect(safe.phase).toBe('player');
    expect(safe.insuranceCents).toBe(0);
  });

  it('changes NOTHING about the hand it is placed on', () => {
    // Insured and uninsured, same cards: the hand's own result and stake must be identical, because
    // insurance is a separate bet that happens to be settled at the same table.
    const insured = reducer(offered('7'), { type: 'insure' });
    const declined = reducer(offered('7'), { type: 'decline' });
    const finish = (s: typeof insured) => reducer(s, { type: 'stand' });

    expect(finish(insured).result).toBe(finish(declined).result);
    expect(finish(insured).wagerCents).toBe(finish(declined).wagerCents);
    expect(finish(insured).dealer).toEqual(finish(declined).dealer);
  });

  it('the OFFER cannot see the hole card', () => {
    // The security property, asserted directly. `canInsure` is sent to a client while `dealer[1]`
    // is deliberately withheld, so an offer that consulted the dealer's TOTAL would hand over the
    // bit the player is supposed to be paying for — and nothing on screen would look wrong.
    // Two states differing in exactly one card, one of them a natural.
    const natural = offered('K');
    const not = offered('7');
    expect(natural.dealer[0]).toEqual(not.dealer[0]); // same up-card
    expect(natural.dealer[1]).not.toEqual(not.dealer[1]); // different hole card
    expect(canInsure(natural)).toBe(canInsure(not));
    expect(canInsure(natural)).toBe(true);
  });

  it('is a no-op outside its own phase, in both directions', () => {
    // The reducer's totality discipline: an illegal action returns the SAME REFERENCE rather than
    // throwing, so a double-clicked button is harmless and the caller can detect "nothing happened".
    const live = reducer(initialState(), {
      type: 'deal',
      deck: stackedDeck(hand('5', 'K', '9', '7')), // no ace up → straight to 'player'
      wagerCents: 1000,
    });
    expect(reducer(live, { type: 'insure' })).toBe(live);
    expect(reducer(live, { type: 'decline' })).toBe(live);

    // And the hand cannot be played while the offer stands — the peek has not happened yet, so a
    // hit here would draw against a dealer who might already be holding a finished hand.
    const waiting = offered('7');
    expect(reducer(waiting, { type: 'hit' })).toBe(waiting);
    expect(reducer(waiting, { type: 'stand' })).toBe(waiting);
    expect(reducer(waiting, { type: 'double' })).toBe(waiting);
    expect(canDouble(waiting)).toBe(false);

    // Twice is not allowed either: the first `insure` leaves the offer behind.
    const once = reducer(waiting, { type: 'insure' });
    expect(reducer(once, { type: 'insure' })).toBe(once);
  });

  it('does not mutate the state it was given', () => {
    const before = offered('K');
    const snapshot = JSON.parse(JSON.stringify(before)) as unknown;
    reducer(before, { type: 'insure' });
    reducer(before, { type: 'decline' });
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });
});
