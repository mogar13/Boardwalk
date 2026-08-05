import { useState } from 'react';
import { linesFor, type LogLine } from '@/games/uno/log';
import type { UnoEvent } from '@boardwalk/game-logic/games/uno';

/** Enough scrollback to see the turn that just happened to you, not a transcript of the evening. */
const MAX_EVENTS = 40;

interface Scrollback {
  readonly round: number;
  /** The highest event seq already appended — the de-duplication key. */
  readonly seq: number;
  readonly events: readonly UnoEvent[];
}

/**
 * The move log's scrollback, accumulated CLIENT-SIDE from the one event the host publishes.
 *
 * The wire carries the LAST event only (see `UnoState.lastEvent`) — a growing array in room state
 * would be a log that costs a write proportional to its own length, on every move, forever. Each
 * client keeps its own tail instead, which means a late joiner starts from the moment they arrived.
 * That is the same answer chat gives and it is the right one: the log is a running commentary, not
 * a record, and nothing is decided by it.
 *
 * It stores EVENTS and renders lines on demand rather than storing formatted lines, so a player
 * renaming themselves re-labels their earlier moves instead of leaving the log addressed to a name
 * nobody has any more.
 *
 * De-duplication is `seq`, not equality: the host republishes the projection on every patch
 * (including ones that carry no move at all, like another player's pending intent landing), so the
 * same event arrives repeatedly and must be appended exactly once. A round change resets it, which
 * is what makes "Deal again" start a fresh log rather than continuing the last one.
 *
 * THE BASELINE IS `-1`, NOT `0`, and that is load-bearing rather than tidy. The deal is itself an
 * event and it is stamped seq 0 (the host's per-round counter starts there), so a baseline of 0
 * made `event.seq > log.seq` false for it and the deal was the one event that could never be
 * appended. That was invisible while a deal had nothing to say; it says something now — who won the
 * last round and is leading this one — so the off-by-one became a missing line.
 *
 * ONE piece of state, updated during render — the "adjust state when props change" pattern
 * `Board.tsx` already uses for the wild picker. It is one object rather than three `useState`s (or,
 * as first written, two refs) so that a StrictMode double-invoke recomputes the SAME value from the
 * same input instead of appending twice: everything the branch reads is state, so it is idempotent.
 */
export function useMoveLog(
  event: UnoEvent,
  names: readonly string[],
  round: number
): readonly LogLine[] {
  const [log, setLog] = useState<Scrollback>({ round, seq: -1, events: [] });

  if (log.round !== round) {
    setLog({ round, seq: -1, events: [] });
  } else if (event.seq > log.seq) {
    setLog({ round, seq: event.seq, events: [...log.events, event].slice(-MAX_EVENTS) });
  }

  return log.events.flatMap((e) => linesFor(e, names));
}
