/**
 * Chess rules, tested before the board is drawn — ARCHITECTURE.md's build order, and the reason
 * `logic/chess.ts` is pure. A move generator is exactly the code that "looks right" and is wrong in
 * one pinned-piece or castling-through-check corner; every such corner is a value here, caught in
 * milliseconds instead of on a board someone is staring at. These import the pure `logic/` directly
 * — no React, no room, no DOM — and lean on FEN, so a position is a one-line fixture.
 */
import { describe, it, expect } from 'vitest';
import {
  START_FEN,
  applyMove,
  hasLegalMove,
  initialChessState,
  insufficientMaterial,
  isInCheck,
  isPromotion,
  legalMoves,
  legalMovesFrom,
  outcomeOf,
  parseFen,
  pieceAt,
  playMove,
  positionOf,
  squareIndex,
  squareName,
  targetsFrom,
  toFen,
  turnSeat,
  type ChessState,
} from '@boardwalk/game-logic/games/chess';

/** Legal moves from a FEN, as "e2e4"-style strings (with a promotion suffix), sorted for stable compare. */
function movesFrom(fen: string): string[] {
  return legalMoves(parseFen(fen))
    .map((m) => `${squareName(m.from)}${squareName(m.to)}${m.promotion ?? ''}`)
    .sort();
}

/** A ChessState pinned to a FEN, outcome derived the honest way. */
function stateFrom(fen: string, round = 0): ChessState {
  const pos = parseFen(fen);
  return { fen, outcome: outcomeOf(pos), lastFrom: -1, lastTo: -1, round };
}

describe('square naming round-trips', () => {
  it('maps the corners and centre both ways', () => {
    expect(squareName(0)).toBe('a8');
    expect(squareName(7)).toBe('h8');
    expect(squareName(56)).toBe('a1');
    expect(squareName(63)).toBe('h1');
    expect(squareName(27)).toBe('d5');
    for (let i = 0; i < 64; i++) expect(squareIndex(squareName(i))).toBe(i);
  });
});

describe('FEN parse/serialize', () => {
  it('round-trips the starting position exactly', () => {
    expect(toFen(parseFen(START_FEN))).toBe(START_FEN);
  });

  it('reads side to move, castling, ep and clocks', () => {
    const pos = parseFen('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2');
    expect(pos.active).toBe('w');
    expect(pos.castling).toEqual({ wk: true, wq: true, bk: true, bq: true });
    expect(pos.ep).toBe(squareIndex('c6'));
    expect(pos.fullmove).toBe(2);
    expect(pos.board[squareIndex('e4')]).toEqual({ color: 'w', type: 'p' });
    expect(pos.board[squareIndex('e2')]).toBeNull();
  });

  it('round-trips a position with partial castling rights and no ep', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w Kq - 5 20';
    expect(toFen(parseFen(fen))).toBe(fen);
  });
});

describe('opening move counts', () => {
  it('the starting position has exactly 20 legal moves', () => {
    // 16 pawn moves (8 pawns × {one, two}) + 4 knight moves.
    expect(legalMoves(parseFen(START_FEN))).toHaveLength(20);
  });

  it('a pawn on its start square offers one and two forward', () => {
    expect(targetsFrom(initialChessState(), squareIndex('e2')).sort()).toEqual(
      [squareIndex('e3'), squareIndex('e4')].sort()
    );
  });
});

describe('piece movement', () => {
  it('a knight in the corner has two moves; in the centre, eight', () => {
    expect(movesFrom('8/8/8/8/8/8/8/N6k w - - 0 1').filter((m) => m.startsWith('a1'))).toHaveLength(2);
    expect(movesFrom('8/8/8/3N4/8/8/8/7k w - - 0 1').filter((m) => m.startsWith('d5'))).toHaveLength(8);
  });

  it('a rook is blocked by its own pieces and captures the enemy', () => {
    // White rook a1, own pawn a3, black pawn e1: rook reaches a2, and b1..e1 capturing on e1.
    const t = targetsFrom(stateFrom('7k/8/8/8/8/P7/8/R3p2K w - - 0 1'), squareIndex('a1')).map(squareName).sort();
    expect(t).toEqual(['a2', 'b1', 'c1', 'd1', 'e1'].sort());
  });

  it('a bishop slides both diagonals until blocked', () => {
    // Kings kept off both of d4's diagonals so nothing blocks the rays.
    const t = targetsFrom(stateFrom('4k3/8/8/8/3B4/8/8/4K3 w - - 0 1'), squareIndex('d4')).map(squareName);
    expect(t).toContain('a7');
    expect(t).toContain('h8');
    expect(t).toContain('a1');
    expect(t).toContain('g1');
  });
});

