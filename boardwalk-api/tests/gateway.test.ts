import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { RoomGateway } from '../src/rooms/gateway';
import { RoomStore } from '../src/rooms/store';
import type { TokenVerifier } from '../src/auth/verify';
import type { ClientMsg, ServerMsg } from '../src/rooms/protocol';

/**
 * The gateway end-to-end over a REAL socket, the half `rooms.test.ts` (the pure store) cannot
 * cover: the handshake, authorization (WHO may do WHAT), request/reply correlation, push fan-out,
 * and the disconnect safety net. A fake verifier makes the token the uid (`bad*` rejects), so a
 * test names a caller by the token it connects with.
 */

const fakeVerifier: TokenVerifier = {
  verify: (token) => (token.startsWith('bad') ? Promise.reject(new Error('nope')) : Promise.resolve(token)),
};

/** `Omit` over a union collapses to common keys; distribute it so each variant keeps its own. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ResMsg = Extract<ServerMsg, { t: 'res' }>;
type RequestBody = DistOmit<Extract<ClientMsg, { id: number }>, 'id'>;

/** Unwrap a reply's value, failing the test loudly if the server refused. */
function okValue(res: ResMsg): unknown {
  if (!res.ok) throw new Error(`expected ok, got: ${res.error}`);
  return res.value;
}

