import { useEffect, useRef } from 'react';
import { Button } from '@/ui';
import { ExitGame } from '@/system/game/ExitGame';
import { useAudio } from '@/system/audio/useAudio';
import { GameResult } from '@/system/game/GameResult';
import { useEquippedFelt } from '@/system/felt/useEquippedFelt';
import { useBlackjackTable } from '@/system/economy/useBlackjackTable';
import { useBankroll } from '@/system/profile/useProfile';
import { formatMoney } from '@boardwalk/game-logic';
import { BetRack } from '@/games/blackjack/components/BetRack';
import { Felt } from '@/games/blackjack/components/Felt';
import { Hand } from '@/games/blackjack/components/Hand';
import { ScoreBubble } from '@/games/blackjack/components/ScoreBubble';
import { Spot } from '@/games/blackjack/components/Spot';
import { seatArc } from '@/games/blackjack/seatLayout';
import { handValue, payoutCents, type Result } from '@boardwalk/game-logic/games/blackjack';

/**
 * THE SOLO TABLE — and since Phase D it is a RENDERER, not a game.
 *
 * It used to hold the hand in a `useReducer`, shuffle its own deck, decide the result, and hand the
 * economy a `payoutCents` it had computed itself. All four of those are now the dealer's
 * (`useBlackjackTable` → `BlackjackRepo`), and what is left here is the part that was always the
 * board's: draw a hand onto a felt, offer three buttons, make a noise at the right moment.
 *
 * WHAT THIS FILE CAN NO LONGER SPELL, which is the point of the phase. There is no `payoutCents`
 * call against a result it chose, no `reportResult`, and no `feat_natural` — the dealer detects a
 * two-card 21 from the two cards it dealt. `payoutCents` still appears below and is doing something
 * different and harmless: turning the settled hand's own numbers into the "+$37.50 this hand" line.
 * It is arithmetic ON a settled result, not a claim about one.
 *
 * THE HOLE CARD IS ABSENT, NOT HIDDEN. `hand.dealer` carries one card until the hand settles, so
 * the board draws ONE back for the card it does not have.
 *
 * It renders the SAME `<Felt>` and `<Spot>` the multi-seat table does, with one chair at the
 * deepest point of the arc — which is exactly where one player sits at a real half-moon table.
 * Before this the two containers drew visibly different games.
 */

/** The line under the table, and the sound, for a settled hand — one place so they cannot disagree. */
const RESULT_COPY: Record<Result, string> = {
  blackjack: 'Blackjack! Paid 3 to 2.',
  win: 'You win.',
  push: 'Push — your bet is returned.',
  lose: 'Dealer takes it.',
};

