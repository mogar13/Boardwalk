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
  dealerShouldHit,
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
} from '@/games/blackjack/logic/blackjack';

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
