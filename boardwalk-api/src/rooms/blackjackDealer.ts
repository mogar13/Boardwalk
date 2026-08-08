/**
 * THE BLACKJACK TABLE'S DEALER — the referee's side of a multi-seat blackjack room, and the seam
 * between the durable round (`domain/blackjackTable.ts`) and the live room (`store.ts`).
 *
 * It is `unoDealer.ts` with one thing taken away and one thing changed shape.
 *
 * TAKEN AWAY: THERE IS NO PRIVATE WRITE. UNO's dealer publishes a projection AND deals each hand to
 * its owner's private node. Every blackjack hand is face up, so `broadcast` here is one line — the
 * projection — and no seat ever receives anything nobody else received. The hidden information
 * (the deck, the hole card) does not go to a seat at all; it stays in `state_json`.
 *
 * CHANGED SHAPE: A BOT OWES AN ACTION IN THREE PHASES, not on a turn. UNO schedules when
 * `game.turn` lands on an AI chair. Here a bot may owe a bet (before anyone is dealt), an insurance
 * answer (which every chair gives at once), or a play (on turn) — so the schedule reads
 * `pendingSeats` from the rulebook rather than a single turn index. That is one function with three
 * readers rather than three ideas of whose move it is, and it is why the reducer exports it.
 *
 * THE TIMERS ARE THE ONLY STATE HERE, exactly as in the two dealers beside it: unref'd so they never
 * hold the process open, keyed by room so a GC can cancel them, and every one RE-READS the round
 * before acting, because the table can move under a timer.
 */
import {
  chooseAiMove,
  type TableMove,
} from '@boardwalk/game-logic/games/blackjack';
import {
  GAME_ID,
  liveRoundInRoom,
  openTableRound,
  pendingSeats,
  playAction,
  playAiTurn,
  roundOver,
  seatOf,
  viewOf,
  type RoundOk,
  type SeatSpec,
} from '../domain/blackjackTable';
import type { Db } from '../db/db';
import { loadProfile } from '../domain/profile';
import type { Profile } from '../domain/types';
import { AI_DELAY_MS } from './aiPace';
import type { Seat, RoomStatus } from './types';

/** The slice of the room store the dealer needs. Injected so this file never imports the store. */
export interface BlackjackDealerHost {
  seatsOf(gameId: string, roomId: string): readonly Seat[];
  hostOf(gameId: string, roomId: string): string | null;
  statusOf(gameId: string, roomId: string): RoomStatus | null;
  publish(gameId: string, roomId: string, state: unknown): void;
}

/**
 * A dealer reply carries the caller's AUTHORITATIVE PROFILE, for the reason Liar's Dice learned in a
 * browser: the game state arrives on the room subscription, but the PROFILE does not — and here
 * every `bet`, every `double` and every `insure` moves money, while a settling move moves more of it.
 */
export type DealerResult =
  | { readonly ok: true; readonly profile: Profile | null }
  | { readonly ok: false; readonly error: string };

const key = (gameId: string, roomId: string): string => `${gameId}/${roomId}`;

