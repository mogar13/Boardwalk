/**
 * Chess, as pure functions. No React, no DOM, no `@/system`, no Firebase — enforced by
 * `@boardwalk/no-impure-logic`, which is what lets the whole rulebook (legal-move generation, check,
 * castling, en passant, promotion, checkmate/stalemate/draw) be unit-tested to the last line before
 * a single square is drawn. ARCHITECTURE.md's build order — extract logic → test logic → draw UI —
 * matters most here, because a chess move generator is exactly the kind of code that "looks right"
 * and is wrong in one pinned-piece corner, and only a test finds that.
 *
 * TWO SHAPES, ON PURPOSE. The wire/domain state a game shares through `useRoom` is `ChessState`, and
 * it is a **FEN string** plus a small envelope — a string round-trips through RTDB intact, where an
 * array-of-pieces with empty squares would hit the exact null-dropping trap Tic-Tac-Toe found (an
 * empty square written as `null` comes back `undefined`). FEN is chess's standard serialization and
 * it already carries everything: placement, side to move, castling rights, the en-passant target,
 * and the halfmove clock. The rich `Position` — a 64-cell board of pieces — is the INTERNAL form the
 * move logic works on; it never touches the wire. `positionOf`/`toFen` are the one seam between them,
 * the same split `profileRepo` and `roomRepo` make between domain and wire.
 *
 * A PLAYER IS A SEAT INDEX. Seat 0 is White, seat 1 is Black — the board never stores `'white'`, it
 * stores which colour, and `turnSeat` maps the side to move to the seat the OS knows. "Who owns this
 * turn" and "who sits in seat 0" are the same fact, so there is no second alphabet to disagree with
 * the seat array (the rule Tic-Tac-Toe's `Player = seat index` already set).
 */

// ── Board geometry ─────────────────────────────────────────────────────────────────────────────
//
// Index 0..63, row-major from a8: index 0 = a8 (top-left as White sees it), 7 = h8, 56 = a1,
// 63 = h1 — the order FEN lists ranks in (rank 8 first). File 0 = a, rank-row 0 = rank 8. White
// moves toward rank 8 (up the board, DECREASING index); Black moves toward rank 1 (increasing).

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
  readonly color: Color;
  readonly type: PieceType;
}

/** The internal, rich position the move logic reasons over. Never serialized — see `ChessState`. */
export interface Position {
  /** 64 squares, index 0 = a8. `null` is an empty square (internal only; the wire uses FEN). */
  readonly board: readonly (Piece | null)[];
  readonly active: Color;
  readonly castling: { readonly wk: boolean; readonly wq: boolean; readonly bk: boolean; readonly bq: boolean };
  /** The en-passant target square (the square a capturing pawn lands on), or -1 for none. */
  readonly ep: number;
  /** Halfmove clock — plies since the last pawn move or capture, for the fifty-move rule. */
  readonly halfmove: number;
  /** Fullmove number — starts at 1, increments after Black moves. */
  readonly fullmove: number;
}

