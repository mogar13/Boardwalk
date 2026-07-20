/**
 * THE DEALER — the referee's side of a Liar's Dice table, and the seam between the durable match
 * (`domain/liarsDice.ts`) and the live room (`store.ts`).
 *
 * It owns three things the domain layer deliberately does not: WHEN a bot moves, WHEN a reveal
 * ends, and WHO gets told what. Everything it decides it decides from the match the database
 * holds; nothing it publishes comes from a client.
 *
 * WHY IT NEEDS NO NEW SERVER→CLIENT FRAME. The gateway already broadcasts `room` (public state)
 * and `private` (owner-only, re-authorised on every push). So the dealer writes the projection to
 * room state and each cup to its owner's private node, and both ride paths the client has handled
 * since Phase C. The client learns the dice were rolled the same way it learns anything else.
 * That is why this whole phase adds two client→server frames and zero the other way.
 *
 * THE TIMERS ARE THE ONLY STATE HERE. A bot's turn and the end of a reveal are both "later", and
 * later has to live somewhere. They are unref'd so they never hold the process open, keyed by room
 * so a GC can cancel them, and every one of them RE-READS the match before acting — the table can
 * move under a timer (a player acts, a match settles, a room dies) and a timer that trusted what it
 * captured would publish a state that has already been overtaken.
 */
import {
  GAME_ID,
  advance,
  cupOf,
  liveMatchInRoom,
  playAction,
  playAiTurn,
  seatOf,
  startMatch,
  viewOf,
  type SeatSpec,
} from '../domain/liarsDice';
import type { Db } from '../db/db';
import type { Seat, RoomStatus } from './types';
import type { Action, Face, LiarsDiceMatch } from '@boardwalk/game-logic/games/liars-dice';

/** How long a bot "thinks". Long enough to read as a decision, short enough not to drag. */
const AI_DELAY_MS = 1_100;
/** How long every cup stays open after a call. The one moment the hidden information is public. */
const REVEAL_MS = 4_000;

/** The slice of the room store the dealer needs. Injected so this file never imports the store. */
export interface DealerHost {
  seatsOf(gameId: string, roomId: string): readonly Seat[];
  hostOf(gameId: string, roomId: string): string | null;
  statusOf(gameId: string, roomId: string): RoomStatus | null;
  publish(gameId: string, roomId: string, state: unknown): void;
  deal(gameId: string, roomId: string, index: number, data: unknown): void;
}

export type DealerResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

const key = (gameId: string, roomId: string): string => `${gameId}/${roomId}`;

export class LiarsDiceDealer {
  /** `gameId/roomId` → the pending bot move or reveal step. At most one per room. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly db: Db,
    private readonly host: DealerHost,
    private readonly clock: () => number = Date.now,
    private readonly rng: () => number = Math.random
  ) {}

  /** Is this a table this dealer runs? Every other game still uses `patchState`. */
  private handles(gameId: string): boolean {
    return gameId === GAME_ID;
  }

  // ── the two client entry points ─────────────────────────────────────────────────────────────

  start(uid: string, gameId: string, roomId: string, nonce: string, anteCents: number): DealerResult {
    if (!this.handles(gameId)) return { ok: false, error: 'Not a dealt game.' };
    if (this.host.statusOf(gameId, roomId) !== 'playing') {
      return { ok: false, error: 'The table has not started.' };
    }
    const seats: SeatSpec[] = this.host.seatsOf(gameId, roomId).map((s) => ({
      kind: s.kind,
      uid: s.uid,
    }));

    const res = startMatch(
      this.db,
      uid,
      { nonce, gameId, roomId, seats, anteCents },
      this.clock(),
      this.rng
    );
    if (!res.ok) return { ok: false, error: res.error };

    this.broadcast(gameId, roomId, res.value.match);
    this.schedule(gameId, roomId, res.value.match);
    return { ok: true };
  }

  act(uid: string, gameId: string, roomId: string, nonce: string, action: unknown): DealerResult {
    if (!this.handles(gameId)) return { ok: false, error: 'Not a dealt game.' };
    const parsed = parseAction(action);
    if (parsed === null) return { ok: false, error: 'Bad action.' };

    const row = liveMatchInRoom(this.db, gameId, roomId);
    if (row === undefined) return { ok: false, error: 'No live match.' };
    // The membership check is inside `playAction` too — this one only makes the refusal specific.
    if (seatOf(this.db, row.id, uid) < 0) return { ok: false, error: 'You are not in that match.' };

    const res = playAction(this.db, uid, row.id, nonce, parsed, this.clock());
    if (!res.ok) return { ok: false, error: res.error };

    this.broadcast(gameId, roomId, res.value.match);
    this.schedule(gameId, roomId, res.value.match);
    return { ok: true };
  }