export class BlackjackTableDealer {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly db: Db,
    private readonly host: BlackjackDealerHost,
    private readonly clock: () => number = Date.now,
    private readonly rng: () => number = Math.random
  ) {}

  /** Is this a table this dealer runs? The SOLO game shares this id and does not come through here
   *  at all — it is `POST /blackjack/deal`, a room-less route with no seats and no gateway. */
  private handles(gameId: string): boolean {
    return gameId === GAME_ID;
  }

  // ── the two client entry points ─────────────────────────────────────────────────────────────

  /**
   * Open a round: seat everybody and wait for stakes.
   *
   * Called by the HOST only — once when the table starts, and once per rematch. Idempotent through
   * the nonce, so a double-fire is a replay rather than a second round. **It takes no money**, which
   * is what makes it different from `unoStart`: a blackjack stake is per chair and arrives later, as
   * a `bet` from the player whose chair it is.
   */
  start(uid: string, gameId: string, roomId: string, nonce: string): DealerResult {
    if (!this.handles(gameId)) return { ok: false, error: 'Not a dealt game.' };
    if (this.host.statusOf(gameId, roomId) !== 'playing') {
      return { ok: false, error: 'The table has not started.' };
    }
    if (this.host.hostOf(gameId, roomId) !== uid) {
      return { ok: false, error: 'Only the host opens a round.' };
    }
    const seats: SeatSpec[] = this.host
      .seatsOf(gameId, roomId)
      .map((s) => ({ kind: s.kind, uid: s.uid }));

    const res = openTableRound(this.db, uid, { nonce, gameId, roomId, seats }, this.clock());
    if (!res.ok) return { ok: false, error: res.error };

    this.broadcast(gameId, roomId, res.value);
    this.schedule(gameId, roomId, res.value);
    return { ok: true, profile: loadProfile(this.db, uid) };
  }

  /** Bet, hit, stand, double, insure or decline. Every seated human's moves take this road. */
  act(uid: string, gameId: string, roomId: string, nonce: string, move: unknown): DealerResult {
    if (!this.handles(gameId)) return { ok: false, error: 'Not a dealt game.' };
    const parsed = parseTableMove(move);
    if (parsed === null) return { ok: false, error: 'Bad move.' };

    const row = liveRoundInRoom(this.db, gameId, roomId);
    if (row === undefined) return { ok: false, error: 'No live round.' };
    // The membership check is inside `playAction` too — this one only makes the refusal specific.
    if (seatOf(this.db, row.id, uid) < 0) return { ok: false, error: 'You are not in that round.' };

    const res = playAction(this.db, uid, row.id, nonce, parsed, this.clock(), this.rng);
    if (!res.ok) return { ok: false, error: res.error };

    this.broadcast(gameId, roomId, res.value);
    this.schedule(gameId, roomId, res.value);
    return { ok: true, profile: loadProfile(this.db, uid) };
  }

  // ── publishing ──────────────────────────────────────────────────────────────────────────────

  /**
   * Tell the table what it may see — and that is the whole of it.
   *
   * ONE LINE, WHERE UNO'S IS SEVEN. There is no per-seat deal because there is nothing per-seat to
   * deal: every chair's cards are public, and the deck and the hole card go to nobody. That makes
   * this the first dealt game where "did we leak a hand" is not a question about the transport at
   * all — `toPublic` has no field for the deck, so there is nothing here to get wrong.
   */
  private broadcast(gameId: string, roomId: string, result: RoundOk): void {
    this.host.publish(gameId, roomId, viewOf(result.table));
  }

  // ── the clock ───────────────────────────────────────────────────────────────────────────────

  /**
   * Decide what happens next without anyone asking: a bot to bet, answer or play.
   *
   * `pendingSeats` and not `turn`, because a bot owes an action in three different phases and only
   * one of them is a turn. Reading the rulebook's own answer is what stops this file inventing a
   * fourth idea of whose move it is — the failure would be silent, since a table waiting on a bot
   * that is never scheduled looks exactly like a table that is thinking.
   *
   * Re-entrant by design, so a table every human has walked away from still finishes and still
   * settles the hands they paid for.
   */
  private schedule(gameId: string, roomId: string, result: RoundOk): void {
    this.cancel(gameId, roomId);
    if (roundOver(result.table)) return;

    const seats = this.host.seatsOf(gameId, roomId);
    // The FIRST pending chair the house is sitting in. A human's chair in the same list is simply
    // skipped: the table waits for them, which is the same wait an off-turn UNO table makes and is
    // bounded by the crash-recovery grace that hands an abandoned chair to a bot.
    const seat = pendingSeats(result.table).find((index) => seats[index]?.kind === 'ai');
    if (seat === undefined) return;

    this.later(gameId, roomId, AI_DELAY_MS, () => {
      const row = liveRoundInRoom(this.db, gameId, roomId);
      if (row === undefined) return;
      const table = JSON.parse(row.state_json) as Parameters<typeof chooseAiMove>[0];
      // Re-read and re-decide: the chair may have been taken, the round may have settled, and a
      // move chosen against the table as it was is a move the reducer will now refuse.
      const pending = pendingSeats(table);
      if (!pending.includes(seat)) return;
      const next = playAiTurn(
        this.db,
        row.id,
        seat,
        chooseAiMove(table, seat),
        this.clock(),
        this.rng
      );
      if (next === null) return;
      this.broadcast(gameId, roomId, next);
      this.schedule(gameId, roomId, next);
    });
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
   * A seat changed hands. If the vacated chair owed the table a bet or a move, the house now owns it
   * and the table must not sit waiting for a player who has gone — the crash-recovery rule, one
   * layer up. It matters more here than at UNO: a chair that never bets holds the DEAL up for
   * everybody, not merely its own turn.
   */
  onSeatsChanged(gameId: string, roomId: string): void {
    if (!this.handles(gameId)) return;
    const row = liveRoundInRoom(this.db, gameId, roomId);
    if (row === undefined) return;
    const result: RoundOk = {
      roundId: row.id,
      table: JSON.parse(row.state_json) as RoundOk['table'],
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
 * It REFUSES anything it does not recognise rather than coercing it, for `parseMove`'s reason: the
 * reducer is total and would silently no-op on a malformed move, which reads to the player as a
 * click that did nothing rather than an error.
 *
 * Note what it drops: every field it does not name. A frame carrying a `card`, an `outcome` or a
 * `payoutCents` reaches the reducer as a plain `{type:'stand'}` — hostile extras are not validated
 * and rejected, they simply have nowhere to go. The ONE number it does read is a stake, which is a
 * decision about how much to risk rather than a claim about a result, and it is bounded by
 * `checkBet` against the ledger before a card is dealt.
 */
export function parseTableMove(raw: unknown): TableMove | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'hit') return { type: 'hit' };
  if (r.type === 'stand') return { type: 'stand' };
  if (r.type === 'double') return { type: 'double' };
  if (r.type === 'insure') return { type: 'insure' };
  if (r.type === 'decline') return { type: 'decline' };
  if (r.type !== 'bet') return null;
  const cents = r.wagerCents;
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0) return null;
  return { type: 'bet', wagerCents: cents };
}
