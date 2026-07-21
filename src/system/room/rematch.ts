/**
 * REMATCH — the first shared in-game service (V1_FEATURE_GAPS #4, sequencing step 4).
 *
 * v1 rebuilt "play again" in 9 of 31 games, and online it was a request/host-accept handshake
 * hand-rolled each time. Boardwalk had drifted into the same shape from the other end: Tic-Tac-Toe
 * and Chess let ANY seated player reset the board unilaterally (a sore loser could wipe the result
 * out from under the winner still reading it), while UNO let only the host deal again and gave the
 * guests no say at all — three games, three different answers to one question. This module is the
 * question answered once.
 *
 * THE RULE: a rematch needs every HUMAN seat to ask for it. An AI seat agrees by construction — a
 * bot never sulks — which is also what keeps the handshake from being a stall: a player who leaves
 * mid-game has their seat handed to a bot (`releaseSeat(…, 'ai')`), so their vote requirement
 * leaves with them rather than freezing the table forever.
 *
 * WHERE THE VOTES LIVE, and why it is not a new wire field. A vote rides in the game's own shared
 * state under one reserved key, `rematch`, alongside the `round` counter every room game already
 * carries for exactly this purpose. That means it goes through `patchState` — already seq-ordered,
 * already transactional, already authorised (the gateway refuses a `patchState` from a socket that
 * holds no seat and does not host). A `rematch` node on `RoomSnapshot` would have been the more
 * obvious design and it would have cost a `database.rules.json` change deployed by hand, a gateway
 * change, and a Pi deploy — three manual steps, for a fact the room already has a transport for.
 *
 * The votes are a `Record<seatIndex, true>` — a SET, in the shape RTDB round-trips (the same shape
 * `presence` and `inventory` use). Not an array of indexes: RTDB drops null children, so a sparse
 * array is a shape that changes on the wire (see the `-1` sentinel Tic-Tac-Toe needed).
 *
 * Pure and unit-tested (`tests/rematch.test.ts`); the hook and the button are `Rematch.tsx`.
 */

import type { Seat } from '@/system/room/types';

/** Who has asked for a rematch, keyed by seat index. A set — the value is a marker, not data. */
export type RematchVotes = Readonly<Record<string, true>>;

/**
 * The slice of a game's shared state this service owns. A game's `TPublic` satisfies it by carrying
 * a `round` (they all already do — it is what keys the once-per-game result report) and tolerating
 * one extra optional key it never reads. The game keeps owning everything else; the OS reads and
 * writes exactly these two fields and nothing more.
 */
export interface Rematchable {
  readonly round: number;
  readonly rematch?: RematchVotes;
}

/** Add votes for `seatIndexes` (a hot-seat screen votes for every local human seat at once). */
export function castVotes(votes: RematchVotes | undefined, seatIndexes: readonly number[]) {
  const next: Record<string, true> = { ...votes };
  for (const i of seatIndexes) next[String(i)] = true;
  return next as RematchVotes;
}

export interface RematchTally {
  /** Human seat indexes whose agreement is required. AI and open seats are not asked. */
  readonly needed: readonly number[];
  /** The subset of `needed` that has voted. */
  readonly voted: readonly number[];
  /** Every needed seat has voted — and there was at least one to ask. */
  readonly agreed: boolean;
}

/**
 * Count the handshake. Votes from a seat that is no longer human (a player who left and was handed
 * to a bot) are ignored rather than counted — `needed` is recomputed from the CURRENT seats every
 * time, so the tally can never be satisfied by a ghost.
 */
export function rematchTally(
  votes: RematchVotes | undefined,
  seats: readonly Seat[]
): RematchTally {
  const needed = seats.flatMap((s, i) => (s.kind === 'human' ? [i] : []));
  const voted = needed.filter((i) => votes?.[String(i)] === true);
  return { needed, voted, agreed: needed.length > 0 && voted.length === needed.length };
}

/** Have all of MY seats voted? The button's own state — false when I hold no seat at all. */
export function haveVoted(
  votes: RematchVotes | undefined,
  seatIndexes: readonly number[]
): boolean {
  return seatIndexes.length > 0 && seatIndexes.every((i) => votes?.[String(i)] === true);
}
