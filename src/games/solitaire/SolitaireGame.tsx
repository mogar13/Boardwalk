import { useEffect, useReducer, useRef } from 'react';
import { Button, Card, useToast } from '@/ui';
import { useAudio } from '@/system/audio/useAudio';
import { useEquippedFelt } from '@/system/felt/useEquippedFelt';
import { useGame } from '@/system/economy/useGame';
import type { GameProps } from '@/games/registry';
import { Board } from '@/games/solitaire/components/Board';
import { GameOptions } from '@/system/options/GameOptions';
import { solitaireDrawCount } from '@/games/solitaire/manifest';
import { useGameOptions } from '@/system/options/useGameOptions';
import {
  canAutoComplete,
  freshDeck,
  initialState,
  reducer,
  shuffle,
} from '@boardwalk/game-logic/games/solitaire';

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
  const { values } = useGameOptions();
  const drawCount = solitaireDrawCount(values);
  const { reportResult } = useGame();
  const { play } = useAudio();
  const felt = useEquippedFelt();
  const toast = useToast();

  const newGame = () => {
    play('shuffle');
    dispatch({ type: 'deal', deck: shuffle(freshDeck()), drawCount });
  };

  // Deal on mount, and RE-deal whenever the draw option changes — one effect, because "put cards on
  // the table" and "the rules just changed" are the same act. Changing draw mode mid-game is not a
  // mutation of a game in flight (v1's Chess deferred a difficulty change to the next game for
  // exactly this reason); here the next game is one shuffle away, so it starts immediately.
  const dealtFor = useRef<1 | 3 | null>(null);
  useEffect(() => {
    if (dealtFor.current === drawCount) return;
    dealtFor.current = drawCount;
    dispatch({ type: 'deal', deck: shuffle(freshDeck()), drawCount });
  }, [drawCount]);

  // Report the win exactly once per game, and voice it. The guard is the TRANSITION into `won`,
  // not a flag reset by whoever deals: a fresh deal clears `won`, which re-arms this by itself. The
  // flag version needed clearing from `newGame` AND from the deal effect, and a ref written from
  // three places is both a double-credit waiting to happen and (rightly) a lint error.
  const wasWon = useRef(false);
  useEffect(() => {
    if (state.won === wasWon.current) return;
    wasWon.current = state.won;
    if (!state.won) return;
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
          {/* Draw mode is a DECLARED option now — the manifest names it, the OS draws it, and the
              effect above re-deals when it changes. This used to be two buttons and a `useState`
              living here, which is the per-game duplication the seam exists to end. */}
          <GameOptions />
          <Button variant="ghost" size="sm" onClick={newGame}>
            New game
          </Button>
          <Button variant="quiet" size="sm" onClick={onExit}>
            Leave
          </Button>
        </div>
      </div>

      <Card felt={felt} className="flex flex-col gap-6 p-4 sm:p-6">
        <Board state={state} dispatch={dispatch} play={play} />
      </Card>

      {state.won ? (
        <Card className="flex flex-col items-start gap-3 p-6">
          <p className="font-display text-base-content text-lg font-bold tracking-[0.04em]">
            You win — all four suits home in {state.moves} moves.
          </p>
          <Button variant="primary" onClick={newGame}>
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
