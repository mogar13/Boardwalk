/**
 * The seat array, as pure functions. No Firebase, no React, no DOM — the same discipline
 * `credentials.ts` and `economy/bet.ts` follow, and for the same reason: logic welded to I/O
 * is untestable logic, and this is the logic the whole of multiplayer stands on. Every subtle
 * thing here is a v1 bug (ARCHITECTURE.md#what-casino-os-v1-got-wrong), and `tests/room.test.ts`
 * covers the lot in milliseconds.
 *
 * THE ONE IDEA: three "modes" are one seat array read three ways. AI is `[mySeat]`, online is
 * `[mySeat]`, hot-seat is every human seat — and a game reads `localSeatIds`/`isMyTurn` and
 * NEVER a mode string. v1 spelled the mode as a dropdown string, hand-rolled hot-seat in 14
 * games (7 said `"local"`, 7 said `"hotseat"`), and Checkers paid the local player when EITHER
 * side won. The fix is that the mode collapses to one boolean at one call site (`useSeats`) and
 * disappears; below this line there is no mode, only seats.
 */

import type { Seat, SeatOccupant } from '@/system/room/types';

/** A table of `size` open seats. The starting array a room is created with. */
export function emptyTable(size: number): Seat[] {
  return Array.from({ length: size }, (): Seat => ({ kind: 'open', name: '', uid: null }));
}

/**
 * The seat a joiner should take: the first OPEN seat, or failing that the first AI seat.
 * `-1` if the table is full of humans.
 *
 * OPEN BEFORE AI is v1's rule ("the first replaceable seat: open OR ai"), and the order
 * matters — you fill an empty chair before you evict a bot, so a table with one open seat and
 * one AI seat seats the next two humans without either displacing the AI early. An AI seat is
 * still claimable (that is what keeps drop-in working), just second in line.
 */
export function firstClaimableIndex(seats: readonly Seat[]): number {
  const open = seats.findIndex((s) => s.kind === 'open');
  if (open !== -1) return open;
  return seats.findIndex((s) => s.kind === 'ai');
}

/** A seat a claim may take: an empty chair or a bot chair, never another human's. */
function isClaimable(seat: Seat): boolean {
  return seat.kind === 'open' || seat.kind === 'ai';
}

/**
 * The result of a claim attempt. `ok: false` is not an error — it is "someone got there
 * first", the ordinary outcome of two clients racing for the last seat, which the caller
 * renders as "SEAT TAKEN" rather than throwing. This mirrors `RepoResult`'s split: expected
 * contention is a value, a broken database is an exception.
 */
export type ClaimResult =
  | { readonly ok: true; readonly seats: Seat[] }
  | { readonly ok: false; readonly reason: 'taken' | 'out-of-range' };

/**
 * Seat an occupant at `index`, if that seat is claimable. Returns a NEW array — the input is
 * never mutated, because this is applied optimistically to store state and a mutation would
 * corrupt the value another render is still reading.
 *
 * This is the pure half of claim-then-verify (ARCHITECTURE.md — "write, re-read, confirm
 * `claimed.name === myName`, else SEAT TAKEN"). The re-read against the server is the repo's
 * job; this decides, given a known board, whether the claim is legal at all.
 */
export function claimSeat(seats: readonly Seat[], index: number, who: SeatOccupant): ClaimResult {
  const seat = seats[index];
  if (seat === undefined) return { ok: false, reason: 'out-of-range' };
  if (!isClaimable(seat)) return { ok: false, reason: 'taken' };
  const next = seats.slice();
  next[index] = { kind: 'human', name: who.name, uid: who.uid };
  return { ok: true, seats: next };
}

/**
 * Empty a seat on leave. `fallback` decides what the chair becomes:
 *
 * - `'ai'`   — hand it BACK to the house driver so the table stays alive. This is UNO's leave
 *              path and v1's best idea: a player dropping out of a game in progress becomes a
 *              bot rather than a hole nobody can fill, so the remaining players finish the hand.
 * - `'open'` — a plain empty chair, for the lobby, where a departure should free the seat for
 *              the next human rather than spawn a bot into a game that has not started.
 *
 * The choice is the caller's because it depends on `status`, which lives in meta, not here —
 * keeping this function ignorant of room lifecycle is what keeps it pure and total.
 */
