/**
 * State ordering, as pure functions. The rule this file enforces is one sentence long and it
 * is the most expensive sentence in v1's multiplayer:
 *
 *   NEVER ORDER STATE BY WALL-CLOCK TIME.
 *
 * v1's UNO left the comment after paying for it: "Wall-clock timestamps are NOT comparable
 * across machines (clock skew silently dropped opponents' moves)." Two clients a few hundred
 * milliseconds apart on their system clocks would each stamp a move, the later-stamped move
 * would sometimes carry the EARLIER wall-clock, and the "newest wins" reconcile would drop a
 * real move on the floor — invisibly, because nothing errored. UNO's fix was a monotonic
 * `stateSeq` the OS now owns for every game (ARCHITECTURE.md), so no game has to rediscover it.
 *
 * `seq` is a plain counter, incremented once per accepted write. It is comparable across
 * machines precisely because it is NOT a clock: it has no relationship to time, only to
 * how many writes have been accepted, and `database.rules.json` refuses a write that does not
 * increase it (so a buggy or malicious client cannot rewind the room).
 */

/** The seq a new write should carry: one past the current. The only way seq ever moves. */
export function nextSeq(current: number): number {
  return current + 1;
}

/**
 * Is `incoming` state newer than what we have already applied? STRICTLY greater — an equal seq
 * is the same write arriving twice (RTDB re-delivers on reconnect), and applying it again is at
 * best wasted work and at worst a double-count if a reducer is not idempotent. Older-or-equal is
 * dropped; only strictly-newer is fresh.
 */
export function isFresh(incomingSeq: number, appliedSeq: number): boolean {
  return incomingSeq > appliedSeq;
}

/**
 * The reconcile primitive: keep the current value unless the incoming one is genuinely newer. This
 * is what makes out-of-order delivery harmless — a late packet carrying seq 4 cannot clobber the
 * seq 5 we already showed, so the screen never flickers backwards to a state the player has already
 * moved past.
 *
 * Today the live subscription does not call this: a single `onValue` listener (RoomProvider) is
 * delivered value events in order by RTDB, and the server `seq` rule refuses a rewind at the source,
 * so a stale snapshot never reaches the client to be dropped. This is the client-side belt for the
 * day state arrives from more than one listener (BACKEND_PLAN.md's WebSocket path) — proven now,
 * against a shuffled delivery order, so it is correct before it is load-bearing.
 *
 * Pure and total: it decides between two values it is handed and touches nothing else.
 */
export function applyIfFresh<T>(
  current: { readonly value: T; readonly seq: number },
  incoming: { readonly value: T; readonly seq: number }
): { readonly value: T; readonly seq: number } {
  return isFresh(incoming.seq, current.seq) ? incoming : current;
}
