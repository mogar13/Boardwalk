/**
 * UNO's rules, pure and therefore testable to the last case — the whole reason the game's `logic/`
 * is a hookless module (ARCHITECTURE.md's build order: extract logic → test logic → draw UI). UNO's
 * assigned coverage is the multiplayer-hard stuff: private hands, seq ordering, AI-as-occupant, a
 * 7-seat table. The rulebook underneath all of that lives in `applyMove`, so the load-bearing
 * assertions here are the action cards (skip/reverse/draw2/wild4), the UNO-call penalty, reshuffle-
 * on-empty, and win detection — plus reducer totality (an illegal intent is a no-op) and input
 * immutability, the two properties the host relies on to hand any wire intent straight in.
 */
import { describe, it, expect } from 'vitest';
import {
  type Card,
  type UnoColor,
  type UnoGame,
  NO_PENDING,
  applyMove,
  canPlay,
  chooseAiMove,
  deal,
  freshDeck,
  shuffle,
  submitMove,
  toPublic,
} from '@boardwalk/game-logic/games/uno';

// A tiny seeded PRNG so a shuffle is deterministic in a test without stubbing Math.random.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let idc = 0;
const c = (color: UnoColor | 'wild', kind: Card['kind'], value = -1): Card => ({
  id: `t${String((idc += 1))}`,
  color,
  kind,
  value,
});

/** Build a complete game with explicit hands and a chosen top card, for deterministic rule tests. */
function game(hands: Card[][], topCard: Card, over: Partial<UnoGame> = {}): UnoGame {
  return {
    hands,
    deck: [c('red', 'number', 3), c('blue', 'number', 4), c('green', 'number', 5)],
    discard: [topCard],
    color: topCard.color === 'wild' ? 'red' : topCard.color,
    turn: 0,
    direction: 1,
    calledUno: hands.map(() => false),
    winner: -1,
    ...over,
  };
}

describe('deck', () => {
  it('is 108 cards with the right composition and unique ids', () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((x) => x.id)).size).toBe(108);
    const zeros = deck.filter((x) => x.kind === 'number' && x.value === 0);
    expect(zeros).toHaveLength(4); // one per colour
    const fives = deck.filter((x) => x.kind === 'number' && x.value === 5);
    expect(fives).toHaveLength(8); // two per colour
    expect(deck.filter((x) => x.kind === 'draw2')).toHaveLength(8);
    expect(deck.filter((x) => x.kind === 'wild')).toHaveLength(4);
    expect(deck.filter((x) => x.kind === 'wild4')).toHaveLength(4);
  });

  it('shuffle is a deterministic permutation that does not mutate its input', () => {
    const deck = freshDeck();
    const a = shuffle(deck, seeded(1));
    const b = shuffle(deck, seeded(1));
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id)); // same seed → same order
    expect(a.map((x) => x.id)).not.toEqual(deck.map((x) => x.id)); // actually shuffled
    expect(new Set(a.map((x) => x.id)).size).toBe(108); // a permutation
    expect(deck[0]?.id).toBe('u0'); // input untouched
  });
});

describe('canPlay', () => {
  const top = c('red', 'number', 5);
  it('matches on colour, on value, and on action-of-any-colour; wild always plays', () => {
    expect(canPlay(c('red', 'number', 9), top, 'red')).toBe(true); // colour
    expect(canPlay(c('blue', 'number', 5), top, 'red')).toBe(true); // value
    expect(canPlay(c('blue', 'number', 9), top, 'red')).toBe(false); // neither
    expect(canPlay(c('wild', 'wild'), top, 'red')).toBe(true);
    const skipTop = c('red', 'skip');
    expect(canPlay(c('blue', 'skip'), skipTop, 'red')).toBe(true); // skip on skip, any colour
    expect(canPlay(c('blue', 'number', 5), skipTop, 'red')).toBe(false);
  });
  it('respects the active colour a wild set, not the top card colour', () => {
    const wildTop = c('wild', 'wild4');
    expect(canPlay(c('green', 'number', 2), wildTop, 'green')).toBe(true);
    expect(canPlay(c('red', 'number', 2), wildTop, 'green')).toBe(false);
  });
});

