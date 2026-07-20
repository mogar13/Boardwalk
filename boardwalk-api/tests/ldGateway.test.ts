/**
 * THE DEALER, OVER A REAL SOCKET — the end-to-end half of Phase E.
 *
 * `liarsDice.test.ts` proves the rules and the money against the database directly. This file
 * proves the thing that actually matters to a player: what arrives on the wire. The central case
 * is the one the whole phase exists for — **a player subscribed to another seat's private node
 * receives `null`, and the public state carries no dice at all** — and it is asserted by reading
 * the frames, not by asking the projection what it would have said.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RoomGateway } from '../src/rooms/gateway';
import { RoomStore } from '../src/rooms/store';
import { parseAction } from '../src/rooms/liarsDiceDealer';
import { decodeFrame } from '../src/rooms/protocol';
import { openDb, type Db } from '../src/db/db';
import { upsertProfile, balanceOf } from '../src/domain/profile';
import { STARTING_BANKROLL_CENTS } from '../src/domain/economy';
import { GAME_ID } from '../src/domain/liarsDice';
import type { LiarsDicePublic } from '@boardwalk/game-logic/games/liars-dice';

const fakeVerifier = {
  verify: (token: string): Promise<string> =>
    token.startsWith('bad') ? Promise.reject(new Error('bad')) : Promise.resolve(token),
};

interface Frame {
  t: string;
  id?: number;
  ok?: boolean;
  error?: string;
  value?: unknown;
  gameId?: string;
  roomId?: string;
  index?: number;
  data?: unknown;
  snapshot?: { state?: unknown; seats?: unknown[] } | null;
}

/** A promise-shaped client, the same shape `gateway.test.ts` uses. */
class Client {
  private nextId = 1;
  readonly seen: Frame[] = [];
  private constructor(readonly ws: WebSocket) {}

  static async open(url: string, token: string): Promise<Client> {
    const ws = new WebSocket(url);
    const client = new Client(ws);
    // `decodeFrame`, not `String(raw)` — only the Buffer arm of ws's RawData union
    // stringifies to its contents, and the other two silently yield junk.
    ws.on('message', (raw) => client.seen.push(JSON.parse(decodeFrame(raw)) as Frame));
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(JSON.stringify({ t: 'hello', token }));
    await client.waitFor((f) => f.t === 'ready');
    return client;
  }

