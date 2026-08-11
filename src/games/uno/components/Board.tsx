import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, cx, useToast } from '@/ui';
import { useEquippedFelt } from '@/system/felt/useEquippedFelt';
import { useAudio } from '@/system/audio/useAudio';
import { Rematch } from '@/system/room/Rematch';
import { useRoom } from '@/system/room/useRoom';
import { useSeats } from '@/system/room/useSeats';
import { useHand } from '@/system/room/useHand';
import { mintNonce, useAuthStore } from '@/system/auth/authStore';
import { repos } from '@/system/repo';
import { formatMoney } from '@boardwalk/game-logic';
import {
  DEAL_EVENT,
  canPlay,
  drawDebt,
  mustDraw,
  placesOf,
  potBacking,
  type Card as UnoCard,
  type Move,
  type UnoColor,
  type UnoState,
} from '@boardwalk/game-logic/games/uno';
import { usePlayerPref } from '@/system/prefs/prefsStore';
import { AUTO_DRAW_PREF, unoManifest } from '@/games/uno/manifest';
import { stuckLine } from '@/games/uno/components/stuckLine';
import { useAutoDraw } from '@/games/uno/components/useAutoDraw';
import { useMoveLog } from '@/games/uno/components/useMoveLog';
import { CallUno } from '@/games/uno/components/CallUno';
import { HandView } from '@/games/uno/components/HandView';
import { MoveLog } from '@/games/uno/components/MoveLog';
import { SeatView } from '@/games/uno/components/SeatView';
import { TableCentre } from '@/games/uno/components/TableCentre';
import { PenaltyFlash, Podium, TurnCue, UnoShout } from '@/games/uno/components/UnoOverlays';
import { GameResult } from '@/system/game/GameResult';
import { opponentSlots, slotsOn, type UnoSeatSide } from '@/games/uno/seatLayout';
import { ordinal } from '@/games/uno/log';
import { pinnedOptionValues } from '@/system/options/options';
import { useGameOptions } from '@/system/options/useGameOptions';
import { unoBotLevel } from '@/games/uno/manifest';