describe('check, pins, and getting out of check', () => {
  it('detects a king in check from a rook', () => {
    expect(isInCheck(parseFen('4k3/8/8/8/8/8/8/4R1K1 b - - 0 1'), 'b')).toBe(true);
    expect(isInCheck(parseFen('4k3/8/8/8/8/8/8/5RK1 b - - 0 1'), 'b')).toBe(false);
  });

  it('a pinned piece cannot move off the pin line', () => {
    // Black bishop d7 pinned to king e8 by white rook on e1 — wait, use a file pin:
    // White rook e1, black bishop e7, black king e8. The bishop is pinned and has no legal move.
    const fen = '4k3/4b3/8/8/8/8/8/4R1K1 b - - 0 1';
    expect(legalMovesFrom(stateFrom(fen), squareIndex('e7'))).toHaveLength(0);
  });

  it('when in check, the king may not stay on the checked line', () => {
    // Black rook e8 checks the white king down the e-file; the king may step off but not to e2.
    const moves = movesFrom('4r1k1/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(moves).not.toContain('e1e2');
    expect(moves).toContain('e1d1');
    expect(moves).toContain('e1f1');
  });

  it('a king may not move into check', () => {
    // White king e1, black rook d8 covers the d-file. Kd1 is illegal.
    expect(movesFrom('3r2k1/8/8/8/8/8/8/4K3 w - - 0 1')).not.toContain('e1d1');
  });
});

describe('castling', () => {
  const both = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

  it('offers both castles when squares are empty and safe', () => {
    const m = movesFrom(both);
    expect(m).toContain('e1g1'); // king-side
    expect(m).toContain('e1c1'); // queen-side
  });

  it('moves the rook when castling king-side', () => {
    const next = playMove(stateFrom(both), squareIndex('e1'), squareIndex('g1'));
    expect(pieceAt(next, squareIndex('g1'))).toEqual({ color: 'w', type: 'k' });
    expect(pieceAt(next, squareIndex('f1'))).toEqual({ color: 'w', type: 'r' });
    expect(pieceAt(next, squareIndex('h1'))).toBeNull();
  });

  it('moves the rook when castling queen-side', () => {
    const next = playMove(stateFrom(both), squareIndex('e1'), squareIndex('c1'));
    expect(pieceAt(next, squareIndex('c1'))).toEqual({ color: 'w', type: 'k' });
    expect(pieceAt(next, squareIndex('d1'))).toEqual({ color: 'w', type: 'r' });
    expect(pieceAt(next, squareIndex('a1'))).toBeNull();
  });

  it('cannot castle out of check', () => {
    // Black rook e8 checks the white king down the e-file.
    expect(movesFrom('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1')).not.toContain('e1g1');
  });

  it('cannot castle through an attacked square', () => {
    // Black rook f8 attacks f1, the square the king crosses king-side. c-side is still fine.
    const m = movesFrom('r4rk1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(m).not.toContain('e1g1');
  });

  it('cannot castle when squares between are occupied', () => {
    // Bishop on f1 blocks king-side.
    expect(movesFrom('r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1')).not.toContain('e1g1');
  });

  it('cannot castle without the right', () => {
    expect(movesFrom('r3k2r/8/8/8/8/8/8/R3K2R w kq - 0 1')).not.toContain('e1g1');
  });

  it('a king move clears both castling rights', () => {
    const next = playMove(stateFrom(both), squareIndex('e1'), squareIndex('e2'));
    expect(positionOf(next).castling.wk).toBe(false);
    expect(positionOf(next).castling.wq).toBe(false);
  });

  it('a rook move clears only its side', () => {
    const next = playMove(stateFrom(both), squareIndex('h1'), squareIndex('g1'));
    const c = positionOf(next).castling;
    expect(c.wk).toBe(false);
    expect(c.wq).toBe(true);
  });

  it('capturing a rook on its home square clears the enemy right', () => {
    // White rook a1 captures a black rook on a8; black loses queen-side castling.
    const next = playMove(stateFrom('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), squareIndex('a1'), squareIndex('a8'));
    expect(positionOf(next).castling.bq).toBe(false);
    expect(positionOf(next).castling.bk).toBe(true);
  });
});

describe('en passant', () => {
  it('a double pawn push sets the ep target', () => {
    const next = playMove(initialChessState(), squareIndex('e2'), squareIndex('e4'));
    expect(positionOf(next).ep).toBe(squareIndex('e3'));
  });

  it('the ep capture is offered and removes the passed pawn', () => {
    // White pawn e5, black just played d7-d5 (ep target d6). exd6 e.p. captures the d5 pawn.
    const fen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    expect(movesFrom(fen)).toContain('e5d6');
    const next = playMove(stateFrom(fen), squareIndex('e5'), squareIndex('d6'));
    expect(pieceAt(next, squareIndex('d6'))).toEqual({ color: 'w', type: 'p' });
    expect(pieceAt(next, squareIndex('d5'))).toBeNull();
    expect(pieceAt(next, squareIndex('e5'))).toBeNull();
  });

  it('the ep target expires after another move', () => {
    const fen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    const afterKing = playMove(stateFrom(fen), squareIndex('e1'), squareIndex('e2'));
    expect(positionOf(afterKing).ep).toBe(-1);
  });
});

describe('promotion', () => {
  it('a pawn reaching the back rank is flagged and offers four pieces', () => {
    const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const s = stateFrom(fen);
    expect(isPromotion(s, squareIndex('a7'), squareIndex('a8'))).toBe(true);
    const promos = legalMovesFrom(s, squareIndex('a7')).filter((m) => m.to === squareIndex('a8'));
    expect(promos.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
  });

  it('promotes to the chosen piece, defaulting to a queen', () => {
    const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const q = playMove(stateFrom(fen), squareIndex('a7'), squareIndex('a8'));
    expect(pieceAt(q, squareIndex('a8'))).toEqual({ color: 'w', type: 'q' });
    const n = playMove(stateFrom(fen), squareIndex('a7'), squareIndex('a8'), 'n');
    expect(pieceAt(n, squareIndex('a8'))).toEqual({ color: 'w', type: 'n' });
  });
});

describe('terminal positions', () => {
  it("fool's mate is checkmate, Black wins (seat 1)", () => {
    // 1. f3 e5 2. g4 Qh4#
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    const oc = outcomeOf(parseFen(fen));
    expect(oc.kind).toBe('checkmate');
    if (oc.kind === 'checkmate') expect(oc.winner).toBe(1);
    expect(hasLegalMove(parseFen(fen))).toBe(false);
  });

  it('scholar-mate position is checkmate, White wins (seat 0)', () => {
    // Qxf7#: black king e8, white queen f7 backed by a bishop on c4, black king boxed in.
    const fen = 'r1bqkbnr/pppp1Qpp/2n5/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
    const oc = outcomeOf(parseFen(fen));
    expect(oc.kind).toBe('checkmate');
    if (oc.kind === 'checkmate') expect(oc.winner).toBe(0);
  });

  it('a stalemate is not a checkmate', () => {
    // The canonical corner stalemate: Black king a8, White queen b6, White king h1, Black to move.
    // a8 is not attacked, but a7/b7/b8 are all covered by the queen — no legal move, no check.
    const fen = 'k7/8/1Q6/8/8/8/8/7K b - - 0 1';
    expect(isInCheck(parseFen(fen), 'b')).toBe(false);
    expect(hasLegalMove(parseFen(fen))).toBe(false);
    expect(outcomeOf(parseFen(fen)).kind).toBe('stalemate');
  });

  it('a live position is still playing', () => {
    expect(outcomeOf(parseFen(START_FEN)).kind).toBe('playing');
  });
});

describe('draws by material and the fifty-move rule', () => {
  it('king vs king is insufficient material', () => {
    expect(insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1'))).toBe(true);
    expect(outcomeOf(parseFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1')).kind).toBe('draw');
  });

  it('king and knight vs king is insufficient; king and rook is not', () => {
    expect(insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/3NK3 w - - 0 1'))).toBe(true);
    expect(insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/3RK3 w - - 0 1'))).toBe(false);
  });

  it('the fifty-move rule draws at a halfmove clock of 100', () => {
    const oc = outcomeOf(parseFen('4k3/8/8/8/8/5q2/8/4K3 b - - 100 80'));
    expect(oc.kind).toBe('draw');
    if (oc.kind === 'draw') expect(oc.reason).toBe('fifty-move');
  });
});

describe('playMove totality and immutability', () => {
  it('an illegal move returns the state unchanged (same reference-value)', () => {
    const s = initialChessState();
    expect(playMove(s, squareIndex('e2'), squareIndex('e5'))).toBe(s); // pawn can't leap three
    expect(playMove(s, squareIndex('e7'), squareIndex('e5'))).toBe(s); // not Black's turn
    expect(playMove(s, squareIndex('d1'), squareIndex('d3'))).toBe(s); // queen blocked by own pawn
  });

  it('a move on a finished game is a no-op', () => {
    const mate = stateFrom('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(mate.outcome.kind).toBe('checkmate');
    expect(playMove(mate, squareIndex('e1'), squareIndex('f2'))).toBe(mate);
  });

  it('does not mutate the input position when applying a move', () => {
    const pos = parseFen(START_FEN);
    const before = toFen(pos);
    applyMove(pos, { from: squareIndex('e2'), to: squareIndex('e4'), doublePush: true });
    expect(toFen(pos)).toBe(before);
  });

  it('advances the side to move and turnSeat tracks it', () => {
    const s = initialChessState();
    expect(turnSeat(s)).toBe(0);
    const next = playMove(s, squareIndex('e2'), squareIndex('e4'));
    expect(turnSeat(next)).toBe(1);
    expect(next.lastFrom).toBe(squareIndex('e2'));
    expect(next.lastTo).toBe(squareIndex('e4'));
    expect(next.round).toBe(s.round);
  });
});

describe('a full short game plays through', () => {
  it("reaches fool's mate move by move", () => {
    let s = initialChessState();
    const play = (from: string, to: string): void => {
      s = playMove(s, squareIndex(from), squareIndex(to));
    };
    play('f2', 'f3');
    play('e7', 'e5');
    play('g2', 'g4');
    play('d8', 'h4'); // Qh4#
    expect(s.outcome.kind).toBe('checkmate');
    if (s.outcome.kind === 'checkmate') expect(s.outcome.winner).toBe(1);
  });
});
