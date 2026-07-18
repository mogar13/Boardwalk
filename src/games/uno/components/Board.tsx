import { useEffect, useRef, useState } from 'react';
import { Button, Card, cx } from '@/ui';
import { useGame } from '@/system/economy/useGame';
import { useEquippedFelt } from '@/system/felt/useEquippedFelt';
import { useAudio } from '@/system/audio/useAudio';
import { useRoom } from '@/system/room/useRoom';
import { useSeats } from '@/system/room/useSeats';
import { useHand } from '@/system/room/useHand';
import {
  canPlay,
  submitMove,
  type Card as UnoCard,
  type UnoColor,
  type UnoState,
} from '@boardwalk/game-logic/games/uno';
import { unoBackSrc, unoCardSrc } from '@/games/uno/art';
import { useUnoHost } from '@/games/uno/components/useUnoHost';

/**
 * The board — the only part of UNO that is neither the OS nor the tested pure `logic/`. It reads
 * `useRoom` (the public projection), `useHand` (this seat's private cards), `useSeats` and
 * `useGame`, and it NEVER runs the rules: a move is submitted as an intent (`submitMove`) and the
 * host's `useUnoHost` engine applies it. So the whole component is a renderer plus an intent sender —
 * hot-seat-free, mode-blind, exactly like Chess's board, and the reason no client can leak a listener
 * is still structural (the provider owns every subscription; `useHand` owns its own teardown).
 *
 * A note on colour: the four UNO colours are the deck's identity (game content), so they come from
 * theme tokens (`bg-uno-*`, defined in packages/theme/theme.css — the one file allowed to name a
 * colour) via the literal maps below, which Tailwind can see. The card FACES carry their colour in
 * the art; the swatch and the wild picker are the only places a bare colour is drawn.
 */

const SWATCH: Record<UnoColor, string> = {
  red: 'bg-uno-red',
  blue: 'bg-uno-blue',
  green: 'bg-uno-green',
  yellow: 'bg-uno-yellow',
};
const RING: Record<UnoColor, string> = {
  red: 'ring-uno-red',
  blue: 'ring-uno-blue',
  green: 'ring-uno-green',
  yellow: 'ring-uno-yellow',
};

