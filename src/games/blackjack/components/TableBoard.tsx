import { useCallback, useEffect, useRef } from 'react';
import { Button, Card, cx, useToast } from '@/ui';
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
import { Hand } from '@/games/blackjack/components/Hand';

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
 * so reporting would be a client claiming a result the server already recorded. `checkSettle`
 * refuses `blackjack` outright, so it could not double-count — it would simply toast "settled by the
 * dealer, not by a claim" at every player at the end of every round. What IS still needed is the
 * authoritative PROFILE, and every action's reply carries it.
 *
 * THE HOLE CARD IS ABSENT, NOT HIDDEN, and here that is stronger than it is solo: `state.dealer`
 * carries one card until the round settles, for EVERY seat including the host's. There is no private
 * channel in this game at all — a blackjack player's cards are face up, so `useHand` has no caller
 * here and every chair renders every other chair's hand from the public projection.
 */

/** What the line under a chair says once the round is over. One place, so the copy cannot drift. */
const RESULT_COPY: Record<string, string> = {
  blackjack: 'Blackjack!',
  win: 'Wins',
  push: 'Push',
  lose: 'Loses',
};

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
   * the nonce makes a double-fire a replay rather than a second round — the ref is belt to the
   * server's braces rather than the only thing between a table and two deals.
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
  // The dealer's own total is only the truth once it has revealed; while a round is live this is
  // what the UP-CARD shows, which is what every seat can see and all any of them can reason from.
  const dealerLabel = settled
    ? `Dealer has ${String(handValue(state.dealer).total)}`
    : state.dealer.length > 0
      ? `Dealer shows ${String(handValue(state.dealer).total)}`
      : 'Dealer';

  return (
    <Card felt={felt} className="flex flex-col gap-6 p-4 sm:p-6">
      {/* THE DEALER, once, at the top — one hand for the whole table, which is the shape of the
          game: every chair plays the same dealer rather than its own. ONE back is drawn while the
          round is live, because there is genuinely one card the client does not have. */}
      <Hand
        cards={state.dealer}
        faceDown={settled ? 0 : state.dealer.length > 0 ? 1 : 0}
        label={dealerLabel}
      />

      {/* THE CHAIRS. Every seat's cards are public in this game, so each one renders in full for
          everybody — there is no per-seat channel and nothing to withhold from a neighbour. */}
      <div className="flex flex-wrap items-start gap-4">
        {state.spots.map((spot, seat) => {
          if (!spot.seated) return null;
          const active = state.phase === 'player' && state.turn === seat;
          const you = seat === mySeatIndex;
          const total = spot.cards.length > 0 ? handValue(spot.cards).total : 0;
          return (
            <div
              key={seat}
              className={cx('flex min-w-[9rem] flex-col gap-1', you && 'order-first')}
            >
              <span
                className={cx(
                  'font-display flex items-center gap-1 text-sm font-semibold tracking-wide',
                  // The ACTIVE CUE is the NAME rather than a box around the chair — UNO's board
                  // settled that argument, and a felt with four lit rectangles on it spends the
                  // glow budget without buying the distinction it exists for.
                  active ? 'text-secondary text-shadow-neon-cyan' : 'text-base-content'
                )}
              >
                {active && <span aria-hidden>★</span>}
                {you
                  ? `${names[seat] ?? 'You'} (you)`
                  : (names[seat] ?? `Player ${String(seat + 1)}`)}
              </span>
              <Hand
                cards={spot.cards}
                label={spot.cards.length > 0 ? `${String(total)}` : 'Waiting for a bet'}
              />
              <span className="text-bw-muted text-xs" data-money>
                {spot.wagerCents > 0 ? formatMoney(spot.wagerCents) : '—'}
                {spot.doubled && ' · doubled'}
                {spot.insured && ' · insured'}
              </span>
              {settled && spot.result !== null && (
                <span
                  className={cx(
                    'text-xs font-semibold',
                    spot.result === 'lose'
                      ? 'text-error'
                      : spot.result === 'push'
                        ? 'text-bw-muted'
                        : 'text-success'
                  )}
                >
                  {RESULT_COPY[spot.result] ?? spot.result}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {mySeatIndex < 0 && <p className="text-bw-muted text-sm">Watching this table.</p>}

      {/* WHAT THE TABLE IS WAITING FOR, said out loud. A blackjack round stalls on a chair that has
          not bet — not on a turn — so "it is nobody's turn and nothing is happening" is a state
          this game can be in and the other dealt games cannot. Saying who reads as a table; saying
          nothing reads as a bug. */}
      {!settled && !waitingOnMe && state.pending.length > 0 && (
        <p className="text-bw-muted text-sm" aria-live="polite">
          Waiting for{' '}
          {state.pending.map((seat) => names[seat] ?? `Player ${String(seat + 1)}`).join(', ')}…
        </p>
      )}

      {/* YOUR BET. The same chip rack the solo table uses, and it stages rather than commits for
          exactly the same reason: the stake leaves the bankroll inside the referee's own
          transaction, and committing here too would deduct it twice. */}
      {mine !== undefined && state.phase === 'betting' && mine.wagerCents === 0 && (
        <BetRack
          disabled={false}
          onDeal={(wagerCents) => {
            audio.play('chip');
            send({ type: 'bet', wagerCents });
          }}
        />
      )}

      {/* THE INSURANCE OFFER — the one decision at this table whose outcome only the dealer can see.
          Every chair is asked at once and the dealer does not peek until the last one answers, so
          nobody learns the hole card a beat before the player still deciding. */}
      {mine !== undefined && mine.canInsure && (
        <div className="flex flex-col gap-3">
          <p className="text-bw-muted text-sm">
            Dealer shows an Ace. Insure for {formatMoney(mine.insuranceCents)}? It pays 2 to 1 if
            the dealer has blackjack.
          </p>
          <div className="flex flex-wrap gap-3">
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
        <div className="flex flex-wrap gap-3">
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
          {/* Affordability is checked here for the BUTTON and again by the referee for the money.
              This one can be wrong (a stale balance) and costs a refusal toast; the other cannot. */}
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
    </Card>
  );
}