describe('deal', () => {
  it('gives seven to each seat, opens on a number card, and leaves the rest in the deck', () => {
    const g = deal(4, seeded(7));
    expect(g.hands).toHaveLength(4);
    for (const h of g.hands) expect(h).toHaveLength(7);
    expect(g.discard).toHaveLength(1);
    expect(g.discard[0]?.kind).toBe('number'); // never opens on an action/wild
    expect(g.deck).toHaveLength(108 - 4 * 7 - 1);
    expect(g.turn).toBe(0);
    expect(g.winner).toBe(-1);
    expect(g.color).toBe(g.discard[0]?.color);
  });
});

describe('applyMove — totality & immutability', () => {
  it('is a no-op off-turn, on a card you do not hold, and on an unplayable card', () => {
    const g = game([[c('red', 'number', 3)], [c('blue', 'number', 4)]], c('red', 'number', 9));
    expect(applyMove(g, 1, { type: 'play', cardId: g.hands[1]![0]!.id })).toBe(g); // not seat 1's turn
    expect(applyMove(g, 0, { type: 'play', cardId: 'nope' })).toBe(g); // no such card
    const blue = game([[c('blue', 'number', 8)]], c('red', 'number', 9));
    expect(applyMove(blue, 0, { type: 'play', cardId: blue.hands[0]![0]!.id })).toBe(blue); // unplayable
  });

  it('does not mutate the input and keeps untouched hands by reference', () => {
    const hand0 = [c('red', 'number', 3), c('red', 'number', 6), c('red', 'number', 7)];
    const hand1 = [c('blue', 'number', 4)];
    const g = game([hand0, hand1], c('red', 'number', 9));
    const next = applyMove(g, 0, { type: 'play', cardId: hand0[0]!.id });
    expect(g.hands[0]).toHaveLength(3); // input untouched
    expect(next.hands[1]).toBe(g.hands[1]); // seat 1 unchanged → same reference (structural sharing)
    expect(next.hands[0]).toHaveLength(2);
  });

  it('is a no-op once the game is finished', () => {
    const g = game([[c('red', 'number', 3)], []], c('red', 'number', 9), { winner: 1 });
    expect(applyMove(g, 0, { type: 'play', cardId: g.hands[0]![0]!.id })).toBe(g);
  });
});

describe('applyMove — a plain play and a draw', () => {
  it('plays a number: new top, new colour, turn advances one', () => {
    const g = game(
      [
        [c('red', 'number', 3), c('red', 'number', 6), c('red', 'number', 7)],
        [c('blue', 'number', 4)],
      ],
      c('blue', 'number', 3)
    );
    const next = applyMove(g, 0, { type: 'play', cardId: g.hands[0]![0]!.id });
    expect(next.discard[next.discard.length - 1]?.value).toBe(3);
    expect(next.color).toBe('red');
    expect(next.turn).toBe(1);
    expect(next.hands[0]).toHaveLength(2);
  });

  it('draw takes one card and passes the turn', () => {
    const g = game([[c('blue', 'number', 8)], [c('red', 'number', 4)]], c('red', 'number', 9));
    const next = applyMove(g, 0, { type: 'draw' });
    expect(next.hands[0]).toHaveLength(2);
    expect(next.deck).toHaveLength(g.deck.length - 1);
    expect(next.turn).toBe(1);
  });
});

