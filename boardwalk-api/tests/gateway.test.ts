import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { RoomGateway } from '../src/rooms/gateway';
import { RoomStore } from '../src/rooms/store';
import type { TokenVerifier } from '../src/auth/verify';
import type { ClientMsg, ServerMsg } from '../src/rooms/protocol';
import { decodeFrame } from '../src/rooms/protocol';

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
      const msg = JSON.parse(decodeFrame(raw)) as ServerMsg;
      if (msg.t === 'res') {
        this.waiters.get(msg.id)?.(msg);
        this.waiters.delete(msg.id);
        return;
      }
      if (msg.t === 'room' || msg.t === 'private' || msg.t === 'chat' || msg.t === 'open')
        this.pushes.push(msg);
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

  /**
   * `waitFor`, but satisfied by a frame that has ALREADY arrived.
   *
   * The plain version races: a reply and the push it triggers can land in one TCP read, so both
   * `message` events run before the `await request(...)` continuation gets to register a matcher,
   * and the wait then hangs on a frame that came and went. Anything asserting "the push that
   * follows this request" has to scan the log first.
   */
  waitForPush(pred: (m: ServerMsg) => boolean): Promise<ServerMsg> {
    const seen = this.pushes.filter(pred);
    const last = seen[seen.length - 1];
    if (last !== undefined) return Promise.resolve(last);
    return this.waitFor(pred);
  }

  close(): void {
    this.ws.close();
  }

  /** A CRASH, not a leave — the socket dies with no close handshake and no client code running. */
  kill(): void {
    this.ws.terminate();
  }
}

/** The grace window these tests run against — long enough to act inside, short enough to wait out. */
const GRACE_MS = 60;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Wait past the grace window plus the scheduler's slack, so a fired timer has definitely landed. */
const waitOutGrace = () => sleep(GRACE_MS * 3);

