import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, useToast } from '@/ui';
import { useAudio } from '@/system/audio/useAudio';
import { useEquippedFelt } from '@/system/felt/useEquippedFelt';
import { GameResult } from '@/system/game/GameResult';
import { Rematch } from '@/system/room/Rematch';
import { useRoom } from '@/system/room/useRoom';
import { useSeats } from '@/system/room/useSeats';
import { useBankroll } from '@/system/profile/useProfile';
import { mintNonce, useAuthStore } from '@/system/auth/authStore';
import { repos } from '@/system/repo';
import { formatMoney } from '@boardwalk/game-logic';
import {
  handValue,
  spotPayout,
  type BlackjackTableState,
  type SpotView,
  type TableMove,
} from '@boardwalk/game-logic/games/blackjack';
import { BetRack } from '@/games/blackjack/components/BetRack';
import { Felt } from '@/games/blackjack/components/Felt';
import { Hand } from '@/games/blackjack/components/Hand';
import { ScoreBubble } from '@/games/blackjack/components/ScoreBubble';
import { Spot } from '@/games/blackjack/components/Spot';
import { seatArc } from '@/games/blackjack/seatLayout';

/**
 * A BLACKJACK TABLE — and since the room-less hand was deleted, the whole of blackjack.
 *
 * It holds no game and deals nothing. Every card on screen came off the room subscription, every
 * decision goes out as a nonce'd message (`repos.blackjackTable.act`), and the result comes back the
 * same way it reaches everybody else at the table — so the host's own moves take exactly the road a
 * guest's do and there is no local-apply path to diverge.
 *
 * IT DOES NOT CALL `reportResult`, which is the sharpest consequence of a dealt game and the one a
 * browser found at Liar's Dice: the referee banks the stat, the XP and the badges inside its settle,
 * so reporting would be a client claiming a result the server already recorded. What IS still needed
 * is the authoritative PROFILE, and every action's reply carries it.
 *
 * THE HOLE CARD IS ABSENT, NOT HIDDEN, and here that is stronger than it is solo: `state.dealer`
 * carries one card until the round settles, for EVERY seat including the host's. There is no private
 * channel in this game at all — a blackjack player's cards are face up, so `useHand` has no caller
 * here and every chair renders every other chair's hand from the public projection.
 *
 * **THE CHAIRS SIT ON AN ARC AND ARE NOT ROTATED TO CENTRE YOU** — see `seatLayout.ts`. Reading the
 * table left to right is reading the order the dealer works along it, which is a property an arc
 * only keeps if every screen draws the seats in the same order.
 */
