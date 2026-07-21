import type { ApiClientConfig } from '@/system/repo/api/client';
import type { ChatMessage } from '@/system/chat/types';
import type { OpenTable, RoomSnapshot } from '@/system/room/types';
import type { SeatOccupant } from '@/system/repo/types';

/**
 * The one multiplexed WebSocket to the referee (BACKEND_PLAN.md Phase C). Every room and chat
 * subscription in the app rides this single connection — the WS twin of the single RTDB connection
 * Firebase gave for free. It owns the four things the plan says a WebSocket transport must own that
 * RTDB owned for us: the handshake, reconnects, presence, and backpressure.
 *
 * WHY ONE SOCKET, NOT ONE PER SUBSCRIPTION. `<RoomProvider>` mounts one room subscription, `useChat`
 * one chat subscription, `useHand` one private subscription — but they are the same room and the same
 * player, so they share a connection and the server correlates them by the socket's verified uid. A
 * socket-per-subscription would re-run the handshake and re-verify the token N times per table.
 *
 * THE WIRE PROTOCOL is `boardwalk-api/src/rooms/protocol.ts`, mirrored here by hand (a shared package
 * is Phase D's `packages/game-logic` refactor). The two ends drift only if someone edits one copy;
 * the API's `tests/gateway.test.ts` and this file are what break if they do.
 *
 * FRAME FAMILIES, mirrored from the server:
 *   • request/reply — a mutating op carries a numeric `id`; exactly one `res` echoes it. That is how
 *     a `Promise<RepoResult>` on the repo resolves.
 *   • subscriptions — `subscribe`/`subPrivate`/`chatSub`/`presence` register interest and get a
 *     stream of `room`/`private`/`chat` push frames until unsubscribe or close. They live in the
 *     registries below so a RECONNECT can replay every one — the client, not the server, remembers
 *     what it was watching, because a dropped socket is a fresh server connection with no memory.
 */

// ── the wire (mirror of protocol.ts) ─────────────────────────────────────────────────────────────

/** Server → client frames this socket parses. */
type ServerFrame =
  | { t: 'ready' }
  | { t: 'denied'; error: string }
  | { t: 'res'; id: number; ok: true; value?: unknown }
  | { t: 'res'; id: number; ok: false; error: string }
  | { t: 'room'; gameId: string; roomId: string; snapshot: RoomSnapshot<unknown> | null }
  | { t: 'private'; gameId: string; roomId: string; index: number; data: unknown }
  | { t: 'chat'; gameId: string; roomId: string; messages: readonly ChatMessage[] }
  | { t: 'open'; rooms: readonly OpenTable[] };

/** A reply, as the repo layer consumes it — `RepoResult`-shaped. */
export type Reply = { ok: true; value?: unknown } | { ok: false; error: string };

export type Unsubscribe = () => void;

// ── tuning ───────────────────────────────────────────────────────────────────────────────────────

/** Reconnect backoff: double from base to cap, with jitter so a fleet of tabs doesn't sync-storm. */
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 15_000;
/** Bound the outbox so a long offline stretch cannot grow memory without limit — drop-oldest. */
const OUTBOX_CAP = 256;
/** Backpressure ceiling: hold sends when the socket's own buffer is this deep on a slow link. */
const BUFFER_HIGH_WATER = 1 << 20; // 1 MiB
const DRAIN_POLL_MS = 50;

// ── registries: what to replay on reconnect ──────────────────────────────────────────────────────

interface RoomReg {
  readonly listeners: Set<(snap: RoomSnapshot<unknown> | null) => void>;
  /** Last snapshot seen — fired immediately to a new listener, and read by `patchState` for `prev`. */
  last: RoomSnapshot<unknown> | null | undefined;
}
interface PrivReg {
  readonly listeners: Set<(data: unknown) => void>;
  last: unknown;
}
interface ChatReg {
  readonly listeners: Set<(msgs: readonly ChatMessage[]) => void>;
  limit: number;
  last: readonly ChatMessage[] | undefined;
}

/** The open-table index has no key — there is exactly one, global. See `protocol.ts`. */
interface OpenReg {
  readonly listeners: Set<(tables: readonly OpenTable[]) => void>;
  last: readonly OpenTable[] | undefined;
}

const roomKey = (gameId: string, roomId: string): string => `${gameId}/${roomId}`;
const privKey = (gameId: string, roomId: string, index: number): string =>
  `${gameId}/${roomId}/${String(index)}`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Turn the API base URL into the `/rooms` WS endpoint: http→ws, https→wss, path replaced. */
function toWsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/rooms';
  u.search = '';
  u.hash = '';
  return u.toString();
}

