import { describe, expect, it } from 'vitest';
import {
  DEAL_EVENT,
  applyMove,
  deal,
  describeMove,
  freshDeck,
  type Card,
  type Move,
  type UnoGame,
} from '@boardwalk/game-logic/games/uno';
import { cardLabel, linesFor } from '@/games/uno/log';

/**
 * THE MOVE LOG, both halves: the facts the rulebook derives (`describeMove`) and the sentences the
 * board builds from them (`linesFor`).
 *
 * The point of testing the derivation at all is that it works by DIFFING the game either side of a
 * move rather than by being told what happened — which is what keeps it from drifting from the
 * rules, and also what makes it possible to get subtly wrong (a skip and a draw-two both move the
 * turn two seats; only one of them also moves cards). Every case below is driven through the REAL
 * reducer, never a hand-built "after" state, because a diff of two states I wrote myself would only
 * prove I can subtract.
 */

/** A game with an exact hand for `seat`, so a specific card is playable on demand. */
function rigged(hands: readonly (readonly Card[])[], top: Card, turn = 0): UnoGame {
  return {
    hands,
    deck: freshDeck().slice(0, 40),
    discard: [top],
    color: top.color === 'wild' ? 'red' : top.color,
    turn,
    direction: 1,
    calledUno: hands.map(() => false),
    winner: -1,
  };
}

const card = (id: string, color: Card['color'], kind: Card['kind'], value = -1): Card => ({
  id,
  color,
  kind,
  value,
});

const NAMES = ['mogar', 'AI 2', 'AI 3'];

/** Run a move through the real reducer and describe it, the way the host does. */
function step(game: UnoGame, seat: number, move: Move, seq = 1) {
  const after = applyMove(game, seat, move, () => 0.5);
  return { after, event: describeMove(game, after, seat, move, seq) };
}

describe('describeMove', () => {
  it('reports a plain play: who, which card, the colour it leaves in force', () => {
    const g = rigged(
      [[card('a', 'red', 'number', 5)], [card('b', 'blue', 'number', 1)]],
      card('t', 'red', 'number', 9)
    );
    const { event } = step(g, 0, { type: 'play', cardId: 'a', declareUno: true });
    expect(event.seat).toBe(0);
    expect(event.action).toBe('play');
    expect(event.card.id).toBe('a');
    expect(event.color).toBe('red');
    expect(event.victim).toBe(-1);
    expect(event.drew).toBe(0);
    expect(event.reversed).toBe(false);
    expect(event.seq).toBe(1);
  });

  it('reports a draw as a draw, with no card', () => {
    const g = rigged(
      [[card('a', 'blue', 'number', 5)], [card('b', 'blue', 'number', 1)]],
      card('t', 'red', 'number', 9)
    );
    const { event } = step(g, 0, { type: 'draw' });
    expect(event.action).toBe('draw');
    expect(event.card.id).toBe('');
  });

  it('reads a draw-two off the result: the victim, the count, and the skip', () => {
    const g = rigged(
      [
        [card('a', 'red', 'draw2'), card('z', 'red', 'number', 1)],
        [card('b', 'blue', 'number', 1)],
        [card('c', 'green', 'number', 2)],
      ],
      card('t', 'red', 'number', 9)
    );
    const { event } = step(g, 0, { type: 'play', cardId: 'a' });
    expect(event.victim).toBe(1);
    expect(event.drew).toBe(2);
    expect(event.skipped).toBe(1); // the victim loses the turn too
  });

  it('reads a wild draw-four the same way, and carries the CHOSEN colour', () => {
    const g = rigged(
      [
        [card('a', 'wild', 'wild4'), card('z', 'red', 'number', 1)],
        [card('b', 'blue', 'number', 1)],
        [card('c', 'green', 'number', 2)],
      ],
      card('t', 'red', 'number', 9)
    );
    const { event } = step(g, 0, { type: 'play', cardId: 'a', chosenColor: 'green' });
    expect(event.drew).toBe(4);
    expect(event.victim).toBe(1);
    // The card's face says nothing about the colour — this is the only place it is said.
    expect(event.color).toBe('green');
  });

  it('reports a skip with nobody drawing', () => {
    const g = rigged(
      [
        [card('a', 'red', 'skip'), card('z', 'red', 'number', 1)],
        [card('b', 'blue', 'number', 1)],
        [card('c', 'green', 'number', 2)],
      ],
      card('t', 'red', 'number', 9)
    );
    const { event } = step(g, 0, { type: 'play', cardId: 'a' });
    expect(event.skipped).toBe(1);
    expect(event.drew).toBe(0);
    expect(event.victim).toBe(-1);
  });

  it('reports a reverse — the one action whose effect is otherwise invisible', () => {
    const g = rigged(
      [
        [card('a', 'red', 'reverse'), card('z', 'red', 'number', 1)],
        [card('b', 'blue', 'number', 1)],
        [card('c', 'green', 'number', 2)],
      ],
      card('t', 'red', 'number', 9)
    );
    const { event } = step(g, 0, { type: 'play', cardId: 'a' });
    expect(event.reversed).toBe(true);
    expect(event.skipped).toBe(-1); // three-handed, a reverse skips nobody
  });

  it('reports the UNO call and the penalty as the different things they are', () => {
    const two = (): UnoGame =>
      rigged(
        [
          [card('a', 'red', 'number', 5), card('z', 'red', 'number', 1)],
          [card('b', 'blue', 'number', 1)],
        ],
        card('t', 'red', 'number', 9)
      );

    const declared = step(two(), 0, { type: 'play', cardId: 'a', declareUno: true });
    expect(declared.event.calledUno).toBe(true);
    expect(declared.event.penalty).toBe(false);

    const silent = step(two(), 0, { type: 'play', cardId: 'a' });
    expect(silent.event.calledUno).toBe(false);
    expect(silent.event.penalty).toBe(true); // +2, so the hand GREW on a play
  });

  it('reports the winner when the last card goes down', () => {
    const g = rigged(
      [[card('a', 'red', 'number', 5)], [card('b', 'blue', 'number', 1)]],
      card('t', 'red', 'number', 9)
    );
    const { after, event } = step(g, 0, { type: 'play', cardId: 'a', declareUno: true });
    expect(after.winner).toBe(0);
    expect(event.winner).toBe(0);
  });

  it('SAYS NOTHING about a move the reducer refused', () => {
    // The reducer is total: an illegal move returns its input. That has to produce no log line, or
    // the commentary claims a move that never happened — which is what logging at the call site did.
    const g = rigged(
      [[card('a', 'blue', 'number', 5)], [card('b', 'blue', 'number', 1)]],
      card('t', 'red', 'number', 9)
    );
    const { after, event } = step(g, 0, { type: 'play', cardId: 'a' }); // blue 5 on a red 9
    expect(after).toBe(g);
    expect(event).toBe(DEAL_EVENT);
    expect(linesFor(event, NAMES)).toEqual([]);
  });

  it('says nothing for an off-turn move either', () => {
    const g = deal(3, () => 0.5);
    const { event } = step(g, 2, { type: 'draw' }); // seat 0 has the turn
    expect(event).toBe(DEAL_EVENT);
  });
});