  async request(msg: Record<string, unknown>): Promise<Frame> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ ...msg, id }));
    return this.waitFor((f) => f.t === 'res' && f.id === id);
  }

  fire(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor(pred: (f: Frame) => boolean, ms = 2_000): Promise<Frame> {
    const hit = this.seen.find(pred);
    if (hit !== undefined) return hit;
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('timeout waiting for frame')); }, ms);
      const onMessage = (raw: WebSocket.RawData): void => {
        const frame = JSON.parse(decodeFrame(raw)) as Frame;
        if (!pred(frame)) return;
        clearTimeout(timer);
        this.ws.off('message', onMessage);
        resolve(frame);
      };
      this.ws.on('message', onMessage);
    });
  }

  /** Every `private` frame this socket has been sent for a seat. */
  privatesFor(index: number): Frame[] {
    return this.seen.filter((f) => f.t === 'private' && f.index === index);
  }

  /** The latest public state this socket saw. */
  lastState(): LiarsDicePublic | undefined {
    const rooms = this.seen.filter((f) => f.t === 'room' && f.snapshot != null);
    const last = rooms[rooms.length - 1];
    return last?.snapshot?.state as LiarsDicePublic | undefined;
  }

  close(): void { this.ws.close(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the Liar\'s Dice dealer, over a real socket', () => {
  let server: Server;
  let gateway: RoomGateway;
  let db: Db;
  let url: string;

  beforeEach(async () => {
    db = openDb(':memory:');
    for (const uid of ['ada', 'bob', 'mallory'])
      upsertProfile(db, uid, { name: uid, avatar: '👤', equipped: {} }, { now: 1 });
    server = createServer();
    gateway = new RoomGateway(fakeVerifier, new RoomStore(() => 1_000), 60, db);
    gateway.attach(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}/rooms`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Ada hosts a started 2-seat table with Bob; both present and subscribed to both seats. */
  async function table(): Promise<{ ada: Client; bob: Client; roomId: string }> {
    const ada = await Client.open(url, 'ada');
    const created = await ada.request({ t: 'create', gameId: GAME_ID, host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
    const roomId = created.value as string;
    const bob = await Client.open(url, 'bob');
    for (const [c, uid, name, i] of [[ada, 'ada', 'Ada', 0], [bob, 'bob', 'Bob', 1]] as const) {
      await c.request({ t: 'claimSeat', gameId: GAME_ID, roomId, index: i, who: { uid, name } });
      c.fire({ t: 'subscribe', gameId: GAME_ID, roomId });
      c.fire({ t: 'presence', gameId: GAME_ID, roomId });
    }
    await ada.request({ t: 'setStatus', gameId: GAME_ID, roomId, status: 'playing' });
    return { ada, bob, roomId };
  }

  it('deals a match: each player is sent their OWN cup and null for the other seat', async () => {
    // The whole phase in one assertion. In UNO the host legitimately holds every hand; here nobody
    // does, so a bystander subscribing to a seat they do not own gets `null` — not a filtered
    // payload, not an error, just nothing, forever.
    const { ada, bob, roomId } = await table();
    ada.fire({ t: 'subPrivate', gameId: GAME_ID, roomId, index: 0 });
    ada.fire({ t: 'subPrivate', gameId: GAME_ID, roomId, index: 1 }); // Ada spying on Bob's cup
    bob.fire({ t: 'subPrivate', gameId: GAME_ID, roomId, index: 1 });

    const started = await ada.request({ t: 'ldStart', gameId: GAME_ID, roomId, nonce: 'n1', anteCents: 1_000 });
    expect(started.ok).toBe(true);
    await sleep(120);

    const ownCup = ada.privatesFor(0).at(-1)?.data as { dice: number[] } | null;
    expect(ownCup?.dice).toHaveLength(5);

    // Every frame Ada ever received for Bob's seat carries no dice.
    for (const frame of ada.privatesFor(1)) expect(frame.data).toBeNull();
    const bobCup = bob.privatesFor(1).at(-1)?.data as { dice: number[] } | null;
    expect(bobCup?.dice).toHaveLength(5);

    ada.close();
    bob.close();
  });

  it('publishes a public state with counts and NO dice anywhere in the payload', async () => {
    const { ada, bob, roomId } = await table();
    await ada.request({ t: 'ldStart', gameId: GAME_ID, roomId, nonce: 'n1', anteCents: 0 });
    await sleep(120);

    const state = ada.lastState();
    expect(state?.counts).toEqual([5, 5]);
    expect(state?.revealed).toEqual([]);
    expect(state?.total).toBe(10);

    // Structural: the failure guarded against is a FIELD APPEARING, so scan the serialised frame
    // rather than the fields we happen to know about.
    const roomFrames = ada.seen.filter((f) => f.t === 'room');
    for (const frame of roomFrames) expect(JSON.stringify(frame)).not.toContain('"dice"');

    ada.close();
    bob.close();
  });

  it('takes the antes and pays the pot, all without a client naming a number', async () => {
    const { ada, bob, roomId } = await table();
    await ada.request({ t: 'ldStart', gameId: GAME_ID, roomId, nonce: 'n1', anteCents: 1_000 });
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - 1_000);
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS - 1_000);

    // Drive to a finish by hand: one die each, Ada over-bids, Bob challenges.
    const id = (db.prepare('SELECT id FROM liars_dice_matches').get() as { id: number }).id;
    const state = JSON.parse((db.prepare('SELECT state_json FROM liars_dice_matches WHERE id = ?').get(id) as { state_json: string }).state_json) as Record<string, unknown>;
    db.prepare('UPDATE liars_dice_matches SET state_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...state, dice: [[3], [5]], turn: 0 }), id);

    await ada.request({ t: 'ldAction', gameId: GAME_ID, roomId, nonce: 'a1', action: { type: 'bid', quantity: 2, face: 3 } });
    await bob.request({ t: 'ldAction', gameId: GAME_ID, roomId, nonce: 'b1', action: { type: 'challenge' } });
    await sleep(120);

    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS - 1_000 + 2_000);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - 1_000);
    // And at the reveal, every cup is finally public — because the RULES say so, not the renderer.
    expect(ada.lastState()?.revealed).toHaveLength(2);

    ada.close();
    bob.close();
  });

  it('refuses an action from a socket that holds no seat at the table', async () => {
    const { ada, bob, roomId } = await table();
    await ada.request({ t: 'ldStart', gameId: GAME_ID, roomId, nonce: 'n1', anteCents: 0 });

    const mallory = await Client.open(url, 'mallory');
    const res = await mallory.request({ t: 'ldAction', gameId: GAME_ID, roomId, nonce: 'm1', action: { type: 'challenge' } });
    expect(res.ok).toBe(false);

    ada.close(); bob.close(); mallory.close();
  });

  it('refuses an action out of turn, and a start from a non-host', async () => {
    const { ada, bob, roomId } = await table();
    await ada.request({ t: 'ldStart', gameId: GAME_ID, roomId, nonce: 'n1', anteCents: 0 });

    const outOfTurn = await bob.request({ t: 'ldAction', gameId: GAME_ID, roomId, nonce: 'b1', action: { type: 'bid', quantity: 2, face: 3 } });
    expect(outOfTurn.ok).toBe(false);

    const notHost = await bob.request({ t: 'ldStart', gameId: GAME_ID, roomId, nonce: 'b2', anteCents: 0 });
    expect(notHost.ok).toBe(false);

    ada.close(); bob.close();
  });

  it('drives a bot seat with no client asking, and never leaks its cup', async () => {
    // No host holds this game, so a bot plays because the REFEREE decided to — which is also why a
    // table whose humans have all left still finishes and still settles.
    const ada = await Client.open(url, 'ada');
    const created = await ada.request({ t: 'create', gameId: GAME_ID, host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
    const roomId = created.value as string;
    await ada.request({ t: 'claimSeat', gameId: GAME_ID, roomId, index: 0, who: { uid: 'ada', name: 'Ada' } });
    await ada.request({ t: 'setAi', gameId: GAME_ID, roomId, index: 1, name: 'CPU' });
    ada.fire({ t: 'subscribe', gameId: GAME_ID, roomId });
    ada.fire({ t: 'subPrivate', gameId: GAME_ID, roomId, index: 1 });
    await ada.request({ t: 'setStatus', gameId: GAME_ID, roomId, status: 'playing' });
    await ada.request({ t: 'ldStart', gameId: GAME_ID, roomId, nonce: 'n1', anteCents: 0 });

    await ada.request({ t: 'ldAction', gameId: GAME_ID, roomId, nonce: 'a1', action: { type: 'bid', quantity: 2, face: 3 } });
    // The bot's turn arrives on a timer nobody triggered.
    await ada.waitFor((f) => {
      // A room frame carries `state: null` until the first publish, so guard the null too — not
      // just `undefined`. The bot's move is what puts the turn back on seat 0.
      const s = f.t === 'room' ? (f.snapshot?.state as LiarsDicePublic | null | undefined) : undefined;
      return s != null && (s.turn === 0 || s.phase !== 'bidding');
    }, 4_000);

    // A bot's dice are written nowhere — there is nobody to read them.
    for (const frame of ada.privatesFor(1)) expect(frame.data).toBeNull();
    ada.close();
  });

  it('refuses ldStart before the table has started', async () => {
    const ada = await Client.open(url, 'ada');
    const created = await ada.request({ t: 'create', gameId: GAME_ID, host: { uid: 'ada', name: 'Ada' }, seatCount: 2 });
    const roomId = created.value as string;
    await ada.request({ t: 'claimSeat', gameId: GAME_ID, roomId, index: 0, who: { uid: 'ada', name: 'Ada' } });
    const res = await ada.request({ t: 'ldStart', gameId: GAME_ID, roomId, nonce: 'n1', anteCents: 0 });
    expect(res.ok).toBe(false);
    ada.close();
  });

  it('a replayed action frame changes nothing — the socket outbox replays on reconnect', async () => {
    const { ada, bob, roomId } = await table();
    await ada.request({ t: 'ldStart', gameId: GAME_ID, roomId, nonce: 'n1', anteCents: 0 });
    await ada.request({ t: 'ldAction', gameId: GAME_ID, roomId, nonce: 'a1', action: { type: 'bid', quantity: 2, face: 3 } });
    const first = ada.lastState()?.bid;

    const again = await ada.request({ t: 'ldAction', gameId: GAME_ID, roomId, nonce: 'a1', action: { type: 'bid', quantity: 9, face: 6 } });
    expect(again.ok).toBe(true);
    expect(ada.lastState()?.bid).toEqual(first);

    ada.close(); bob.close();
  });
});

describe('parseAction', () => {
  it('accepts the three real actions and refuses everything else', () => {
    expect(parseAction({ type: 'challenge' })).toEqual({ type: 'challenge' });
    expect(parseAction({ type: 'spotOn' })).toEqual({ type: 'spotOn' });
    expect(parseAction({ type: 'bid', quantity: 3, face: 4 })).toEqual({ type: 'bid', quantity: 3, face: 4 });

    // Refused rather than coerced: the reducer is total, so a coerced action would silently no-op
    // and read to the player as a click that did nothing rather than an error.
    expect(parseAction(null)).toBeNull();
    expect(parseAction('challenge')).toBeNull();
    expect(parseAction({ type: 'bid', quantity: 2.5, face: 4 })).toBeNull();
    expect(parseAction({ type: 'bid', quantity: 3, face: 9 })).toBeNull();
    expect(parseAction({ type: 'bid', quantity: 3, face: 0 })).toBeNull();
    expect(parseAction({ type: 'bid', quantity: '3', face: 4 })).toBeNull();
    expect(parseAction({ type: 'nope' })).toBeNull();
  });

  it('ignores extra fields a hostile client might attach', () => {
    // There is no field here for a payout, an outcome or a die — but a client can always PUT one
    // on the wire, so assert that what comes out is exactly the action and nothing more.
    expect(
      parseAction({ type: 'challenge', payoutCents: 1_000_000, dice: [6, 6, 6], winner: 0 })
    ).toEqual({ type: 'challenge' });
  });
});
