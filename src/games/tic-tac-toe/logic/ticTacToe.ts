/**
 * Tic-Tac-Toe, as pure functions. No React, no DOM, no `@/system` — enforced by
 * `@boardwalk/no-impure-logic`, which is why this file can be unit-tested to the last line before
 * a single component exists (ARCHITECTURE.md's build order: extract logic → test logic → draw UI).
 * A win check that lives in a component is a win check no test can reach; here it is a value.
 *
 * A player IS a seat index. Seat 0 plays first (call it X), seat 1 second (O), and the board holds
 * the seat index that marked each cell — never a `'X' | 'O'` string, because "who owns this mark"
 * and "who sits in seat 0" must be the same fact, and a separate mark alphabet is a second source
 * of truth waiting to disagree with the seat array.
 */

export type Player = 0 | 1;

/**
 * An empty cell is `-1`, NOT `null` — and this is a wire decision, not a style one. RTDB drops
 * null children, so a board written as `[null, null, …]` round-trips back as `undefined` (an
 * all-null array is an empty node, which RTDB deletes), and the first render after the host seeds
 * the board reads `state.board` as `undefined` and crashes on `.map`. A sentinel RTDB keeps —
 * `-1`, which `0` (a real seat) is not — makes the board a fixed-length array of numbers that
 * survives the round trip intact. This is the exact class of bug ARCHITECTURE.md says only a
 * browser finds: it typechecks, it unit-tests, and it breaks only against a real database.
 */
export const EMPTY = -1;
/** A cell holds the seat that marked it, or `EMPTY`. */
export type Cell = Player | typeof EMPTY;
/** Nine cells, row-major (index 0 is top-left, 8 is bottom-right). Readonly — moves return anew. */
export type Board = readonly Cell[];

/**
 * The eight winning lines, as cell-index triples. A `const` because it is the one place the
 * geometry lives — every win check reads this array, so there is exactly one definition of "three
 * in a row" and no chance of a component hand-rolling a ninth, wrong line.
 */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8], // rows
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8], // columns
  [0, 4, 8],
  [2, 4, 6], // diagonals
];

export type Outcome =
  | { readonly kind: 'playing' }
  | {
      readonly kind: 'win';
      readonly player: Player;
      readonly line: readonly [number, number, number];
    }
  | { readonly kind: 'draw' };

/**
 * The shared game state — this game's `TPublic`, the thing `useRoom<TicTacToeState>()` carries.
 * `turn` is whose move it is (a seat index); the OS deliberately does NOT track this for a game
 * (see `useSeats`), so it lives here where it belongs. `round` bumps on a rematch so a fresh board
 * is a state change every client sees, and so each client reports its result exactly once per game.
 */
export interface TicTacToeState {
  readonly board: Board;
  readonly turn: Player;
  readonly outcome: Outcome;
  readonly round: number;
}

const other = (p: Player): Player => (p === 0 ? 1 : 0);

/** The starting state: an empty board, seat 0 to move, nothing decided. */
export function initialState(round = 0): TicTacToeState {
  return {
    board: [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY],
    turn: 0,
    outcome: { kind: 'playing' },
    round,
  };
}

/** The player who has three in a row and the line they hold, or `null` if nobody does. */
export function winner(
  board: Board
): { player: Player; line: readonly [number, number, number] } | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const v = board[a];
    // Exclude empty (and, for a short board, undefined), so the returned player is a real seat and
    // three empty cells never read back as a phantom win.
    if (v !== undefined && v !== EMPTY && v === board[b] && v === board[c])
      return { player: v, line };
  }
  return null;
}

/** Every cell filled — the draw condition, once `winner` has come back null. */
export function isFull(board: Board): boolean {
  return board.every((c) => c !== EMPTY);
}

/** Reduce a board to its outcome: a win beats a full board (a winning last move is a win, not a draw). */
export function outcomeOf(board: Board): Outcome {
  const w = winner(board);
  if (w !== null) return { kind: 'win', player: w.player, line: w.line };
  if (isFull(board)) return { kind: 'draw' };
  return { kind: 'playing' };
}

