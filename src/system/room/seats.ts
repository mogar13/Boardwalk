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
 * WHAT A CHAIR IS CALLED — one-based, because a seat index is a developer's number and "CPU 4" is
 * a player's. Two one-liners rather than four string literals scattered across the app, and that
 * is the whole point: a bot chair is named by `plannedSeats` (the preview, before the table
 * exists), by `SeatList`'s "Add CPU" and its "Fill with CPUs" (after it does), and a local human
 * chair by `plannedSeats` and by the hot-seat claim loop. Four writers of one name is four chances
 * for the preview to promise "CPU 2" and the table to seat "AI 2".
 *
 * The referee's own `fillWithAi` (`boardwalk-api/src/rooms/seats.ts`) writes the SAME label from
 * its own copy — that file's docblock names the duplication and why it stands. Nothing static spans
 * the two packages, so both sides pin the literal in their own suite and this comment is the join.
 */
export function aiSeatName(index: number): string {
  return `CPU ${String(index + 1)}`;
}

/** The label an extra LOCAL human takes on a shared screen — v1's "Player 2". */
export function localSeatName(index: number): string {
  return `Player ${String(index + 1)}`;
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

/**
 * HOW MANY HUMANS THIS TABLE COULD HOLD — the seated ones plus every chair still open, because an
 * open chair is a chair a person takes.
 *
 * `humanCount`'s sibling, and the distinction only matters BEFORE the deal. `tableBacking` asks how
 * many humans are anteing, which at a live table is `humanCount` and at a table that does not exist
 * yet is this: a planned AI table is one human and no open chairs (the house banks it), a planned
 * ONLINE table is one human and six chairs somebody can walk into (it is not a house table, whoever
 * has arrived so far). Asking `humanCount` of a planned online table answers "one", which would
 * lock UNO's bot tier at `sharp` on the strength of a guess that nobody else will ever join.
 */
export function humanCapacity(seats: readonly Seat[]): number {
  return seats.filter((s) => s.kind === 'human' || s.kind === 'open').length;
}

/**
 * HOW BIG A TABLE THE HOST MAY BUILD — every size the manifest's `seats` range allows.
 *
 * `manifest.seats.min` was very nearly dead data before this: the lobby created every table at
 * `seats.max` and `canStart` requires a FULL table, so a game declaring `{ min: 2, max: 7 }` had
 * exactly one real table size, seven, and the `min` was decoration. That is why an UNO table was
 * always you plus six CPUs, and why the first thing v1 asked was "2, 3 or 4?".
 *
 * The choice lives at CREATE time, not in the room, because `seatCount` is a create parameter — a
 * table cannot grow a chair once people are sitting at it, and pretending otherwise would mean
 * re-seating a room that somebody has already joined by code.
 *
 * Returns EMPTY when the range holds one size (Chess's `{ min: 2, max: 2 }`), so the lobby draws no
 * control at all rather than a picker with one button — a control that cannot change the outcome is
 * worse than none, which is the same reasoning the visibility toggle is hidden in AI mode for.
 * A reversed or nonsensical range collapses to nothing for the same reason.
 */
export function tableSizeChoices(range: { readonly min: number; readonly max: number }): number[] {
  const { min, max } = range;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max <= min) return [];
  const out: number[] = [];
  for (let n = min; n <= max; n += 1) out.push(n);
  return out;
}

/**
 * WHAT THE EMPTY CHAIRS COME UP HOLDING. Deliberately NOT a mode — this file's header says
 * "below this line there is no mode, only seats", and that stands: the caller (the lobby, which
 * already owns the mode buttons and the URL) maps its mode to a fill, and everything below reads
 * a fill. Three values because there are three answers, not because there are three modes.
 */
export type SeatFill = 'ai' | 'local' | 'none';

/**
 * THE TABLE A CREATE IS ABOUT TO MAKE — v1's `buildSeats(count)` with the fill folded in
 * (plans/GAME_LAUNCH_MODAL.md §5.1).
 *
 * THE PLAN **IS** THE PREVIEW. The lobby draws this array before the table exists and the create
 * path produces this array, which is the one property worth having here: a preview that disagrees
 * with what gets created is worse than no preview, because it is a promise. v1 got it for free by
 * calling one function from both places; here the two EXECUTIONS genuinely differ — an AI fill is
 * a server field applied inside `store.create`, a local fill is a loop of `claim` calls from the
 * host's own client, and an open table is neither — so the agreement is asserted instead
 * (`tests/room.test.ts`).
 *
 * - `'ai'`    — seat 0 the host, every other chair the house. What "Solo / AI" means: a table you
 *               can press Start on, rather than one that asks for six clicks first.
 * - `'local'` — seat 0 the host, every other chair ANOTHER LOCAL HUMAN on the same screen, under
 *               the host's own uid. Hot-seat: the rules pin the uid to the writer, so a shared
 *               screen is several seats one account holds, and only the display label varies.
 * - `'none'`  — seat 0 the host and the rest open. Today's table, and what an ONLINE table stays
 *               (§5.3): a public table that comes up full starts before anyone can walk up to it.
 *
 * Total, like every function in this file. A non-positive, fractional or NaN `seatCount` cannot
 * seat a host, and the honest answer is NO TABLE (`[]`) rather than a thrown error or a phantom
 * chair — this is fed by a manifest range and a picker, so it is only wrong when something else
 * already went wrong, and a lobby that renders an empty preview beats one that crashes.
 */
export function plannedSeats(args: {
  readonly seatCount: number;
  readonly host: SeatOccupant;
  readonly fill: SeatFill;
}): Seat[] {
  const { seatCount, host, fill } = args;
  // Built through the same `emptyTable` + pure `claimSeat` the create paths use, rather than
  // hand-rolling `{ kind: 'human' }` here — one fewer place that knows what a seated host looks
  // like, and `claimSeat`'s out-of-range answer is what makes the zero-chair case honest.
  const claimed = claimSeat(emptyTable(seatCount), 0, host);
  if (!claimed.ok) return [];
  return claimed.seats.map((seat, i) => {
    if (i === 0 || seat.kind !== 'open') return seat;
    if (fill === 'ai') return { kind: 'ai', name: aiSeatName(i), uid: null };
    if (fill === 'local') return { kind: 'human', name: localSeatName(i), uid: host.uid };
    return seat;
  });
}