/** A move in the rich form the generator produces and `applyMove` consumes. */
export interface Move {
  readonly from: number;
  readonly to: number;
  /** The piece a promoting pawn becomes. Present only on a promotion. */
  readonly promotion?: PieceType;
  /** Set on a castle: `'K'` king-side, `'Q'` queen-side, for the moving colour. */
  readonly castle?: 'K' | 'Q';
  /** True when this pawn capture is en passant (the captured pawn is not on `to`). */
  readonly enPassant?: boolean;
  /** True on a pawn's two-square opening move (sets the next `ep` target). */
  readonly doublePush?: boolean;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const fileOf = (i: number): number => i % 8;
const rowOf = (i: number): number => Math.floor(i / 8);
/** Build an index from file (0=a) and rank-row (0=rank 8), or -1 if off-board. */
const sq = (file: number, row: number): number =>
  file < 0 || file > 7 || row < 0 || row > 7 ? -1 : row * 8 + file;

/** Algebraic name of a square (e.g. 27 → "d5"). Handy for tests and FEN's ep field. */
export function squareName(i: number): string {
  return `${'abcdefgh'[fileOf(i)] ?? '?'}${String(8 - rowOf(i))}`;
}
/** Parse an algebraic square ("e4") to an index, or -1 if malformed. */
export function squareIndex(name: string): number {
  const file = 'abcdefgh'.indexOf(name[0] ?? '');
  const rank = Number(name[1]);
  if (file === -1 || !Number.isInteger(rank) || rank < 1 || rank > 8) return -1;
  return sq(file, 8 - rank);
}

const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');

// ── FEN ⇄ Position ─────────────────────────────────────────────────────────────────────────────

/** Parse a FEN string into the internal position. Assumes a well-formed FEN (our own writer's). */
export function parseFen(fen: string): Position {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0] ?? '';
  const active: Color = parts[1] === 'b' ? 'b' : 'w';
  const rights = parts[2] ?? '-';
  const epField = parts[3] ?? '-';
  const halfmove = Number(parts[4] ?? '0');
  const fullmove = Number(parts[5] ?? '1');

  const board: (Piece | null)[] = Array.from({ length: 64 }, () => null);
  let i = 0;
  for (const ch of placement) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') {
      i += Number(ch);
      continue;
    }
    const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
    const type = ch.toLowerCase() as PieceType;
    if (i < 64) board[i] = { color, type };
    i += 1;
  }

  return {
    board,
    active,
    castling: {
      wk: rights.includes('K'),
      wq: rights.includes('Q'),
      bk: rights.includes('k'),
      bq: rights.includes('q'),
    },
    ep: epField === '-' ? -1 : squareIndex(epField),
    halfmove: Number.isFinite(halfmove) ? halfmove : 0,
    fullmove: Number.isFinite(fullmove) ? fullmove : 1,
  };
}

const PIECE_CHAR: Record<PieceType, string> = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

/** Serialize a position back to FEN — the canonical wire form. */
export function toFen(pos: Position): string {
  let placement = '';
  for (let row = 0; row < 8; row++) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[row * 8 + file];
      if (p === null || p === undefined) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        placement += String(empty);
        empty = 0;
      }
      const c = PIECE_CHAR[p.type];
      placement += p.color === 'w' ? c.toUpperCase() : c;
    }
    if (empty > 0) placement += String(empty);
    if (row < 7) placement += '/';
  }

  const rights =
    (pos.castling.wk ? 'K' : '') +
    (pos.castling.wq ? 'Q' : '') +
    (pos.castling.bk ? 'k' : '') +
    (pos.castling.bq ? 'q' : '');
  const ep = pos.ep === -1 ? '-' : squareName(pos.ep);
  return `${placement} ${pos.active} ${rights === '' ? '-' : rights} ${ep} ${String(pos.halfmove)} ${String(pos.fullmove)}`;
}

// ── Attacks & check ──────────────────────────────────────────────────────────────────────────────