/** A thin promise-shaped test client over the wire protocol. */
class Client {
  private readonly ws: WebSocket;
  private id = 0;
  private readonly waiters = new Map<number, (m: ServerMsg) => void>();
  /** Every push frame received, newest last — tests assert against the tail. */
  readonly pushes: ServerMsg[] = [];
  private readonly onceMatchers: Array<{ pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString()) as ServerMsg;
      if (msg.t === 'res') {
        this.waiters.get(msg.id)?.(msg);
        this.waiters.delete(msg.id);
        return;
      }
      if (msg.t === 'room' || msg.t === 'private' || msg.t === 'chat') this.pushes.push(msg);
      for (let i = this.onceMatchers.length - 1; i >= 0; i -= 1) {
        const w = this.onceMatchers[i];
        if (w !== undefined && w.pred(msg)) {
          this.onceMatchers.splice(i, 1);
          w.resolve(msg);
        }
      }
    });
  }

  static async open(url: string, token: string): Promise<Client> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const client = new Client(ws);
    ws.send(JSON.stringify({ t: 'hello', token }));
    await client.waitFor((m) => m.t === 'ready' || m.t === 'denied');
    return client;
  }

  /** Send a mutating request and resolve with its reply. */
  request(msg: RequestBody): Promise<ResMsg> {
    const id = (this.id += 1);
    return new Promise((resolve) => {
      this.waiters.set(id, (m) => resolve(m as ResMsg));
      this.ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  /** Fire a no-reply frame (subscribe/presence/etc.). */
  fire(msg: Exclude<ClientMsg, { id: number } | { t: 'hello' }>): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolve when a matching frame arrives (or the next `ready`/`denied`). */
  waitFor(pred: (m: ServerMsg) => boolean): Promise<ServerMsg> {
    return new Promise((resolve) => this.onceMatchers.push({ pred, resolve }));
  }

  close(): void {
    this.ws.close();
  }
}

describe('RoomGateway — over a real socket', () => {
  let server: Server;
  let gateway: RoomGateway;
  let url: string;

  beforeEach(async () => {
    server = createServer();
    gateway = new RoomGateway(fakeVerifier, new RoomStore(() => 1_000));
    gateway.attach(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    url = `ws://127.0.0.1:${String(port)}/rooms`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('refuses everything until a valid hello, then replies ready', async () => {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    // A request before hello is ignored — no reply ever comes; assert by racing a short timeout.
    ws.send(JSON.stringify({ t: 'create', id: 1, gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 }));
    const gotReply = await Promise.race([
      new Promise<boolean>((resolve) => ws.once('message', () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
    ]);
    expect(gotReply).toBe(false);
    ws.close();
  });

  it('rejects a bad token with denied and closes', async () => {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(JSON.stringify({ t: 'hello', token: 'bad-token' }));
    const msg = await new Promise<ServerMsg>((resolve) =>
      ws.once('message', (raw: WebSocket.RawData) => resolve(JSON.parse(raw.toString()) as ServerMsg))
    );
    expect(msg).toEqual({ t: 'denied', error: 'invalid token' });
  });

  it('creates a room, subscribes, and a seat claim broadcasts to every subscriber', async () => {
    const ada = await Client.open(url, 'ada');
    const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
    expect(created.ok).toBe(true);
    const roomId = okValue(created) as string;

    const bob = await Client.open(url, 'bob');
    // Both subscribe; each gets an immediate `room` frame with the current snapshot.
    ada.fire({ t: 'subscribe', gameId: 'chess', roomId });
    bob.fire({ t: 'subscribe', gameId: 'chess', roomId });
    await ada.waitFor((m) => m.t === 'room');
    await bob.waitFor((m) => m.t === 'room');

    const claimed = await bob.request({ t: 'claimSeat', gameId: 'chess', roomId, index: 1, who: { uid: 'bob', name: 'Bob' } });
    expect(claimed.ok).toBe(true);
    // Ada, a subscriber, is pushed the new snapshot without asking.
    const push = (await ada.waitFor((m) => m.t === 'room' && (m.snapshot?.seats[1]?.uid === 'bob'))) as Extract<ServerMsg, { t: 'room' }>;
    expect(push.snapshot?.seats[1]).toEqual({ kind: 'human', name: 'Bob', uid: 'bob' });
    ada.close();
    bob.close();
  });

  it('refuses a forged author on create, claim, and chat', async () => {
    const ada = await Client.open(url, 'ada');
    // create with a host uid ≠ the socket's identity
    const c = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'mallory', name: 'M' }, seatCount: 2 });
    expect(c).toMatchObject({ ok: false });

    const real = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
    const roomId = okValue(real) as string;
    // claim someone else's uid
    const claim = await ada.request({ t: 'claimSeat', gameId: 'chess', roomId, index: 1, who: { uid: 'bob', name: 'Bob' } });
    expect(claim).toMatchObject({ ok: false });
    // chat with a forged uid
    const chat = await ada.request({ t: 'chatSend', gameId: 'chess', roomId, message: { uid: 'bob', name: 'Bob', text: 'hi' } });
    expect(chat).toMatchObject({ ok: false });
    ada.close();
  });

  it('delivers a private hand to its owner only, never to a bystander', async () => {
    const ada = await Client.open(url, 'ada');
    const created = await ada.request({ t: 'create', gameId: 'uno', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
    const roomId = okValue(created) as string;
    const bob = await Client.open(url, 'bob');
    await bob.request({ t: 'claimSeat', gameId: 'uno', roomId, index: 1, who: { uid: 'bob', name: 'Bob' } });

    // Both subscribe to seat 1's private node; only bob owns it.
    ada.fire({ t: 'subPrivate', gameId: 'uno', roomId, index: 1 });
    bob.fire({ t: 'subPrivate', gameId: 'uno', roomId, index: 1 });
    const adaFirst = (await ada.waitFor((m) => m.t === 'private')) as Extract<ServerMsg, { t: 'private' }>;
    expect(adaFirst.data).toBeNull(); // a non-owner is sent nothing

    // Host deals bob his hand.
    await ada.request({ t: 'writePrivate', gameId: 'uno', roomId, index: 1, data: { hand: ['red-5'] } });
    const bobHand = (await bob.waitFor((m) => m.t === 'private' && m.data !== null)) as Extract<ServerMsg, { t: 'private' }>;
    expect(bobHand.data).toEqual({ hand: ['red-5'] });
    // Ada never receives the card.
    expect(JSON.stringify(ada.pushes)).not.toContain('red-5');
    ada.close();
    bob.close();
  });

  it('a disconnect releases the leaver seats and GCs an empty room', async () => {
    const ada = await Client.open(url, 'ada');
    const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
    const roomId = okValue(created) as string;
    ada.fire({ t: 'subscribe', gameId: 'chess', roomId });
    await ada.waitFor((m) => m.t === 'room');
    ada.fire({ t: 'presence', gameId: 'chess', roomId });
    // Wait until the server has recorded presence (it re-broadcasts the room), then drop the only
    // participant — the close path must release the seat and GC the now-empty room.
    await ada.waitFor((m) => m.t === 'room' && m.snapshot?.presence.ada === true);
    ada.close();
    await new Promise((r) => setTimeout(r, 50));
    // Nobody present ⇒ the room is gone.
    expect(gateway.store.has('chess', roomId)).toBe(false);
  });

  it('host-only guards: a non-host cannot setStatus, but release/remove are idempotent no-ops', async () => {
    const ada = await Client.open(url, 'ada');
    const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
    const roomId = okValue(created) as string;
    const bob = await Client.open(url, 'bob');
    await bob.request({ t: 'claimSeat', gameId: 'chess', roomId, index: 1, who: { uid: 'bob', name: 'Bob' } });

    const status = await bob.request({ t: 'setStatus', gameId: 'chess', roomId, status: 'playing' });
    expect(status).toMatchObject({ ok: false });
    expect(gateway.store.statusOf('chess', roomId)).toBe('waiting');

    const host = await ada.request({ t: 'setStatus', gameId: 'chess', roomId, status: 'playing' });
    expect(host.ok).toBe(true);
    expect(gateway.store.statusOf('chess', roomId)).toBe('playing');
    ada.close();
    bob.close();
  });
});