describe('applyMove — action cards', () => {
  // Seat 0 carries two spare cards in these tests so playing the action does not empty its hand and
  // trip the win/no-advance path — the rule under test is the turn advance, not the win.
  const spares = (): Card[] => [c('yellow', 'number', 4), c('yellow', 'number', 5)];

  it('skip advances two seats', () => {
    const g = game(
      [[c('red', 'skip'), ...spares()], [c('blue', 'number', 1)], [c('green', 'number', 2)]],
      c('red', 'number', 9)
    );
    const next = applyMove(g, 0, { type: 'play', cardId: g.hands[0]![0]!.id });
    expect(next.turn).toBe(2); // seat 1 skipped
  });

  it('reverse flips direction (and acts as a skip heads-up)', () => {
    const three = game(
      [[c('red', 'reverse'), ...spares()], [c('blue', 'number', 1)], [c('green', 'number', 2)]],
      c('red', 'number', 9)
    );
    const n3 = applyMove(three, 0, { type: 'play', cardId: three.hands[0]![0]!.id });
    expect(n3.direction).toBe(-1);
    expect(n3.turn).toBe(2); // reversed, one step back from seat 0

    const heads = game(
      [[c('red', 'reverse'), ...spares()], [c('blue', 'number', 1)]],
      c('red', 'number', 9)
    );
    const n2 = applyMove(heads, 0, { type: 'play', cardId: heads.hands[0]![0]!.id });
    expect(n2.turn).toBe(0); // heads-up reverse = skip, back to the player
  });

  it('draw2 deals the next seat two cards and skips them', () => {
    const g = game(
      [[c('red', 'draw2'), ...spares()], [c('blue', 'number', 1)], [c('green', 'number', 2)]],
      c('red', 'number', 9)
    );
    const next = applyMove(g, 0, { type: 'play', cardId: g.hands[0]![0]!.id });
    expect(next.hands[1]).toHaveLength(3); // 1 + 2 drawn
    expect(next.turn).toBe(2); // victim skipped
  });

  it('wild4 sets the chosen colour, deals four, and skips the victim', () => {
    const g = game(
      [[c('wild', 'wild4'), ...spares()], [c('blue', 'number', 1)], [c('green', 'number', 2)]],
      c('red', 'number', 9)
    );
    const next = applyMove(g, 0, {
      type: 'play',
      cardId: g.hands[0]![0]!.id,
      chosenColor: 'green',
    });
    expect(next.color).toBe('green');
    expect(next.hands[1]).toHaveLength(5); // 1 + 4
    expect(next.turn).toBe(2);
  });

  it('a wild without a chosen colour is refused', () => {
    const g = game(
      [[c('wild', 'wild'), ...spares()], [c('blue', 'number', 1)]],
      c('red', 'number', 9)
    );
    expect(applyMove(g, 0, { type: 'play', cardId: g.hands[0]![0]!.id })).toBe(g);
    const ok = applyMove(g, 0, { type: 'play', cardId: g.hands[0]![0]!.id, chosenColor: 'yellow' });
    expect(ok.color).toBe('yellow');
  });
});

describe('applyMove — the UNO call and the win', () => {
  it('declaring UNO as you go to one card avoids the penalty', () => {
    const g = game(
      [[c('red', 'number', 3), c('red', 'number', 6)], [c('blue', 'number', 1)]],
      c('red', 'number', 9)
    );
    const next = applyMove(g, 0, { type: 'play', cardId: g.hands[0]![0]!.id, declareUno: true });
    expect(next.hands[0]).toHaveLength(1);
    expect(next.calledUno[0]).toBe(true);
  });

  it('going to one card WITHOUT declaring draws the +2 penalty', () => {
    const g = game(
      [[c('red', 'number', 3), c('red', 'number', 6)], [c('blue', 'number', 1)]],
      c('red', 'number', 9)
    );
    const next = applyMove(g, 0, { type: 'play', cardId: g.hands[0]![0]!.id });
    expect(next.hands[0]).toHaveLength(3); // 1 left + 2 penalty
    expect(next.calledUno[0]).toBe(false);
  });

  it('playing the last card wins, and the turn stops', () => {
    const g = game([[c('red', 'number', 3)], [c('blue', 'number', 1)]], c('red', 'number', 9));
    const next = applyMove(g, 0, { type: 'play', cardId: g.hands[0]![0]!.id });
    expect(next.winner).toBe(0);
    expect(next.hands[0]).toHaveLength(0);
    expect(next.turn).toBe(0); // no advance after a win
  });
});

