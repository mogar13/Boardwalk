/**
 * THE UNO DEALER — the referee's side of an UNO table, and the seam between the durable round
 * (`domain/uno.ts`) and the live room (`store.ts`).
 *
 * It is `liarsDiceDealer.ts` with one thing added and one thing taken away, and both are UNO's.
 *
 * ADDED: THE ANTE COMES OFF THE ROOM. `ldStart` carries `anteCents` from the client; `unoStart` has
 * no such field, because the stake is a property of the TABLE that every joiner agreed to when they
 * sat down (`RoomMeta.anteCents`, stamped at create). A client that names its own stake can name a
 * large one — a hostile host charging a table $1M for a game it joined at $25 plays a game that is
 * perfectly FAIR and at stakes nobody consented to. Reading it from the room makes that unspellable
 * rather than validated.
 *
 * TAKEN AWAY: THERE IS NO INTENT/ACK LANE. Under host-as-dealer a non-host wrote a `pending` move
 * into shared state and waited to be acknowledged, because only the host could apply it. A move is
 * now a message to the referee, so `PendingMove`/`submitMove` are gone from the rulebook entirely
 * rather than left as a second road into the same state.
 *
 * WHY IT NEEDS NO NEW SERVER→CLIENT FRAME. The gateway already broadcasts `room` (public state) and
 * `private` (owner-only, re-authorised on every push). The dealer writes the projection to room
 * state and each hand to its owner's private node, and both ride paths the client has handled since
 * Phase C. So this whole phase adds two client→server frames and zero the other way — the same
 * result Liar's Dice got, and the reason the client transport is untouched.
 *
 * THE TIMERS ARE THE ONLY STATE HERE. A bot's turn is "later", and later has to live somewhere.
 * They are unref'd so they never hold the process open, keyed by room so a GC can cancel them, and
 * every one RE-READS the match before acting — the table can move under a timer (a player acts, a
 * round settles, a room dies) and a timer that trusted what it captured would publish a state that
 * has already been overtaken.
 */
import {
  GAME_ID,
  handOf,
  liveMatchInRoom,
  playAiTurn,
  playMove,
  seatOf,
  startMatch,
  viewOf,
  type MoveOk,
  type SeatSpec,
  type StartOk,
} from '../domain/uno';
import type { Db } from '../db/db';
import { loadProfile } from '../domain/profile';
import type { Profile } from '../domain/types';
import type { Seat, RoomStatus, TableRules } from './types';
import { roundOver, type Move, type UnoLevel } from '@boardwalk/game-logic/games/uno';

/** How long a bot "thinks". Matches what the client dealer used, so the table's rhythm is unchanged. */
const AI_DELAY_MS = 900;

/** The slice of the room store the dealer needs. Injected so this file never imports the store. */
export interface UnoDealerHost {
  seatsOf(gameId: string, roomId: string): readonly Seat[];
  hostOf(gameId: string, roomId: string): string | null;
  statusOf(gameId: string, roomId: string): RoomStatus | null;
  /** The table's stake, stamped at create. The dealer reads it here and never off a frame. */
  anteOf(gameId: string, roomId: string): number;
  /**
   * The table's house rules, stamped at create. Read here for the ante's exact reason: whoever
   * presses Deal does not get to choose what game everybody else sat down to, so `unoStart` has no
   * field for one either.
   */
  rulesOf(gameId: string, roomId: string): TableRules;
  publish(gameId: string, roomId: string, state: unknown): void;
  deal(gameId: string, roomId: string, index: number, data: unknown): void;
}

/**
 * A dealer reply carries the caller's AUTHORITATIVE PROFILE, for blackjack's reason and Liar's
 * Dice's evidence: the game state arrives over the room subscription, but the PROFILE does not, and
 * `unoStart` moves money (every human's ante) while a settling move moves more of it. Liar's Dice
 * answered `void` at first on the "it arrives on the subscription anyway" argument, and the browser
 * showed the hole immediately — two accounts anted, the ledger recorded both, and both top bars went
 * on saying $5,000.
 */
