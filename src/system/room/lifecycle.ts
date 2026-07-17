/**
 * Room teardown, as a PLAN rather than a procedure — pure functions that decide what leaving a
 * room should do, so the decisions become `tests/room.test.ts` cases instead of comments buried
 * in an unmount handler.
 *
 * ARCHITECTURE.md, on v1's room-lifecycle hygiene: "`beforeunload` AND `pagehide`; synchronous
 * teardown before exit; `dbRemove` → `dbSet(null)` fallback; only the host clears remote chat.
 * Every one is a scar. These become tests, not comments." This file is that sentence made
 * executable. It computes WHICH nodes to clear; the hook (`useRoom`) executes the steps and owns
 * the browser-event plumbing (which is not testable here and does not need to be — the decision
 * is the part that was wrong in v1, not the `removeValue` call).
 */

import type { RoomSnapshot } from '@/system/room/types';
import { mySeatIndex } from '@/system/room/seats';

/**
 * One thing leaving should clear. A `target` a step, not a raw path, so the pure planner never
 * has to know Firebase's node layout — the repo turns each into the right `remove`/`set(null)`.
 *
 * - `presence` — drop my presence marker so the room stops showing me as connected.
 * - `seat`     — free the seat I hold (`seatIndex` is which). What it becomes — an AI in a game
 *                in progress, an open chair in the lobby — is the repo's call from `status`,
 *                exactly the `fallback` split `releaseSeat` takes; the plan only says "this seat
 *                is mine and I am leaving it".
 * - `chat`     — clear the room's chat. HOST ONLY (see below).
 * - `room`     — remove the whole room node. HOST ONLY, and only when no one else is left, so a
 *                host leaving an empty lobby does not orphan a dead room forever.
 */
export type TeardownStep =
  | { readonly target: 'presence' }
  | { readonly target: 'seat'; readonly seatIndex: number }
  | { readonly target: 'chat' }
  | { readonly target: 'room' };

/**
 * What THIS client should clear on its way out of a room.
 *
 * ONLY THE HOST CLEARS SHARED STATE. v1's rule ("only the host clears remote chat") exists
 * because a non-host clearing chat or removing the room deletes it out from under everyone still
 * playing — a guest closing their tab must not wipe the host's game. So a guest's plan touches
 * only what is theirs (their presence, their seat); the host additionally clears chat, and
 * removes the room entirely if they are the last one connected.
 *
 * Pure and total: given a snapshot and a uid it returns the step list and reads nothing else, so
 * the "guest doesn't nuke the room" and "host cleans up an empty room" cases are two assertions
 * rather than a bug discovered in production when the wrong person closed a tab.
 */
export function teardownPlan<TPublic>(
  snapshot: RoomSnapshot<TPublic>,
  myUid: string
): TeardownStep[] {
  const steps: TeardownStep[] = [{ target: 'presence' }];

  const isHost = snapshot.meta.host === myUid;
  // Last one out removes the room. "Last" means: no other uid is present. My own presence is about
  // to be cleared, so an otherwise-empty presence map means the room is mine alone to close —
  // leaving it would strand a dead lobby that shows up in nobody's list but sits in the database
  // forever.
  const others = isHost ? Object.keys(snapshot.presence).filter((uid) => uid !== myUid) : [];
  const removingRoom = isHost && others.length === 0;

  const seat = mySeatIndex(snapshot.seats, myUid);
  // Free my seat — UNLESS the whole room is going away, in which case releasing it is not just
  // redundant but actively harmful: `releaseSeat` is a read-then-write, and fired concurrently with
  // the room delete its `set` can land AFTER the delete, re-creating a `seats/<i>` leaf under a room
  // whose `meta` is already gone. Nothing can then remove it — the room delete rule needs
  // `meta.host === auth.uid`, and there is no longer a `meta`. Removing the room frees the seat.
  if (seat !== -1 && !removingRoom) steps.push({ target: 'seat', seatIndex: seat });

  if (isHost) {
    steps.push({ target: 'chat' });
    if (removingRoom) steps.push({ target: 'room' });
  }

  return steps;
}
