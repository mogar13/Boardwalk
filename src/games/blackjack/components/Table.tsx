import { useEffect, useRef } from 'react';
import { Button, Card, cx } from '@/ui';
import { useAudio } from '@/system/audio/useAudio';
import { useEquippedFelt } from '@/system/felt/useEquippedFelt';
import { useBlackjackTable } from '@/system/economy/useBlackjackTable';
import { useBankroll } from '@/system/profile/useProfile';
import { formatMoney } from '@boardwalk/game-logic';
import { BetRack } from '@/games/blackjack/components/BetRack';
import { Hand } from '@/games/blackjack/components/Hand';
import { handValue, payoutCents, type Result } from '@boardwalk/game-logic/games/blackjack';

/**
 * The table — and since Phase D it is a RENDERER, not a game.
 *
 * It used to hold the hand in a `useReducer`, shuffle its own deck, decide the result, and hand the
 * economy a `payoutCents` it had computed itself. All four of those are now the dealer's
 * (`useBlackjackTable` → `BlackjackRepo`), and what is left here is the part that was always the
 * board's: draw a `HandView`, offer three buttons, make a noise at the right moment.
 *
 * WHAT THIS FILE CAN NO LONGER SPELL, which is the point of the phase. There is no `payoutCents`
 * call against a result it chose, no `reportResult`, and no `feat_natural` — the dealer detects a
 * two-card 21 from the two cards it dealt, so the last achievement the client could assert has been
 * taken off the wire. `payoutCents` still appears below and it is doing something different and
 * harmless: turning the settled hand's own numbers into the "+$37.50 this hand" line. It is
 * arithmetic ON a settled result, not a claim about one.
 *
 * THE HOLE CARD IS ABSENT, NOT HIDDEN. `hand.dealer` carries one card until the hand settles, so
 * the board draws ONE back for the card it does not have. Opening devtools on this page shows the
 * same thing the screen does, which is the "Done when" the whole phase was for.
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
  // sounds again and a re-render of the same finished hand does not, the same ref-on-round shape
  // Tic-Tac-Toe uses. It reports nothing: the money moved server-side before this effect ran, and
  // this is the flourish, not the ledger.
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
  // One back for the hole card while the hand is live. Not `2 - dealer.length`: the dealer draws
  // more cards on the reveal, and the reveal is exactly when the count goes to zero.
  const holeCards = hand !== null && !settled ? 1 : 0;
  const dealerLabel =
    hand === null
      ? 'Dealer'
      : settled
        ? `Dealer has ${String(handValue(hand.dealer).total)}`
        : `Dealer shows ${String(handValue(hand.dealer).total)}`;
  const playerLabel =
    hand === null || hand.player.length === 0
      ? 'You'
      : `You have ${String(handValue(hand.player).total)}`;

  // Affordability of a double is still checked here for the BUTTON, and still checked again by the
  // dealer for the money. This one can be wrong (a stale balance) and costs a refusal toast; the
  // other one cannot be, which is the division the whole seam exists to draw.
  const canDoubleNow = hand !== null && hand.canDouble && balance >= hand.wagerCents;
  const netCents =
    hand !== null && hand.result !== null
      ? payoutCents(hand.result, hand.wagerCents) - hand.wagerCents
      : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* The table owns its own chrome — there is no lobby to provide a back button (a solo game). */}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.08em] uppercase">
          Blackjack
        </h1>
        <Button variant="quiet" size="sm" onClick={onExit}>
          Leave table
        </Button>
      </div>

      <Card felt={felt} className="flex flex-col gap-8 p-6 sm:p-8">
        <Hand cards={hand?.dealer ?? []} faceDown={holeCards} label={dealerLabel} />
        <Hand cards={hand?.player ?? []} label={playerLabel} />

        {settled && hand.result !== null && (
          <div className="flex flex-col gap-1">
            <p
              className={cx(
                'font-display text-lg font-bold tracking-[0.04em]',
                hand.result === 'lose' ? 'text-bw-muted' : 'text-base-content'
              )}
            >
              {RESULT_COPY[hand.result]}
            </p>
            <p className="text-bw-muted text-sm" data-money>
              {netCents >= 0 ? `+${formatMoney(netCents)}` : formatMoney(netCents)} this hand
            </p>
          </div>
        )}
      </Card>

      {hand === null ? (
        <BetRack onDeal={deal} disabled={busy} />
      ) : (
        <div className="flex flex-wrap gap-3">
          {hand.phase === 'player' && (
            <>
              {/* Every action disables while a request is in flight. The dealer is idempotent on
                  the nonce, so a double-tap could not deal twice anyway — but a button that stays
                  live through a round trip reads as a table that ignored you. */}
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
            </>
          )}
          {settled && (
            <Button variant="primary" disabled={busy} onClick={nextHand}>
              Play again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