export type DealerResult =
  | { readonly ok: true; readonly profile: Profile | null }
  | { readonly ok: false; readonly error: string };

const key = (gameId: string, roomId: string): string => `${gameId}/${roomId}`;

export class UnoDealer {
  /** `gameId/roomId` → the pending bot move. At most one per room. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly db: Db,
    private readonly host: UnoDealerHost,
    private readonly clock: () => number = Date.now,
    private readonly rng: () => number = Math.random
  ) {}

  /** Is this a table this dealer runs? Every other game still uses `patchState`. */
  private handles(gameId: string): boolean {
    return gameId === GAME_ID;
  }

  // ── the two client entry points ─────────────────────────────────────────────────────────────

  /**
   * Deal a round: roll the deck, take every human's ante, hand out the cards.
   *
   * Called by the HOST only — once when the table starts, and once per rematch. It is idempotent
   * through the nonce, so a double-fire is a replay rather than a second round and a second ante.
   */
  start(uid: string, gameId: string, roomId: string, nonce: string, level: unknown): DealerResult {
    if (!this.handles(gameId)) return { ok: false, error: 'Not a dealt game.' };
    if (this.host.statusOf(gameId, roomId) !== 'playing') {
      return { ok: false, error: 'The table has not started.' };
    }
    if (this.host.hostOf(gameId, roomId) !== uid) {
      return { ok: false, error: 'Only the host deals.' };
    }
    const seats: SeatSpec[] = this.host
      .seatsOf(gameId, roomId)
      .map((s) => ({ kind: s.kind, uid: s.uid }));

    const res = startMatch(
      this.db,
      uid,
      {
        nonce,
        gameId,
        roomId,
        seats,
        // THE STAKE COMES FROM THE ROOM. Not from the frame — there is no such field.
        anteCents: this.host.anteOf(gameId, roomId),
        // AND SO DO THE RULES, for the same reason and from the same place.
        houseRules: this.host.rulesOf(gameId, roomId),
        level: parseLevel(level),
      },
      this.clock(),
      this.rng
    );
    if (!res.ok) return { ok: false, error: res.error };

    this.broadcast(gameId, roomId, res.value);
    this.schedule(gameId, roomId, res.value);
    return { ok: true, profile: loadProfile(this.db, uid) };
  }

  /** Play a card or draw one. Every seated human's moves take this road, the host's included. */
  act(uid: string, gameId: string, roomId: string, nonce: string, move: unknown): DealerResult {
    if (!this.handles(gameId)) return { ok: false, error: 'Not a dealt game.' };
    const parsed = parseMove(move);
    if (parsed === null) return { ok: false, error: 'Bad move.' };

    const row = liveMatchInRoom(this.db, gameId, roomId);
    if (row === undefined) return { ok: false, error: 'No live round.' };
    // The membership check is inside `playMove` too — this one only makes the refusal specific.
    if (seatOf(this.db, row.id, uid) < 0) return { ok: false, error: 'You are not in that round.' };

    const res = playMove(this.db, uid, row.id, nonce, parsed, this.clock(), this.rng);
    if (!res.ok) return { ok: false, error: res.error };

    this.broadcast(gameId, roomId, res.value);
    this.schedule(gameId, roomId, res.value);
    return { ok: true, profile: loadProfile(this.db, uid) };
  }

  // ── publishing ──────────────────────────────────────────────────────────────────────────────

