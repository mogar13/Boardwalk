import { useEffect, useRef } from 'react';
import { Button, Card, cx } from '@/ui';
import { useGame } from '@/system/economy/useGame';
import { useEquippedFelt } from '@/system/felt/useEquippedFelt';
import { useRoom } from '@/system/room/useRoom';
import { useSeats } from '@/system/room/useSeats';
import { aiSeatsToDrive } from '@/system/room/seats';
import {
  EMPTY,
  bestMove,
  initialState,
  play,
  type Player,
  type TicTacToeState,
} from '@boardwalk/game-logic/games/tic-tac-toe';

/**
 * The board — the only part of Tic-Tac-Toe that is not the OS. It is a reader of `useRoom`,
 * `useSeats` and `useGame`, and everything hard about it (the rules, the win check, the house's
 * move) lives in the tested pure `logic/`; this component only draws the state and forwards clicks
 * into `patch`. Three effects wire it to the room, and each is a rule the OS made a one-liner:
 *
 *   1. The HOST seeds the opening board once play starts (`state` is null until someone writes it).
 *   2. The HOST drives the AI seats — `aiSeatsToDrive` is host-only, so an online guest never
 *      fights the host to move a bot (v1 got a human prompted to play the computer's hand).
 *   3. EACH client reports its OWN seat's result once per game, so online both players record
 *      honestly and a rematch (a new `round`) re-arms the report.
 *
 * No listener is registered here and none is torn down — `<RoomProvider>` (mounted by the lobby)
 * owns the single subscription. That is why this game cannot leak the way 22 of v1's 25 did.
 */

const MARK: Record<Player, string> = { 0: '✕', 1: '◯' };
const MARK_TONE: Record<Player, string> = { 0: 'text-primary', 1: 'text-secondary' };

export function Board() {
  const { state, patch, seats, status, isHost } = useRoom<TicTacToeState>();
  const { isMyTurn, mySeatIndex } = useSeats();
  const { reportResult } = useGame();
  const felt = useEquippedFelt();

  // 1. Host seeds the opening state exactly once, when the room flips to playing.
  useEffect(() => {
    if (isHost && status === 'playing' && state === null) {
      void patch(() => initialState());
    }
  }, [isHost, status, state, patch]);

  // 2. Host drives whichever AI seat is to move. Recomputed INSIDE the producer so the write is
  // always legal even if the board changed under the pacing delay — `play` no-ops an illegal move.
  useEffect(() => {
    if (!isHost || state === null || state.outcome.kind !== 'playing') return;
    if (!aiSeatsToDrive(seats, isHost).includes(state.turn)) return;
    const timer = setTimeout(() => {
      void patch((s) => {
        if (s === null) return initialState();
        if (s.outcome.kind !== 'playing') return s;
        const move = bestMove(s, s.turn);
        return move === null ? s : play(s, s.turn, move);
      });
    }, 450);
    return () => {
      clearTimeout(timer);
    };
  }, [isHost, seats, state, patch]);

  // 3. Report my own seat's result once per finished round. The ref keys on `round`, so a rematch
  // reports again and a re-render of the same finished game does not double-count.
  const reportedRound = useRef<number | null>(null);
  useEffect(() => {
    if (state === null || state.outcome.kind === 'playing' || mySeatIndex < 0) return;
    if (reportedRound.current === state.round) return;
    reportedRound.current = state.round;
    const outcome =
      state.outcome.kind === 'draw'
        ? 'push'
        : state.outcome.player === mySeatIndex
          ? 'win'
          : 'loss';
    reportResult({ outcome });
  }, [state, mySeatIndex, reportResult]);

  if (state === null) {
    return (
      <Card className="p-6">
        <p className="text-bw-muted text-sm">Setting up the board…</p>
      </Card>
    );
  }

  const { board, turn, outcome } = state;
  const myMove = outcome.kind === 'playing' && isMyTurn(turn);
  const winningLine = outcome.kind === 'win' ? outcome.line : null;

  const onCell = (i: number) => {
    if (outcome.kind !== 'playing' || !isMyTurn(turn)) return;
    void patch((s) => (s === null ? initialState() : play(s, turn, i)));
  };

  const status_ =
    outcome.kind === 'win'
      ? mySeatIndex === outcome.player
        ? 'You win.'
        : `${MARK[outcome.player]} takes it.`
      : outcome.kind === 'draw'
        ? 'A draw — the oldest result on the boardwalk.'
        : myMove
          ? 'Your move.'
          : `${MARK[turn]} to move — ${seats[turn]?.name ?? '…'}.`;

  return (
    <Card felt={felt} className="flex flex-col items-center gap-5 p-6">
      <p
        className={cx(
          'text-sm',
          outcome.kind === 'playing' ? 'text-bw-muted' : 'text-base-content'
        )}
      >
        {status_}
      </p>

      <div className="grid grid-cols-3 gap-2">
        {board.map((cell, i) => {
          const onWin = winningLine?.includes(i) ?? false;
          return (
            <button
              key={i}
              type="button"
              disabled={!myMove || cell !== EMPTY}
              onClick={() => {
                onCell(i);
              }}
              className={cx(
                'flex h-20 w-20 items-center justify-center rounded-lg border text-4xl font-bold transition',
                'border-bw-line bg-base-200',
                onWin && 'border-primary shadow-glow-primary',
                cell !== EMPTY ? MARK_TONE[cell] : 'text-base-content',
                myMove && cell === EMPTY && 'hover:border-secondary cursor-pointer'
              )}
            >
              {cell !== EMPTY ? MARK[cell] : ''}
            </button>
          );
        })}
      </div>

      {outcome.kind !== 'playing' && mySeatIndex >= 0 && (
        <Button
          variant="primary"
          onClick={() => {
            void patch((s) => initialState((s?.round ?? 0) + 1));
          }}
        >
          Play again
        </Button>
      )}
    </Card>
  );
}