const KNIGHT_STEPS: readonly (readonly [number, number])[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const BISHOP_DIRS: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ROOK_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Whether `target` is attacked by any piece of `by`. The primitive check/castling both rest on. A
 * pawn attacks the two forward diagonals (forward = toward the enemy back rank), which for White is
 * DECREASING row and for Black increasing — the one place pawn direction has to be right or check
 * detection silently misses a pawn.
 */
export function squareAttackedBy(pos: Position, target: number, by: Color): boolean {
  const tf = fileOf(target);
  const tr = rowOf(target);

  // Pawns. A `by`-pawn on square s attacks s's forward diagonals; equivalently, `target` is attacked
  // by a pawn sitting one rank "behind" it (from `by`'s perspective) on an adjacent file.
  const pawnRow = by === 'w' ? tr + 1 : tr - 1; // where an attacking pawn would stand
  for (const df of [-1, 1]) {
    const s = sq(tf + df, pawnRow);
    if (s !== -1) {
      const p = pos.board[s];
      if (p && p.color === by && p.type === 'p') return true;
    }
  }

  // Knights.
  for (const [df, dr] of KNIGHT_STEPS) {
    const s = sq(tf + df, tr + dr);
    if (s !== -1) {
      const p = pos.board[s];
      if (p && p.color === by && p.type === 'n') return true;
    }
  }

  // King (adjacent).
  for (const [df, dr] of KING_STEPS) {
    const s = sq(tf + df, tr + dr);
    if (s !== -1) {
      const p = pos.board[s];
      if (p && p.color === by && p.type === 'k') return true;
    }
  }

  // Sliding: bishops/queens on diagonals, rooks/queens on ranks/files.
  const slide = (dirs: readonly (readonly [number, number])[], types: readonly PieceType[]): boolean => {
    for (const [df, dr] of dirs) {
      let f = tf + df;
      let r = tr + dr;
      let s = sq(f, r);
      while (s !== -1) {
        const p = pos.board[s];
        if (p) {
          if (p.color === by && types.includes(p.type)) return true;
          break; // a piece blocks the ray
        }
        f += df;
        r += dr;
        s = sq(f, r);
      }
    }
    return false;
  };
  if (slide(BISHOP_DIRS, ['b', 'q'])) return true;
  if (slide(ROOK_DIRS, ['r', 'q'])) return true;
  return false;
}

/** The square of `color`'s king, or -1 if (illegally) absent. */
function kingSquare(pos: Position, color: Color): number {
  return pos.board.findIndex((p) => p !== null && p.color === color && p.type === 'k');
}

/** Whether `color`'s king is currently attacked. */
export function isInCheck(pos: Position, color: Color): boolean {
  const k = kingSquare(pos, color);
  return k !== -1 && squareAttackedBy(pos, k, opposite(color));
}

// ── Move generation ──────────────────────────────────────────────────────────────────────────────

/** Home squares, for castling. */
const KING_HOME: Record<Color, number> = { w: 60, b: 4 };

/**
 * Pseudo-legal moves for the side to move — every move the pieces *can* make by their movement
 * rules, WITHOUT yet checking whether it leaves the own king in check. `legalMoves` filters those
 * out; splitting it this way keeps each half simple and testable.
 */
function pseudoMoves(pos: Position): Move[] {
  const moves: Move[] = [];
  const me = pos.active;
  const forward = me === 'w' ? -1 : 1; // row delta toward promotion
  const startRow = me === 'w' ? 6 : 1;
  const promoRow = me === 'w' ? 0 : 7;

  for (let i = 0; i < 64; i++) {
    const p = pos.board[i];
    if (!p || p.color !== me) continue;
    const f = fileOf(i);
    const r = rowOf(i);

    if (p.type === 'p') {
      // One forward, if empty.
      const one = sq(f, r + forward);
      if (one !== -1 && pos.board[one] === null) {
        pushPawn(moves, i, one, r + forward === promoRow);
        // Two forward from the start row, if both empty.
        if (r === startRow) {
          const two = sq(f, r + 2 * forward);
          if (two !== -1 && pos.board[two] === null) moves.push({ from: i, to: two, doublePush: true });
        }
      }
      // Captures (including en passant).
      for (const df of [-1, 1]) {
        const c = sq(f + df, r + forward);
        if (c === -1) continue;
        const tp = pos.board[c];
        if (tp && tp.color !== me) {
          pushPawn(moves, i, c, r + forward === promoRow);
        } else if (c === pos.ep) {
          moves.push({ from: i, to: c, enPassant: true });
        }
      }
      continue;
    }

    if (p.type === 'n') {
      for (const [df, dr] of KNIGHT_STEPS) addIfTarget(moves, pos, i, sq(f + df, r + dr), me);
      continue;
    }
    if (p.type === 'k') {
      for (const [df, dr] of KING_STEPS) addIfTarget(moves, pos, i, sq(f + df, r + dr), me);
      addCastles(moves, pos, i, me);
      continue;
    }

    const dirs =
      p.type === 'b' ? BISHOP_DIRS : p.type === 'r' ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
    for (const [df, dr] of dirs) {
      let s = sq(f + df, r + dr);
      let step = 1;
      while (s !== -1) {
        const tp = pos.board[s] ?? null;
        if (tp === null) {
          moves.push({ from: i, to: s });
        } else {
          if (tp.color !== me) moves.push({ from: i, to: s });
          break;
        }
        step += 1;
        s = sq(f + df * step, r + dr * step);
      }
    }
  }

  return moves;
}

/** A pawn move to `to`, expanded into four promotion moves if it reaches the back rank. */
function pushPawn(moves: Move[], from: number, to: number, promotes: boolean): void {
  if (!promotes) {
    moves.push({ from, to });
    return;
  }
  for (const promotion of ['q', 'r', 'b', 'n'] as const) moves.push({ from, to, promotion });
}

/** Add a step/capture target for a knight or king (empty square, or an enemy piece). */
function addIfTarget(moves: Move[], pos: Position, from: number, to: number, me: Color): void {
  if (to === -1) return;
  const tp = pos.board[to] ?? null;
  if (tp === null || tp.color !== me) moves.push({ from, to });
}

/**
 * Castling — generated only when fully legal, because the "king may not pass THROUGH an attacked
 * square" rule cannot be caught by the general legal filter (which only checks the landing square).
 * So the not-attacked test for every square the king crosses is done here, at generation.
 */
function addCastles(moves: Move[], pos: Position, kingIdx: number, me: Color): void {
  if (kingIdx !== KING_HOME[me]) return;
  const enemy = opposite(me);
  if (squareAttackedBy(pos, kingIdx, enemy)) return; // cannot castle out of check

  const rights = pos.castling;
  const empty = (idxs: number[]): boolean => idxs.every((s) => pos.board[s] === null);
  const safe = (idxs: number[]): boolean => idxs.every((s) => !squareAttackedBy(pos, s, enemy));

  if (me === 'w') {
    if (rights.wk && empty([61, 62]) && safe([61, 62])) moves.push({ from: 60, to: 62, castle: 'K' });
    if (rights.wq && empty([59, 58, 57]) && safe([59, 58])) moves.push({ from: 60, to: 58, castle: 'Q' });
  } else {
    if (rights.bk && empty([5, 6]) && safe([5, 6])) moves.push({ from: 4, to: 6, castle: 'K' });
    if (rights.bq && empty([3, 2, 1]) && safe([3, 2])) moves.push({ from: 4, to: 2, castle: 'Q' });
  }
}

/**
 * Apply a move to a position, returning a NEW one — the input is never mutated (it is shared state
 * another render may still read). Handles capture, en passant, castling, promotion, the castling-
 * rights bookkeeping, the halfmove clock and the ep target. Assumes `move` is one the generator
 * produced for `pos`.
 */
export function applyMove(pos: Position, move: Move): Position {
  const board = pos.board.slice();
  const piece = board[move.from];
  if (!piece) return pos; // defensive; a generated move always has a piece

  const isCapture = board[move.to] !== null || move.enPassant === true;
  board[move.to] = move.promotion ? { color: piece.color, type: move.promotion } : piece;
  board[move.from] = null;

  // En passant removes the pawn that is NOT on `to` — it sits beside the mover, on `from`'s rank.
  if (move.enPassant === true) {
    const capRow = rowOf(move.from);
    const capSquare = sq(fileOf(move.to), capRow);
    if (capSquare !== -1) board[capSquare] = null;
  }

  // Castling moves the rook to the far side of the king.
  if (move.castle === 'K') {
    if (piece.color === 'w') {
      board[61] = board[63] ?? null;
      board[63] = null;
    } else {
      board[5] = board[7] ?? null;
      board[7] = null;
    }
  } else if (move.castle === 'Q') {
    if (piece.color === 'w') {
      board[59] = board[56] ?? null;
      board[56] = null;
    } else {
      board[3] = board[0] ?? null;
      board[0] = null;
    }
  }

  // Castling rights: king move clears both; a rook leaving (or being captured on) its home clears
  // that side. Recompute from the affected squares rather than tracking incrementally.
  const castling = { ...pos.castling };
  if (piece.type === 'k') {
    if (piece.color === 'w') {
      castling.wk = false;
      castling.wq = false;
    } else {
      castling.bk = false;
      castling.bq = false;
    }
  }
  for (const s of [move.from, move.to]) {
    if (s === 63) castling.wk = false;
    if (s === 56) castling.wq = false;
    if (s === 7) castling.bk = false;
    if (s === 0) castling.bq = false;
  }

  const ep = move.doublePush === true ? sq(fileOf(move.from), rowOf(move.from) + (piece.color === 'w' ? -1 : 1)) : -1;
  const resetClock = piece.type === 'p' || isCapture;

  return {
    board,
    active: opposite(pos.active),
    castling,
    ep,
    halfmove: resetClock ? 0 : pos.halfmove + 1,
    fullmove: pos.active === 'b' ? pos.fullmove + 1 : pos.fullmove,
  };
}

/** The fully legal moves for the side to move: pseudo-legal moves that do not leave the king in check. */
export function legalMoves(pos: Position): Move[] {
  const me = pos.active;
  return pseudoMoves(pos).filter((m) => !isInCheck(applyMove(pos, m), me));
}

/** Whether the side to move has any legal move — the checkmate/stalemate discriminator. */
export function hasLegalMove(pos: Position): boolean {
  const me = pos.active;
  return pseudoMoves(pos).some((m) => !isInCheck(applyMove(pos, m), me));
}

// ── Draws & outcome ──────────────────────────────────────────────────────────────────────────────

/**
 * K vs K, K+minor vs K, and K+B vs K+B with the bishops on same-coloured squares — the material
 * combinations from which no checkmate is possible. Threefold repetition is deliberately NOT here
 * (it needs move history the wire state does not carry); a friendly game does without it, and the
 * fifty-move rule still terminates a dead position.
 */
export function insufficientMaterial(pos: Position): boolean {
  const pieces: { type: PieceType; color: Color; square: number }[] = [];
  pos.board.forEach((p, i) => {
    if (p) pieces.push({ type: p.type, color: p.color, square: i });
  });
  const nonKings = pieces.filter((p) => p.type !== 'k');
  if (nonKings.length === 0) return true; // K vs K
  if (nonKings.length === 1) return nonKings[0]?.type === 'b' || nonKings[0]?.type === 'n'; // K+minor vs K
  if (nonKings.length === 2 && nonKings.every((p) => p.type === 'b')) {
    // Two bishops: drawn only if same colour AND on same-coloured squares.
    const [a, b] = nonKings;
    if (a && b && a.color !== b.color) {
      const colour = (s: number): number => (fileOf(s) + rowOf(s)) % 2;
      return colour(a.square) === colour(b.square);
    }
  }
  return false;
}

export type Outcome =
  | { readonly kind: 'playing' }
  | { readonly kind: 'checkmate'; readonly winner: 0 | 1 }
  | { readonly kind: 'stalemate' }
  | { readonly kind: 'draw'; readonly reason: 'fifty-move' | 'insufficient-material' };

/** Reduce a position to its outcome. Terminal-no-moves first (mate vs stalemate), then the draws. */
export function outcomeOf(pos: Position): Outcome {
  if (!hasLegalMove(pos)) {
    if (isInCheck(pos, pos.active)) {
      // The side to move is mated; the winner is the other seat.
      return { kind: 'checkmate', winner: pos.active === 'w' ? 1 : 0 };
    }
    return { kind: 'stalemate' };
  }
  if (pos.halfmove >= 100) return { kind: 'draw', reason: 'fifty-move' };
  if (insufficientMaterial(pos)) return { kind: 'draw', reason: 'insufficient-material' };
  return { kind: 'playing' };
}

// ── The wire state a game shares ───────────────────────────────────────────────────────────────

/**
 * The shared game state — this game's `TPublic`, the thing `useRoom<ChessState>()` carries and
 * `patch` writes to RTDB. It is a FEN string plus a small envelope, and every field is wire-safe:
 * `fen` is a non-empty string; `outcome` is a non-empty object (it always has a `kind`); `lastFrom`/
 * `lastTo` use the `-1` sentinel rather than `null` for "no last move", the exact fix Tic-Tac-Toe's
 * null-board bug bought — an empty/`null` value is dropped by RTDB and read back as `undefined`.
 */
export interface ChessState {
  readonly fen: string;
  readonly outcome: Outcome;
  /** The last move's from/to squares for highlighting, or `-1`/`-1` before any move. */
  readonly lastFrom: number;
  readonly lastTo: number;
  /** Bumps on a rematch, so a fresh board is a state change every client sees and each reports once. */
  readonly round: number;
}

/** The opening position, seat 0 (White) to move. `round` bumps on a rematch. */
export function initialChessState(round = 0): ChessState {
  return { fen: START_FEN, outcome: { kind: 'playing' }, lastFrom: -1, lastTo: -1, round };
}

/** Parse the shared state's FEN into the rich position the logic reasons over. */
export function positionOf(state: ChessState): Position {
  return parseFen(state.fen);
}

/** The seat (0 White, 1 Black) whose move it is in this state. */
export function turnSeat(state: ChessState): 0 | 1 {
  return positionOf(state).active === 'w' ? 0 : 1;
}

/** The piece on square `i` of the shared state, or `null`. For the board to draw. */
export function pieceAt(state: ChessState, i: number): Piece | null {
  return positionOf(state).board[i] ?? null;
}

/** The legal moves originating from `from` in this state — for highlighting a selected piece. */
export function legalMovesFrom(state: ChessState, from: number): Move[] {
  return legalMoves(positionOf(state)).filter((m) => m.from === from);
}

/** The distinct destination squares reachable from `from` — the dots the board paints. */
export function targetsFrom(state: ChessState, from: number): number[] {
  const seen = new Set<number>();
  for (const m of legalMovesFrom(state, from)) seen.add(m.to);
  return [...seen];
}

/** Whether a pawn moving `from`→`to` in this state would land on the back rank (needs a promotion pick). */
export function isPromotion(state: ChessState, from: number, to: number): boolean {
  return legalMovesFrom(state, from).some((m) => m.to === to && m.promotion !== undefined);
}

/**
 * Play a move. TOTAL and PURE: a move that is not legal in `state` returns the state UNCHANGED
 * rather than throwing — this runs inside the room's `patch` transaction (which may retry it) and
 * against clicks that can race, so a stale or illegal move must be a no-op, not a crash. The board
 * gates the UI to legal targets; this gates the state, so a bad write is impossible even if the UI
 * slips. `promotion` defaults to a queen (the near-universal choice) when the move promotes.
 */
export function playMove(
  state: ChessState,
  from: number,
  to: number,
  promotion: PieceType = 'q'
): ChessState {
  if (state.outcome.kind !== 'playing') return state;
  const pos = positionOf(state);
  const move = legalMoves(pos).find(
    (m) => m.from === from && m.to === to && (m.promotion === undefined || m.promotion === promotion)
  );
  if (move === undefined) return state;
  const next = applyMove(pos, move);
  return { fen: toFen(next), outcome: outcomeOf(next), lastFrom: from, lastTo: to, round: state.round };
}
