/**
 * The room gateway (BACKEND_PLAN.md Phase C). The transport-and-authorization layer over `RoomStore`:
 * it verifies the socket's identity once, enforces WHO may do WHAT (the half the store deliberately
 * omits), applies the mutation, and fans the result out to every subscriber. `useRoom`/`useChat` and
 * every game are untouched — this file plus the frontend `api/roomRepo`/`chatRepo` are the whole of
 * "rooms moved off RTDB".
 *
 * THE AUTHORIZATION RULES, one per RTDB rule it replaces:
 *   • A socket does nothing until it says `hello` with a valid Firebase ID token (identity stays in
 *     Firebase Auth — BACKEND_PLAN.md is emphatic). The verified uid is the ONLY identity trusted.
 *   • A claim/create/chat carrying a uid ≠ the socket's is refused — a forged author or seat-grab
 *     dies here (v1's chat trusted a client-asserted author; the rules pinned it; now the server does).
 *   • `setStatus`/`remove`/`chatClear` are host-only. `writePrivate` is host-or-owner (the dealer
 *     deals). `subPrivate` only ever delivers a seat's hand to that seat's owner — hidden information
 *     is enforced by never SENDING it, not by a UI that hides it.
 *
 * THE DISCONNECT SAFETY NET closes the crash-recovery gap RTDB left (memory: only presence was
 * reaped on an abrupt close). When a socket drops, the server itself releases the uid's seats
 * (→ AI mid-game so the table survives, → open in the lobby), clears presence, and GCs a room once
 * nobody is left — no client code has to run for a crashed tab to be cleaned up.
 *
 * THE GRACE PERIOD is the other half of that, and it exists because the safety net used to fire too
 * eagerly: a three-second network blip closed the socket, handed your seat to a bot, and the
 * reconnect — which replays subscriptions and presence but has never re-claimed a seat — left you
 * watching the house play your hand. So a seat is not released ON close; it is SCHEDULED, and
 * declaring presence again cancels it. A crash waits out the window and becomes an AI; a blip
 * resumes and the bot never existed. See plans/done/CRASH_RECOVERY.md.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { TokenVerifier } from '../auth/verify';
import { RoomStore } from './store';
import { seatsHeldBy } from './seats';
import type { ClientMsg, ServerMsg } from './protocol';
import { decodeFrame } from './protocol';
import type { RoomStatus, SeatOccupant } from './types';

/** Per-connection state — its identity and everything it is currently subscribed to. */
interface Conn {
  readonly ws: WebSocket;
  uid: string | null;
  readonly rooms: Set<string>; // roomKey → subscribed to the public room
  readonly privates: Set<string>; // 'gameId/roomId/index' → subscribed to a private hand
  readonly chats: Map<string, number>; // roomKey → chat limit
  readonly presence: Set<string>; // roomKey → declared present
}