/**
 * THE TABLE — now a pure renderer plus a move sender, and no longer a dealer.
 *
 * It used to host one: `useUnoHost` held every hand and the draw pile in the host's memory, ran the
 * reducer, projected a public view and dealt each hand to its owner. That file is GONE. The referee
 * deals UNO, because the pot made host-as-dealer untenable — a host who can see every hand and also
 * moves the money is a player who cannot lose, and a 4-seat $25 table pays 4× where the generic
 * `/settle` ceiling is 3×. So a move is a message (`repos.uno.move`) and the resulting table comes
 * back over the ordinary room subscription, exactly as it does for everyone else. There is no
 * "host applies it locally" path left to diverge.
 *
 * IT DOES NOT CALL `reportResult`, and that is the sharpest consequence of a dealt game. The
 * referee banks the stat, the XP and the achievements inside the settle transaction, so reporting
 * would be a client claiming a result the server already recorded. `checkSettle` refuses `uno`, so
 * it could not double-count — it would simply toast "settled by the dealer, not by a claim" at every
 * player at the end of every round, which is exactly what Liar's Dice did until a browser found it.
 * What IS still needed is a profile refresh at the two moments money moves; see `syncedMoment`.
 *
 * It DOES run `canPlay`/`mustDraw`, and that is not a contradiction: those are for FEEL — dim a card
 * the rules will refuse, so nobody clicks into a wall — and the referee checks again and decides.
 * Same split as `validateBet` on the chip rack, and literally the same functions.
 *
 * The SHAPE is unchanged: opponents used to wrap into one row above the piles, which is a
 * scoreboard. Now they
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
  const { state, seats, status, meta, isHost, gameId, roomId, myId } = useRoom<UnoState>();
  // The table's difficulty, chosen in the lobby before the deal. The OS holds the value
  // (`<GameShell>`) and draws the control; turning it into a level the rulebook understands is the
  // game's job, and `unoBotLevel` is where that meaning lives. It rides the DEAL to the referee,
  // which is what drives the bots now — the client that picked it may have closed its tab by then.
  //
  // PINNED WHEN THE HOUSE IS BANKING THE POT, off this game's own rule rather than off the lobby's
  // reading of it — `potBacking` is what the referee runs, so the client asks the same question of
  // the same function. The referee pins it regardless, and that is the authority; sending a level
  // we know will be overridden would leave the one field `unoStart` still carries from a client
  // saying something untrue.
  const options = useGameOptions();
  const botLevel = unoBotLevel(
    pinnedOptionValues(
      options.spec,
      options.values,
      potBacking(seats, meta?.anteCents ?? 0) === 'house'
    )
  );
  const { mySeatIndex, isMyTurn } = useSeats();
  const adoptProfile = useAuthStore((s) => s.adoptProfile);
  const felt = useEquippedFelt();
  const audio = useAudio();
  const toast = useToast();

  const myHand = useHand<UnoCard[]>(mySeatIndex) ?? [];

  const [pendingWild, setPendingWild] = useState<string | null>(null);
  const [unoArmed, setUnoArmed] = useState(false);

  const dealtRef = useRef(false);
  /** Which money-moving moment this client has already refreshed its profile for. */
  const syncedMoment = useRef<string>('');

  /**
   * The host asks the referee to deal. `state === null` is the not-yet-dealt signal; the nonce makes
   * a double-fire a replay rather than a second round and a second ante, so the ref is belt to the
   * server's braces rather than the only thing between a player and two stakes.
   */
  useEffect(() => {
    if (!isHost || status !== 'playing' || state !== null || dealtRef.current) return;
    if (repos.uno === null) return;
    dealtRef.current = true;
    void repos.uno.start(gameId, roomId, { nonce: mintNonce(), level: botLevel }).then((res) => {
      if (res.ok) adoptProfile(res.value);
      else toast.error(res.error);
    });
  }, [isHost, status, state, gameId, roomId, botLevel, toast, adoptProfile]);

  /**
   * THE PROFILE SYNC, and the reason this board does not call `reportResult` (see the header).
   *
   * A refresh is needed at the two moments the referee moves money, for every seated player rather
   * than whoever happened to act:
   *   - THE DEAL takes every human's ante, but only the HOST sends `unoStart`. Without this the
   *     host's top bar drops the ante and everyone else's goes on showing the old balance while
   *     their stake sits in the ledger.
   *   - THE SETTLE pays the pot, and the move that triggers it can be a BOT's — in which case no
   *     client made a request at all and nobody would learn anything from a reply.
   *
   * Keyed so each fires once: the deal per round, the settle per round.
   */
  useEffect(() => {
    if (state === null || mySeatIndex < 0) return;
    if (state.potCents <= 0) return; // nothing moved; a table playing for XP needs no refresh
    const moment =
      state.winner >= 0 ? `settled:${String(state.round)}` : `dealt:${String(state.round)}`;
    if (syncedMoment.current === moment) return;
    syncedMoment.current = moment;
    void repos.profile.load(myId).then((p) => {
      if (p !== null) adoptProfile(p);
    });
  }, [state, mySeatIndex, myId, adoptProfile]);

  /** Send a move to the referee. The host's own moves take this road too — there is only one. */
  const submit = useCallback(
    (move: Move): void => {
      if (mySeatIndex < 0 || repos.uno === null) return;
      void repos.uno.move(gameId, roomId, { nonce: mintNonce(), move }).then((res) => {
        if (res.ok) adoptProfile(res.value);
        else toast.error(res.error);
      });
      setUnoArmed(false);
    },
    [mySeatIndex, gameId, roomId, toast, adoptProfile]
  );

  /** Deal the next round. Host-only by construction — the referee refuses anyone else. */
  const dealAgain = useCallback((): void => {
    if (!isHost || repos.uno === null) return;
    void repos.uno.start(gameId, roomId, { nonce: mintNonce(), level: botLevel }).then((res) => {
      if (res.ok) adoptProfile(res.value);
      else toast.error(res.error);
    });
  }, [isHost, gameId, roomId, botLevel, toast, adoptProfile]);

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

  // Audio, from the OS roles (never a filename): a slide when anyone draws, a place on any played
  // card, a low blip when the turn becomes mine, and — at the end of the ROUND — `victory`/`defeat`
  // rather than `win`/`lose`. Those two are blackjack's hand-settle blips, which fire every few
  // seconds there; a whole game of UNO ending deserves the phrase, not the blip. See `sounds.ts`.
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
      audio.play(state.winner === mySeatIndex ? 'victory' : 'defeat');
    }
  }, [state, isMyTurn, mySeatIndex, audio]);

  // STUCK — my turn, nothing in my hand plays, and no half-made wild choice in the way. The
  // rulebook's own predicate, so the line below the fan and the timer above cannot come to
  // different conclusions about the same hand. Computed before the early return because the hook
  // that reads it cannot be called conditionally; `mustDraw` is false for an empty hand, which is
  // what makes it safe to ask before the private node has arrived.
  // `UnoState` IS a `UnoTable`, so the state goes in whole and the board's feel check is literally
  // the call the referee made — including the stack collapse, which is why nothing here spells a
  // house rule. A client that read the rules itself would be a second copy of them.
  const stuck =
    state !== null &&
    state.winner < 0 &&
    isMyTurn(state.turn) &&
    pendingWild === null &&
    mustDraw(myHand, state);

  // MY OWN PREFERENCE, not the table's — instant, and binding on nobody else. It gates the ARMING
  // only: `stuck` still means "the rulebook has collapsed this position to one action", which is
  // what the line below and the hidden UNO call both read. Turning the draw off must not change
  // what the board believes about the position, only who performs the move it has already named.
  const autoDraw = usePlayerPref(unoManifest.id, AUTO_DRAW_PREF);

  useAutoDraw(
    stuck && autoDraw && state !== null
      ? `${String(state.round)}:${String(state.lastEvent.seq)}`
      : null,
    () => {
      if (state === null || mySeatIndex < 0) return;
      submit({ type: 'draw' });
    }
  );

  if (repos.uno === null) {
    // Named rather than degraded. There is no RTDB version of "the server holds the deck", and the
    // only client-side dealer available is one player's browser holding everybody's hand — which is
    // exactly what the referee replaced.
    return (
      <Card className="p-6 text-center">
        <p className="text-base-content/70">
          UNO needs the game server, and this build is running without it.
        </p>
      </Card>
    );
  }

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
  // THE PODIUM. Through the rulebook's own reader, never `state.finished`: an old referee sends no
  // list at all, and deciding what that means is exactly what `placesOf` exists to do once. Playing
  // the ordinary game it holds one seat once the round is over and nothing before that, so every
  // line below is inert on a table that did not ask for places.
  const places = placesOf(state);
  const myPlace = places.indexOf(mySeatIndex) + 1;
  // I am out and the table is still playing — a state that could not exist before ranked places, and
  // one an empty fan otherwise reads as "still loading" rather than "you are done".
  const outEarly = myPlace > 0 && !finished;
  // What the table owes whoever is on turn. Through the rulebook's own reader, never
  // `state.pendingDraw`: an old referee that has never heard of the field sends nothing at all, and
  // deciding what that means is exactly what `drawDebt` exists to do once.
  const owed = drawDebt(state);

  const playCard = (card: UnoCard): void => {
    if (!myTurn || !canPlay(card, state)) {
      if (!canPlay(card, state)) audio.play('error');
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
  const topSeats = slotsOn(slots, 'top');
  const leftSeats = slotsOn(slots, 'left');
  const rightSeats = slotsOn(slots, 'right');
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

      {/* THE COMMENTARY, WHICH DRAWS NOWHERE NEAR HERE. `<MoveLog>` is a `<TableAside>`, so it
          portals into the lobby's sidebar under the chat; this element occupies no space on the
          felt. It used to be a strip at the BOTTOM of this card, below the hand — under the one
          element that grows — so on any real table it was off the bottom of the screen, and the
          room it took came out of the felt it exists to comment on. The call stays in the board
          because the scrollback is derived from the projection the board already subscribes to. */}
      <MoveLog lines={lines} mySeat={mySeatIndex} />

      {/* THE POT. The referee's own number, off the projection — not `potFor(seats, ante)` computed
          here, which is the same figure right up until it is not (a seat that changed hands after
          the deal, an ante that was refused) and then the table quotes a pot nobody will be paid. */}
      {state.potCents > 0 && (
        <p className="font-display text-accent text-shadow-neon-gold text-sm font-semibold tracking-[0.2em] uppercase">
          Pot {formatMoney(state.potCents)}
        </p>
      )}
      {/* THE TABLE — the seats RING THE PILES at a distance the table chooses, rather than at the
          width of whatever screen it is drawn on.

          The flanks used to be `w-full justify-between`, which is not a distance at all: on a
          desktop it threw the side players ~600px out to the edges of the card while the far seat
          sat a dozen pixels off the deck, so the same table read as three unrelated groups instead
          of one felt. A table's shape is information in UNO (see the layout note below), and a
          shape that changes with the viewport carries none. So the row is content-width and
          CENTRED, with a deliberate gap either side, and the gap tightens on a phone rather than
          the layout changing.

          THE GAPS ARE MEASURED FROM THE RING, NOT FROM THE CARDS, and that is what `TableCentre`'s
          own padding buys: the centre column reserves the direction ring's overhang, so every
          number here is clear air on top of it and no table size can push a seat into an arrow.
          Before that the clearance was a coincidence of the flanks being tall, and the heads-up
          table — which has no flank seats at all — put the top arrow in the far player's hand.

          THEY OPEN UP ON A DESKTOP, because the felt is ~80rem wide and the table was drawing
          itself into the middle 40 of them, with everything piled around one small ring. The rungs
          are deliberate rather than one big number: a phone keeps a compact table, and `xl` gets a
          seat-to-seat span of ~41rem, which is open enough to read as a table and short of the
          point where the two flanks stop looking like they are at the same one. */}
      <div className="flex flex-col items-center gap-10 lg:gap-14">
        {/* TOP SEATS — across the far side of the table. Rendered only when somebody sits there: a
            three-handed table seats its two opponents on the flanks, and a reserved-but-empty row
            left a band of dead felt above the piles. */}
        {topSeats.length > 0 && (
          <div className="flex flex-wrap items-start justify-center gap-8 sm:gap-12 xl:gap-24 2xl:gap-32">
            {topSeats.map((s) => seatView(s.seat, 'top'))}
          </div>
        )}

        {/* THE FELT — side seats flanking the piles. `items-center` so a one-seat column sits level
            with the discard rather than floating at the top of a tall row. An empty flank is not
            rendered at all: a heads-up table has nobody on either side, and two reserved columns
            plus their gaps is the same dead felt the top row avoids, turned on its side. */}
        <div className="flex items-center justify-center gap-2 sm:gap-6 lg:gap-14 xl:gap-24 2xl:gap-48">
          {leftSeats.length > 0 && (
            <div className="flex flex-col items-center gap-6">
              {leftSeats.map((s) => seatView(s.seat, 'left'))}
            </div>
          )}

          <TableCentre
            top={state.top}
            color={state.color}
            direction={state.direction}
            deckCount={state.deckCount}
            pending={owed}
            canDraw={myTurn && pendingWild === null}
            onDraw={() => {
              submit({ type: 'draw' });
            }}
          />

          {rightSeats.length > 0 && (
            <div className="flex flex-col items-center gap-6">
              {rightSeats.map((s) => seatView(s.seat, 'right'))}
            </div>
          )}
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
            isPlayable={(card) => canPlay(card, state)}
            onPlay={playCard}
            pendingId={pendingWild}
          />

          {/* A hand with nothing in it you can play looks exactly like a hand you have not read
              yet — every card dimmed reads as "still loading" rather than "you must draw". Say it,
              and then do it: the line now announces the draw the board is about to take rather than
              instructing the player to take it. The pile stays live throughout, so anyone who does
              not want to wait out the beat can still click it and skip ahead. */}
          {/* AND IT SAYS WHICHEVER OF THOSE TWO THINGS IS TRUE, which is the whole cost of making
              the draw optional. The announcing wording is a claim about what is ABOUT TO HAPPEN,
              so leaving it up with the preference off would be the board promising a move nobody
              is going to make — the player waits out a beat that never comes and the table looks
              hung. Off, it goes back to instructing, which is what this line said before the
              auto-draw existed at all. `stuck` is the same predicate in both branches; only the
              verb moves. */}
          {stuck && (
            <p className="text-bw-muted text-xs" aria-live="polite">
              {stuckLine({ owed, color: state.color, autoDraw })}
            </p>
          )}

          {/* CALL UNO. It arms BEFORE the play that takes you to one card, because that is when the
              rulebook decides the penalty (`declareUno` rides on the move). v1 let you yell after
              the fact; the decision point is the same one, it just has to be made a beat earlier.
              Hidden while stuck: with no playable card the button cannot change the next move, and
              the draw it is about to be interrupted by clears the call anyway. */}
          {myHand.length === 2 && myTurn && !stuck && (
            <CallUno
              armed={unoArmed}
              onToggle={() => {
                setUnoArmed((v) => !v);
              }}
            />
          )}
        </>
      )}

      {mySeatIndex < 0 && <p className="text-bw-muted text-sm">Watching — every hand is hidden.</p>}

      {/* OUT, BUT THE ROUND IS NOT. Without this the seat that just went out looks identical to a
          seat whose private hand has not arrived — an empty fan and no turn — which is the same
          confusion the "nothing matches, drawing…" line exists to fix one state earlier. */}
      {outEarly && (
        <p className="text-secondary text-sm font-semibold" aria-live="polite">
          You went out {ordinal(myPlace)} — playing on for the rest of the places.
        </p>
      )}

      {/* THE RESULT IS THE OS'S SURFACE, not a panel at the bottom of this card. It used to be
          exactly that — under the move log, under the hand, under the felt — so the answer to "did
          I win, and are we going again" was a scroll on any table taller than the viewport. The
          verdict, the podium and the deal-again handshake all ride in `<GameResult>` now; what
          stayed here is the one thing only this board knows, which is what the words should say. */}
      <GameResult
        over={finished}
        tone={state.winner === mySeatIndex ? 'win' : 'loss'}
        title={
          state.winner === mySeatIndex
            ? // A ranked pot is SHARED, so the winner's line cannot quote the whole of it. What
              // it can say without guessing is that the pot went their way; the top bar carries
              // the authoritative figure, which is the referee's and not this board's.
              state.potCents > 0
              ? places.length > 1
                ? 'You went out first — you take the pot!'
                : `You went out — you win ${formatMoney(state.potCents)}!`
              : 'You went out — you win!'
            : myPlace > 0
              ? `You finished ${ordinal(myPlace)}`
              : `${names[state.winner] ?? 'A player'} wins`
        }
        detail={
          <Podium
            places={places.map((seat) => ({
              seat,
              name: names[seat] ?? `Player ${String(seat + 1)}`,
              you: seat === mySeatIndex,
            }))}
          />
        }
      >
        {/* Every human at the table has to ask for the next deal — the guests used to have no say
            at all here, only the host's button and a line telling them to wait for it. The dealer
            is still the host (`dealAgain` no-ops for anyone else); what changed is who gets asked. */}
        <Rematch restart={dealAgain} label="Deal again" />
      </GameResult>
    </Card>
  );
}
