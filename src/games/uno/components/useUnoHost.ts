import { useCallback, useEffect, useRef } from 'react';
import type { Seat } from '@/system/room/types';
import {
  NO_PENDING,
  applyMove,
  chooseAiMove,
  deal,
  toPublic,
  type Card,
  type UnoGame,
  type UnoState,
} from '@boardwalk/game-logic/games/uno';

/**
 * THE DEALER. UNO's one genuinely-multiplayer-hard piece, and it lives on the HOST alone. Because a
 * hand is hidden — the rules refuse a read of anyone else's `hands/` node, even the host's — no
 * client can hold the whole game the way Chess's every client holds the whole board. So the host is
 * the single authority: it holds the complete `UnoGame` (every hand + the draw pile) in a ref, runs
 * the pure `logic/uno.ts` reducer, and each transition it (a) PROJECTS a public view to `state/data`
 * (`toPublic`: top card, counts, whose turn — never a hidden card) and (b) DEALS each changed hand to
 * its owner's private node. The deck therefore never touches the wire at all — strictly more private
 * than v1, whose deck was public.
 *
 * Three effects, each host-gated (a non-host runs none of this — its hooks are still called, per the
 * rules of hooks, and early-return):
 *   1. DEAL once when the room flips to playing (the projection is null until the host writes it).
 *   2. Drive an AI seat whose turn it is — the Phase-5 `aiSeatsToDrive` seam, and the reason a
 *      leaving player handed to a bot (`releaseSeat(…, 'ai')`) keeps playing: the host already holds
 *      that seat's hand, so it just starts choosing its moves. No hand transfer, nothing to reload.
 *   3. Apply a human's submitted intent (`state.pending`) in nonce order, ack it, republish. The
 *      host's OWN moves go through this same path (it submits a `pending` like anyone), so there is
 *      one code path for "a human moved", not a host special-case.
 *
 * The host reload note, stated not hidden: the hidden state lives only in this ref, so a host that
 * reloads cannot recover it (it may not read the other hands back). In practice a host unmount tears
 * the room down (`<RoomProvider>`'s teardown — the host is the last-present participant), so a host
 * leaving ENDS the game rather than stranding it, which is the same contract v1 had.
 */

const AI_DELAY_MS = 900;

export interface UnoHostArgs {
  readonly isHost: boolean;
  readonly status: 'waiting' | 'playing' | 'finished' | 'gone';
  readonly state: UnoState | null;
  readonly seats: readonly Seat[];
  readonly patch: (produce: (prev: UnoState | null) => UnoState) => Promise<void>;
  readonly writeHand: (index: number, data: readonly Card[]) => Promise<void>;
}

export interface UnoHostApi {
  /** Host action: deal a fresh round (the "Play again" button). No-op for a non-host. */
  readonly dealAgain: () => void;
}

export function useUnoHost({ isHost, status, state, seats, patch, writeHand }: UnoHostArgs): UnoHostApi {
  const gameRef = useRef<UnoGame | null>(null);
  const lastGameRef = useRef<UnoGame | null>(null); // for writing only the hands that changed
  const roundRef = useRef(0);
  const ackRef = useRef(0);

  /** Write the changed private hands, then the public projection. Preserves any pending a player wrote. */
  const publish = useCallback(
    (game: UnoGame, reset = false) => {
      const last = lastGameRef.current;
      seats.forEach((s, i) => {
        if (s.kind !== 'human') return; // AI/host-unowned hands stay in memory; nobody may read them
        if (!reset && last !== null && last.hands[i] === game.hands[i]) return; // unchanged → skip
        void writeHand(i, game.hands[i] ?? []);
      });
      lastGameRef.current = game;
      const round = roundRef.current;
      const ack = reset ? 0 : ackRef.current;
      void patch((prev) => toPublic(game, round, reset || prev === null ? NO_PENDING : prev.pending, ack));
    },
    [seats, writeHand, patch]
  );

  const startRound = useCallback(
    (round: number) => {
      const g = deal(seats.length, Math.random);
      gameRef.current = g;
      lastGameRef.current = null;
      roundRef.current = round;
      ackRef.current = 0;
      publish(g, true);
    },
    [seats, publish]
  );

  // 1. Deal the first round when play starts (projection null = not yet dealt).
  useEffect(() => {
    if (!isHost || status !== 'playing' || state !== null || gameRef.current !== null) return;
    startRound(0);
  }, [isHost, status, state, startRound]);

  // 2. Drive an AI seat whose turn it is. Keyed on `state`, so each AI move republishes → this
  // re-runs → the next AI turn (if any) schedules, chaining bot turns; the cleanup cancels a stale
  // timer. `seats` in deps so a human→AI flip (a leaver) is picked up mid-turn.
  useEffect(() => {
    if (!isHost) return;
    const g = gameRef.current;
    if (g === null || state === null || g.winner !== -1) return;
    const turn = g.turn;
    if (seats[turn]?.kind !== 'ai') return;
    const timer = setTimeout(() => {
      const cur = gameRef.current;
      if (cur === null || cur.winner !== -1 || cur.turn !== turn || seats[turn]?.kind !== 'ai') return;
      const next = applyMove(cur, turn, chooseAiMove(cur, turn), Math.random);
      gameRef.current = next;
      publish(next);
    }, AI_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isHost, state, seats, publish]);

  // 3. Apply a human's submitted intent in nonce order (the host's own move takes this path too).
  useEffect(() => {
    if (!isHost) return;
    const g = gameRef.current;
    if (g === null || state === null || g.winner !== -1) return;
    const p = state.pending;
    if (p.nonce <= ackRef.current || p.seat !== g.turn || seats[p.seat]?.kind !== 'human') return;
    ackRef.current = p.nonce;
    const next = applyMove(g, p.seat, p.move, Math.random);
    gameRef.current = next;
    publish(next);
  }, [isHost, state, seats, publish]);

  const dealAgain = useCallback(() => {
    if (!isHost || gameRef.current === null) return;
    startRound(roundRef.current + 1);
  }, [isHost, startRound]);

  return { dealAgain };
}
