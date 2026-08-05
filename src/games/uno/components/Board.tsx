import { useEffect, useRef, useState } from 'react';
import { Button, Card, cx } from '@/ui';
import { useGame } from '@/system/economy/useGame';
import { useEquippedFelt } from '@/system/felt/useEquippedFelt';
import { useAudio } from '@/system/audio/useAudio';
import { Rematch } from '@/system/room/Rematch';
import { useRoom } from '@/system/room/useRoom';
import { useSeats } from '@/system/room/useSeats';
import { useHand } from '@/system/room/useHand';
import {
  DEAL_EVENT,
  canPlay,
  mustDraw,
  submitMove,
  type Card as UnoCard,
  type UnoColor,
  type UnoState,
} from '@boardwalk/game-logic/games/uno';
import { useAutoDraw } from '@/games/uno/components/useAutoDraw';
import { useUnoHost } from '@/games/uno/components/useUnoHost';
import { useMoveLog } from '@/games/uno/components/useMoveLog';
import { HandView } from '@/games/uno/components/HandView';
import { MoveLog } from '@/games/uno/components/MoveLog';
import { SeatView } from '@/games/uno/components/SeatView';
import { TableCentre } from '@/games/uno/components/TableCentre';
import { PenaltyFlash, RoundResult, TurnCue, UnoShout } from '@/games/uno/components/UnoOverlays';
import { opponentSlots, slotsOn, type UnoSeatSide } from '@/games/uno/seatLayout';
import { useGameOptions } from '@/system/options/useGameOptions';
import { unoBotLevel } from '@/games/uno/manifest';