  // ── publishing ──────────────────────────────────────────────────────────────────────────────

  /**
   * Tell the table what it may see, and each player their own cup.
   *
   * The public projection goes to room state; each seat's dice go to that seat's private node,
   * which the gateway re-authorises on every push. AI seats get no private write — there is
   * nobody to read it, and writing one would put a bot's dice somewhere a future bug could serve.
   */
  private broadcast(gameId: string, roomId: string, match: LiarsDiceMatch): void {
    this.host.publish(gameId, roomId, viewOf(match));
    this.host.seatsOf(gameId, roomId).forEach((seat, index) => {
      if (seat.kind !== 'human') return;
      this.host.deal(gameId, roomId, index, cupOf(match, index));
    });
  }

  // ── the clock ───────────────────────────────────────────────────────────────────────────────

  /**
   * Decide what happens next without anyone asking: a bot to move, or a reveal to end.
   *
   * Re-entrant by design — each step schedules the next — so a table of six bots plays itself to a
   * winner with no client involved at all. That is the AI-as-occupant rule with the host taken out
   * of it: UNO needs a host present to drive its bots, and this game does not, so a table where
   * every human has walked away still finishes and still settles.
   */
  private schedule(gameId: string, roomId: string, match: LiarsDiceMatch): void {
    this.cancel(gameId, roomId);
    if (match.winner !== -1) return;

    if (match.phase === 'reveal') return this.later(gameId, roomId, REVEAL_MS, () => {
      const next = advance(this.db, this.matchIdIn(gameId, roomId), this.clock(), this.rng);
      if (next === null) return;
      this.broadcast(gameId, roomId, next);
      this.schedule(gameId, roomId, next);
    });

    const seat = this.host.seatsOf(gameId, roomId)[match.turn];
    if (seat?.kind !== 'ai') return;

    this.later(gameId, roomId, AI_DELAY_MS, () => {
      const next = playAiTurn(this.db, this.matchIdIn(gameId, roomId), this.clock(), this.rng);
      if (next === null) return;
      this.broadcast(gameId, roomId, next);
      this.schedule(gameId, roomId, next);
    });
  }

  /** The live match's id, or -1 — re-read rather than captured, because it can settle under us. */
  private matchIdIn(gameId: string, roomId: string): number {
    return liveMatchInRoom(this.db, gameId, roomId)?.id ?? -1;
  }

  private later(gameId: string, roomId: string, ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(key(gameId, roomId));
      run();
    }, ms);
    timer.unref();
    this.timers.set(key(gameId, roomId), timer);
  }

  /** Cancel a room's pending step. Called on every new step, and by the gateway on GC. */
  cancel(gameId: string, roomId: string): void {
    const timer = this.timers.get(key(gameId, roomId));
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(key(gameId, roomId));
  }

  /**
   * A seat changed hands. If the vacated seat was on turn, the house now owns it and the table
   * must not sit waiting for a player who has gone — the crash-recovery rule, one layer up: a
   * table that stalls forever on a departed player is the bug that whole phase existed to close.
   */
  onSeatsChanged(gameId: string, roomId: string): void {
    if (!this.handles(gameId)) return;
    const row = liveMatchInRoom(this.db, gameId, roomId);
    if (row === undefined) return;
    const match = JSON.parse(row.state_json) as LiarsDiceMatch;
    this.broadcast(gameId, roomId, match);
    this.schedule(gameId, roomId, match);
  }
}

/**
 * Narrow an action off the wire.
 *
 * It refuses anything it does not recognise rather than coercing it, because the reducer is total
 * and would silently no-op on a malformed action — which reads to the player as a click that did
 * nothing rather than an error. The reducer is still the authority on whether the action is LEGAL;
 * this only decides whether it is an action at all.
 */
export function parseAction(raw: unknown): Action | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'challenge') return { type: 'challenge' };
  if (r.type === 'spotOn') return { type: 'spotOn' };
  if (r.type !== 'bid') return null;
  const quantity = r.quantity;
  const face = r.face;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity)) return null;
  if (typeof face !== 'number' || !Number.isInteger(face) || face < 1 || face > 6) return null;
  return { type: 'bid', quantity, face: face as Face };
}
