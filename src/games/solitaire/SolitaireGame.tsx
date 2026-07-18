import { useEffect, useReducer, useRef, useState } from 'react';
import { Button, Card, cx, useToast } from '@/ui';
import { useAudio } from '@/system/audio/useAudio';
import { useGame } from '@/system/economy/useGame';
import type { GameProps } from '@/games/registry';
import { Board } from '@/games/solitaire/components/Board';
import {
  canAutoComplete,
  freshDeck,
  initialState,
  reducer,
  shuffle,
} from '@/games/solitaire/logic/solitaire';

/**
 * Solitaire — the whole game, and the shape of a room-LESS one, exactly like Blackjack. There is no
 * lobby: it is one player against the shuffle, so it renders its board straight into the
 * `<GameShell>` the play route already wrapped it in and drives a local `useReducer`. `onExit` — the
 * one prop a game gets (CLAUDE.md) — is passed through to the header's "Leave", since there is no
 * lobby to own the way back.
 *
 * Everything with weight is elsewhere and owed to the OS: the rules are the tested pure `logic/`,
 * the card art is the shared `system/cards`, the sounds are `useAudio`, and the win is one
 * `reportResult({ outcome: 'win' })` — no payout, because Solitaire has no `betting` in its manifest
 * and never touches the bankroll (the same report shape Chess uses). This file is the seam, and it
 * is a few lines of glue plus the chrome a solo game must own itself.
 */
export default function SolitaireGame({ onExit }: GameProps) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [drawCount, setDrawCount] = useState<1 | 3>(1);
  const { reportResult } = useGame();
  const { play } = useAudio();
  const toast = useToast();

  const newGame = (count: 1 | 3) => {
    setDrawCount(count);
    reportedWin.current = false;
    play('shuffle');
    dispatch({ type: 'deal', deck: shuffle(freshDeck()), drawCount: count });
  };

  // Deal the opening game once, on mount. The empty initial state means "before the first deal", so
  // this is what puts cards on the table; `newGame` is the same call for every subsequent deal.
  const dealt = useRef(false);
  useEffect(() => {
    if (dealt.current) return;
    dealt.current = true;
    dispatch({ type: 'deal', deck: shuffle(freshDeck()), drawCount });
  }, [drawCount]);

  // Report the win exactly once per game, and voice it. Reset in `newGame`, so a fresh deal can win
  // and report again — the same ref-guard shape the other games use to avoid a double-credit.
  const reportedWin = useRef(false);
  useEffect(() => {
    if (!state.won || reportedWin.current) return;
    reportedWin.current = true;
    // Clean Sheet feat: cleared without ever recycling the stock. Only the board tracks recycles,
    // so the game reports it; the economy never learns the run any other way.
    reportResult({
      outcome: 'win',
      ...(state.recycles === 0 ? { feats: ['feat_cleansheet'] } : {}),
    });
    play('jackpot');
    toast.success('You cleared the board!');
  }, [state.won, state.recycles, reportResult, play, toast]);

  const showAutoFinish = canAutoComplete(state) && !state.won;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.08em] uppercase">
          Solitaire
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-bw-muted text-sm" data-money>
            {state.moves} moves
          </span>
          {/* Draw mode picks the difficulty and re-deals — a fresh shuffle, not a mid-game switch. */}
          <div className="flex overflow-hidden rounded-md">
            {([1, 3] as const).map((count) => (
              <Button
                key={count}
                variant={drawCount === count ? 'secondary' : 'quiet'}
                size="sm"
                onClick={() => newGame(count)}
                className={cx('rounded-none')}
              >
                Draw {count}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => newGame(drawCount)}>
            New game
          </Button>
          <Button variant="quiet" size="sm" onClick={onExit}>
            Leave
          </Button>
        </div>
      </div>

      <Card className="flex flex-col gap-6 p-4 sm:p-6">
        <Board state={state} dispatch={dispatch} play={play} />
      </Card>

      {state.won ? (
        <Card className="flex flex-col items-start gap-3 p-6">
          <p className="font-display text-base-content text-lg font-bold tracking-[0.04em]">
            You win — all four suits home in {state.moves} moves.
          </p>
          <Button variant="primary" onClick={() => newGame(drawCount)}>
            Deal again
          </Button>
        </Card>
      ) : (
        showAutoFinish && (
          <div className="flex">
            <Button variant="primary" onClick={() => dispatch({ type: 'autoComplete' })}>
              Auto-finish
            </Button>
          </div>
        )
      )}
    </div>
  );
}
