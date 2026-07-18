/**
 * Tic-Tac-Toe's rules, tested before its UI — the build order ARCHITECTURE.md insists on, and the
 * reason `logic/` is pure. Every subtle thing a component could get wrong (a missed diagonal, a
 * draw that should have been a win, a house that fails to block) is a value here, so it is caught
 * once, in milliseconds, instead of on a board someone is looking at.
 *
 * These import the game's pure `logic/` directly — no React, no room, no DOM. If this file needed
 * any of those to test the rules, the rules would be in the wrong place.
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY,
  LINES,
  bestMove,
  canPlay,
  initialState,
  isFull,
  legalMoves,
  outcomeOf,
  play,
  winner,
  type Board,
  type Cell,
  type Player,
  type TicTacToeState,
} from '@boardwalk/game-logic/games/tic-tac-toe';

/** Build a state from a raw board and whose turn it is, deriving the outcome the honest way. */
function stateFrom(board: Cell[], turn: Player, round = 0): TicTacToeState {
  return { board, turn, outcome: outcomeOf(board), round };
}

const E = EMPTY;
/** A blank board — empties are `EMPTY` (-1), not null, because RTDB drops nulls (see logic). */
const BLANK: Board = [E, E, E, E, E, E, E, E, E];

describe('initialState', () => {
  it('is an empty board, seat 0 to move, nothing decided', () => {
    const s = initialState();
    expect(s.board).toEqual(BLANK);
    expect(s.turn).toBe(0);
    expect(s.outcome).toEqual({ kind: 'playing' });
    expect(s.round).toBe(0);
  });

  it('carries the round it was given — for rematches', () => {
    expect(initialState(3).round).toBe(3);
  });
});

describe('winner', () => {
  it('detects a win on every one of the eight lines', () => {
    expect(LINES).toHaveLength(8);
    for (const line of LINES) {
      const board: Cell[] = BLANK.slice();
      for (const i of line) board[i] = 1;
      const w = winner(board);
      expect(w).not.toBeNull();
      expect(w?.player).toBe(1);
      expect(w?.line).toEqual(line);
    }
  });

  it('returns null on an empty board and on a board with no line', () => {
    expect(winner(BLANK)).toBeNull();
    // X and O scattered, nobody with three: 0,1 X · 4 X · 2,3 O · 5 O — no full line.
    expect(winner([0, 0, 1, 1, 0, 1, E, E, E])).toBeNull();
  });

  it('does not read an empty cell as a phantom win', () => {
    // Three empties are not a winning line — the guard is what stops `EMPTY === EMPTY === EMPTY`.
    expect(winner([E, E, E, 0, 1, 0, 1, 0, 1])).toBeNull();
  });
});

describe('isFull / outcomeOf', () => {
  it('isFull only when every cell is marked', () => {
    expect(isFull(BLANK)).toBe(false);
    expect(isFull([0, 1, 0, 1, 0, 1, 0, 1, E])).toBe(false);
    expect(isFull([0, 1, 0, 1, 0, 1, 0, 1, 0])).toBe(true);
  });

  it('a winning last move is a win, not a draw', () => {
    // A full board that also contains a win must report the win — win beats full.
    // Top row X, and the rest arranged so the board is full: X X X / O O X / O X O
    const board: Cell[] = [0, 0, 0, 1, 1, 0, 1, 0, 1];
    expect(isFull(board)).toBe(true);
    expect(outcomeOf(board)).toEqual({ kind: 'win', player: 0, line: [0, 1, 2] });
  });

  it('a full board with no line is a draw', () => {
    // X O X / X O O / O X X — full, nobody has three.
    expect(outcomeOf([0, 1, 0, 0, 1, 1, 1, 0, 0])).toEqual({ kind: 'draw' });
  });
});

describe('legalMoves / canPlay', () => {
  it('lists empty cells while playing, and nothing once decided', () => {
    expect(legalMoves(initialState())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const won = stateFrom([1, 1, 1, 0, 0, E, E, E, E], 0);
    expect(won.outcome.kind).toBe('win');
    expect(legalMoves(won)).toEqual([]);
  });

  it('permits only the current player, an empty in-range cell, in a live game', () => {
    const s = initialState();
    expect(canPlay(s, 0, 4)).toBe(true);
    expect(canPlay(s, 1, 4)).toBe(false); // not seat 1's turn
    expect(canPlay(s, 0, 9)).toBe(false); // out of range
    expect(canPlay(s, 0, -1)).toBe(false);
    const taken = play(s, 0, 4);
    expect(canPlay(taken, 1, 4)).toBe(false); // occupied
  });
});

describe('play', () => {
  it('marks the cell, advances the turn, and does not mutate its input', () => {
    const s0 = initialState();
    const s1 = play(s0, 0, 4);
    expect(s1.board[4]).toBe(0);
    expect(s1.turn).toBe(1);
    expect(s0.board[4]).toBe(E); // the input is untouched — pure
  });

  it('returns the SAME state (a no-op) on any illegal move', () => {
    const s0 = initialState();
    expect(play(s0, 1, 0)).toBe(s0); // wrong turn
    expect(play(s0, 0, 9)).toBe(s0); // out of range
    const s1 = play(s0, 0, 4);
    expect(play(s1, 1, 4)).toBe(s1); // occupied
    const won = stateFrom([1, 1, 1, 0, 0, E, E, E, E], 0);
    expect(play(won, 0, 5)).toBe(won); // game already over
  });

  it('sets the outcome when a move completes a line', () => {
    // Seat 0 to complete the top row.
    const s = stateFrom([0, 0, E, 1, 1, E, E, E, E], 0);
    const done = play(s, 0, 2);
    expect(done.outcome).toEqual({ kind: 'win', player: 0, line: [0, 1, 2] });
  });
});

describe('bestMove — the house', () => {
  it('is null when it is not the house’s turn or the game is over', () => {
    expect(bestMove(initialState(), 1)).toBeNull(); // seat 0 to move
    const won = stateFrom([1, 1, 1, 0, 0, E, E, E, E], 0);
    expect(bestMove(won, 0)).toBeNull();
  });

  it('opens in the centre', () => {
    expect(bestMove(initialState(), 0)).toBe(4);
  });

  it('takes an immediate win when one is on offer', () => {
    // Seat 0 has two in a row on the top; cell 2 wins now.
    const s = stateFrom([0, 0, E, 1, 1, E, E, E, E], 0);
    expect(bestMove(s, 0)).toBe(2);
  });

  it('blocks the opponent’s winning threat', () => {
    // Seat 1 threatens the top row (cells 0,1); seat 0 to move must block at 2.
    const s = stateFrom([1, 1, E, 0, E, E, E, E, E], 0);
    expect(bestMove(s, 0)).toBe(2);
  });

  it('never loses: perfect play against perfect play is a draw', () => {
    let s = initialState();
    let guard = 0;
    while (s.outcome.kind === 'playing') {
      const move = bestMove(s, s.turn);
      expect(move).not.toBeNull();
      s = play(s, s.turn, move as number);
      expect(++guard).toBeLessThanOrEqual(9); // must terminate within nine moves
    }
    expect(s.outcome.kind).toBe('draw');
  });
});
