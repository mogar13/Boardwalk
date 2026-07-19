import { TICKET_BATCH, TICKET_LOW } from '@boardwalk/game-logic';
import type { EconomyIntent } from '@/system/repo/types';

/**
 * THE OFFLINE BANKING QUEUE — pure logic, no storage, no clock, no fetch.
 *
 * Phase B's locked decision (2026-07-17) is that offline wins are RANKED and sync on reconnect —
 * real mobile play through a tunnel or an outage. That was never built: until this commit a failed
 * economy write reverted its optimistic profile, toasted "check your connection", and DROPPED the
 * intent, nonce and all. So the result was lost, and a "retry" would have minted a fresh nonce and
 * defeated the server's idempotency anyway.
 *
 * Building the queue is what would open the replay hole, so the bound arrives with it: every queued
 * result carries a SERVER-SIGNED ticket (see `boardwalk-api/src/domain/tickets.ts`), spent at the
 * moment the game finished. A client cannot bank more results than it holds tickets for.
 *
 * WHY THE TICKET IS SPENT AT THE EVENT AND NOT AT FLUSH. The obvious-looking design — queue results
 * now, attach tickets when the connection returns — reduces to client-minted nonces with extra
 * steps: at flush time the server cannot tell 64 honest results from 6,400 fabricated ones. Spending
 * at the event is precisely what makes the ticket count the bound.
 *
 * ONLY `settle` IS QUEUEABLE, and the omissions are the design, the same way they are on the
 * intents themselves. A `bet` is bounded by the ledger balance, a `purchase` and a `pack` by the
 * server's price and the server's roll, a `daily` by the server's clock — none of them can be
 * decided offline, and queuing `daily` in particular would reintroduce the client clock as an input
 * by the back door. Blackjack is structurally online because the server holds the cards. What is
 * left is exactly the locked decision's content: offline WINS are ranked.
 */

/** The only intent that may be banked offline. Narrowed from `EconomyIntent` by construction. */
export type SettleIntent = Extract<EconomyIntent, { kind: 'settle' }>;

export interface QueuedSettle {
  readonly intent: SettleIntent;
  /** When the client banked it. Diagnostic only — the server never reads a client clock. */
  readonly stampedAt: number;
}

export interface OfflineState {
  /**
   * This browser's ticket namespace. Random, client-generated, persisted, and NOT a credential:
   * there is no attestation anywhere in this design and a client may claim to be as many devices as
   * it likes. The server's cap is per-ACCOUNT for exactly that reason, so inventing devices divides
   * the budget rather than multiplying it.
   */
  readonly deviceId: string;
  /**
   * Does this server require tickets? `null` until the first `/tickets` answer.
   *
   * Three states, not two, because "we have not asked yet" is genuinely different from "not
   * required": a client that assumed `false` before asking would mint its own nonce for the first
   * settle after every sign-in and eat a 409 on a server that does enforce.
   */
  readonly enabled: boolean | null;
  /** Unspent tickets, in issue order. Opaque strings — the client never looks inside one. */
  readonly tickets: readonly string[];
  /** Results banked but not yet accepted by the server, oldest first. */
  readonly queue: readonly QueuedSettle[];
}

export const emptyOffline = (deviceId: string): OfflineState => ({
  deviceId,
  enabled: null,
  tickets: [],
  queue: [],
});

/**
 * The outbox ceiling. Equal to `TICKET_BATCH` and deliberately the SAME constant rather than a
 * second number: every queued entry has already spent a ticket, so the queue can never outgrow the
 * batch on its own. This is a backstop against a bug, not a second policy — two constants here
 * would be two things that could disagree about one bound.
 */
export const OUTBOX_CAP = TICKET_BATCH;

/**
 * Spend a ticket. Returns `null` when the store is empty, which is the honest answer and the whole
 * bound: an exhausted client STOPS BANKING rather than minting its own nonce. It keeps playing —
 * the four queueable games are entirely local — but results past this point are not ranked.
 */
export function takeTicket(state: OfflineState): { state: OfflineState; ticket: string } | null {
  const [ticket, ...rest] = state.tickets;
  if (ticket === undefined) return null;
  return { state: { ...state, tickets: rest }, ticket };
}

/** Top up before the store is empty, so a refill is never on the critical path of a finished game. */
export const needsTopUp = (state: OfflineState): boolean =>
  state.enabled !== false && state.tickets.length < TICKET_LOW;