export function TableBoard() {
  const { state, seats, status, isHost, gameId, roomId, myId } = useRoom<BlackjackTableState>();
  const { mySeatIndex } = useSeats();
  const adoptProfile = useAuthStore((s) => s.adoptProfile);
  const balance = useBankroll();
  const felt = useEquippedFelt();
  const audio = useAudio();
  const toast = useToast();

  const openedRef = useRef(false);
  /** Which money-moving moment this client has already refreshed its profile for. */
  const syncedRound = useRef<number>(-1);
  /**
   * What this player staked last, so the rack can offer REPEAT.
   *
   * It lives HERE and not in `<BetRack>` because the rack unmounts the instant the bet lands — a
   * memory inside it would be wiped by the very event it needs to remember, which is the same
   * reason `<Rematch>`'s once-per-handshake gate sits above the button it controls.
   *
   * Recorded at the CLICK rather than off the settled projection, and that is a choice about which
   * number REPEAT means. A settled `wagerCents` includes a double, so repeating off it would turn
   * "bet the same again" into "bet twice as much again" for anyone who doubled — which is the one
   * way a convenience control can cost somebody money they did not mean to stake. The click is the
   * opening bet by construction. The cost of reading it here is that a stake the referee REFUSES is
   * still remembered; `clampBet` snaps it back into the affordable range the moment it is reused,
   * so the worst case is a rack that opens on a number it then corrects.
   */
  const [lastWagerCents, setLastWagerCents] = useState(0);

  const repo = repos.blackjackTable;

  /**
   * The host asks the referee to open a round. `state === null` is the not-yet-opened signal, and
   * the nonce makes a double-fire a replay rather than a second round.
   */
  useEffect(() => {
    if (!isHost || status !== 'playing' || state !== null || openedRef.current) return;
    if (repo === null) return;
    openedRef.current = true;
    void repo.open(gameId, roomId, { nonce: mintNonce() }).then((res) => {
      if (res.ok) adoptProfile(res.value);
      else toast.error(res.error);
    });
  }, [isHost, status, state, gameId, roomId, repo, toast, adoptProfile]);

  /**
   * THE PROFILE SYNC, and the reason this board does not call `reportResult`.
   *
   * A settling move can be a BOT's — the house plays a chair and no client made a request at all —
   * so nobody would learn from a reply that the round paid out. Keyed per round so it fires once.
   */
  useEffect(() => {
    if (state === null || mySeatIndex < 0) return;
    if (state.phase !== 'settled' || syncedRound.current === state.round) return;
    syncedRound.current = state.round;
    void repos.profile.load(myId).then((p) => {
      if (p !== null) adoptProfile(p);
    });
  }, [state, mySeatIndex, myId, adoptProfile]);

  /** Send a decision to the referee. The host's own take this road too — there is only one. */
  const send = useCallback(
    (move: TableMove): void => {
      if (mySeatIndex < 0 || repo === null) return;
      void repo.act(gameId, roomId, { nonce: mintNonce(), move }).then((res) => {
        if (res.ok) adoptProfile(res.value);
        else toast.error(res.error);
      });
    },
    [mySeatIndex, gameId, roomId, repo, toast, adoptProfile]
  );

  /** Open the next round. Host-only by construction — the referee refuses anyone else. */
  const dealAgain = useCallback((): void => {
    if (!isHost || repo === null) return;
    void repo.open(gameId, roomId, { nonce: mintNonce() }).then((res) => {
      if (res.ok) adoptProfile(res.value);
      else toast.error(res.error);
    });
  }, [isHost, gameId, roomId, repo, adoptProfile, toast]);

  // Voice the settle once per round: the hole card turning over, then what it meant for MY chair.
  const voiced = useRef(-1);
  useEffect(() => {
    if (state === null || state.phase !== 'settled' || voiced.current === state.round) return;
    voiced.current = state.round;
    audio.play('flip');
    const mine = state.spots[mySeatIndex]?.result;
    if (mine == null) return;
    audio.play(
      mine === 'blackjack' ? 'jackpot' : mine === 'win' ? 'win' : mine === 'push' ? 'push' : 'lose'
    );
  }, [state, mySeatIndex, audio]);

  if (repo === null) {
    // Named rather than degraded, exactly as UNO names it. There is no client-side version of "the
    // server holds the deck and the hole card for four people".
    return (
      <Card className="p-6 text-center">
        <p className="text-base-content/70">
          Blackjack needs the game server, and this build is running without it. There is no
          client-side version of a dealer holding the deck and the hole card for four people.
        </p>
      </Card>
    );
  }

  if (state === null) {
    return (
      <Card className="p-6">
        <p className="text-bw-muted text-sm">Opening a round…</p>
      </Card>
    );
  }

  const names = seats.map((s, i) => (s.name === '' ? `Player ${String(i + 1)}` : s.name));
  const mine: SpotView | undefined = state.spots[mySeatIndex];
  const settled = state.phase === 'settled';
  const myTurn = state.phase === 'player' && state.turn === mySeatIndex;
  const dealerTotal = state.dealer.length > 0 ? handValue(state.dealer).total : null;

  // The chairs that are actually IN this round, and the arc computed over exactly those — so a
  // table with an empty seat draws a symmetric curve over the players it has rather than a gap.
  const playing = state.spots
    .map((spot, seat) => ({ spot, seat }))
    .filter((entry) => entry.spot.seated);
  const arc = seatArc(playing.length);
  // Uniform card size across the table. Blackjack is not UNO: every hand here is face up and
  // equally readable, so scaling your own up would re-introduce exactly the "one row matters, the
  // rest are a legend" reading that the arc exists to remove.
  const size = playing.length >= 3 ? 'sm' : 'md';

  /**
   * WHAT SITS ON THE RAIL RIGHT NOW — one expression, evaluated in the order the table asks its
   * questions, so exactly one control can ever be on the apron.
   *
   * These were four separately-conditioned blocks stacked BELOW the felt, and the conditions
   * overlapped: `canInsure` and `phase === 'player'` can both be true within a beat of each other,
   * so the page could grow an insurance offer above a hit/stand row and shift everything down. As
   * one ladder the ambiguity is not resolved, it is unspellable.
   *
   * The last rung is deliberately a SENTENCE rather than nothing. A blackjack round can stall on a
   * chair that has not bet — not on a turn — which no other dealt game in this repo can do, so
   * "it is nobody's turn and nothing is happening" is a real state and the rail is where a player
   * is already looking for something to press.
   */
  const apron = (() => {
    if (mine === undefined) {
      return <p className="text-bw-muted self-center text-sm">Watching this table.</p>;
    }
    if (mine.canInsure) {
      return (
        <div className="flex flex-col items-center gap-3">
          <p className="text-base-content/90 max-w-md text-center text-sm">
            Dealer shows an Ace. Insure for {formatMoney(mine.insuranceCents)}? It pays 2 to 1 if
            the dealer has blackjack.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              variant="primary"
              disabled={balance < mine.insuranceCents}
              onClick={() => {
                audio.play('chip');
                send({ type: 'insure' });
              }}
            >
              Insure {formatMoney(mine.insuranceCents)}
            </Button>
            <Button variant="secondary" onClick={() => send({ type: 'decline' })}>
              No insurance
            </Button>
          </div>
        </div>
      );
    }
    if (myTurn) {
      return (
        <div className="flex flex-wrap items-start justify-center gap-3 self-center">
          <Button
            variant="primary"
            onClick={() => {
              audio.play('deal');
              send({ type: 'hit' });
            }}
          >
            Hit
          </Button>
          <Button variant="secondary" onClick={() => send({ type: 'stand' })}>
            Stand
          </Button>
          {/* Affordability is checked here for the BUTTON and again by the referee for the money. */}
          {mine.canDouble && balance >= mine.wagerCents && (
            <Button
              variant="ghost"
              onClick={() => {
                audio.play('chip');
                audio.play('deal');
                send({ type: 'double' });
              }}
            >
              Double
            </Button>
          )}
        </div>
      );
    }
    if (state.phase === 'betting' && mine.wagerCents === 0) {
      return (
        <BetRack
          disabled={false}
          lastWagerCents={lastWagerCents}
          dealLabel="Place bet"
          onDeal={(wagerCents) => {
            audio.play('chip');
            setLastWagerCents(wagerCents);
            send({ type: 'bet', wagerCents });
          }}
        />
      );
    }
    if (!settled && state.pending.length > 0) {
      return (
        <p className="text-bw-muted self-center text-sm" aria-live="polite">
          Waiting for{' '}
          {state.pending.map((seat) => names[seat] ?? `Player ${String(seat + 1)}`).join(', ')}…
        </p>
      );
    }
    return null;
  })();

  return (
    <>
      <Felt
        felt={felt}
        apron={apron}
        dealer={
          <>
            {/* ONE back is drawn while the round is live, because there is genuinely one card the
                client does not have. */}
            <Hand
              cards={state.dealer}
              faceDown={settled ? 0 : state.dealer.length > 0 ? 1 : 0}
              size={size}
            />
            {dealerTotal !== null && (
              <ScoreBubble
                total={dealerTotal}
                tone={settled && dealerTotal > 21 ? 'bust' : 'idle'}
                size={size}
              />
            )}
            <span className="font-display border-accent/30 text-accent/85 bg-base-300/50 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-[0.1em] uppercase">
              Dealer
            </span>
            {dealerTotal !== null && (
              <span className="text-bw-muted text-[0.65rem] tracking-wide uppercase">
                {settled ? 'total' : 'showing'}
              </span>
            )}
          </>
        }
      >
        {playing.map(({ spot, seat }, i) => (
          <Spot
            key={seat}
            name={names[seat] ?? `Player ${String(seat + 1)}`}
            you={seat === mySeatIndex}
            active={state.phase === 'player' && state.turn === seat}
            waiting={state.pending.includes(seat)}
            cards={spot.cards}
            wagerCents={spot.wagerCents}
            insuranceCents={spot.insuranceCents}
            doubled={spot.doubled}
            result={spot.result}
            settled={settled}
            size={size}
            dropRem={arc[i]?.dropRem ?? 0}
          />
        ))}
      </Felt>

      {/* THE RESULT IS THE OS'S SURFACE, never a panel at the bottom of this card — the one place it
          must not be is below the fold, which is where a four-chair felt puts anything after it. */}
      <GameResult
        over={settled}
        tone={
          mine?.result === 'lose'
            ? 'loss'
            : mine?.result === 'push'
              ? 'draw'
              : mine == null
                ? 'draw'
                : 'win'
        }
        title={
          mine?.result == null
            ? 'Round over'
            : mine.result === 'blackjack'
              ? 'Blackjack! Paid 3 to 2.'
              : mine.result === 'win'
                ? 'You win.'
                : mine.result === 'push'
                  ? 'Push — your bet is returned.'
                  : 'Dealer takes it.'
        }
        detail={
          mine == null || mine.result === null ? null : (
            <div className="flex flex-col gap-1">
              <p className="text-bw-muted" data-money>
                {/* The hand's true net, INSURANCE INCLUDED — through the rulebook's own
                    `spotPayout`, so the number on screen is the one the ledger moved rather than a
                    second piece of arithmetic that agrees with it until it does not. */}
                {(() => {
                  const net = spotPayout(mine) - mine.wagerCents - mine.insuranceCents;
                  return `${net >= 0 ? '+' : ''}${formatMoney(net)} this round.`;
                })()}
              </p>
              {mine.insured && (
                <p className="text-bw-muted text-sm">
                  {mine.insurancePaidCents > 0
                    ? `Insurance paid ${formatMoney(mine.insurancePaidCents - mine.insuranceCents)}.`
                    : `Insurance lost ${formatMoney(mine.insuranceCents)}.`}
                </p>
              )}
            </div>
          )
        }
      >
        {/* Everybody at the table has to ask for the next round. The host still deals it
            (`dealAgain` no-ops for anyone else); what the OS owns is who gets asked. */}
        <Rematch restart={dealAgain} label="Next round" />
      </GameResult>
    </>
  );
}
