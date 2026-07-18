import { useEffect, useRef, useState } from 'react';
import { Button, Card, cx } from '@/ui';
import { useGame } from '@/system/economy/useGame';
import { useAudio } from '@/system/audio/useAudio';
import { useRoom } from '@/system/room/useRoom';
import { useSeats } from '@/system/room/useSeats';
import {
  initialChessState,
  isInCheck,
  isPromotion,
  playMove,
  positionOf,
  targetsFrom,
  turnSeat,
  type ChessState,
  type PieceType,
} from '@boardwalk/game-logic/games/chess';

/**
 * The board — the only part of Chess that is not the OS or the tested pure `logic/`. It is a reader
 * of `useRoom`, `useSeats` and `useGame`; every rule (legal moves, check, promotion, mate) is a
 * value from `logic/chess.ts`, and this component only draws the position, paints the legal targets,
 * and forwards a chosen move into `patch`. Two effects wire it to the room, each a rule the OS made
 * a one-liner — and there is NO AI effect, because Chess has no house (its coverage is hot-seat and
 * online, not the bot):
 *
 *   1. The HOST seeds the opening position once play starts (`state` is null until someone writes it).
 *   2. EACH client reports its OWN seat's result once per round, so both players record honestly and
 *      a rematch (a new `round`) re-arms the report. In hot-seat one screen holds both seats, so
 *      `mySeatIndex` is seat 0 (White) and the account records White's result — one game, one record.
 *
 * No listener is registered or torn down here — `<RoomProvider>` (mounted by the lobby) owns the one
 * subscription. Hot-seat and online are the SAME code: `isMyTurn(turn)` is true for whichever local
 * seat is to move (both, on a shared screen; mine, online), and the game never branches on a mode.
 */

/** Solid Unicode chess glyphs, tinted by seat so White/Black read on the dark squares (as X/O do). */
const GLYPH: Record<PieceType, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const TONE: Record<'w' | 'b', string> = { w: 'text-primary', b: 'text-secondary' };