describe('reshuffle on an empty deck', () => {
  it('recycles the discard (all but the top) when the deck runs dry', () => {
    const g = game([[c('blue', 'number', 8)], [c('red', 'number', 4)]], c('red', 'number', 9), {
      deck: [],
      discard: [c('red', 'number', 1), c('red', 'number', 2), c('red', 'number', 9)],
    });
    const next = applyMove(g, 0, { type: 'draw' });
    expect(next.hands[0]).toHaveLength(2); // still drew a card
    expect(next.discard[next.discard.length - 1]?.value).toBe(9); // top preserved
    expect(next.deck.length + next.discard.length).toBeLessThan(4); // pile recycled into the deck
  });
});

describe('chooseAiMove', () => {
  it('plays a legal card, preferring a non-wild, and declares UNO when it empties to one', () => {
    const g = game(
      [[c('red', 'number', 3), c('wild', 'wild')], [c('blue', 'number', 1)]],
      c('red', 'number', 9)
    );
    const move = chooseAiMove(g, 0);
    expect(move.type).toBe('play');
    if (move.type === 'play') {
      expect(move.cardId).toBe(g.hands[0]![0]!.id); // the number, not the wild
      expect(move.declareUno).toBe(true); // 2 → 1
    }
  });

  it('draws when nothing is playable', () => {
    const g = game([[c('blue', 'number', 8), c('green', 'number', 2)]], c('red', 'number', 9));
    expect(chooseAiMove(g, 0).type).toBe('draw');
  });

  it('chooses the most-held colour for a wild', () => {
    const hand = [
      c('wild', 'wild'),
      c('green', 'number', 1),
      c('green', 'number', 2),
      c('red', 'number', 3),
    ];
    const g = game([hand, [c('blue', 'number', 1)]], c('yellow', 'number', 9));
    const move = chooseAiMove(g, 0);
    if (move.type === 'play') expect(move.chosenColor).toBe('green');
  });
});

