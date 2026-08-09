import { useCallback, useEffect, useRef } from 'react';
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
 * A BLACKJACK TABLE — the same renderer as the solo board, several chairs wide.
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
          A blackjack table needs the game server, and this build is running without it. The solo
          table still deals.
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
  const waitingOnMe = state.pending.includes(mySeatIndex);
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

  return (
    <>
      <Felt
        felt={felt}
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

      {mySeatIndex < 0 && <p className="text-bw-muted mt-4 text-sm">Watching this table.</p>}

      {/* WHAT THE TABLE IS WAITING FOR, said out loud. A blackjack round stalls on a chair that has
          not bet — not on a turn — so "it is nobody's turn and nothing is happening" is a state
          this game can be in and the other dealt games cannot. */}
      {!settled && !waitingOnMe && state.pending.length > 0 && (
        <p className="text-bw-muted mt-4 text-sm" aria-live="polite">
          Waiting for{' '}
          {state.pending.map((seat) => names[seat] ?? `Player ${String(seat + 1)}`).join(', ')}…
        </p>
      )}

      {/* YOUR BET. The same chip rack the solo table uses, and it stages rather than commits for
          exactly the same reason: the stake leaves the bankroll inside the referee's own
          transaction, and committing here too would deduct it twice. */}
      {mine !== undefined && state.phase === 'betting' && mine.wagerCents === 0 && (
        <div className="mt-4">
          <BetRack
            disabled={false}
            onDeal={(wagerCents) => {
              audio.play('chip');
              send({ type: 'bet', wagerCents });
            }}
          />
        </div>
      )}

      {/* THE INSURANCE OFFER — the one decision at this table whose outcome only the dealer can see.
          Every chair is asked at once and the dealer does not peek until the last one answers, so
          nobody learns the hole card a beat before the player still deciding. */}
      {mine !== undefined && mine.canInsure && (
        <div className="mt-4 flex flex-col items-center gap-3">
          <p className="text-bw-muted text-sm">
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
      )}

      {mine !== undefined && myTurn && (
        <div className="mt-4 flex flex-wrap justify-center gap-3">
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
      )}

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
