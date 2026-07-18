/**
 * Seat arbitration, as pure functions — the server-authoritative twin of the frontend's
 * `@/system/room/seats`. Kept deliberately separate from the store so the rules ("open before ai",
 * "never another human's seat", "a leaver becomes an AI mid-game") are tested in isolation, the same
 * discipline the frontend follows.
 *
 * The one difference from the frontend copy: there is no claim-THEN-verify here. The server holds
 * the single authoritative seat array and applies a claim atomically (Node is single-threaded; a
 * message is processed to completion before the next), so the race BACKEND_PLAN.md names —
 * "two clients race for the same seat" — cannot occur. `claimSeat` returns the arbitrated result and
 * that IS the truth, not an optimistic guess awaiting a re-read.
 *
 * These functions are duplicated from the frontend rather than shared because a cross-package
 * workspace import is Phase D's `packages/game-logic` refactor; until then two small, identically
 * tested copies beat a premature package. `tests/rooms.test.ts` pins this copy.
 */

import type { Seat, SeatOccupant } from './types';

/** A table of `size` open seats — the array a room is born with. */
export function emptyTable(size: number): Seat[] {
  return Array.from({ length: size }, (): Seat => ({ kind: 'open', name: '', uid: null }));
}

/** A seat a claim may take: an empty chair or a bot chair, never another human's. */
function isClaimable(seat: Seat): boolean {
  return seat.kind === 'open' || seat.kind === 'ai';
}

export type ClaimResult =
  | { readonly ok: true; readonly seats: Seat[] }
  | { readonly ok: false; readonly reason: 'taken' | 'out-of-range' };

/**
 * Seat an occupant at `index` if that seat is claimable. Returns a NEW array; the input is never
 * mutated. Idempotent for the same occupant: re-claiming a seat you already hold succeeds and
 * returns you seated, so a duplicate command (a resend after a flaky socket) is harmless.
 */
export function claimSeat(seats: readonly Seat[], index: number, who: SeatOccupant): ClaimResult {
  const seat = seats[index];
  if (seat === undefined) return { ok: false, reason: 'out-of-range' };
  const alreadyMine = seat.kind === 'human' && seat.uid === who.uid;
  if (!isClaimable(seat) && !alreadyMine) return { ok: false, reason: 'taken' };
  const next = seats.slice();
  next[index] = { kind: 'human', name: who.name, uid: who.uid };
  return { ok: true, seats: next };
}

/**
 * Empty a seat on leave. `'ai'` hands the chair BACK to the house driver so a game in progress
 * stays alive (UNO's leave path); `'open'` frees it for the next human (the lobby).
 */
export function releaseSeat(seats: readonly Seat[], index: number, fallback: 'ai' | 'open'): Seat[] {
  const next = seats.slice();
  const seat = next[index];
  if (seat === undefined) return next;
  next[index] =
    fallback === 'ai'
      ? { kind: 'ai', name: seat.name === '' ? 'CPU' : seat.name, uid: null }
      : { kind: 'open', name: '', uid: null };
  return next;
}

/** Every seat index this uid holds — usually one, but a shared-screen host can hold several. */
export function seatsHeldBy(seats: readonly Seat[], uid: string): number[] {
  const out: number[] = [];
  seats.forEach((s, i) => {
    if (s.kind === 'human' && s.uid === uid) out.push(i);
  });
  return out;
}

/** How many humans hold a seat — the leaderboard/lobby "N players" count and a GC input. */
export function humanCount(seats: readonly Seat[]): number {
  return seats.filter((s) => s.kind === 'human').length;
}