describe('linesFor', () => {
  it('turns one draw-four into the four things that actually happened', () => {
    const g = rigged(
      [
        [card('a', 'wild', 'wild4'), card('z', 'red', 'number', 1)],
        [card('b', 'blue', 'number', 1)],
        [card('c', 'green', 'number', 2)],
      ],
      card('t', 'red', 'number', 9)
    );
    const { event } = step(g, 0, { type: 'play', cardId: 'a', chosenColor: 'green' });
    const lines = linesFor(event, NAMES);
    expect(lines[0]?.text).toBe('mogar played');
    expect(lines[0]?.card?.kind).toBe('wild4');
    expect(lines[1]?.text).toBe('AI 2 draws 4 and is skipped!');
    // Keys are unique within an event, or React renders one line and drops the rest.
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  it('does not announce a skip twice when the victim already drew', () => {
    // "AI 2 draws 2 and is skipped!" followed by "AI 2 is skipped!" reads as two separate things
    // happening to one player. v1 printed both.
    const g = rigged(
      [
        [card('a', 'red', 'draw2'), card('z', 'red', 'number', 1)],
        [card('b', 'blue', 'number', 1)],
        [card('c', 'green', 'number', 2)],
      ],
      card('t', 'red', 'number', 9)
    );
    const { event } = step(g, 0, { type: 'play', cardId: 'a' });
    const lines = linesFor(event, NAMES);
    expect(lines.filter((l) => l.text.includes('is skipped')).length).toBe(1);
  });

  it('falls back to a seat number rather than rendering a blank name', () => {
    const g = rigged(
      [
        [card('a', 'red', 'number', 5), card('z', 'red', 'number', 1)],
        [card('b', 'blue', 'number', 1)],
      ],
      card('t', 'red', 'number', 9)
    );
    const { event } = step(g, 0, { type: 'play', cardId: 'a', declareUno: true });
    expect(linesFor(event, [])[0]?.text).toBe('Player 1 played');
    expect(linesFor(event, [''])[0]?.text).toBe('Player 1 played');
  });

  it('says nothing for the deal sentinel', () => {
    expect(linesFor(DEAL_EVENT, NAMES)).toEqual([]);
  });

  it('labels a card the way the log needs to say it out loud', () => {
    expect(cardLabel(card('x', 'red', 'number', 5))).toBe('RED 5');
    expect(cardLabel(card('x', 'blue', 'draw2'))).toBe('BLUE DRAW TWO');
    expect(cardLabel(card('x', 'green', 'skip'))).toBe('GREEN SKIP');
    expect(cardLabel(card('x', 'yellow', 'reverse'))).toBe('YELLOW REVERSE');
    // A wild has no colour of its own — the log must not claim one.
    expect(cardLabel(card('x', 'wild', 'wild'))).toBe('a WILD');
    expect(cardLabel(card('x', 'wild', 'wild4'))).toBe('a WILD DRAW FOUR');
  });
});