const roomKey = (gameId: string, roomId: string): string => `${gameId}/${roomId}`;
const privKey = (gameId: string, roomId: string, index: number): string =>
  `${gameId}/${roomId}/${String(index)}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const asIndex = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : -1;
const asOccupant = (v: unknown): SeatOccupant | null =>
  isRecord(v) && typeof v.uid === 'string' && typeof v.name === 'string'
    ? { uid: v.uid, name: v.name }
    : null;
const asStatus = (v: unknown): RoomStatus | null =>
  v === 'waiting' || v === 'playing' || v === 'finished' ? v : null;

/**
 * How long a dropped socket keeps its seats before the house takes over. Long enough to ride out a
 * blip and a reconnect (the socket's own backoff caps well inside it), short enough that a table
 * waiting on a genuinely crashed player is not stuck for a noticeable stretch.
 */
export const DEFAULT_GRACE_MS = 20_000;

export class RoomGateway {
  private readonly conns = new Set<Conn>();
  /** `roomKey::uid` → the armed seat-release. Cancelled by a reconnect, by GC, or by firing. */
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly verifier: TokenVerifier,
    /** Injectable so a test can hold the same store the assertions read. */
    readonly store: RoomStore = new RoomStore(),
    /** Injectable so a test can drive the grace window in milliseconds instead of waiting one out. */
    private readonly graceMs: number = DEFAULT_GRACE_MS
  ) {}

  /** Wire this gateway to an existing HTTP server (shares the Express port and the tunnel). */
  attach(server: Server, path = '/rooms'): WebSocketServer {
    const wss = new WebSocketServer({ server, path, maxPayload: 512 * 1024 });
    // Private Network Access (Chrome), the WS twin of the HTTP middleware in `app.ts`. A WebSocket
    // cannot run a separate CORS preflight, so Chrome folds the PNA check into the handshake itself:
    // it sends `Access-Control-Request-Private-Network: true` on the upgrade request and blocks the
    // socket unless the 101 response echoes `Access-Control-Allow-Private-Network: true`. This fires
    // only for a browser resolving the API host to a private-range IP — a tailnet device seeing the
    // Funnel host as a 100.x address — and is inert for everyone reaching the public Funnel IP. The
    // `headers` event is ws's hook for adding response headers to the handshake reply.
    wss.on('headers', (headers, req) => {
      if (req.headers['access-control-request-private-network'] === 'true') {
        headers.push('Access-Control-Allow-Private-Network: true');
      }
    });
    wss.on('connection', (ws) => this.onConnection(ws));
    return wss;
  }

  /** Register a freshly-accepted socket. Public so a standalone `WebSocketServer` (tests) can call it. */
  onConnection(ws: WebSocket): void {
    const conn: Conn = {
      ws,
      uid: null,
      rooms: new Set(),
      privates: new Set(),
      chats: new Map(),
      presence: new Set(),
    };
    this.conns.add(conn);

    ws.on('message', (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(decodeFrame(raw)) as unknown;
      } catch {
        return; // junk frame — ignore, never crash the socket
      }
      void this.dispatch(conn, msg);
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', () => this.onClose(conn));
  }

  private send(conn: Conn, msg: ServerMsg): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  private reply(conn: Conn, id: number, result: { ok: true; value?: unknown } | { ok: false; error: string }): void {
    this.send(conn, result.ok ? { t: 'res', id, ok: true, value: result.value } : { t: 'res', id, ok: false, error: result.error });
  }

  private async dispatch(conn: Conn, raw: unknown): Promise<void> {
    if (!isRecord(raw) || typeof raw.t !== 'string') return;

    // The handshake: nothing is processed until a valid token arrives.
    if (conn.uid === null) {
      if (raw.t !== 'hello') return;
      try {
        conn.uid = await this.verifier.verify(asStr(raw.token));
        this.send(conn, { t: 'ready' });
      } catch {
        this.send(conn, { t: 'denied', error: 'invalid token' });
        conn.ws.close();
      }
      return;
    }

    const msg = raw as ClientMsg;
    switch (msg.t) {
      case 'hello':
        return; // already authed; a second hello is a no-op
      case 'create':
        return this.onCreate(conn, msg.id, asStr(msg.gameId), asOccupant(msg.host), msg.seatCount);
      case 'subscribe':
        return this.onSubscribe(conn, asStr(msg.gameId), asStr(msg.roomId));
      case 'unsubscribe':
        conn.rooms.delete(roomKey(asStr(msg.gameId), asStr(msg.roomId)));
        return;
      case 'claimSeat':
        return this.onClaimSeat(conn, msg.id, asStr(msg.gameId), asStr(msg.roomId), asIndex(msg.index), asOccupant(msg.who));
      case 'releaseSeat':
        return this.onReleaseSeat(conn, msg.id, asStr(msg.gameId), asStr(msg.roomId), asIndex(msg.index), msg.fallback === 'ai' ? 'ai' : 'open');
      case 'setAi':
        return this.onSetAi(conn, msg.id, asStr(msg.gameId), asStr(msg.roomId), asIndex(msg.index), typeof msg.name === 'string' ? msg.name : null);
      case 'patchState':
        return this.onPatchState(conn, msg.id, asStr(msg.gameId), asStr(msg.roomId), msg.data);
      case 'setStatus':
        return this.onSetStatus(conn, msg.id, asStr(msg.gameId), asStr(msg.roomId), asStatus(msg.status));
      case 'writePrivate':
        return this.onWritePrivate(conn, msg.id, asStr(msg.gameId), asStr(msg.roomId), asIndex(msg.index), msg.data);
      case 'subPrivate':
        return this.onSubPrivate(conn, asStr(msg.gameId), asStr(msg.roomId), asIndex(msg.index));
      case 'unsubPrivate':
        conn.privates.delete(privKey(asStr(msg.gameId), asStr(msg.roomId), asIndex(msg.index)));
        return;
      case 'presence':
        return this.onPresence(conn, asStr(msg.gameId), asStr(msg.roomId));
      case 'unpresence':
        return this.onUnpresence(conn, asStr(msg.gameId), asStr(msg.roomId));
      case 'remove':
        return this.onRemove(conn, msg.id, asStr(msg.gameId), asStr(msg.roomId));
      case 'chatSend':
        return this.onChatSend(conn, msg.id, asStr(msg.gameId), asStr(msg.roomId), msg.message);
      case 'chatSub':
        return this.onChatSub(conn, asStr(msg.gameId), asStr(msg.roomId), typeof msg.limit === 'number' ? msg.limit : 50);
      case 'chatUnsub':
        conn.chats.delete(roomKey(asStr(msg.gameId), asStr(msg.roomId)));
        return;
      case 'chatClear':
        return this.onChatClear(conn, msg.id, asStr(msg.gameId), asStr(msg.roomId));
      default:
        return;
    }
  }

  // ── requests ───────────────────────────────────────────────────────────────────────────────

  private onCreate(conn: Conn, id: number, gameId: string, host: SeatOccupant | null, seatCount: unknown): void {
    if (host === null) return this.reply(conn, id, { ok: false, error: 'Bad host.' });
    if (host.uid !== conn.uid) return this.reply(conn, id, { ok: false, error: 'Forbidden.' });
    const count = typeof seatCount === 'number' && Number.isInteger(seatCount) ? seatCount : 0;
    const res = this.store.create(gameId, host, count);
    this.reply(conn, id, res.ok ? { ok: true, value: res.roomId } : { ok: false, error: res.error });
  }

  private onSubscribe(conn: Conn, gameId: string, roomId: string): void {
    conn.rooms.add(roomKey(gameId, roomId));
    // Fire immediately with the current value, `null` if the room is gone — the same contract as
    // Firebase's `onValue`, which is why the frontend needs no first-load special case.
    this.send(conn, { t: 'room', gameId, roomId, snapshot: this.store.snapshot(gameId, roomId) });
  }

  private onClaimSeat(conn: Conn, id: number, gameId: string, roomId: string, index: number, who: SeatOccupant | null): void {
    if (who === null || who.uid !== conn.uid) return this.reply(conn, id, { ok: false, error: 'Forbidden.' });
    const res = this.store.claimSeat(gameId, roomId, index, who);
    if (!res.ok) {
      const error = res.error === 'no-room' ? 'No such room.' : res.error === 'out-of-range' ? 'No such seat.' : 'Seat taken.';
      return this.reply(conn, id, { ok: false, error });
    }
    this.reply(conn, id, { ok: true });
    this.broadcastRoom(gameId, roomId);
    this.broadcastRoomPrivates(gameId, roomId);
  }

  private onReleaseSeat(conn: Conn, id: number, gameId: string, roomId: string, index: number, fallback: 'ai' | 'open'): void {
    // Only the seat's own occupant or the host may vacate it — a plain leaver frees their own chair.
    const seat = this.store.seatsOf(gameId, roomId)[index];
    const isOwner = seat?.kind === 'human' && seat.uid === conn.uid;
    const isHost = this.store.hostOf(gameId, roomId) === conn.uid;
    if (!isOwner && !isHost) return this.reply(conn, id, { ok: true }); // idempotent no-op, never an error
    this.store.releaseSeat(gameId, roomId, index, fallback);
    this.reply(conn, id, { ok: true });
    this.broadcastRoom(gameId, roomId);
    this.broadcastRoomPrivates(gameId, roomId);
  }

  private onSetAi(conn: Conn, id: number, gameId: string, roomId: string, index: number, name: string | null): void {
    // Filling/clearing an AI chair is a lobby control; require the host, matching who runs the lobby.
    if (this.store.hostOf(gameId, roomId) !== conn.uid) return this.reply(conn, id, { ok: false, error: 'Host only.' });
    this.store.setAi(gameId, roomId, index, name);
    this.reply(conn, id, { ok: true });
    this.broadcastRoom(gameId, roomId);
  }

  private onPatchState(conn: Conn, id: number, gameId: string, roomId: string, data: unknown): void {
    // Any seated participant may advance state (the turn-owner, or the host-as-dealer). The server
    // owns the seq bump, so a client cannot rewind or skip ordering.
    //
    // THAT COMMENT USED TO DESCRIBE AN AUTHORISATION THIS FUNCTION DID NOT PERFORM. It checked that
    // the room existed and nothing else, so any authenticated socket that knew a room code — they are
    // four characters — could overwrite any room's entire state. For UNO/Chess/Tic-Tac-Toe that was
    // griefing rather than theft, because none of them bet; it became load-bearing the moment a game
    // on this path could win money, and it is the room-state twin of leaving `POST /settle` open for
    // a game the dealer settles. The check is membership, not turn: whose turn it is lives in a
    // game's own state, which this layer deliberately cannot read. Liar's Dice does not come through
    // here at all — a dealt game's actions carry their own turn-checked frames.
    if (!this.store.has(gameId, roomId)) return this.reply(conn, id, { ok: true });
    const seats = this.store.seatsOf(gameId, roomId);
    const seated = conn.uid !== null && seatsHeldBy(seats, conn.uid).length > 0;
    const isHost = this.store.hostOf(gameId, roomId) === conn.uid;
    if (!seated && !isHost) return this.reply(conn, id, { ok: false, error: 'Forbidden.' });
    this.store.patchState(gameId, roomId, data);
    this.reply(conn, id, { ok: true });
    this.broadcastRoom(gameId, roomId);
  }

  private onSetStatus(conn: Conn, id: number, gameId: string, roomId: string, status: RoomStatus | null): void {
    if (status === null) return this.reply(conn, id, { ok: false, error: 'Bad status.' });
    if (this.store.hostOf(gameId, roomId) !== conn.uid) return this.reply(conn, id, { ok: false, error: 'Host only.' });
    this.store.setStatus(gameId, roomId, status);
    this.reply(conn, id, { ok: true });
    this.broadcastRoom(gameId, roomId);
  }

  private onWritePrivate(conn: Conn, id: number, gameId: string, roomId: string, index: number, data: unknown): void {
    const seat = this.store.seatsOf(gameId, roomId)[index];
    const isHost = this.store.hostOf(gameId, roomId) === conn.uid;
    const isOwner = seat?.kind === 'human' && seat.uid === conn.uid;
    if (!isHost && !isOwner) return this.reply(conn, id, { ok: false, error: 'Forbidden.' });
    this.store.writePrivate(gameId, roomId, index, data);
    this.reply(conn, id, { ok: true });
    this.broadcastPrivate(gameId, roomId, index);
  }

  private onSubPrivate(conn: Conn, gameId: string, roomId: string, index: number): void {
    conn.privates.add(privKey(gameId, roomId, index));
    this.pushPrivate(conn, gameId, roomId, index);
  }

  private onPresence(conn: Conn, gameId: string, roomId: string): void {
    if (conn.uid === null) return;
    conn.presence.add(roomKey(gameId, roomId));
    this.store.addPresence(gameId, roomId, conn.uid);
    // THE RESUME. A reconnect replays presence, which is this frame — so cancelling the armed
    // release here is what lets a blipped player keep the seat a bot was about to inherit.
    this.cancelRelease(roomKey(gameId, roomId), conn.uid);
    this.broadcastRoom(gameId, roomId);
  }

  private onUnpresence(conn: Conn, gameId: string, roomId: string): void {
    if (conn.uid === null) return;
    conn.presence.delete(roomKey(gameId, roomId));
    const empty = this.store.removePresence(gameId, roomId, conn.uid);
    if (empty) this.gcRoom(gameId, roomId);
    else this.broadcastRoom(gameId, roomId);
  }

  private onRemove(conn: Conn, id: number, gameId: string, roomId: string): void {
    if (this.store.hostOf(gameId, roomId) !== conn.uid) return this.reply(conn, id, { ok: true }); // idempotent
    this.reply(conn, id, { ok: true });
    this.gcRoom(gameId, roomId); // removes, cancels armed releases, and broadcasts null
  }

  private onChatSend(conn: Conn, id: number, gameId: string, roomId: string, message: unknown): void {
    if (!isRecord(message)) return this.reply(conn, id, { ok: false, error: 'Message not sent.' });
    const uid = asStr(message.uid);
    // Pin the author to the socket's identity — a forged `uid` is refused, the exact v1 fix.
    if (uid !== conn.uid) return this.reply(conn, id, { ok: false, error: 'Message not sent.' });
    const text = asStr(message.text).trim().slice(0, 500);
    if (text === '') return this.reply(conn, id, { ok: false, error: 'Message not sent.' });
    const stamped = this.store.chatSend(gameId, roomId, { uid, name: asStr(message.name), text });
    if (stamped === null) return this.reply(conn, id, { ok: false, error: 'Message not sent.' });
    this.reply(conn, id, { ok: true });
    this.broadcastChat(gameId, roomId);
  }

  private onChatSub(conn: Conn, gameId: string, roomId: string, limit: number): void {
    conn.chats.set(roomKey(gameId, roomId), Math.max(1, Math.floor(limit)));
    this.send(conn, { t: 'chat', gameId, roomId, messages: this.store.chatMessages(gameId, roomId, limit) });
  }

  private onChatClear(conn: Conn, id: number, gameId: string, roomId: string): void {
    if (this.store.hostOf(gameId, roomId) !== conn.uid) return this.reply(conn, id, { ok: true }); // idempotent
    this.store.chatClear(gameId, roomId);
    this.reply(conn, id, { ok: true });
    this.broadcastChat(gameId, roomId);
  }

  // ── fan-out ────────────────────────────────────────────────────────────────────────────────

  private broadcastRoom(gameId: string, roomId: string): void {
    const key = roomKey(gameId, roomId);
    const snapshot = this.store.snapshot(gameId, roomId);
    for (const conn of this.conns) if (conn.rooms.has(key)) this.send(conn, { t: 'room', gameId, roomId, snapshot });
  }

  /** Deliver a private hand to its owner only; a de-authorized subscriber gets `null` (cleared). */
  private pushPrivate(conn: Conn, gameId: string, roomId: string, index: number): void {
    const seat = this.store.seatsOf(gameId, roomId)[index];
    const owns = seat?.kind === 'human' && seat.uid === conn.uid;
    this.send(conn, { t: 'private', gameId, roomId, index, data: owns ? this.store.getPrivate(gameId, roomId, index) : null });
  }

  private broadcastPrivate(gameId: string, roomId: string, index: number): void {
    const key = privKey(gameId, roomId, index);
    for (const conn of this.conns) if (conn.privates.has(key)) this.pushPrivate(conn, gameId, roomId, index);
  }

  /** Re-evaluate every private subscription for a room — used when seats (and thus owners) change. */
  private broadcastRoomPrivates(gameId: string, roomId: string): void {
    const prefix = `${roomKey(gameId, roomId)}/`;
    for (const conn of this.conns)
      for (const pk of conn.privates)
        if (pk.startsWith(prefix)) {
          const index = Number(pk.slice(prefix.length));
          if (Number.isInteger(index)) this.pushPrivate(conn, gameId, roomId, index);
        }
  }

  private broadcastChat(gameId: string, roomId: string): void {
    const key = roomKey(gameId, roomId);
    for (const conn of this.conns) {
      const limit = conn.chats.get(key);
      if (limit !== undefined)
        this.send(conn, { t: 'chat', gameId, roomId, messages: this.store.chatMessages(gameId, roomId, limit) });
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────────────────────

  /** GC a room nobody is present in, and tell any lingering subscribers it is gone. */
  private gcRoom(gameId: string, roomId: string): void {
    this.cancelRoomReleases(roomKey(gameId, roomId));
    this.store.remove(gameId, roomId);
    this.broadcastRoom(gameId, roomId);
  }

  /** Split a `gameId/roomId` key back apart. `roomId` never contains a slash; `gameId` never does. */
  private static parseKey(key: string): { gameId: string; roomId: string } {
    const slash = key.indexOf('/');
    return { gameId: key.slice(0, slash), roomId: key.slice(slash + 1) };
  }

  /** Whether another LIVE socket carries this uid into this room — a second tab, not a departure. */
  private hasLiveConn(uid: string, key: string): boolean {
    for (const conn of this.conns) if (conn.uid === uid && conn.presence.has(key)) return true;
    return false;
  }

  private cancelRelease(key: string, uid: string): void {
    const pk = `${key}::${uid}`;
    const timer = this.pending.get(pk);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pending.delete(pk);
    }
  }

  /** Drop every armed release for a room — it is being GC'd, so there is nothing left to release. */
  private cancelRoomReleases(key: string): void {
    const prefix = `${key}::`;
    for (const [pk, timer] of this.pending)
      if (pk.startsWith(prefix)) {
        clearTimeout(timer);
        this.pending.delete(pk);
      }
  }

  /**
   * Arm the seat release for a leaver, to fire once the grace window passes without them coming
   * back. The `'ai'` vs `'open'` fallback is decided WHEN IT FIRES, not now: a lobby that starts
   * during the window must hand the seat to a bot so the table can play, not open a chair mid-game.
   */
  private scheduleRelease(gameId: string, roomId: string, uid: string): void {
    const key = roomKey(gameId, roomId);
    const pk = `${key}::${uid}`;
    if (this.pending.has(pk)) return;
    const timer = setTimeout(() => {
      this.pending.delete(pk);
      const playing = this.store.statusOf(gameId, roomId) === 'playing';
      for (const index of seatsHeldBy(this.store.seatsOf(gameId, roomId), uid))
        this.store.releaseSeat(gameId, roomId, index, playing ? 'ai' : 'open');
      this.broadcastRoom(gameId, roomId);
      this.broadcastRoomPrivates(gameId, roomId);
    }, this.graceMs);
    timer.unref(); // a pending grace window must never hold the process open
    this.pending.set(pk, timer);
  }

  /**
   * The crash-recovery safety net. On any socket close: drop presence, GC a room nobody is left in,
   * and otherwise ARM the seat release (see the grace period in the header). This is the code no
   * client runs on an abrupt tab-kill — and the reason a crashed player no longer wedges a table.
   *
   * The rooms considered are the ones this socket declared presence in PLUS every room the store
   * says the uid holds a seat in — the presence set alone used to miss a seat claimed by a socket
   * that never declared presence, and leak it forever.
   */
  private onClose(conn: Conn): void {
    this.conns.delete(conn);
    const uid = conn.uid;
    if (uid === null) return;

    const keys = new Set(conn.presence);
    for (const { gameId, roomId } of this.store.roomsHolding(uid)) keys.add(roomKey(gameId, roomId));

    for (const key of keys) {
      // Another tab of this account is still at the table. Not a departure: leave presence (which
      // is per-uid, not per-socket) and the seat exactly as they are.
      if (this.hasLiveConn(uid, key)) continue;

      const { gameId, roomId } = RoomGateway.parseKey(key);
      const empty = this.store.removePresence(gameId, roomId, uid);
      if (empty) {
        // Nobody is left to wait for, so there is nothing to be gracious about — take the room.
        this.gcRoom(gameId, roomId);
        continue;
      }
      if (seatsHeldBy(this.store.seatsOf(gameId, roomId), uid).length > 0)
        this.scheduleRelease(gameId, roomId, uid);
      this.broadcastRoom(gameId, roomId);
      this.broadcastRoomPrivates(gameId, roomId);
    }
  }
}