export function releaseSeat(
  seats: readonly Seat[],
  index: number,
  fallback: 'ai' | 'open'
): Seat[] {
  const next = seats.slice();
  const seat = next[index];
  if (seat === undefined) return next;
  next[index] =
    fallback === 'ai'
      ? { kind: 'ai', name: seat.name === '' ? 'CPU' : seat.name, uid: null }
      : { kind: 'open', name: '', uid: null };
  return next;
}

/** The index this account sits in, or `-1` if it holds no seat. */
export function mySeatIndex(seats: readonly Seat[], myUid: string): number {
  return seats.findIndex((s) => s.kind === 'human' && s.uid === myUid);
}

/**
 * THE THREE-MODES-INTO-ONE collapse. The seats whose turns THIS screen is responsible for —
 * i.e. whose current-turn a local click should be attributed to.
 *
 * - `sharedScreen: true` (hot-seat) — every human seat, because several people share one
 *   screen and an un-attributed local click belongs to whoever's turn it is, "not always the
 *   first human in the list" (v1's Monopoly found this the hard way and nobody generalized it).
 * - `sharedScreen: false` (online AND single-player-vs-AI) — only my own seat. Online because
 *   the other humans drive their own; vs-AI because the human owns exactly one seat and the AI
 *   seats are not driven by a *click* (see `aiSeatsToDrive`).
 *
 * `isMyTurn = localSeatIds.includes(currentSeat)` (below) then works identically in all three,
 * which is the entire point: no game ever branches on a mode again.
 */
export function localSeatIds(args: {
  readonly seats: readonly Seat[];
  readonly myUid: string;
  readonly sharedScreen: boolean;
}): number[] {
  const { seats, myUid, sharedScreen } = args;
  const out: number[] = [];
  seats.forEach((seat, i) => {
    if (seat.kind !== 'human') return;
    if (sharedScreen || seat.uid === myUid) out.push(i);
  });
  return out;
}

/**
 * Whether the seat to move now is one this screen controls. A one-liner on purpose — the whole
 * of the mode logic is already spent in `localSeatIds`, and this is what a game actually calls
 * every render, given its own notion of `currentSeat` (turn-tracking is game state, not room
 * infra — see `useSeats`).
 */
export function isMyTurn(localIds: readonly number[], currentSeat: number): boolean {
  return localIds.includes(currentSeat);
}

/**
 * The AI seats whose moves THIS client must compute and write — and it is the HOST's job, not
 * everyone's. If every client drove the AI, an N-player online table would compute each bot
 * move N times and race to write it; the host owning the drivers is what makes AI-as-occupant
 * work across the network. Empty for a non-host, so an online guest never fights the host for a
 * bot's turn.
 *
 * This is deliberately SEPARATE from `localSeatIds`: local attribution (a click) and AI driving
 * (an automatic move) are different responsibilities, and folding a bot's turn into "my turn"
 * is how v1 got a human prompted to play the computer's hand.
 */
export function aiSeatsToDrive(seats: readonly Seat[], isHost: boolean): number[] {
  if (!isHost) return [];
  const out: number[] = [];
  seats.forEach((seat, i) => {
    if (seat.kind === 'ai') out.push(i);
  });
  return out;
}

/** Whether every seat is filled (human or AI) — the host's cue that the table can start. */
export function tableIsFull(seats: readonly Seat[]): boolean {
  // `[].every` is vacuously true, so guard the empty array: a zero-seat table (a ghost room, or a
  // future caller that hasn't loaded seats yet) is NOT full. `canStart` also requires a human, so
  // this is belt-and-braces today, but a helper that calls nothing "full" is a trap waiting for the
  // next caller that forgets the human-count clause.
  return seats.length > 0 && seats.every((s) => s.kind !== 'open');
}

/** How many humans hold a seat — for the lobby's "2/4 players" line and the min-seats check. */
export function humanCount(seats: readonly Seat[]): number {
  return seats.filter((s) => s.kind === 'human').length;
}