/**
 * THE TABLE. Still a renderer plus an intent sender — it never runs the rules (a move is
 * `submitMove`, the host's `useUnoHost` applies it) and it never branches on a mode. What changed is
 * the SHAPE: opponents used to wrap into one row above the piles, which is a scoreboard. Now they
 * are seated around the felt (`opponentSlots`), you sit at the bottom, and play runs bottom → left →
 * top → right, so reading the table clockwise is reading the order of play. That is v1's board, and
 * the reason to bring it over is not nostalgia: in a game where every hand is face down, the SHAPE
 * of the table is most of the information — who is next, who is nearly out, which way it is going.
 *
 * A note on colour, kept from the previous board and still true: the four UNO colours are the deck's
 * identity (game content), so they come from theme tokens (`bg-uno-*`) via literal maps Tailwind can
 * see. What is new is that CYAN and BLUE are now spent deliberately — cyan is "here" (whose turn it
 * is, your seat, your turn cue), blue is "act" (a card you can legally play). The old board used
 * cyan for both, which is the glow budget being spent without buying the distinction it exists for.
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
  // The table's difficulty, chosen in the lobby before the deal. The OS holds the value
  // (`<GameShell>`) and draws the control; turning it into a level the rulebook understands is the
  // game's job, and `unoBotLevel` is where that meaning lives.
  const botLevel = unoBotLevel(useGameOptions().values);
  const { mySeatIndex, isMyTurn } = useSeats();
  const { reportResult } = useGame();
  const felt = useEquippedFelt();
  const audio = useAudio();

  const { dealAgain } = useUnoHost({
    isHost,
    status,
    state,
    seats,
    patch,
    writeHand,
    level: botLevel,
  });
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

  // THE TURN CUE's trigger. It has to fire on the TRANSITION into my turn, not on the state of it
  // being mine, so it is a counter bumped when the answer flips — the same render-phase adjustment
  // the wild picker above uses. Passing the boolean straight to the cue would re-arm it on every
  // republish for as long as the turn stayed mine, which is a toast that never goes away.
  const mineNow = state !== null && state.winner < 0 && isMyTurn(state.turn);
  const [cue, setCue] = useState({ mine: mineNow, key: 0 });
  if (cue.mine !== mineNow) setCue({ mine: mineNow, key: cue.key + 1 });

  const names = seats.map((s, i) => (s.name === '' ? `Player ${String(i + 1)}` : s.name));
  const lines = useMoveLog(state?.lastEvent ?? DEAL_EVENT, names, state?.round ?? -1);

  // Report my own seat's result once per finished round — keyed on round like Chess, so a rematch
  // re-arms and a re-render of the same win does not double-count. No betting: XP + a stat, no money.
  const reportedRound = useRef<number | null>(null);
  useEffect(() => {
    if (state === null || state.winner < 0 || mySeatIndex < 0) return;
    if (reportedRound.current === state.round) return;
    reportedRound.current = state.round;
    reportResult({ outcome: state.winner === mySeatIndex ? 'win' : 'loss' });
  }, [state, mySeatIndex, reportResult]);

  // Audio, from the OS roles (never a filename): a slide when anyone draws, a place on any played
  // card, a chime when the turn becomes mine, and win/lose at the end.
  const topKey = useRef<string | null>(null);
  const drawKey = useRef(0);
  const prevTurnMine = useRef(false);
  const wonKey = useRef<number | null>(null);
  useEffect(() => {
    if (state === null) return;
    if (topKey.current !== null && topKey.current !== state.top.id) audio.play('place');
    topKey.current = state.top.id;

    if (state.lastEvent.seq > drawKey.current) {
      if (state.lastEvent.action === 'draw') audio.play('deal');
      drawKey.current = state.lastEvent.seq;
    }

    const mine = state.winner < 0 && isMyTurn(state.turn);
    if (mine && !prevTurnMine.current) audio.play('notify');
    prevTurnMine.current = mine;

    if (state.winner >= 0 && wonKey.current !== state.round) {
      wonKey.current = state.round;
      audio.play(state.winner === mySeatIndex ? 'win' : 'lose');
    }
  }, [state, isMyTurn, mySeatIndex, audio]);

  // STUCK — my turn, nothing in my hand plays, and no half-made wild choice in the way. The
  // rulebook's own predicate, so the line below the fan and the timer above cannot come to
  // different conclusions about the same hand. Computed before the early return because the hook
  // that reads it cannot be called conditionally; `mustDraw` is false for an empty hand, which is
  // what makes it safe to ask before the private node has arrived.
  const stuck =
    state !== null &&
    state.winner < 0 &&
    isMyTurn(state.turn) &&
    pendingWild === null &&
    mustDraw(myHand, state.top, state.color);

  useAutoDraw(
    stuck && state !== null ? `${String(state.round)}:${String(state.lastEvent.seq)}` : null,
    () => {
      if (state === null || mySeatIndex < 0) return;
      void patch((prev) => submitMove(prev ?? state, mySeatIndex, { type: 'draw' }));
      setUnoArmed(false);
    }
  );

  if (state === null) {
    return (
      <Card className="p-6">
        <p className="text-bw-muted text-sm">Shuffling the deck…</p>
      </Card>
    );
  }

  const myTurn = state.winner < 0 && isMyTurn(state.turn);
  const finished = state.winner >= 0;
  const event = state.lastEvent;

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

  const slots = opponentSlots(mySeatIndex, seats.length);
  const seatView = (seat: number, side: UnoSeatSide) => (
    <SeatView
      key={seat}
      name={names[seat] ?? `Player ${String(seat + 1)}`}
      side={side}
      count={state.counts[seat] ?? 0}
      active={state.turn === seat && !finished}
      calledUno={state.calledUno[seat] === true}
    />
  );

  return (
    <Card
      felt={felt}
      className="relative flex flex-col items-center gap-3 overflow-hidden p-4 sm:p-6"
    >
      <TurnCue turnKey={cue.mine ? cue.key : null} />
      <UnoShout
        shout={event.calledUno ? { key: event.seq, name: names[event.seat] ?? 'A player' } : null}
      />
      <PenaltyFlash penaltyKey={event.penalty && event.seat === mySeatIndex ? event.seq : null} />

      {/* TOP SEATS — across the far side of the table. Rendered only when somebody sits there: a
          three-handed table seats its two opponents on the flanks, and a reserved-but-empty row
          left a band of dead felt above the piles. */}
      {slotsOn(slots, 'top').length > 0 && (
        <div className="flex flex-wrap items-start justify-center gap-3">
          {slotsOn(slots, 'top').map((s) => seatView(s.seat, 'top'))}
        </div>
      )}

      {/* THE FELT — side seats flanking the piles. `items-center` so a one-seat column sits level
          with the discard rather than floating at the top of a tall row. */}
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex min-w-16 flex-col items-center gap-3">
          {slotsOn(slots, 'left').map((s) => seatView(s.seat, 'left'))}
        </div>

        <TableCentre
          top={state.top}
          color={state.color}
          direction={state.direction}
          deckCount={state.deckCount}
          canDraw={myTurn && pendingWild === null}
          onDraw={() => {
            submit({ type: 'draw' });
          }}
        />

        <div className="flex min-w-16 flex-col items-center gap-3">
          {slotsOn(slots, 'right').map((s) => seatView(s.seat, 'right'))}
        </div>
      </div>

      {/* THE WILD PICKER — inline, like Chess's promotion picker, and it holds the card up out of
          the fan while it is open so you can see what you are about to commit. */}
      {pendingWild !== null && (
        <div className="border-bw-line bg-base-300/90 rounded-box flex flex-col items-center gap-2 border px-4 py-3">
          <p className="font-display text-bw-muted text-xs tracking-[0.2em] uppercase">
            Pick a colour
          </p>
          <div className="flex gap-3">
            {(['red', 'blue', 'green', 'yellow'] as const).map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  chooseColor(color);
                }}
                aria-label={color}
                className={cx(
                  'size-11 rounded-full ring-2 ring-inset transition hover:scale-110',
                  'focus-visible:outline-secondary focus-visible:outline-2 focus-visible:outline-offset-4',
                  SWATCH[color],
                  RING[color]
                )}
              />
            ))}
          </div>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              setPendingWild(null);
            }}
          >
            Pick a different card
          </Button>
        </div>
      )}

      {/* YOUR SEAT — the label reads exactly like an opponent's, so the table is symmetrical. */}
      {mySeatIndex >= 0 && (
        <>
          <div className="flex flex-col items-center gap-1">
            <span
              className={cx(
                'font-display flex items-center gap-1 text-sm font-semibold tracking-wide',
                myTurn ? 'text-secondary text-shadow-neon-cyan' : 'text-base-content'
              )}
            >
              {myTurn && <span aria-hidden>★</span>}
              {names[mySeatIndex] ?? 'You'}
            </span>
            {myHand.length === 1 && (
              <span className="text-warning animate-lastcard text-xs font-bold tracking-[0.2em] uppercase">
                {state.calledUno[mySeatIndex] === true ? 'UNO!' : 'One card left'}
              </span>
            )}
          </div>

          <HandView
            cards={myHand}
            myTurn={myTurn && pendingWild === null}
            isPlayable={(card) => canPlay(card, state.top, state.color)}
            onPlay={playCard}
            pendingId={pendingWild}
          />

          {/* A hand with nothing in it you can play looks exactly like a hand you have not read
              yet — every card dimmed reads as "still loading" rather than "you must draw". Say it,
              and then do it: the line now announces the draw the board is about to take rather than
              instructing the player to take it. The pile stays live throughout, so anyone who does
              not want to wait out the beat can still click it and skip ahead. */}
          {stuck && (
            <p className="text-bw-muted text-xs" aria-live="polite">
              Nothing matches {state.color} — drawing a card…
            </p>
          )}

          {/* CALL UNO. It arms BEFORE the play that takes you to one card, because that is when the
              rulebook decides the penalty (`declareUno` rides on the move). v1 let you yell after
              the fact; the decision point is the same one, it just has to be made a beat earlier.
              Hidden while stuck: with no playable card the button cannot change the next move, and
              the draw it is about to be interrupted by clears the call anyway. */}
          {myHand.length === 2 && myTurn && !stuck && (
            <Button
              variant={unoArmed ? 'primary' : 'secondary'}
              size="sm"
              className={cx(!unoArmed && 'animate-lastcard')}
              onClick={() => {
                setUnoArmed((v) => !v);
              }}
            >
              {unoArmed ? 'UNO! armed — play your card' : 'Call UNO!'}
            </Button>
          )}
        </>
      )}

      {mySeatIndex < 0 && <p className="text-bw-muted text-sm">Watching — every hand is hidden.</p>}

      <MoveLog lines={lines} mySeat={mySeatIndex} />

      {finished && (
        <div className="flex flex-col items-center gap-3">
          <RoundResult
            won={state.winner === mySeatIndex}
            text={
              state.winner === mySeatIndex
                ? 'You went out — you win!'
                : `${names[state.winner] ?? 'A player'} wins`
            }
          />
          {/* Every human at the table has to ask for the next deal — the guests used to have no say
              at all here, only the host's button and a line telling them to wait for it. The dealer
              is still the host (`dealAgain` no-ops for anyone else); what changed is who gets asked. */}
          <Rematch restart={dealAgain} label="Deal again" />
        </div>
      )}
    </Card>
  );
}