export class RoomSocket {
  private ws: WebSocket | null = null;
  private phase: 'idle' | 'opening' | 'ready' | 'closed' = 'idle';
  private readonly url: string;

  private nextId = 0;
  private readonly pending = new Map<number, (r: Reply) => void>();

  private readonly rooms = new Map<string, RoomReg>();
  private readonly privates = new Map<string, PrivReg>();
  private readonly chats = new Map<string, ChatReg>();
  /** Refcounted presence — several mounts in one tab share one server-side presence mark. */
  private readonly presence = new Map<string, number>();
  /** The one open-table subscription, shared by every browser mounted in this tab. */
  private open: OpenReg | null = null;

  /** Frames waiting for a live, handshaken socket. Flushed on `ready`, capped for backpressure. */
  private outbox: string[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  private readonly cfg: ApiClientConfig;

  constructor(cfg: ApiClientConfig) {
    this.cfg = cfg;
    this.url = toWsUrl(cfg.baseUrl);
  }

  // ── connection lifecycle ───────────────────────────────────────────────────────────────────────

  /** Open the socket if it is idle/closed. Idempotent — every subscribe/request calls it. */
  private ensureOpen(): void {
    if (this.stopped) return;
    if (this.phase === 'opening' || this.phase === 'ready') return;
    this.phase = 'opening';
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => void this.onOpen(ws);
    ws.onmessage = (ev) => this.onMessage(ev);
    ws.onclose = () => this.onClose(ws);
    ws.onerror = () => ws.close();
  }

  private async onOpen(ws: WebSocket): Promise<void> {
    // The handshake: verify identity BEFORE anything else. A fresh token each connect handles
    // expiry across a long-lived session and across reconnects.
    let token: string | null;
    try {
      token = await this.cfg.getToken();
    } catch {
      token = null;
    }
    if (this.ws !== ws || ws.readyState !== ws.OPEN) return; // superseded while awaiting the token
    if (token === null) {
      // Signed out (or config missing): the referee will refuse an empty token, so don't spin on it —
      // close and let the backoff retry, by which time the player may have signed in.
      ws.close();
      return;
    }
    ws.send(JSON.stringify({ t: 'hello', token }));
  }

  private onMessage(ev: MessageEvent): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as ServerFrame;
    } catch {
      return; // junk frame — ignore
    }
    if (!isRecord(frame) || typeof frame.t !== 'string') return;

