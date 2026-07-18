/**
 * Klondike solitaire's rules, pure and therefore testable to the last case — the same build order
 * as the other games (extract logic → test logic → draw UI). Solitaire's assigned coverage is that
 * a game can opt out of rooms entirely, so what these tests protect is that it is a genuine,
 * correct game standing on that room-less seam: the deal, the tableau/foundation build rules, the
 * stock draw-and-recycle, and the win — none of which touch a seat or a bankroll.
 */
import { describe, it, expect } from 'vitest';
import {
  type Card,
  type Rank,
  type Suit,
  type SolitaireState,
  canAutoComplete,
  canStackFoundation,
  canStackTableau,
  deal,
  freshDeck,
  initialState,
  isRed,
  isValidRun,
  isWon,
  liftable,
  rankOrder,
  reducer,
  shuffle,
} from '@/games/solitaire/logic/solitaire';

/** Compact card builder — face up by default (the common case in these fixtures). */
function c(rank: Rank, suit: Suit, faceUp = true): Card {
  return { rank, suit, faceUp };
}

/** A seeded LCG so `shuffle` can be driven deterministically. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('freshDeck', () => {
  it('is 52 unique cards, all face down', () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(52);
    expect(deck.every((card) => !card.faceUp)).toBe(true);
    const ids = new Set(deck.map((card) => `${card.rank}${card.suit}`));
    expect(ids.size).toBe(52);
  });
});

describe('shuffle', () => {
  it('is a permutation — same multiset, different order, input untouched', () => {
    const deck = freshDeck();
    const shuffled = shuffle(deck, seededRng(42));
    expect(shuffled).toHaveLength(52);
    const key = (card: Card) => `${card.rank}${card.suit}`;
    expect(new Set(shuffled.map(key))).toEqual(new Set(deck.map(key)));
    expect(shuffled.map(key)).not.toEqual(deck.map(key)); // vanishingly unlikely to match
    expect(deck.map(key)).toEqual(freshDeck().map(key)); // input not mutated
  });

  it('is deterministic for a given seed', () => {
    const a = shuffle(freshDeck(), seededRng(7));
    const b = shuffle(freshDeck(), seededRng(7));
    expect(a).toEqual(b);
  });
});

describe('rankOrder / isRed', () => {
  it('orders Ace low to King high', () => {
    expect(rankOrder('A')).toBe(1);
    expect(rankOrder('10')).toBe(10);
    expect(rankOrder('J')).toBe(11);
    expect(rankOrder('K')).toBe(13);
  });

  it('reds are hearts and diamonds only', () => {
    expect(isRed(c('5', 'hearts'))).toBe(true);
    expect(isRed(c('5', 'diamonds'))).toBe(true);
    expect(isRed(c('5', 'spades'))).toBe(false);
    expect(isRed(c('5', 'clubs'))).toBe(false);
  });
});

describe('deal', () => {
  it('lays out seven columns of increasing height with only the top face up, rest to stock', () => {
    const state = deal(freshDeck(), 1);
    expect(state.tableau.map((col) => col.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const col of state.tableau) {
      const top = col[col.length - 1];
      expect(top?.faceUp).toBe(true);
      expect(col.slice(0, -1).every((card) => !card.faceUp)).toBe(true);
    }
    expect(state.stock).toHaveLength(52 - (1 + 2 + 3 + 4 + 5 + 6 + 7)); // 24
    expect(state.stock.every((card) => !card.faceUp)).toBe(true);
    expect(state.waste).toHaveLength(0);
    expect(state.foundations.flat()).toHaveLength(0);
    expect(state.won).toBe(false);
  });

  it('records the chosen draw count', () => {
    expect(deal(freshDeck(), 3).drawCount).toBe(3);
    expect(deal(freshDeck(), 1).drawCount).toBe(1);
  });
});

describe('canStackTableau', () => {
  it('takes only a King on an empty column', () => {
    expect(canStackTableau(c('K', 'spades'), undefined)).toBe(true);
    expect(canStackTableau(c('Q', 'spades'), undefined)).toBe(false);
  });

  it('stacks one lower and opposite colour', () => {
    expect(canStackTableau(c('9', 'hearts'), c('10', 'spades'))).toBe(true); // red on black
    expect(canStackTableau(c('9', 'diamonds'), c('10', 'clubs'))).toBe(true);
    expect(canStackTableau(c('9', 'spades'), c('10', 'spades'))).toBe(false); // same colour
    expect(canStackTableau(c('9', 'clubs'), c('10', 'diamonds'))).toBe(true);
    expect(canStackTableau(c('8', 'hearts'), c('10', 'spades'))).toBe(false); // wrong rank gap
  });
});

describe('canStackFoundation', () => {
  it('takes only an Ace on an empty foundation', () => {
    expect(canStackFoundation(c('A', 'hearts'), [])).toBe(true);
    expect(canStackFoundation(c('2', 'hearts'), [])).toBe(false);
  });

  it('builds up by suit', () => {
    const upToThree = [c('A', 'hearts'), c('2', 'hearts'), c('3', 'hearts')];
    expect(canStackFoundation(c('4', 'hearts'), upToThree)).toBe(true);
    expect(canStackFoundation(c('4', 'spades'), upToThree)).toBe(false); // wrong suit
    expect(canStackFoundation(c('5', 'hearts'), upToThree)).toBe(false); // skips a rank
  });
});

describe('isValidRun', () => {
  it('accepts a single face-up card', () => {
    expect(isValidRun([c('7', 'hearts')])).toBe(true);
  });

  it('accepts a descending alternating face-up run', () => {
    expect(isValidRun([c('10', 'spades'), c('9', 'hearts'), c('8', 'clubs')])).toBe(true);
  });

  it('rejects same-colour, wrong-order, or face-down cards', () => {
    expect(isValidRun([c('10', 'spades'), c('9', 'clubs')])).toBe(false); // same colour
    expect(isValidRun([c('9', 'hearts'), c('10', 'spades')])).toBe(false); // ascending
    expect(isValidRun([c('10', 'spades'), c('9', 'hearts', false)])).toBe(false); // face down
    expect(isValidRun([])).toBe(false);
  });
});

describe('liftable', () => {
  const base: SolitaireState = {
    ...initialState(),
    waste: [c('4', 'clubs')],
    foundations: [[c('A', 'spades')], [], [], []],
    tableau: [
      [c('K', 'spades', false), c('Q', 'hearts'), c('J', 'clubs')],
      [c('5', 'diamonds')],
      [],
      [],
      [],
      [],
      [],
    ],
  };

  it('lifts the single top card off the waste and a foundation', () => {
    expect(liftable(base, { kind: 'waste' }, 0)).toEqual([c('4', 'clubs')]);
    expect(liftable(base, { kind: 'foundation', index: 0 }, 0)).toEqual([c('A', 'spades')]);
  });

  it('lifts a valid face-up run from a tableau column, indexing from the run start', () => {
    expect(liftable(base, { kind: 'tableau', col: 0 }, 1)).toEqual([c('Q', 'hearts'), c('J', 'clubs')]);
    expect(liftable(base, { kind: 'tableau', col: 0 }, 2)).toEqual([c('J', 'clubs')]);
  });

  it('refuses a lift starting on a face-down card, and never lifts the stock', () => {
    expect(liftable(base, { kind: 'tableau', col: 0 }, 0)).toBeNull(); // starts face-down
    expect(liftable(base, { kind: 'stock' }, 0)).toBeNull();
  });
});

describe('reducer: draw', () => {
  it('moves one card stock→waste face up (draw-1)', () => {
    const start = deal(freshDeck(), 1);
    const next = reducer(start, { type: 'draw' });
    expect(next.stock).toHaveLength(23);
    expect(next.waste).toHaveLength(1);
    expect(next.waste[0]?.faceUp).toBe(true);
    expect(next.moves).toBe(1);
  });

  it('moves three cards at a time in draw-3', () => {
    const start = deal(freshDeck(), 3);
    const next = reducer(start, { type: 'draw' });
    expect(next.stock).toHaveLength(21);
    expect(next.waste).toHaveLength(3);
  });

  it('recycles the waste back into the stock, face down, when the stock is empty', () => {
    const state: SolitaireState = {
      ...initialState(),
      stock: [],
      waste: [c('2', 'spades'), c('7', 'hearts'), c('9', 'clubs')], // last is the top
    };
    const next = reducer(state, { type: 'draw' });
    expect(next.waste).toHaveLength(0);
    expect(next.stock).toHaveLength(3);
    expect(next.stock.every((card) => !card.faceUp)).toBe(true);
    // The waste top becomes the stock bottom, so the very next draw re-serves the old bottom card.
    const afterDraw = reducer({ ...next, drawCount: 1 }, { type: 'draw' });
    expect(afterDraw.waste[0]?.rank).toBe('2');
  });

  it('is a no-op when both stock and waste are empty', () => {
    const state = { ...initialState(), stock: [], waste: [] };
    expect(reducer(state, { type: 'draw' })).toBe(state);
  });
});

describe('reducer: move', () => {
  it('sends the waste top to a foundation and flips no tableau card', () => {
    const state: SolitaireState = {
      ...initialState(),
      waste: [c('A', 'hearts')],
    };
    const next = reducer(state, {
      type: 'move',
      from: { kind: 'waste' },
      fromIndex: 0,
      to: { kind: 'foundation', index: 0 },
    });
    expect(next.foundations[0]).toEqual([c('A', 'hearts')]);
    expect(next.waste).toHaveLength(0);
    expect(next.moves).toBe(1);
  });

  it('moves a tableau run and flips the newly exposed card face up', () => {
    const state: SolitaireState = {
      ...initialState(),
      tableau: [
        [c('7', 'clubs', false), c('9', 'hearts')], // 9♥ sits on a face-down card
        [c('10', 'spades')],
        [],
        [],
        [],
        [],
        [],
      ],
    };
    const next = reducer(state, {
      type: 'move',
      from: { kind: 'tableau', col: 0 },
      fromIndex: 1,
      to: { kind: 'tableau', col: 1 },
    });
    expect(next.tableau[1]).toEqual([c('10', 'spades'), c('9', 'hearts')]);
    expect(next.tableau[0]).toEqual([c('7', 'clubs', true)]); // the 7♣ flipped up
  });

  it('takes only a King onto an empty column', () => {
    const state: SolitaireState = {
      ...initialState(),
      tableau: [[c('K', 'diamonds')], [], [], [], [], [], []],
      waste: [c('Q', 'clubs')],
    };
    const kingMove = reducer(state, {
      type: 'move',
      from: { kind: 'tableau', col: 0 },
      fromIndex: 0,
      to: { kind: 'tableau', col: 1 },
    });
    expect(kingMove.tableau[1]).toEqual([c('K', 'diamonds')]);

    const queenMove = reducer(state, {
      type: 'move',
      from: { kind: 'waste' },
      fromIndex: 0,
      to: { kind: 'tableau', col: 1 },
    });
    expect(queenMove).toBe(state); // a Queen cannot open a column
  });

  it('is a no-op for an illegal destination', () => {
    const state: SolitaireState = { ...initialState(), waste: [c('5', 'hearts')] };
    // 5♥ cannot go on an empty foundation (needs an Ace)
    const bad = reducer(state, {
      type: 'move',
      from: { kind: 'waste' },
      fromIndex: 0,
      to: { kind: 'foundation', index: 0 },
    });
    expect(bad).toBe(state);
  });

  it('refuses to move more than one card to a foundation', () => {
    const state: SolitaireState = {
      ...initialState(),
      foundations: [[c('A', 'spades')], [], [], []],
      tableau: [[c('3', 'hearts'), c('2', 'spades')], [], [], [], [], [], []],
    };
    const bad = reducer(state, {
      type: 'move',
      from: { kind: 'tableau', col: 0 },
      fromIndex: 0, // a two-card run
      to: { kind: 'foundation', index: 0 },
    });
    expect(bad).toBe(state);
  });
});

describe('reducer: auto', () => {
  it('sends a top card to the first legal foundation', () => {
    const state: SolitaireState = {
      ...initialState(),
      foundations: [[c('A', 'spades')], [], [], []],
      tableau: [[c('2', 'spades')], [], [], [], [], [], []],
    };
    const next = reducer(state, { type: 'auto', from: { kind: 'tableau', col: 0 } });
    expect(next.foundations[0]).toEqual([c('A', 'spades'), c('2', 'spades')]);
    expect(next.tableau[0]).toHaveLength(0);
  });

  it('is a no-op when no foundation accepts the card', () => {
    const state: SolitaireState = {
      ...initialState(),
      tableau: [[c('9', 'hearts')], [], [], [], [], [], []],
    };
    expect(reducer(state, { type: 'auto', from: { kind: 'tableau', col: 0 } })).toBe(state);
  });
});

describe('win and autoComplete', () => {
  /** A state one move from a win: every suit built to the Queen, four Kings waiting on the waste. */
  function nearlyWon(): SolitaireState {
    const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
    const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'];
    return {
      ...initialState(),
      foundations: suits.map((s) => ranks.map((r) => c(r, s))),
      tableau: [
        [c('K', 'spades')],
        [c('K', 'hearts')],
        [c('K', 'diamonds')],
        [c('K', 'clubs')],
        [],
        [],
        [],
      ],
    };
  }

  it('detects the win when the last card lands', () => {
    const state = nearlyWon();
    expect(isWon(state)).toBe(false);
    let s = state;
    for (let col = 0; col < 4; col++) {
      s = reducer(s, { type: 'auto', from: { kind: 'tableau', col } });
    }
    expect(isWon(s)).toBe(true);
    expect(s.won).toBe(true);
  });

  it('canAutoComplete only when every card is face up and the stock is empty', () => {
    expect(canAutoComplete(nearlyWon())).toBe(true);
    const withStock = { ...nearlyWon(), stock: [c('3', 'clubs', false)] };
    expect(canAutoComplete(withStock)).toBe(false);
    const withFaceDown: SolitaireState = {
      ...nearlyWon(),
      tableau: [[c('K', 'spades', false)], [c('K', 'hearts')], [c('K', 'diamonds')], [c('K', 'clubs')], [], [], []],
    };
    expect(canAutoComplete(withFaceDown)).toBe(false);
  });

  it('autoComplete finishes a solvable, all-face-up game', () => {
    const next = reducer(nearlyWon(), { type: 'autoComplete' });
    expect(next.won).toBe(true);
    expect(next.foundations.every((f) => f.length === 13)).toBe(true);
  });

  it('a won game accepts no further action but a fresh deal', () => {
    const won = reducer(nearlyWon(), { type: 'autoComplete' });
    expect(reducer(won, { type: 'draw' })).toBe(won);
    const redealt = reducer(won, { type: 'deal', deck: freshDeck(), drawCount: 1 });
    expect(redealt.won).toBe(false);
    expect(redealt.tableau.map((col) => col.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('immutability', () => {
  it('never mutates the input state', () => {
    const state: SolitaireState = {
      ...initialState(),
      waste: [c('A', 'clubs')],
    };
    const snapshot = JSON.parse(JSON.stringify(state)) as unknown;
    reducer(state, {
      type: 'move',
      from: { kind: 'waste' },
      fromIndex: 0,
      to: { kind: 'foundation', index: 0 },
    });
    expect(JSON.parse(JSON.stringify(state))).toEqual(snapshot);
  });
});