  /**
   * Tell the table what it may see, and each player their own hand.
   *
   * The public projection goes to room state; each seat's cards go to that seat's private node,
   * which the gateway re-authorises on every push. AI seats get no private write — there is nobody
   * to read it, and writing one would put a bot's hand somewhere a future bug could serve. The DECK
   * is written nowhere at all, which is strictly more private than v1, whose deck was public.
   */
  private broadcast(gameId: string, roomId: string, result: StartOk | MoveOk): void {
    this.host.publish(gameId, roomId, viewOf(result.match, result.row));
    this.host.seatsOf(gameId, roomId).forEach((seat, index) => {
      if (seat.kind !== 'human') return;
      this.host.deal(gameId, roomId, index, handOf(result.match, index));
    });
  }

  // ── the clock ───────────────────────────────────────────────────────────────────────────────

  /**
   * Decide what happens next without anyone asking: a bot to move.
   *
   * Re-entrant by design — each step schedules the next — so a table of six bots plays itself to a
   * winner with no client involved. That is the AI-as-occupant rule with the host taken out of it:
   * the client dealer needed a host PRESENT to drive its bots, so a host closing their tab stalled
   * the table. Here a table every human has walked away from still finishes and still settles.
   */
  private schedule(gameId: string, roomId: string, result: StartOk | MoveOk): void {
    this.cancel(gameId, roomId);
    // `roundOver`, not "somebody went out": playing for places the table keeps going after 1st, and
    // a timer that stopped there would leave every remaining bot seat waiting for a move nobody can
    // make — the stall this whole file exists to prevent, arriving through the front door.
    if (roundOver(result.match.game)) return;

    const seat = this.host.seatsOf(gameId, roomId)[result.match.game.turn];
    if (seat?.kind !== 'ai') return;

    this.later(gameId, roomId, AI_DELAY_MS, () => {
      const next = playAiTurn(this.db, this.matchIdIn(gameId, roomId), this.clock(), this.rng);
      if (next === null) return;
      this.broadcast(gameId, roomId, next);
      this.schedule(gameId, roomId, next);
    });
  }

  /** The live round's id, or -1 — re-read rather than captured, because it can settle under us. */
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
   * A seat changed hands. If the vacated seat was on turn, the house now owns it and the table must
   * not sit waiting for a player who has gone — the crash-recovery rule, one layer up. It also
   * re-deals the hands, so a player who took over a departed seat receives the cards that seat
   * holds instead of an empty node.
   */
  onSeatsChanged(gameId: string, roomId: string): void {
    if (!this.handles(gameId)) return;
    const row = liveMatchInRoom(this.db, gameId, roomId);
    if (row === undefined) return;
    const result: MoveOk = {
      matchId: row.id,
      match: JSON.parse(row.state_json) as MoveOk['match'],
      row,
      replayed: false,
    };
    this.broadcast(gameId, roomId, result);
    this.schedule(gameId, roomId, result);
  }
}

/**
 * Narrow a move off the wire.
 *
 * It REFUSES anything it does not recognise rather than coercing it, because the reducer is total
 * and would silently no-op on a malformed move — which reads to the player as a click that did
 * nothing rather than an error. The reducer is still the authority on whether the move is LEGAL;
 * this only decides whether it is a move at all.
 *
 * Note what it drops: every field it does not name. A frame carrying `payoutCents`, an `outcome` or
 * a `card` it does not hold reaches the reducer as a plain `{type:'play', cardId}` — hostile extras
 * are not validated and rejected, they simply have nowhere to go.
 */
export function parseMove(raw: unknown): Move | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'draw') return { type: 'draw' };
  if (r.type !== 'play') return null;
  if (typeof r.cardId !== 'string' || r.cardId === '') return null;
  const color = r.chosenColor;
  const move: Move = {
    type: 'play',
    cardId: r.cardId,
    declareUno: r.declareUno === true,
    ...(color === 'red' || color === 'yellow' || color === 'green' || color === 'blue'
      ? { chosenColor: color }
      : {}),
  };
  return move;
}

/** A difficulty off the wire. Anything unrecognised is the level the game shipped with. */
export function parseLevel(raw: unknown): UnoLevel {
  return raw === 'casual' ? 'casual' : 'sharp';
}

