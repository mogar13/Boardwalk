/**
 * The room socket's state machine (BACKEND_PLAN.md Phase C) — the half the API's `gateway.test.ts`
 * cannot see: the client handshake gate, request/reply correlation, the immediate-cache replay to a
 * late subscriber, and above all RECONNECT — that a dropped socket replays every live subscription
 * against the fresh connection, because the client, not the server, remembers what it was watching.
 *
 * Driven against a fake `WebSocket` so the transitions are deterministic: the test opens the socket,
 * pushes server frames, and drops it, with no real network and no timing races.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoomSocket, type RoomSocket } from '@/system/repo/api/socket';

interface Sent {
  t: string;
  [k: string]: unknown;
}

/** A controllable stand-in for the browser `WebSocket`. Tests fire `_open`/`_msg`/`close` by hand. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = 0;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: Sent[] = [];
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Sent);
  }
  close(): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.onclose?.();
  }
  _open(): void {
    this.readyState = this.OPEN;
    this.onopen?.();
  }
  _msg(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  types(): string[] {
    return this.sent.map((m) => m.t);
  }
}

const cfg = { baseUrl: 'https://api.example', getToken: () => Promise.resolve('tok') };

/** Let awaited microtasks (the token handshake) settle. */
const tick = (): Promise<void> => Promise.resolve().then(() => undefined);

let socket: RoomSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  socket.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Drive one instance through open → hello → ready, returning it handshaken. */
async function handshake(index = 0): Promise<FakeWebSocket> {
  const ws = FakeWebSocket.instances[index];
  if (ws === undefined) throw new Error(`no socket instance ${String(index)}`);
  ws._open();
  await tick(); // onOpen awaits getToken, then sends hello
  expect(ws.types()).toContain('hello');
  ws._msg({ t: 'ready' });
  return ws;
}

describe('RoomSocket — handshake + request/reply', () => {
  it('converts the base URL to a wss /rooms endpoint and says hello with the token', async () => {
    socket = createRoomSocket(cfg);
    void socket.request({ t: 'create', gameId: 'chess' });
    const ws = FakeWebSocket.instances[0];
    expect(ws?.url).toBe('wss://api.example/rooms');
    await handshake();
    const hello = ws?.sent.find((m) => m.t === 'hello');
    expect(hello?.token).toBe('tok');
  });

  it('holds a request until ready, then flushes it, and resolves on the matching res', async () => {
    socket = createRoomSocket(cfg);
    const pending = socket.request({ t: 'create', gameId: 'chess' });
    const ws = FakeWebSocket.instances[0];
    // Before the handshake, nothing but the queued frame exists — no create on the wire yet.
    expect(ws?.types() ?? []).not.toContain('create');
    await handshake();
    // Now it flushes.
    expect(ws?.types()).toContain('create');
    const createFrame = ws?.sent.find((m) => m.t === 'create');
    ws?._msg({ t: 'res', id: createFrame?.id, ok: true, value: 'ABCD' });
    await expect(pending).resolves.toEqual({ ok: true, value: 'ABCD' });
  });

  it('fails an in-flight request when the socket drops (no reply can ever come)', async () => {
    socket = createRoomSocket(cfg);
    const pending = socket.request({ t: 'create', gameId: 'chess' }); // opens the socket, queues
    await handshake(); // flushes it live; no res is sent
    FakeWebSocket.instances[0]?.close();
    await expect(pending).resolves.toEqual({ ok: false, error: 'Connection lost.' });
  });
});

describe('RoomSocket — subscriptions', () => {
  it('fires a listener on the room push and hands a late subscriber the cached snapshot', async () => {
    socket = createRoomSocket(cfg);
    const seenA: unknown[] = [];
    socket.subscribeRoom('chess', 'ABCD', (s) => seenA.push(s));
    const ws = await handshake();
    expect(ws.types()).toContain('subscribe');

    const snap = {
      meta: { host: 'ada', status: 'waiting', createdAt: 1, seq: 0 },
      seats: [],
      state: null,
      presence: {},
    };
    ws._msg({ t: 'room', gameId: 'chess', roomId: 'ABCD', snapshot: snap });
    expect(seenA).toEqual([snap]);

    // A second subscriber to the same room gets the cached value immediately, no new server frame.
    const seenB: unknown[] = [];
    socket.subscribeRoom('chess', 'ABCD', (s) => seenB.push(s));
    expect(seenB).toEqual([snap]);
  });

  it('unsubscribes on the wire only when the last listener leaves', async () => {
    socket = createRoomSocket(cfg);
    const off1 = socket.subscribeRoom('chess', 'ABCD', () => undefined);
    const off2 = socket.subscribeRoom('chess', 'ABCD', () => undefined);
    const ws = await handshake();
    off1();
    expect(ws.types()).not.toContain('unsubscribe');
    off2();
    expect(ws.types()).toContain('unsubscribe');
  });

  it('caches the latest state so patchState can read prev', async () => {
    socket = createRoomSocket(cfg);
    socket.subscribeRoom('chess', 'ABCD', () => undefined);
    const ws = await handshake();
    ws._msg({
      t: 'room',
      gameId: 'chess',
      roomId: 'ABCD',
      snapshot: {
        meta: { host: 'ada', status: 'playing', createdAt: 1, seq: 3 },
        seats: [],
        state: { fen: 'e4' },
        presence: {},
      },
    });
    expect(socket.latestState('chess', 'ABCD')).toEqual({ fen: 'e4' });
    expect(socket.latestState('chess', 'ZZZZ')).toBeNull();
  });
});

describe('RoomSocket — reconnect', () => {
  it('replays every live subscription against a fresh socket after a drop', async () => {
    socket = createRoomSocket(cfg);
    socket.subscribeRoom('chess', 'ABCD', () => undefined);
    socket.subscribePrivate('chess', 'ABCD', 1, () => undefined);
    socket.subscribeChat('chess', 'ABCD', () => undefined, 20);
    socket.trackPresence('chess', 'ABCD');
    const first = await handshake();
    expect(first.types()).toEqual(
      expect.arrayContaining(['hello', 'subscribe', 'subPrivate', 'chatSub', 'presence'])
    );

    // The link drops. A backoff timer is armed; advancing it opens a brand-new socket.
    first.close();
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);

    const second = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (second === undefined) throw new Error('no reconnect socket');
    second._open();
    await tick();
    second._msg({ t: 'ready' });
    // Every subscription the client was holding is re-established on the new connection.
    expect(second.types()).toEqual(
      expect.arrayContaining(['hello', 'subscribe', 'subPrivate', 'chatSub', 'presence'])
    );
  });

  it('does not reconnect once nothing is subscribed', async () => {
    socket = createRoomSocket(cfg);
    const off = socket.subscribeRoom('chess', 'ABCD', () => undefined);
    const ws = await handshake();
    off(); // last listener gone → no work
    ws.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1); // no fresh socket
  });
});
