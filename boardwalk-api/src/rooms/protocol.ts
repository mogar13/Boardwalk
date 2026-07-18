/**
 * The WebSocket wire protocol (BACKEND_PLAN.md Phase C). JSON frames, each tagged by `t`. This is
 * the contract between this server and the frontend's `src/system/repo/api/socket.ts`; the two are
 * mirror copies kept in sync by hand (a cross-package import is Phase D's workspace refactor), and
 * `tests/gateway.test.ts` is the end that fails if they drift.
 *
 * TWO FRAME FAMILIES:
 *   • REQUEST/REPLY — a mutating op carries a numeric `id`; the server answers exactly one
 *     `res` with the same `id`. That is how a `Promise<void>` or `Promise<RepoResult>` on the repo
 *     resolves — void ops resolve on `ok:true`, `RepoResult` ops carry `value`/`error`.
 *   • SUBSCRIPTIONS — `subscribe`/`subPrivate`/`chatSub`/`presence` register interest and get no
 *     `res`; instead the server pushes `room`/`private`/`chat` frames now and on every change, until
 *     the matching unsubscribe or the socket closes.
 *
 * The very first frame a client sends must be `hello` (the Firebase ID token). The server verifies
 * it, replies `ready`, and only then processes anything else — an unauthenticated socket can do
 * nothing but say hello.
 */

import type { RoomSnapshot, RoomStatus, SeatOccupant, ChatMessage } from './types';

// ── Client → Server ────────────────────────────────────────────────────────────────────────────

export interface HelloMsg {
  t: 'hello';
  token: string;
}

/** A mutating request: always an `id` the reply echoes. */
export type RequestMsg =
  | { t: 'create'; id: number; gameId: string; host: SeatOccupant; seatCount: number }
  | { t: 'claimSeat'; id: number; gameId: string; roomId: string; index: number; who: SeatOccupant }
  | { t: 'releaseSeat'; id: number; gameId: string; roomId: string; index: number; fallback: 'ai' | 'open' }
  | { t: 'setAi'; id: number; gameId: string; roomId: string; index: number; name: string | null }
  | { t: 'patchState'; id: number; gameId: string; roomId: string; data: unknown }
  | { t: 'setStatus'; id: number; gameId: string; roomId: string; status: RoomStatus }
  | { t: 'writePrivate'; id: number; gameId: string; roomId: string; index: number; data: unknown }
  | { t: 'remove'; id: number; gameId: string; roomId: string }
  | { t: 'chatSend'; id: number; gameId: string; roomId: string; message: { uid: string; name: string; text: string } }
  | { t: 'chatClear'; id: number; gameId: string; roomId: string };

/** A subscription/registration: no reply, a stream of push frames instead. */
export type SubscribeMsg =
  | { t: 'subscribe'; gameId: string; roomId: string }
  | { t: 'unsubscribe'; gameId: string; roomId: string }
  | { t: 'subPrivate'; gameId: string; roomId: string; index: number }
  | { t: 'unsubPrivate'; gameId: string; roomId: string; index: number }
  | { t: 'chatSub'; gameId: string; roomId: string; limit: number }
  | { t: 'chatUnsub'; gameId: string; roomId: string }
  | { t: 'presence'; gameId: string; roomId: string }
  | { t: 'unpresence'; gameId: string; roomId: string };

export type ClientMsg = HelloMsg | RequestMsg | SubscribeMsg;

// ── Server → Client ────────────────────────────────────────────────────────────────────────────

export type ServerMsg =
  | { t: 'ready' }
  | { t: 'denied'; error: string }
  | { t: 'res'; id: number; ok: true; value?: unknown }
  | { t: 'res'; id: number; ok: false; error: string }
  | { t: 'room'; gameId: string; roomId: string; snapshot: RoomSnapshot | null }
  | { t: 'private'; gameId: string; roomId: string; index: number; data: unknown | null }
  | { t: 'chat'; gameId: string; roomId: string; messages: readonly ChatMessage[] };