export function Table({ onExit }: { onExit: () => void }) {
  const { hand, busy, deal, play: move, nextHand } = useBlackjackTable();
  const { play } = useAudio();
  const balance = useBankroll();
  const felt = useEquippedFelt();

  // Voice a settled hand exactly once. Keyed on `handId` — the dealer's row id — so a rematch
  // sounds again and a re-render of the same finished hand does not.
  const voiced = useRef(-1);
  useEffect(() => {
    if (hand === null || hand.phase !== 'settled' || hand.result === null) return;
    if (voiced.current === hand.handId) return;
    voiced.current = hand.handId;

    play('flip'); // the hole card turning over
    play(
      hand.result === 'blackjack'
        ? 'jackpot'
        : hand.result === 'win'
          ? 'win'
          : hand.result === 'push'
            ? 'push'
            : 'lose'
    );
  }, [hand, play]);

  const settled = hand !== null && hand.phase === 'settled' && hand.result !== null;
  const result = settled && hand !== null ? hand.result : null;
  // One back for the hole card while the hand is live. Not `2 - dealer.length`: the dealer draws
  // more cards on the reveal, and the reveal is exactly when the count goes to zero.
  const holeCards = hand !== null && !settled ? 1 : 0;
  const dealerTotal = hand !== null && hand.dealer.length > 0 ? handValue(hand.dealer).total : null;

  // Affordability of a double is still checked here for the BUTTON, and again by the dealer for the
  // money. This one can be wrong (a stale balance) and costs a refusal toast; the other cannot.
  const canDoubleNow = hand !== null && hand.canDouble && balance >= hand.wagerCents;
  // The hand's true net, INSURANCE INCLUDED — it is a separate bet settled at the same moment, so
  // a line that quoted the main bet alone would tell a player who insured a dealer natural that
  // they were down $500 on a hand they broke even on.
  const netCents =
    hand !== null && hand.result !== null
      ? payoutCents(hand.result, hand.wagerCents) -
        hand.wagerCents +
        hand.insurancePaidCents -
        hand.insuranceCents
      : 0;

  const solo = seatArc(1)[0];

  return (
    <div className="flex flex-col gap-6">
      {/* The table owns its own chrome — there is no lobby to provide a back button (a solo game). */}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.08em] uppercase">
          Blackjack
        </h1>
        <ExitGame onExit={onExit} />
      </div>

      <Felt
        felt={felt}
        dealer={
          <>
            <Hand cards={hand?.dealer ?? []} faceDown={holeCards} />
            {dealerTotal !== null && (
              <ScoreBubble
                total={dealerTotal}
                tone={settled && dealerTotal > 21 ? 'bust' : 'idle'}
              />
            )}
            <span className="font-display border-accent/30 text-accent/85 bg-base-300/50 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-[0.1em] uppercase">
              Dealer
            </span>
            {/* The dealer's total is only the truth once it has revealed; while a hand is live this
                is what the UP-CARD shows, which is all the player can reason from. */}
            {dealerTotal !== null && (
              <span className="text-bw-muted text-[0.65rem] tracking-wide uppercase">
                {settled ? 'total' : 'showing'}
              </span>
            )}
          </>
        }
      >
        <Spot
          name="You"
          you={false}
          active={hand !== null && hand.phase === 'player'}
          cards={hand?.player ?? []}
          wagerCents={hand?.wagerCents ?? 0}
          insuranceCents={hand?.insuranceCents ?? 0}
          doubled={hand?.doubled ?? false}
          result={hand?.result ?? null}
          settled={settled}
          dropRem={solo?.dropRem ?? 0}
        />
      </Felt>

      {/* THE SETTLE IS THE OS'S SURFACE — the result line, what the hand paid, and the way into the
          next one, in the one place that is never below the fold. */}
      <GameResult
        over={result !== null}
        tone={result === 'lose' ? 'loss' : result === 'push' ? 'draw' : 'win'}
        title={result === null ? '' : RESULT_COPY[result]}
        detail={
          <div className="flex flex-col gap-1">
            <p className="text-bw-muted" data-money>
              {netCents >= 0 ? `+${formatMoney(netCents)}` : formatMoney(netCents)} this hand.
            </p>
            {/* Said out loud, because the net above folds two bets into one number and an
                insurance that paid is the only reason a LOST hand can come out level. */}
            {hand !== null && hand.insured && (
              <p className="text-bw-muted text-sm">
                {hand.insurancePaidCents > 0
                  ? `Insurance paid ${formatMoney(hand.insurancePaidCents - hand.insuranceCents)}.`
                  : `Insurance lost ${formatMoney(hand.insuranceCents)}.`}
              </p>
            )}
          </div>
        }
      >
        <Button variant="primary" disabled={busy} onClick={nextHand}>
          Play again
        </Button>
      </GameResult>

      {hand === null && <BetRack onDeal={deal} disabled={busy} />}

      {/* THE INSURANCE OFFER — the one decision at this table whose outcome the dealer alone can
          see. The board knows it is offered because `canInsure` says so (a function of the UP-card,
          which is on screen), and it does NOT know whether it will pay. */}
      {hand !== null && hand.canInsure && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-bw-muted text-sm">
            Dealer shows an Ace. Insure for {formatMoney(hand.insuranceCents)}? It pays 2 to 1 if
            the dealer has blackjack.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              variant="primary"
              disabled={busy || balance < hand.insuranceCents}
              onClick={() => {
                play('chip');
                move('insure');
              }}
            >
              Insure {formatMoney(hand.insuranceCents)}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => move('decline')}>
              No insurance
            </Button>
          </div>
        </div>
      )}

      {hand !== null && hand.phase === 'player' && (
        <div className="flex flex-wrap justify-center gap-3">
          {/* Every action disables while a request is in flight. The dealer is idempotent on the
              nonce, so a double-tap could not deal twice anyway — but a button that stays live
              through a round trip reads as a table that ignored you. */}
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              play('deal');
              move('hit');
            }}
          >
            Hit
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => move('stand')}>
            Stand
          </Button>
          {canDoubleNow && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                play('chip');
                play('deal');
                move('double');
              }}
            >
              Double
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