describe('chooseAiMove — the difficulty tiers', () => {
  /** A fixed cycling sequence, so `casual`'s randomness is a value here. */
  const fixed = (...xs: number[]) => {
    let i = 0;
    return () => xs[i++ % xs.length] as number;
  };

  it('defaults to sharp — the bots that shipped are the bots you get', () => {
    const g = game(
      [[c('red', 'number', 3), c('wild', 'wild')], [c('blue', 'number', 1)]],
      c('red', 'number', 9)
    );
    expect(chooseAiMove(g, 0)).toEqual(chooseAiMove(g, 0, 'sharp'));
  });

  it('casual reaches every playable card, and never an unplayable one', () => {
    const hand = [
      c('red', 'number', 3),
      c('blue', 'number', 8), // not playable on a red 9
      c('red', 'skip'),
      c('wild', 'wild'),
    ];
    const g = game([hand, [c('blue', 'number', 1)]], c('red', 'number', 9));
    const playableIds = new Set([hand[0]!.id, hand[2]!.id, hand[3]!.id]);
    const seen = new Set<string>();
    for (const r of [0.0, 0.4, 0.9]) {
      const move = chooseAiMove(g, 0, 'casual', fixed(r));
      expect(move.type).toBe('play');
      if (move.type === 'play') {
        expect(playableIds).toContain(move.cardId);
        seen.add(move.cardId);
      }
    }
    expect(seen.size).toBe(3);
  });

  it('casual DOES call UNO — a bot that does not can never win', () => {
    // The finding this tier cost, kept as a test because it is invisible to every other guard: a
    // hand only reaches zero through one, and going to one undeclared is exactly what the +2
    // punishes — so an undeclaring bot bounces off one card back to three forever. A four-casual
    // table ran 3,000 turns with no winner before this. `applyMove` refuses nothing here; the
    // table is simply unwinnable, which is v1's `[5,5,5,5]` Liar's Dice bug in another costume.
    const g = game(
      [[c('red', 'number', 3), c('red', 'number', 4)], [c('blue', 'number', 1)]],
      c('red', 'number', 9)
    );
    for (const level of ['casual', 'sharp'] as const) {
      const move = chooseAiMove(g, 0, level, fixed(0));
      expect(move.type === 'play' && move.declareUno).toBe(true);
      expect(applyMove(g, 0, move, seeded(3)).hands[0]).toHaveLength(1); // one card, not penalised
    }
  });

  it('casual still names a colour for a wild — a wild with none is refused by the reducer', () => {
    const g = game([[c('wild', 'wild4')], [c('blue', 'number', 1)]], c('red', 'number', 9));
    for (const r of [0, 0.3, 0.6, 0.99, NaN, 1, -1]) {
      const move = chooseAiMove(g, 0, 'casual', fixed(r));
      expect(move.type === 'play' && move.chosenColor).toBeDefined();
      expect(applyMove(g, 0, move, seeded(1))).not.toBe(g); // accepted, not a no-op
    }
  });

  it('draws when nothing is playable, at either level', () => {
    const g = game([[c('blue', 'number', 8), c('green', 'number', 2)]], c('red', 'number', 9));
    expect(chooseAiMove(g, 0, 'casual', fixed(0)).type).toBe('draw');
    expect(chooseAiMove(g, 0, 'sharp').type).toBe('draw');
  });

  it('every level only ever returns a move the reducer ACCEPTS, over whole dealt games', () => {
    // The stall guard, and the reason this matters more than any tuning: a bot move `applyMove`
    // refuses is a no-op on that bot's turn, and the table never moves again.
    for (const level of ['casual', 'sharp'] as const) {
      for (const seed of [1, 7, 99]) {
        const rng = seeded(seed);
        let g = deal(4, rng);
        let guard = 0;
        while (g.winner === -1 && guard < 5000) {
          const before = g;
          const next = applyMove(g, g.turn, chooseAiMove(g, g.turn, level, rng), rng);
          expect(next).not.toBe(before); // a refusal returns the SAME object — the stall
          g = next;
          guard += 1;
        }
        expect(g.winner).toBeGreaterThanOrEqual(0); // a table that finishes, at either level
      }
    }
  });
});

describe('the public projection', () => {
  it('exposes counts and the top but never a hidden card, and uses sentinels', () => {
    const g = deal(3, seeded(2));
    const pub = toPublic(g, 5);
    expect(pub.counts).toEqual([7, 7, 7]);
    expect(pub.deckCount).toBe(g.deck.length);
    expect(pub.top).toEqual(g.discard[0]);
    expect(pub.winner).toBe(-1); // sentinel, not null
    expect(pub.pending).toBe(NO_PENDING);
    expect(pub.round).toBe(5);
    // No hand contents anywhere in the projection.
    expect(JSON.stringify(pub)).not.toContain(g.hands[1]![0]!.id);
  });

  it('submitMove mints the next nonce and preserves the derived fields', () => {
    const pub = toPublic(deal(2, seeded(3)), 0);
    const next = submitMove(pub, 1, { type: 'draw' });
    expect(next.pending.nonce).toBe(1);
    expect(next.pending.seat).toBe(1);
    expect(next.counts).toEqual(pub.counts); // host-authored fields untouched
    const again = submitMove(next, 0, { type: 'draw' });
    expect(again.pending.nonce).toBe(2); // monotonic
  });
});