export function Board() {
  const { state, patch, seats, status, isHost } = useRoom<ChessState>();
  const { isMyTurn, mySeatIndex } = useSeats();
  const { reportResult } = useGame();
  const audio = useAudio();

  const [selected, setSelected] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);

  // Clear any half-made selection when the round changes (a rematch, or the first board). This is
  // React's "adjust state during render when a prop changes" pattern, NOT an effect — a synchronous
  // setState in an effect is exactly what `react-hooks/set-state-in-effect` forbids, and the
  // render-time adjustment is the fix that rule points at (it re-renders immediately, no flash).
  const round = state?.round ?? null;
  const [seenRound, setSeenRound] = useState<number | null>(round);
  if (round !== seenRound) {
    setSeenRound(round);
    setSelected(null);
    setPromo(null);
  }

  // 1. Host seeds the opening position exactly once, when the room flips to playing.
  useEffect(() => {
    if (isHost && status === 'playing' && state === null) {
      void patch(() => initialChessState());
    }
  }, [isHost, status, state, patch]);

  // 2. Report my own seat's result once per finished round. Keyed on `round`, so a rematch reports
  // again and a re-render of the same finished game does not double-count.
  const reportedRound = useRef<number | null>(null);
  useEffect(() => {
    if (state === null || state.outcome.kind === 'playing' || mySeatIndex < 0) return;
    if (reportedRound.current === state.round) return;
    reportedRound.current = state.round;
    const won = state.outcome.kind === 'checkmate' && state.outcome.winner === mySeatIndex;
    const outcome = state.outcome.kind === 'checkmate' ? (won ? 'win' : 'loss') : 'push';
    // Speedrun feat: a checkmate win inside 20 full moves. The fullmove number is the 6th FEN
    // field — a fact the board holds and the economy does not, so the game reports it. Hidden, so
    // the first fast finish is a surprise.
    const fullmove = Number(state.fen.split(' ')[5] ?? '');
    const speedrun = won && Number.isFinite(fullmove) && fullmove < 20;
    reportResult({ outcome, ...(speedrun ? { feats: ['feat_speedrun'] } : {}) });
  }, [state, mySeatIndex, reportResult]);

  // A soft click on any applied move — remote or local — using the OS audio role, never a filename.
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (state === null || state.lastFrom < 0) return;
    const key = `${String(state.round)}:${String(state.lastFrom)}-${String(state.lastTo)}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    audio.play('click');
  }, [state, audio]);

  if (state === null) {
    return (
      <Card className="p-6">
        <p className="text-bw-muted text-sm">Setting up the board…</p>
      </Card>
    );
  }

  const pos = positionOf(state);
  const board = pos.board;
  const turn = turnSeat(state);
  const playing = state.outcome.kind === 'playing';
  const myMove = playing && isMyTurn(turn);
  // Orient the board so the local player's back rank is at the bottom. Online seat 1 (Black) plays
  // flipped; hot-seat (mySeatIndex 0) keeps White at the bottom for both players on the one screen.
  const flipped = mySeatIndex === 1;
  const order = flipped ? [...Array(64).keys()].reverse() : [...Array(64).keys()];

  const targets = selected === null ? [] : targetsFrom(state, selected);
  const checkedKing =
    playing && isInCheck(pos, pos.active)
      ? board.findIndex((p) => p?.color === pos.active && p.type === 'k')
      : -1;

  const move = (from: number, to: number, promotion?: PieceType): void => {
    void patch((s) => (s === null ? initialChessState() : playMove(s, from, to, promotion)));
  };

  const onCell = (i: number): void => {
    if (!myMove || promo !== null) return;
    const piece = board[i];
    if (selected === null) {
      // Select a piece of the side to move (a piece this screen controls the turn of).
      if (piece && (piece.color === 'w' ? 0 : 1) === turn) setSelected(i);
      return;
    }
    if (i === selected) {
      setSelected(null);
      return;
    }
    if (targets.includes(i)) {
      if (isPromotion(state, selected, i)) {
        setPromo({ from: selected, to: i });
      } else {
        move(selected, i);
        setSelected(null);
      }
      return;
    }
    // Clicking another of my own pieces re-selects; anything else clears.
    if (piece && (piece.color === 'w' ? 0 : 1) === turn) setSelected(i);
    else setSelected(null);
  };

  return (
    <Card className="flex flex-col items-center gap-5 p-6">
      <p className={cx('text-sm', playing ? 'text-bw-muted' : 'text-base-content')}>
        {statusLine(state, turn, myMove, mySeatIndex, seats, checkedKing !== -1)}
      </p>

      <div className="grid w-full max-w-[min(88vw,30rem)] grid-cols-8 overflow-hidden rounded-lg border border-bw-line">
        {order.map((i) => {
          const piece = board[i] ?? null;
          const dark = (fileOf(i) + rowOf(i)) % 2 === 1;
          const isSel = selected === i;
          const isTarget = targets.includes(i);
          const isLast = state.lastFrom === i || state.lastTo === i;
          return (
            <button
              key={i}
              type="button"
              disabled={!myMove}
              onClick={() => {
                onCell(i);
              }}
              className={cx(
                'relative flex aspect-square items-center justify-center text-3xl leading-none transition sm:text-4xl',
                dark ? 'bg-base-300' : 'bg-base-200',
                isLast && 'bg-primary/15',
                isSel && 'ring-secondary ring-2 ring-inset',
                i === checkedKing && 'ring-error ring-2 ring-inset',
                myMove && 'cursor-pointer'
              )}
            >
              {piece && <span className={TONE[piece.color]}>{GLYPH[piece.type]}</span>}
              {isTarget && (
                <span
                  className={cx(
                    'pointer-events-none absolute rounded-full',
                    piece ? 'ring-secondary/70 inset-1 ring-2' : 'bg-secondary/60 h-3 w-3'
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {promo !== null && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-bw-muted text-xs">Promote to</p>
          <div className="flex gap-2">
            {(['q', 'r', 'b', 'n'] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant="ghost"
                onClick={() => {
                  move(promo.from, promo.to, t);
                  setPromo(null);
                  setSelected(null);
                }}
              >
                <span className={cx('text-2xl', TONE[turn === 0 ? 'w' : 'b'])}>{GLYPH[t]}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {!playing && mySeatIndex >= 0 && (
        <Button
          variant="primary"
          onClick={() => {
            void patch((s) => initialChessState((s?.round ?? 0) + 1));
          }}
        >
          Play again
        </Button>
      )}
    </Card>
  );
}

const fileOf = (i: number): number => i % 8;
const rowOf = (i: number): number => Math.floor(i / 8);

/** The one line under the board: the result if the game is over, else whose move it is. */
function statusLine(
  state: ChessState,
  turn: 0 | 1,
  myMove: boolean,
  mySeat: number,
  seats: ReadonlyArray<{ readonly name: string }>,
  inCheck: boolean
): string {
  const oc = state.outcome;
  if (oc.kind === 'checkmate') {
    const who = oc.winner === 0 ? 'White' : 'Black';
    return mySeat === oc.winner ? 'Checkmate — you win.' : `Checkmate — ${who} takes it.`;
  }
  if (oc.kind === 'stalemate') return 'Stalemate — a draw.';
  if (oc.kind === 'draw') {
    return oc.reason === 'fifty-move'
      ? 'Draw — the fifty-move rule.'
      : 'Draw — not enough material.';
  }
  const side = turn === 0 ? 'White' : 'Black';
  const check = inCheck ? ' — check!' : '';
  if (myMove) return `Your move${check}`;
  return `${side} to move — ${seats[turn]?.name ?? '…'}${check}`;
}