    switch (frame.t) {
      case 'ready':
        this.onReady();
        return;
      case 'denied':
        // The token was refused. Closing triggers the backoff; a re-auth (new token) may succeed.
        this.ws?.close();
        return;
      case 'res': {
        const resolve = this.pending.get(frame.id);
        if (resolve !== undefined) {
          this.pending.delete(frame.id);
          resolve(frame.ok ? { ok: true, value: frame.value } : { ok: false, error: frame.error });
        }
        return;
      }
      case 'room': {
        const reg = this.rooms.get(roomKey(frame.gameId, frame.roomId));
        if (reg !== undefined) {
          reg.last = frame.snapshot;
          for (const l of reg.listeners) l(frame.snapshot);
        }
        return;
      }
      case 'private': {
        const reg = this.privates.get(privKey(frame.gameId, frame.roomId, frame.index));
        if (reg !== undefined) {
          reg.last = frame.data;
          for (const l of reg.listeners) l(frame.data);
        }
        return;
      }
      case 'chat': {
        const reg = this.chats.get(roomKey(frame.gameId, frame.roomId));
        if (reg !== undefined) {
          reg.last = frame.messages;
          for (const l of reg.listeners) l(frame.messages);
        }
        return;
      }
      case 'open': {
        const reg = this.open;
        if (reg !== null) {
          reg.last = frame.rooms;
          for (const l of reg.listeners) l(frame.rooms);
        }
        return;
      }
      default:
        return;
    }
  }

  /** Handshake complete: reset backoff, replay every live subscription, flush the outbox. */
  private onReady(): void {
    this.phase = 'ready';
    this.reconnectAttempts = 0;
    for (const [key] of this.rooms) {
      const [gameId, roomId] = splitRoomKey(key);
      this.raw({ t: 'subscribe', gameId, roomId });
    }
    for (const [key] of this.privates) {
      const { gameId, roomId, index } = splitPrivKey(key);
      this.raw({ t: 'subPrivate', gameId, roomId, index });
    }
    for (const [key, reg] of this.chats) {
      const [gameId, roomId] = splitRoomKey(key);
      this.raw({ t: 'chatSub', gameId, roomId, limit: reg.limit });
    }
    for (const [key] of this.presence) {
      const [gameId, roomId] = splitRoomKey(key);
      this.raw({ t: 'presence', gameId, roomId });
    }
    // The browser is a subscription like any other, so it is replayed like any other — a hub left
    // open across a reconnect must not sit on a frozen list of tables that have since filled.
    if (this.open !== null) this.raw({ t: 'browse' });
    this.flushOutbox();
  }

  private onClose(ws: WebSocket): void {
    if (this.ws !== ws) return; // a superseded socket closing — ignore
    this.ws = null;
    this.phase = 'closed';
    // In-flight requests will never be answered on this dead socket; a fresh connection has no memory
    // of their ids. Fail them so a caller's `await` settles instead of hanging forever — a RepoResult
    // method surfaces this as `ok:false`, a void method as a rejection, both honest for "offline".
    for (const [, resolve] of this.pending) resolve({ ok: false, error: 'Connection lost.' });
    this.pending.clear();
    if (this.hasWork()) this.scheduleReconnect();
    else this.phase = 'idle';
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** this.reconnectAttempts);
    const jitter = delay * 0.25 * Math.random();
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.hasWork()) this.ensureOpen();
      else this.phase = 'idle';
    }, delay + jitter);
  }

  /** Anything worth staying (re)connected for — a live subscription, presence, or a queued frame. */
  private hasWork(): boolean {
    return (
      this.rooms.size > 0 ||
      this.privates.size > 0 ||
      this.chats.size > 0 ||
      this.presence.size > 0 ||
      this.open !== null ||
      this.outbox.length > 0
    );
  }

  // ── sending, with backpressure ───────────────────────────────────────────────────────────────

  /** Enqueue a frame; send now if the handshake is done and the socket buffer is drained. */
  private raw(msg: object): void {
    const data = JSON.stringify(msg);
    const ws = this.ws;
    if (
      this.phase === 'ready' &&
      ws !== null &&
      ws.readyState === ws.OPEN &&
      ws.bufferedAmount < BUFFER_HIGH_WATER
    ) {
      ws.send(data);
      return;
    }
    // Not sendable yet (connecting, or the link is backed up): queue, drop-oldest past the cap so a
    // long offline stretch is bounded, and make sure a drain poller is watching to flush it.
    if (this.outbox.length >= OUTBOX_CAP) this.outbox.shift();
    this.outbox.push(data);
    this.ensureDrainPoller();
  }

  private flushOutbox(): void {
    const ws = this.ws;
    if (this.phase !== 'ready' || ws === null || ws.readyState !== ws.OPEN) return;
    while (this.outbox.length > 0) {
      if (ws.bufferedAmount >= BUFFER_HIGH_WATER) {
        this.ensureDrainPoller();
        return; // let the buffer drain before pushing more — real backpressure, not a busy-spin
      }
      const next = this.outbox.shift();
      if (next !== undefined) ws.send(next);
    }
  }

  /** A low-frequency poller that flushes the outbox as the socket buffer drains, then stops itself. */
  private ensureDrainPoller(): void {
    if (this.drainTimer !== null) return;
    this.drainTimer = setInterval(() => {
      if (this.outbox.length === 0) {
        if (this.drainTimer !== null) clearInterval(this.drainTimer);
        this.drainTimer = null;
        return;
      }
      if (this.phase === 'ready') this.flushOutbox();
      else this.ensureOpen();
    }, DRAIN_POLL_MS);
  }

  // ── the API the repos call ─────────────────────────────────────────────────────────────────────

  /** Send a mutating request, resolving with the server's single reply (or a lost-connection value). */
  request(msg: Record<string, unknown>): Promise<Reply> {
    this.ensureOpen();
    const id = (this.nextId += 1);
    return new Promise<Reply>((resolve) => {
      this.pending.set(id, resolve);
      this.raw({ ...msg, id });
    });
  }

  subscribeRoom(
    gameId: string,
    roomId: string,
    listener: (snap: RoomSnapshot<unknown> | null) => void
  ): Unsubscribe {
    const key = roomKey(gameId, roomId);
    let reg = this.rooms.get(key);
    if (reg === undefined) {
      reg = { listeners: new Set(), last: undefined };
      this.rooms.set(key, reg);
      this.ensureOpen();
      this.raw({ t: 'subscribe', gameId, roomId });
    } else if (reg.last !== undefined) {
      // A later subscriber to the same room gets the cached snapshot immediately, matching Firebase's
      // onValue firing with the current value — no wait for the next server push.
      listener(reg.last);
    }
    reg.listeners.add(listener);
    return () => {
      const r = this.rooms.get(key);
      if (r === undefined) return;
      r.listeners.delete(listener);
      if (r.listeners.size === 0) {
        this.rooms.delete(key);
        this.raw({ t: 'unsubscribe', gameId, roomId });
      }
    };
  }

  subscribePrivate(
    gameId: string,
    roomId: string,
    index: number,
    listener: (data: unknown) => void
  ): Unsubscribe {
    const key = privKey(gameId, roomId, index);
    let reg = this.privates.get(key);
    if (reg === undefined) {
      reg = { listeners: new Set(), last: undefined };
      this.privates.set(key, reg);
      this.ensureOpen();
      this.raw({ t: 'subPrivate', gameId, roomId, index });
    } else if (reg.last !== undefined) {
      listener(reg.last);
    }
    reg.listeners.add(listener);
    return () => {
      const r = this.privates.get(key);
      if (r === undefined) return;
      r.listeners.delete(listener);
      if (r.listeners.size === 0) {
        this.privates.delete(key);
        this.raw({ t: 'unsubPrivate', gameId, roomId, index });
      }
    };
  }

  subscribeChat(
    gameId: string,
    roomId: string,
    listener: (msgs: readonly ChatMessage[]) => void,
    limit: number
  ): Unsubscribe {
    const key = roomKey(gameId, roomId);
    let reg = this.chats.get(key);
    if (reg === undefined) {
      reg = { listeners: new Set(), limit, last: undefined };
      this.chats.set(key, reg);
      this.ensureOpen();
      this.raw({ t: 'chatSub', gameId, roomId, limit });
    } else {
      // Widen the window if this listener asked for more history than the current subscription.
      if (limit > reg.limit) {
        reg.limit = limit;
        this.raw({ t: 'chatSub', gameId, roomId, limit });
      }
      if (reg.last !== undefined) listener(reg.last);
    }
    reg.listeners.add(listener);
    return () => {
      const r = this.chats.get(key);
      if (r === undefined) return;
      r.listeners.delete(listener);
      if (r.listeners.size === 0) {
        this.chats.delete(key);
        this.raw({ t: 'chatUnsub', gameId, roomId });
      }
    };
  }

  /**
   * Subscribe to the public open-table index. Refcounted onto ONE server-side subscription, and a
   * late subscriber gets the cached list at once — the same immediate-fire contract every other
   * subscribe here honours, so a hub that mounts a second browser does not blink through empty.
   */
  subscribeOpen(listener: (tables: readonly OpenTable[]) => void): Unsubscribe {
    let reg = this.open;
    if (reg === null) {
      reg = { listeners: new Set(), last: undefined };
      this.open = reg;
      this.ensureOpen();
      this.raw({ t: 'browse' });
    } else if (reg.last !== undefined) {
      listener(reg.last);
    }
    reg.listeners.add(listener);
    return () => {
      const r = this.open;
      if (r === null) return;
      r.listeners.delete(listener);
      if (r.listeners.size === 0) {
        this.open = null;
        this.raw({ t: 'unbrowse' });
      }
    };
  }

  /** Declare presence, refcounted, and clear it (and arm nothing else — the server reaps on close). */
  trackPresence(gameId: string, roomId: string): Unsubscribe {
    const key = roomKey(gameId, roomId);
    const n = this.presence.get(key) ?? 0;
    this.presence.set(key, n + 1);
    if (n === 0) {
      this.ensureOpen();
      this.raw({ t: 'presence', gameId, roomId });
    }
    return () => {
      const cur = this.presence.get(key) ?? 0;
      if (cur <= 1) {
        this.presence.delete(key);
        this.raw({ t: 'unpresence', gameId, roomId });
      } else {
        this.presence.set(key, cur - 1);
      }
    };
  }

  /** The latest public state for a room, or `null` — how `patchState` gets its `prev` to apply. */
  latestState(gameId: string, roomId: string): unknown {
    return this.rooms.get(roomKey(gameId, roomId))?.last?.state ?? null;
  }

  /** Tear the socket down for good — a full app teardown, not a reconnect. */
  close(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.drainTimer !== null) clearInterval(this.drainTimer);
    this.reconnectTimer = null;
    this.drainTimer = null;
    this.ws?.close();
    this.ws = null;
  }
}

function splitRoomKey(key: string): [string, string] {
  const slash = key.indexOf('/');
  return [key.slice(0, slash), key.slice(slash + 1)];
}

function splitPrivKey(key: string): { gameId: string; roomId: string; index: number } {
  const last = key.lastIndexOf('/');
  const [gameId, roomId] = splitRoomKey(key.slice(0, last));
  return { gameId, roomId, index: Number(key.slice(last + 1)) };
}

export function createRoomSocket(cfg: ApiClientConfig): RoomSocket {
  return new RoomSocket(cfg);
}

/** Re-exported so the repos can name the occupant shape without a second import. */
export type { SeatOccupant };