export function Board() {
  const { state, patch, seats, status, isHost, writeHand } = useRoom<UnoState>();
  const { mySeatIndex, isMyTurn } = useSeats();
  const { reportResult } = useGame();
  const felt = useEquippedFelt();
  const audio = useAudio();

  const { dealAgain } = useUnoHost({ isHost, status, state, seats, patch, writeHand });
  const myHand = useHand<UnoCard[]>(mySeatIndex) ?? [];

  const [pendingWild, setPendingWild] = useState<string | null>(null);
  const [unoArmed, setUnoArmed] = useState(false);

  // Reset the half-made wild choice and the UNO arm when the round changes (rematch / first deal).
  const round = state?.round ?? null;
  const [seenRound, setSeenRound] = useState<number | null>(round);
  if (round !== seenRound) {
    setSeenRound(round);
    setPendingWild(null);
    setUnoArmed(false);
  }

  // Report my own seat's result once per finished round — keyed on round like Chess, so a rematch
  // re-arms and a re-render of the same win does not double-count. No betting: XP + a stat, no money.
  const reportedRound = useRef<number | null>(null);
  useEffect(() => {
    if (state === null || state.winner < 0 || mySeatIndex < 0) return;
    if (reportedRound.current === state.round) return;
    reportedRound.current = state.round;
    reportResult({ outcome: state.winner === mySeatIndex ? 'win' : 'loss' });
  }, [state, mySeatIndex, reportResult]);

  // Audio, from the OS roles (never a filename): a soft place on any played card, a chime when the
  // turn becomes mine, and win/lose at the end.
  const topKey = useRef<string | null>(null);
  const prevTurnMine = useRef(false);
  const wonKey = useRef<number | null>(null);
  useEffect(() => {
    if (state === null) return;
    if (topKey.current !== null && topKey.current !== state.top.id) audio.play('place');
    topKey.current = state.top.id;

    const mine = state.winner < 0 && isMyTurn(state.turn);
    if (mine && !prevTurnMine.current) audio.play('notify');
    prevTurnMine.current = mine;

    if (state.winner >= 0 && wonKey.current !== state.round) {
      wonKey.current = state.round;
      audio.play(state.winner === mySeatIndex ? 'win' : 'lose');
    }
  }, [state, isMyTurn, mySeatIndex, audio]);

  if (state === null) {
    return (
      <Card className="p-6">
        <p className="text-bw-muted text-sm">Shuffling the deck…</p>
      </Card>
    );
  }

  const myTurn = state.winner < 0 && isMyTurn(state.turn);
  const finished = state.winner >= 0;

  const submit = (move: Parameters<typeof submitMove>[2]): void => {
    if (mySeatIndex < 0) return;
    void patch((prev) => submitMove(prev ?? state, mySeatIndex, move));
    setUnoArmed(false);
  };
  const playCard = (card: UnoCard): void => {
    if (!myTurn || !canPlay(card, state.top, state.color)) {
      if (!canPlay(card, state.top, state.color)) audio.play('error');
      return;
    }
    if (card.kind === 'wild' || card.kind === 'wild4') {
      setPendingWild(card.id);
      return;
    }
    submit({ type: 'play', cardId: card.id, declareUno: unoArmed });
  };
  const chooseColor = (color: UnoColor): void => {
    if (pendingWild === null) return;
    submit({ type: 'play', cardId: pendingWild, chosenColor: color, declareUno: unoArmed });
    setPendingWild(null);
  };

  // Opponents in turn order, starting after me (so the table reads clockwise from my seat).
  const others = seats
    .map((seat, index) => ({ seat, index }))
    .filter((o) => o.index !== mySeatIndex)
    .sort(
      (a, b) =>
        turnDistance(mySeatIndex, a.index, seats.length) -
        turnDistance(mySeatIndex, b.index, seats.length)
    );

  return (
    <Card felt={felt} className="flex flex-col items-center gap-5 p-6">
      <p className={cx('text-sm', finished ? 'text-base-content' : 'text-bw-muted')}>
        {statusLine(state, seats, myTurn, mySeatIndex)}
      </p>

      {/* Opponents */}
      <div className="flex flex-wrap items-start justify-center gap-3">
        {others.map(({ seat, index }) => {
          const count = state.counts[index] ?? 0;
          const active = state.turn === index && !finished;
          return (
            <div
              key={index}
              className={cx(
                'flex min-w-24 flex-col items-center gap-1 rounded-lg border p-2 transition',
                active ? 'border-secondary bg-base-300' : 'border-bw-line bg-base-200'
              )}
            >
              <span className="max-w-28 truncate text-xs font-semibold">
                {seat.name || `Player ${String(index + 1)}`}
              </span>
              <div className="flex h-8 items-center">
                {Array.from({ length: Math.min(count, 7) }).map((_, k) => (
                  <img
                    key={k}
                    src={unoBackSrc()}
                    alt=""
                    className="-ml-4 h-8 w-auto rounded-sm first:ml-0"
                  />
                ))}
              </div>
              <span className="text-bw-muted text-[0.65rem]">
                {count} card{count === 1 ? '' : 's'}
                {count === 1 && state.calledUno[index] ? ' · UNO!' : ''}
              </span>
            </div>
          );
        })}
      </div>

      {/* Table centre: draw pile, discard, active colour, direction */}
      <div className="flex items-center gap-6">
        <button
          type="button"
          disabled={!myTurn}
          onClick={() => {
            submit({ type: 'draw' });
          }}
          className={cx(
            'relative rounded-lg transition',
            myTurn ? 'cursor-pointer hover:-translate-y-0.5' : 'opacity-80'
          )}
          aria-label="Draw a card"
        >
          <img src={unoBackSrc()} alt="Draw pile" className="h-28 w-auto rounded-lg" />
          <span className="bg-base-100/80 text-bw-muted absolute -bottom-1 -right-1 rounded-full px-1.5 py-0.5 text-[0.6rem]">
            {state.deckCount}
          </span>
        </button>

        <div className="flex flex-col items-center gap-2">
          <img
            src={unoCardSrc(state.top)}
            alt="Top of the pile"
            className="h-28 w-auto rounded-lg"
          />
          <div className="flex items-center gap-1.5">
            <span
              className={cx(
                'inline-block h-3 w-3 rounded-full ring-1 ring-inset',
                SWATCH[state.color],
                RING[state.color]
              )}
            />
            <span className="text-bw-muted text-[0.65rem] uppercase tracking-wide">
              {state.color}
            </span>
            <span className="text-bw-muted ml-1 text-[0.65rem]">
              {state.direction === 1 ? '↻' : '↺'}
            </span>
          </div>
        </div>
      </div>

      {/* The wild colour picker (inline, like Chess's promotion picker) */}
      {pendingWild !== null && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-bw-muted text-xs">Pick a colour</p>
          <div className="flex gap-2">
            {(['red', 'blue', 'green', 'yellow'] as const).map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  chooseColor(color);
                }}
                aria-label={color}
                className={cx(
                  'h-9 w-9 rounded-full ring-2 ring-inset transition hover:scale-110',
                  SWATCH[color],
                  RING[color]
                )}
              />
            ))}
          </div>
        </div>
      )}

      {/* My hand */}
      {mySeatIndex >= 0 && (
        <div className="flex w-full max-w-[min(92vw,44rem)] flex-col items-center gap-2">
          <div className="flex w-full items-center justify-center gap-1 overflow-x-auto pb-2">
            {myHand.map((card) => {
              const playable = myTurn && canPlay(card, state.top, state.color);
              return (
                <button
                  key={card.id}
                  type="button"
                  disabled={!myTurn}
                  onClick={() => {
                    playCard(card);
                  }}
                  className={cx(
                    'shrink-0 rounded-lg transition',
                    playable ? 'cursor-pointer hover:-translate-y-1.5' : 'opacity-60',
                    playable && 'ring-secondary ring-2'
                  )}
                >
                  <img src={unoCardSrc(card)} alt="" className="h-24 w-auto rounded-lg sm:h-28" />
                </button>
              );
            })}
            {myHand.length === 0 && !finished && (
              <span className="text-bw-muted text-sm">No cards.</span>
            )}
          </div>

          {myHand.length === 2 && myTurn && (
            <Button
              variant={unoArmed ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => {
                setUnoArmed((v) => !v);
              }}
            >
              {unoArmed ? 'UNO armed ✓' : 'Call UNO!'}
            </Button>
          )}
        </div>
      )}

      {finished && isHost && (
        <Button variant="primary" onClick={dealAgain}>
          Deal again
        </Button>
      )}
      {finished && !isHost && (
        <p className="text-bw-muted text-sm">Waiting for the host to deal again…</p>
      )}
    </Card>
  );
}

/** Steps from `me` to `seat` going in the (initial, clockwise) direction — for ordering opponents. */
function turnDistance(me: number, seat: number, n: number): number {
  if (me < 0) return seat;
  return (((seat - me) % n) + n) % n;
}

/** The one line above the table: the result if the game is over, else whose turn it is. */
function statusLine(
  state: UnoState,
  seats: ReadonlyArray<{ readonly name: string }>,
  myTurn: boolean,
  mySeat: number
): string {
  if (state.winner >= 0) {
    if (state.winner === mySeat) return 'You went out — you win! 🎉';
    return `${seats[state.winner]?.name ?? 'A player'} went out and wins.`;
  }
  if (myTurn) return 'Your turn — play a card or draw.';
  return `${seats[state.turn]?.name ?? '…'} is playing…`;
}