/** The empty cell indices — the legal moves while the game is live, and `[]` once it is decided. */
export function legalMoves(state: TicTacToeState): number[] {
  if (state.outcome.kind !== 'playing') return [];
  const out: number[] = [];
  state.board.forEach((c, i) => {
    if (c === EMPTY) out.push(i);
  });
  return out;
}

/** Whether `player` may mark `cell` right now: the game is live, it is their turn, the cell is empty. */
export function canPlay(state: TicTacToeState, player: Player, cell: number): boolean {
  return (
    state.outcome.kind === 'playing' &&
    state.turn === player &&
    cell >= 0 &&
    cell < 9 &&
    state.board[cell] === EMPTY
  );
}

/**
 * Apply a move. TOTAL and PURE: an illegal move returns the state UNCHANGED rather than throwing,
 * because this runs inside the room's `patch` transaction (which can retry it) and against clicks
 * that may race — a double-tap on the same cell, or a click after the game ended, must be a no-op,
 * not a crash. The caller gates the UI with `canPlay`; this gates the state, so a bad write is
 * impossible even if the UI slips.
 */
export function play(state: TicTacToeState, player: Player, cell: number): TicTacToeState {
  if (!canPlay(state, player, cell)) return state;
  const board = state.board.slice();
  board[cell] = player;
  return { ...state, board, turn: other(player), outcome: outcomeOf(board) };
}

// ── The house player ─────────────────────────────────────────────────────────────────────────
//
// Perfect play by minimax. Tic-Tac-Toe is a solved draw, so the house never loses and a human can
// at best tie it — which is the honest thing for the oldest table on the boardwalk, and (unlike a
// heuristic) it is exactly specifiable, so the tests can assert it takes an open win and blocks a
// forced loss rather than eyeballing "seems to play alright".

/**
 * Preference among moves of EQUAL minimax value: centre, then corners, then edges. This changes
 * nothing about the result (all equal-value moves draw under perfect play) — it only makes the
 * house play the natural-looking move a person would, and makes `bestMove` deterministic, which is
 * what lets a test pin "empty board → centre".
 */
const CELL_RANK = [2, 1, 2, 1, 3, 1, 2, 1, 2] as const;

/** Minimax value of `board` from `me`'s perspective, `current` to move. Depth rewards a quicker win. */
function score(board: Board, me: Player, current: Player, depth: number): number {
  const oc = outcomeOf(board);
  if (oc.kind === 'win') return oc.player === me ? 10 - depth : depth - 10;
  if (oc.kind === 'draw') return 0;

  const best = current === me ? -Infinity : Infinity;
  return board.reduce<number>((acc, cell, i) => {
    if (cell !== EMPTY) return acc;
    const next = board.slice();
    next[i] = current;
    const s = score(next, me, other(current), depth + 1);
    return current === me ? Math.max(acc, s) : Math.min(acc, s);
  }, best);
}

/**
 * The house's move for `player`, or `null` if it is not their turn or the game is over. Picks the
 * highest minimax value, breaking ties by `CELL_RANK` so play is deterministic and natural.
 */
export function bestMove(state: TicTacToeState, player: Player): number | null {
  if (state.outcome.kind !== 'playing' || state.turn !== player) return null;

  const rankOf = (i: number): number => CELL_RANK[i] ?? 0;
  let bestCell = -1;
  let bestScore = -Infinity;
  for (const i of legalMoves(state)) {
    const next = state.board.slice();
    next[i] = player;
    const s = score(next, player, other(player), 1);
    // First legal move always wins this comparison (any finite score beats -Infinity), so bestCell
    // leaves -1 only when there were no legal moves at all.
    if (s > bestScore || (s === bestScore && rankOf(i) > rankOf(bestCell))) {
      bestScore = s;
      bestCell = i;
    }
  }
  return bestCell === -1 ? null : bestCell;
}