/** How many more the server could grant. Never asks for more than the cap could ever hold. */
export const topUpWant = (state: OfflineState): number =>
  Math.max(0, TICKET_BATCH - state.tickets.length);

export function addTickets(state: OfflineState, tickets: readonly string[]): OfflineState {
  return { ...state, tickets: [...state.tickets, ...tickets].slice(0, TICKET_BATCH) };
}

/**
 * Bank a result. Drops the OLDEST on overflow, which is the right direction if it ever happens: the
 * newest results are the ones the player just earned and is watching, and an entry old enough to be
 * evicted has already survived a full batch of failures.
 */
export function enqueue(state: OfflineState, entry: QueuedSettle): OfflineState {
  const queue = [...state.queue, entry];
  return { ...state, queue: queue.slice(Math.max(0, queue.length - OUTBOX_CAP)) };
}

/** Remove an entry by its nonce — the ticket is the identity, so this is exact. */
export function resolve(state: OfflineState, nonce: string): OfflineState {
  return { ...state, queue: state.queue.filter((e) => e.intent.nonce !== nonce) };
}

/**
 * Re-stamp a queued entry with a fresh ticket. The ONLY place a queued nonce ever changes.
 *
 * Sound for exactly one refusal — a ticket signed with a key that has been rotated all the way out
 * — and sound only because that refusal happens at the gate, BEFORE the mutation's transaction, so
 * the old ticket is provably unspent. A ticket that was ACCEPTED is never re-stamped: that would
 * turn one banked result into two, which is the double-pay bug this whole subsystem exists to
 * prevent. Returns `null` when there is no ticket to re-stamp with, and the caller drops the entry
 * rather than retrying forever.
 */
export function restamp(
  state: OfflineState,
  nonce: string
): { state: OfflineState; intent: SettleIntent } | null {
  const entry = state.queue.find((e) => e.intent.nonce === nonce);
  if (entry === undefined) return null;
  const taken = takeTicket(state);
  if (taken === null) return null;

  const intent: SettleIntent = { ...entry.intent, nonce: taken.ticket };
  return {
    state: {
      ...taken.state,
      queue: taken.state.queue.map((e) => (e.intent.nonce === nonce ? { ...e, intent } : e)),
    },
    intent,
  };
}

/* ----------------------------------------------------------------- persistence */

export const OFFLINE_STORAGE_KEY = 'boardwalk.offline.v1';

/**
 * Parse persisted state, defensively. Anything unrecognised degrades to empty rather than throwing:
 * this runs at module load on data a user can edit, and the failure mode of a throw here is an app
 * that will not boot until someone clears their storage.
 *
 * Note what is NOT validated: the ticket strings. They are opaque to the client and the SERVER
 * decides whether one is real — validating a shape here would be the client double-guessing an
 * authority it is about to ask anyway.
 */
export function parseOffline(raw: string | null, fallbackDeviceId: string): OfflineState {
  if (raw === null) return emptyOffline(fallbackDeviceId);
  try {
    const v = JSON.parse(raw) as Partial<OfflineState>;
    const deviceId =
      typeof v.deviceId === 'string' && v.deviceId !== '' ? v.deviceId : fallbackDeviceId;
    const tickets = Array.isArray(v.tickets)
      ? v.tickets.filter((t): t is string => typeof t === 'string').slice(0, TICKET_BATCH)
      : [];
    const queue = Array.isArray(v.queue) ? v.queue.filter(isQueuedSettle).slice(-OUTBOX_CAP) : [];
    return { deviceId, enabled: typeof v.enabled === 'boolean' ? v.enabled : null, tickets, queue };
  } catch {
    return emptyOffline(fallbackDeviceId);
  }
}

function isQueuedSettle(v: unknown): v is QueuedSettle {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as { intent?: unknown; stampedAt?: unknown };
  if (typeof e.stampedAt !== 'number' || !Number.isFinite(e.stampedAt)) return false;
  if (typeof e.intent !== 'object' || e.intent === null) return false;
  const i = e.intent as Record<string, unknown>;
  return (
    i.kind === 'settle' &&
    typeof i.nonce === 'string' &&
    i.nonce !== '' &&
    typeof i.gameId === 'string' &&
    (i.outcome === 'win' || i.outcome === 'loss' || i.outcome === 'push') &&
    typeof i.payoutCents === 'number'
  );
}

export const serializeOffline = (state: OfflineState): string => JSON.stringify(state);
