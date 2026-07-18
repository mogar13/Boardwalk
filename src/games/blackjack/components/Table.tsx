import { useEffect, useReducer, useRef } from 'react';
import { Button, Card, cx, useToast } from '@/ui';
import { useAudio } from '@/system/audio/useAudio';
import { useBet } from '@/system/economy/useBet';
import { useGame } from '@/system/economy/useGame';
import { useBankroll } from '@/system/profile/useProfile';
import { formatMoney } from '@boardwalk/game-logic';
import { Hand } from '@/games/blackjack/components/Hand';
import {
  canDouble,
  freshDeck,
  handValue,
  initialState,
  payoutCents,
  reducer,
  resultOutcome,
  shuffle,
  type Result,
} from '@boardwalk/game-logic/games/blackjack';

/**
 * The table — the only part of Blackjack that is not tested pure logic. It holds the hand in a
 * `useReducer` (local state, no room — this game opts out of multiplayer), draws the state, and
 * wires three OS surfaces the game itself does not implement: `useBet` (the chip rack and the one
 * way a wager leaves the bankroll), `useGame().reportResult` (the one way a payout comes back), and
 * `useAudio` (the felt sounds staged in the Blackjack-prep step). Every rule — value, settle,
 * payout — is imported from `logic/`; this component only decides which pure function to call and
 * when to make a sound.
 *
 * MONEY MOVES IN TWO EVENTS, EXACTLY AS THE OS DEMANDS. The wager leaves at `commit()` (deal, and
 * again on a double); the payout returns through `reportResult` when the hand settles. There is no
 * `money += x` here and no way to spell one — the bankroll is a readonly number.
 */

const CHIPS = [500, 2500, 10000] as const; // $5 / $25 / $100

/** The line under the table, and the sound, for a settled hand — one place so they cannot disagree. */
const RESULT_COPY: Record<Result, string> = {
  blackjack: 'Blackjack! Paid 3 to 2.',
  win: 'You win.',
  push: 'Push — your bet is returned.',
  lose: 'Dealer takes it.',
};

export function Table({ onExit }: { onExit: () => void }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const bet = useBet();
  const { reportResult } = useGame();
  const { play } = useAudio();
  const balance = useBankroll();
  const toast = useToast();

  // Report the economy result exactly once per settled hand, and voice it. Keyed on `handId` so a
  // rematch reports again and a re-render of the same finished hand does not double-credit — the
  // same ref-on-round shape Tic-Tac-Toe uses.
  const reportedHand = useRef(-1);
  useEffect(() => {
    if (state.phase !== 'settled' || state.result === null) return;
    if (reportedHand.current === state.handId) return;
    reportedHand.current = state.handId;

    const result = state.result;
    reportResult({
      outcome: resultOutcome(result),
      payoutCents: payoutCents(result, state.wagerCents),
      wagerCents: state.wagerCents,
      // A `blackjack` result is a two-card 21 — the Natural feat. The economy already knows the
      // stat/XP; the feat is the one fact only the game sees, so the game reports it.
      ...(result === 'blackjack' ? { feats: ['feat_natural'] } : {}),
    });
    play('flip'); // the hole card turning over
    play(
      result === 'blackjack'
        ? 'jackpot'
        : result === 'win'
          ? 'win'
          : result === 'push'
            ? 'push'
            : 'lose'
    );
  }, [state.phase, state.result, state.handId, state.wagerCents, reportResult, play]);

  const deal = () => {
    const wagerCents = bet.commit();
    if (wagerCents === null) {
      toast.error(bet.check.ok ? 'Could not place that bet.' : bet.check.error);
      return;
    }
    play('shuffle');
    play('deal');
    dispatch({ type: 'deal', deck: shuffle(freshDeck()), wagerCents });
  };

  const hit = () => {
    play('deal');
    dispatch({ type: 'hit' });
  };

  const double = () => {
    // The chip rack is still staged at the opening wager (nothing touches it during a hand), so a
    // second `commit()` deducts exactly the original stake — which is what a double-down costs.
    const extra = bet.commit();
    if (extra === null) {
      toast.error('Not enough in the bankroll to double.');
      return;
    }
    play('chip');
    play('deal');
    dispatch({ type: 'double' });
  };

  const { phase, player, dealer, result } = state;
  const holeHidden = phase === 'player'; // the dealer's second card is down until the player stands
  const dealerLabel = holeHidden
    ? `Dealer shows ${String(handValue(dealer.slice(0, 1)).total)}`
    : dealer.length > 0
      ? `Dealer has ${String(handValue(dealer).total)}`
      : 'Dealer';
  const playerLabel = player.length > 0 ? `You have ${String(handValue(player).total)}` : 'You';

  const canDoubleNow = canDouble(state) && balance >= state.wagerCents;
  const netCents = result === null ? 0 : payoutCents(result, state.wagerCents) - state.wagerCents;

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

      <Card className="flex flex-col gap-8 p-6 sm:p-8">
        <Hand cards={dealer} hideIndex={holeHidden ? 1 : -1} label={dealerLabel} />
        <Hand cards={player} label={playerLabel} />

        {phase === 'settled' && result !== null && (
          <div className="flex flex-col gap-1">
            <p
              className={cx(
                'font-display text-lg font-bold tracking-[0.04em]',
                result === 'lose' ? 'text-bw-muted' : 'text-base-content'
              )}
            >
              {RESULT_COPY[result]}
            </p>
            <p className="text-bw-muted text-sm" data-money>
              {netCents >= 0 ? `+${formatMoney(netCents)}` : formatMoney(netCents)} this hand
            </p>
          </div>
        )}
      </Card>

      {/* The controls change by phase, but the bankroll and table always read from the OS. */}
      {phase === 'betting' ? (
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.14em] uppercase">
              Your bet
            </span>
            <span data-money className="font-display text-accent text-2xl font-bold tracking-tight">
              {formatMoney(bet.amountCents)}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {CHIPS.map((chip) => (
              <Button
                key={chip}
                variant="ghost"
                size="sm"
                disabled={bet.amountCents + chip > bet.maxCents && bet.amountCents >= bet.maxCents}
                onClick={() => {
                  play('chip');
                  bet.add(chip);
                }}
              >
                +{formatMoney(chip)}
              </Button>
            ))}
            <Button variant="quiet" size="sm" onClick={() => bet.set(bet.maxCents)}>
              Max
            </Button>
            <Button variant="quiet" size="sm" onClick={bet.clear}>
              Clear
            </Button>
          </div>

          {!bet.check.ok && <p className="text-bw-muted text-sm">{bet.check.error}</p>}

          <Button variant="primary" onClick={deal} disabled={!bet.canCommit}>
            Deal
          </Button>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-3">
          {phase === 'player' && (
            <>
              <Button variant="primary" onClick={hit}>
                Hit
              </Button>
              <Button variant="secondary" onClick={() => dispatch({ type: 'stand' })}>
                Stand
              </Button>
              {canDoubleNow && (
                <Button variant="ghost" onClick={double}>
                  Double
                </Button>
              )}
            </>
          )}
          {phase === 'settled' && (
            <Button variant="primary" onClick={() => dispatch({ type: 'newHand' })}>
              Play again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