describe('RoomGateway — over a real socket', () => {
  let server: Server;
  let gateway: RoomGateway;
  let url: string;

  beforeEach(async () => {
    server = createServer();
    // Both windows driven at GRACE_MS: the seat release (3rd) and the empty-room reap (5th).
    gateway = new RoomGateway(fakeVerifier, new RoomStore(() => 1_000), GRACE_MS, null, GRACE_MS);
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
      ws.once('message', (raw: WebSocket.RawData) => resolve(JSON.parse(decodeFrame(raw)) as ServerMsg))
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

  /**
   * PATCHSTATE AUTHORISATION. `onPatchState` carried a comment saying "any seated participant may
   * advance state" over code that checked only that the room existed — so a stranger who knew a
   * four-character room code could overwrite any room's whole state. These pin the check, both
   * directions: refused for an outsider, permitted for the two callers that legitimately write
   * (a seated player and the host-as-dealer, who may not hold a seat).
   */
  describe('an empty room is reaped on a grace, not instantly', () => {
    it('survives an unpresence/presence remount — the StrictMode double-mount', async () => {
      // React StrictMode double-invokes effects in dev, so `<RoomProvider>` mounts, declares
      // presence, unmounts (sending a REAL unpresence) and re-declares. The room used to be
      // collected between the two, so a table died the moment it was created and NO WS room game
      // could be developed locally at all. Driving Liar's Dice in a browser is how this surfaced.
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
      const roomId = okValue(created) as string;
      ada.fire({ t: 'subscribe', gameId: 'chess', roomId });
      ada.fire({ t: 'presence', gameId: 'chess', roomId });
      await ada.waitFor((m) => m.t === 'room' && m.snapshot?.presence.ada === true);

      // The remount, over a socket that never closed.
      ada.fire({ t: 'unpresence', gameId: 'chess', roomId });
      ada.fire({ t: 'presence', gameId: 'chess', roomId });
      await waitOutGrace();

      expect(gateway.store.has('chess', roomId)).toBe(true);
      ada.close();
    });

    it('still collects a room nobody comes back to', async () => {
      // The grace must not become a leak: an unpresence with no return still takes the room.
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
      const roomId = okValue(created) as string;
      ada.fire({ t: 'subscribe', gameId: 'chess', roomId });
      ada.fire({ t: 'presence', gameId: 'chess', roomId });
      await ada.waitFor((m) => m.t === 'room' && m.snapshot?.presence.ada === true);

      ada.fire({ t: 'unpresence', gameId: 'chess', roomId });
      expect(gateway.store.has('chess', roomId)).toBe(true); // not yet
      await waitOutGrace();
      expect(gateway.store.has('chess', roomId)).toBe(false); // but eventually
      ada.close();
    });
  });

  describe('patchState authorisation', () => {
    it('refuses a socket that holds no seat and does not host the room', async () => {
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
      const roomId = okValue(created) as string;
      await ada.request({ t: 'claimSeat', gameId: 'chess', roomId, index: 0, who: { uid: 'ada', name: 'Ada' } });
      await ada.request({ t: 'patchState', gameId: 'chess', roomId, data: { board: 'real' } });

      // A stranger with the room code and a valid token — the whole attack, and it used to work.
      const mallory = await Client.open(url, 'mallory');
      const res = await mallory.request({ t: 'patchState', gameId: 'chess', roomId, data: { board: 'forged' } });

      expect(res).toMatchObject({ ok: false });
      expect(gateway.store.snapshot('chess', roomId)?.state).toEqual({ board: 'real' });
      ada.close();
      mallory.close();
    });

    it('permits a seated player, and the host even when it holds no seat', async () => {
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
      const roomId = okValue(created) as string;
      const bob = await Client.open(url, 'bob');
      await bob.request({ t: 'claimSeat', gameId: 'chess', roomId, index: 1, who: { uid: 'bob', name: 'Bob' } });

      const seated = await bob.request({ t: 'patchState', gameId: 'chess', roomId, data: { by: 'bob' } });
      expect(seated.ok).toBe(true);
      expect(gateway.store.snapshot('chess', roomId)?.state).toEqual({ by: 'bob' });

      // Ada hosts but never claimed a chair — the host-as-dealer case, which a seats-only check
      // would have broken for UNO.
      const host = await ada.request({ t: 'patchState', gameId: 'chess', roomId, data: { by: 'ada' } });
      expect(host.ok).toBe(true);
      expect(gateway.store.snapshot('chess', roomId)?.state).toEqual({ by: 'ada' });
      ada.close();
      bob.close();
    });
  });

  /**
   * CRASH RECOVERY (plans/done/CRASH_RECOVERY.md). Before this block the gateway's docblock CLAIMED to
   * close the crash-recovery gap and one test asserted only that a solo player's room is GC'd — the
   * branch the claim rests on (a seat becomes an AI so the table survives for everyone else) had no
   * coverage at all. These are that branch, plus the grace window that keeps a blip from costing a
   * live player their seat.
   */
  describe('crash recovery', () => {
    /** A started 2-seat table: ada hosts, bob sits at 1, both present, status `playing`. */
    async function playingTable(): Promise<{ ada: Client; bob: Client; roomId: string }> {
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({
        t: 'create',
        gameId: 'chess',
        host: { uid: 'ada', name: 'Ada' },
        seatCount: 2,
      });
      const roomId = okValue(created) as string;
      const bob = await Client.open(url, 'bob');
      await bob.request({ t: 'claimSeat', gameId: 'chess', roomId, index: 1, who: { uid: 'bob', name: 'Bob' } });
      for (const c of [ada, bob]) {
        c.fire({ t: 'subscribe', gameId: 'chess', roomId });
        c.fire({ t: 'presence', gameId: 'chess', roomId });
      }
      await ada.waitFor((m) => m.t === 'room' && m.snapshot?.presence.bob === true);
      await ada.request({ t: 'setStatus', gameId: 'chess', roomId, status: 'playing' });
      return { ada, bob, roomId };
    }

    it('a crash mid-game hands the seat to an AI and the table survives', async () => {
      const { ada, bob, roomId } = await playingTable();

      bob.kill(); // force-quit: no teardown, no leave frame, nothing client-side runs
      // The seat is NOT released on close — it is armed. Inside the window bob still holds it.
      await sleep(GRACE_MS / 3);
      expect(gateway.store.seatsOf('chess', roomId)[1]).toMatchObject({ kind: 'human', uid: 'bob' });

      await waitOutGrace();
      // The house takes over so ada can finish the game, and the room is emphatically still there.
      expect(gateway.store.seatsOf('chess', roomId)[1]).toMatchObject({ kind: 'ai', uid: null });
      expect(gateway.store.has('chess', roomId)).toBe(true);
      expect(gateway.store.seatsOf('chess', roomId)[0]).toMatchObject({ kind: 'human', uid: 'ada' });
      // And ada was TOLD, without asking — a stalled board that only fixes itself on refresh is
      // the same bug wearing a hat.
      const last = ada.pushes.filter((m) => m.t === 'room').at(-1) as Extract<ServerMsg, { t: 'room' }>;
      expect(last.snapshot?.seats[1]).toMatchObject({ kind: 'ai' });
      ada.close();
    });

    it('a reconnect inside the grace window keeps the seat — a blip is not a departure', async () => {
      const { ada, bob, roomId } = await playingTable();
      bob.kill();

      // Bob's client comes back and replays presence, exactly as socket.ts does on reconnect.
      const bob2 = await Client.open(url, 'bob');
      bob2.fire({ t: 'subscribe', gameId: 'chess', roomId });
      bob2.fire({ t: 'presence', gameId: 'chess', roomId });
      await bob2.waitFor((m) => m.t === 'room');

      await waitOutGrace();
      // The armed release was cancelled: bob still owns his own seat and no bot ever appeared.
      expect(gateway.store.seatsOf('chess', roomId)[1]).toMatchObject({ kind: 'human', uid: 'bob' });
      ada.close();
      bob2.close();
    });

    it('decides ai-vs-open when the timer FIRES, not when it is armed', async () => {
      // Bob drops in the LOBBY (a departure there should open the chair) and the host starts the
      // game during the window. A fallback fixed at arm time would open a seat mid-game.
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
      const roomId = okValue(created) as string;
      const bob = await Client.open(url, 'bob');
      await bob.request({ t: 'claimSeat', gameId: 'chess', roomId, index: 1, who: { uid: 'bob', name: 'Bob' } });
      for (const c of [ada, bob]) {
        c.fire({ t: 'subscribe', gameId: 'chess', roomId });
        c.fire({ t: 'presence', gameId: 'chess', roomId });
      }
      await ada.waitFor((m) => m.t === 'room' && m.snapshot?.presence.bob === true);

      bob.kill();
      // WAIT for the server to have SEEN the disconnect (it re-broadcasts with bob's presence
      // gone) before starting the game. Without this the close can land after `setStatus` and the
      // release gets armed while already `playing` — which makes arm-time and fire-time
      // indistinguishable and the assertion below vacuous. This test passed against a deliberately
      // arm-time implementation until the wait was added.
      await ada.waitFor((m) => m.t === 'room' && m.snapshot?.presence.bob === undefined);
      expect(gateway.store.statusOf('chess', roomId)).toBe('waiting'); // armed in the LOBBY

      await ada.request({ t: 'setStatus', gameId: 'chess', roomId, status: 'playing' });
      await waitOutGrace();
      expect(gateway.store.seatsOf('chess', roomId)[1]).toMatchObject({ kind: 'ai' });
      ada.close();
    });

    it('opens the chair instead when the drop happens in the lobby', async () => {
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
      const roomId = okValue(created) as string;
      const bob = await Client.open(url, 'bob');
      await bob.request({ t: 'claimSeat', gameId: 'chess', roomId, index: 1, who: { uid: 'bob', name: 'Bob' } });
      for (const c of [ada, bob]) {
        c.fire({ t: 'subscribe', gameId: 'chess', roomId });
        c.fire({ t: 'presence', gameId: 'chess', roomId });
      }
      await ada.waitFor((m) => m.t === 'room' && m.snapshot?.presence.bob === true);

      bob.kill();
      await waitOutGrace();
      // Waiting room: free the chair for the next human rather than spawning a bot into a game
      // that has not started.
      expect(gateway.store.seatsOf('chess', roomId)[1]).toMatchObject({ kind: 'open', uid: null });
      ada.close();
    });

    it('releases a seat held by a socket that never declared presence', async () => {
      // The leak finding 3 names: the close path used to walk the connection's presence set alone,
      // so a seat claimed without presence survived the disconnect forever.
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
      const roomId = okValue(created) as string;
      ada.fire({ t: 'subscribe', gameId: 'chess', roomId });
      ada.fire({ t: 'presence', gameId: 'chess', roomId });
      await ada.waitFor((m) => m.t === 'room' && m.snapshot?.presence.ada === true);

      const bob = await Client.open(url, 'bob');
      await bob.request({ t: 'claimSeat', gameId: 'chess', roomId, index: 1, who: { uid: 'bob', name: 'Bob' } });
      bob.kill(); // never sent a `presence` frame

      await waitOutGrace();
      expect(gateway.store.seatsOf('chess', roomId)[1]).toMatchObject({ kind: 'open', uid: null });
      ada.close();
    });

    it('a second tab of the same account is not a departure', async () => {
      const { ada, bob, roomId } = await playingTable();
      // Bob opens a second tab: same uid, a second socket, presence declared again.
      const bobTab2 = await Client.open(url, 'bob');
      bobTab2.fire({ t: 'subscribe', gameId: 'chess', roomId });
      bobTab2.fire({ t: 'presence', gameId: 'chess', roomId });
      await bobTab2.waitFor((m) => m.t === 'room');

      bob.kill(); // closing ONE tab
      await waitOutGrace();
      // Presence is per-uid, not per-socket: the surviving tab keeps both the seat and the mark.
      expect(gateway.store.seatsOf('chess', roomId)[1]).toMatchObject({ kind: 'human', uid: 'bob' });
      const snap = gateway.store.snapshot('chess', roomId);
      expect(snap?.presence.bob).toBe(true);
      ada.close();
      bobTab2.close();
    });

    it('GCs immediately when the crash empties the room — nobody left to be gracious to', async () => {
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({ t: 'create', gameId: 'chess', host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
      const roomId = okValue(created) as string;
      ada.fire({ t: 'subscribe', gameId: 'chess', roomId });
      ada.fire({ t: 'presence', gameId: 'chess', roomId });
      await ada.waitFor((m) => m.t === 'room' && m.snapshot?.presence.ada === true);
      await ada.request({ t: 'writePrivate', gameId: 'chess', roomId, index: 0, data: { hand: ['secret'] } });
      await ada.request({ t: 'chatSend', gameId: 'chess', roomId, message: { uid: 'ada', name: 'Ada', text: 'hi' } });

      ada.kill();
      await sleep(GRACE_MS / 3); // no waiting out the window — an empty room goes at once
      // The room, its chat and its hidden hands are one record, so this single assertion is the
      // whole of "no orphaned rooms/hands/chat nodes" on this path.
      expect(gateway.store.has('chess', roomId)).toBe(false);
      expect(gateway.store.getPrivate('chess', roomId, 0)).toBeNull();
      expect(gateway.store.chatMessages('chess', roomId, 50)).toEqual([]);
    });
  });

  /**
   * THE ROOM BROWSER (V1_FEATURE_GAPS #9), over the wire. The store test proves WHAT is listable;
   * this proves the index reaches a socket that asked, changes when the table does, and stops when
   * it says stop — the three ways a browser goes stale instead of wrong.
   */
  describe('the open-table index', () => {
    /** The rooms in the newest `open` frame this client received. */
    const latestOpen = (c: Client): readonly { roomId: string; gameId: string }[] => {
      const frames = c.pushes.filter((m): m is Extract<ServerMsg, { t: 'open' }> => m.t === 'open');
      return frames[frames.length - 1]?.rooms ?? [];
    };

    it('pushes the index on browse, and a table appears only once somebody is at it', async () => {
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({ t: 'create', gameId: 'uno', host: { uid: 'ada', name: 'Ada' }, seatCount: 4 });
      const roomId = okValue(created) as string;

      const bob = await Client.open(url, 'bob');
      bob.fire({ t: 'browse' });
      // The immediate answer: the table exists but nobody has declared presence, so it is not
      // advertised — the ghost-room case, enforced end to end rather than only in the store.
      const first = (await bob.waitFor((m) => m.t === 'open')) as Extract<ServerMsg, { t: 'open' }>;
      expect(first.rooms).toEqual([]);

      ada.fire({ t: 'presence', gameId: 'uno', roomId });
      await bob.waitForPush((m) => m.t === 'open' && m.rooms.length === 1);
      expect(latestOpen(bob)[0]).toMatchObject({ gameId: 'uno', roomId, hostName: 'Ada', openSeats: 3 });
      ada.close();
      bob.close();
    });

    it('a seat claim and a start both reach a browser without it asking', async () => {
      const ada = await Client.open(url, 'ada');
      const created = await ada.request({ t: 'create', gameId: 'uno', host: { uid: 'ada', name: 'Ada' }, seatCount: 4 });
      const roomId = okValue(created) as string;
      ada.fire({ t: 'presence', gameId: 'uno', roomId });

      const cara = await Client.open(url, 'cara');
      cara.fire({ t: 'browse' });
      await cara.waitForPush((m) => m.t === 'open' && m.rooms.length === 1);

      await cara.request({ t: 'claimSeat', gameId: 'uno', roomId, index: 1, who: { uid: 'cara', name: 'Cara' } });
      const filled = (await cara.waitForPush(
        (m) => m.t === 'open' && (m.rooms[0]?.players ?? 0) === 2
      )) as Extract<ServerMsg, { t: 'open' }>;
      expect(filled.rooms[0]).toMatchObject({ players: 2, openSeats: 2 });

      // The one that matters most: a started table must leave the index, or the browser sends
      // joiners at a game already in progress.
      await ada.request({ t: 'setStatus', gameId: 'uno', roomId, status: 'playing' });
      await cara.waitForPush((m) => m.t === 'open' && m.rooms.length === 0);
      expect(latestOpen(cara)).toEqual([]);
      ada.close();
      cara.close();
    });

    it('never lists a private table, and reads an unknown visibility as private', async () => {
      const ada = await Client.open(url, 'ada');
      const priv = okValue(
        await ada.request({ t: 'create', gameId: 'uno', host: { uid: 'ada', name: 'Ada' }, seatCount: 4, visibility: 'private' })
      ) as string;
      // A hostile/garbled value must not fall through to `public`: the two failure modes are not
      // symmetric, and guessing `public` publishes a table nobody chose to publish.
      const junk = okValue(
        await ada.request({
          t: 'create',
          gameId: 'uno',
          host: { uid: 'ada', name: 'Ada' },
          seatCount: 4,
          visibility: 'PUBLIC' as unknown as 'public',
        })
      ) as string;
      ada.fire({ t: 'presence', gameId: 'uno', roomId: priv });
      ada.fire({ t: 'presence', gameId: 'uno', roomId: junk });

      const bob = await Client.open(url, 'bob');
      bob.fire({ t: 'browse' });
      await bob.waitFor((m) => m.t === 'open');
      // Give both presence frames time to fan out before asserting an ABSENCE.
      await sleep(50);
      expect(latestOpen(bob)).toEqual([]);
      ada.close();
      bob.close();
    });

    it('stops pushing after unbrowse', async () => {
      const ada = await Client.open(url, 'ada');
      const bob = await Client.open(url, 'bob');
      bob.fire({ t: 'browse' });
      await bob.waitFor((m) => m.t === 'open');
      bob.fire({ t: 'unbrowse' });

      const before = bob.pushes.filter((m) => m.t === 'open').length;
      const created = await ada.request({ t: 'create', gameId: 'uno', host: { uid: 'ada', name: 'Ada' }, seatCount: 4 });
      ada.fire({ t: 'presence', gameId: 'uno', roomId: okValue(created) as string });
      await sleep(50);
      expect(bob.pushes.filter((m) => m.t === 'open').length).toBe(before);
      ada.close();
      bob.close();
    });
  });

});
