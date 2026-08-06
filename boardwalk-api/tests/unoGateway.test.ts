/**
 * THE UNO DEALER, OVER A REAL SOCKET — the end-to-end half of the pot.
 *
 * `uno.test.ts` proves the rules and the money against the database directly. This file proves what
 * actually reaches a player, by reading the frames rather than asking the projection what it would
 * have said.
 *
 * Two cases carry the weight, and they are the two things that changed about UNO:
 *
 *  • **A player is sent their own hand and NOTHING for anyone else's.** UNO used to be the game
 *    where one client legitimately held every hand — the host WAS the dealer. It no longer is, so
 *    the host now gets exactly what everybody else gets, and the deck is written nowhere at all.
 *  • **The stake is not on the wire.** `unoStart` has no `anteCents`, so the ante that gets charged
 *    is the one stamped on the room at create — and a client that sends one anyway is charged the
 *    room's, not its own. That is asserted with a hostile frame, because "the field does not exist"
 *    is a claim about the wire and the wire is what a hostile client talks to.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RoomGateway } from '../src/rooms/gateway';
import { RoomStore } from '../src/rooms/store';
import { parseMove, parseLevel } from '../src/rooms/unoDealer';
import { decodeFrame } from '../src/rooms/protocol';
import { openDb, type Db } from '../src/db/db';
import { upsertProfile, balanceOf } from '../src/domain/profile';
import { STARTING_BANKROLL_CENTS } from '../src/domain/economy';
import { GAME_ID } from '../src/domain/uno';
import type { UnoState } from '@boardwalk/game-logic/games/uno';

const ANTE = 2_500;

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
  snapshot?: { state?: unknown; seats?: unknown[]; meta?: { anteCents?: number } } | null;
}

/** A promise-shaped client, the same shape `ldGateway.test.ts` uses. */
class Client {
  private nextId = 1;
  readonly seen: Frame[] = [];
  private constructor(readonly ws: WebSocket) {}

  static async open(url: string, token: string): Promise<Client> {
    const ws = new WebSocket(url);
    const client = new Client(ws);
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
      const timer = setTimeout(() => {
        reject(new Error('timeout waiting for frame'));
      }, ms);
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
  lastState(): UnoState | undefined {
    const rooms = this.seen.filter((f) => f.t === 'room' && f.snapshot != null);
    return rooms[rooms.length - 1]?.snapshot?.state as UnoState | undefined;
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

describe('the UNO dealer, over a real socket', () => {
  let server: Server;
  let db: Db;
  let url: string;

  beforeEach(async () => {
    db = openDb(':memory:');
    for (const uid of ['ada', 'bob', 'mallory'])
      upsertProfile(db, uid, { name: uid, avatar: '👤', equipped: {} }, { now: 1 });
    server = createServer();
    const gateway = new RoomGateway(fakeVerifier, new RoomStore(() => 1_000), 60, db);
    gateway.attach(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}/rooms`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Ada hosts a started 2-seat table with Bob, at `ante`. Both present and subscribed. */
  async function table(ante = ANTE): Promise<{ ada: Client; bob: Client; roomId: string }> {
    const ada = await Client.open(url, 'ada');
    const created = await ada.request({
      t: 'create',
      gameId: GAME_ID,
      host: { uid: 'ada', name: 'Ada' },
      seatCount: 2,
      anteCents: ante,
    });
    const roomId = created.value as string;
    const bob = await Client.open(url, 'bob');
    for (const [c, uid, name, i] of [
      [ada, 'ada', 'Ada', 0],
      [bob, 'bob', 'Bob', 1],
    ] as const) {
      await c.request({ t: 'claimSeat', gameId: GAME_ID, roomId, index: i, who: { uid, name } });
      c.fire({ t: 'subscribe', gameId: GAME_ID, roomId });
      c.fire({ t: 'presence', gameId: GAME_ID, roomId });
    }
    await ada.request({ t: 'setStatus', gameId: GAME_ID, roomId, status: 'playing' });
    return { ada, bob, roomId };
  }

  it('deals: each player is sent their OWN hand and null for the other seat — the HOST included', async () => {
    // The assertion the whole cutover exists for. Under host-as-dealer Ada legitimately held both
    // hands in memory; now she is a player like any other and Bob's cards never reach her socket.
    const { ada, bob, roomId } = await table();
    ada.fire({ t: 'subPrivate', gameId: GAME_ID, roomId, index: 0 });
    ada.fire({ t: 'subPrivate', gameId: GAME_ID, roomId, index: 1 }); // Ada spying on Bob's hand
    bob.fire({ t: 'subPrivate', gameId: GAME_ID, roomId, index: 1 });

    const started = await ada.request({
      t: 'unoStart',
      gameId: GAME_ID,
      roomId,
      nonce: 'n1',
      level: 'sharp',
    });
    expect(started.ok).toBe(true);
    await sleep(120);

    expect((ada.privatesFor(0).at(-1)?.data as unknown[] | null)?.length).toBe(7);
    for (const frame of ada.privatesFor(1)) expect(frame.data).toBeNull();
    expect((bob.privatesFor(1).at(-1)?.data as unknown[] | null)?.length).toBe(7);

    ada.close();
    bob.close();
  });

  it('publishes counts and a pot, and NO card anywhere in the payload', async () => {
    const { ada, bob, roomId } = await table();
    await ada.request({ t: 'unoStart', gameId: GAME_ID, roomId, nonce: 'n1', level: 'sharp' });
    await sleep(120);

    const state = ada.lastState();
    expect(state?.counts).toEqual([7, 7]);
    expect(state?.potCents).toBe(ANTE * 2);

    // Structural: the failure guarded against is a FIELD APPEARING, so scan the serialised frame
    // rather than only the fields this test happens to know the names of. 108 cards minus 14 dealt
    // minus one turned up would all be in `deck` if the projection ever grew one.
    const frame = ada.seen.filter((f) => f.t === 'room').at(-1);
    const json = JSON.stringify(frame);
    expect(json).not.toContain('"deck"');
    expect(json).not.toContain('"hands"');
    // And the host-as-dealer intent lane is gone from the wire, not merely unused.
    expect(json).not.toContain('"pending"');
    expect(json).not.toContain('"ackNonce"');

    ada.close();
    bob.close();
  });

  /**
   * THE STAKE IS THE ROOM'S, NOT THE SENDER'S.
   *
   * `unoStart` has no `anteCents` field. A hostile host sending one anyway must be charged the ante
   * the table was created at — the one Bob agreed to when he sat down — and not the one Ada just
   * made up. Without this the game is perfectly FAIR and played at stakes nobody consented to,
   * which is the failure a validated-but-present field would still permit.
   */
  it('ignores a stake a client tries to name, and charges the table’s own', async () => {
    const { ada, bob, roomId } = await table(ANTE);
    const started = await ada.request({
      t: 'unoStart',
      gameId: GAME_ID,
      roomId,
      nonce: 'n1',
      level: 'sharp',
      anteCents: 400_000, // not a field; there is nowhere for this to go
      potCents: 999_999,
      payoutCents: 999_999,
    });
    expect(started.ok).toBe(true);
    await sleep(120);

    expect(ada.lastState()?.potCents).toBe(ANTE * 2);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - ANTE);
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS - ANTE);

    ada.close();
    bob.close();
  });

  it('takes both antes at the deal and answers the dealer with an authoritative profile', async () => {
    const { ada, bob, roomId } = await table();
    const started = await ada.request({
      t: 'unoStart',
      gameId: GAME_ID,
      roomId,
      nonce: 'n1',
      level: 'sharp',
    });
    // The reply carries the PROFILE, because the state arrives on the subscription and the balance
    // does not — Liar's Dice answered `void` at first and both top bars kept saying $5,000.
    expect((started.value as { bankrollCents: number }).bankrollCents).toBe(
      STARTING_BANKROLL_CENTS - ANTE
    );
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS - ANTE);

    ada.close();
    bob.close();
  });

  it('refuses a deal from a player who is not the host', async () => {
    const { ada, bob, roomId } = await table();
    const res = await bob.request({
      t: 'unoStart',
      gameId: GAME_ID,
      roomId,
      nonce: 'n1',
      level: 'sharp',
    });
    expect(res.ok).toBe(false);
    ada.close();
    bob.close();
  });

  it('refuses a move from a socket holding no seat, and from a seat off turn', async () => {
    const { ada, bob, roomId } = await table();
    await ada.request({ t: 'unoStart', gameId: GAME_ID, roomId, nonce: 'n1', level: 'sharp' });
    await sleep(120);

    const mallory = await Client.open(url, 'mallory');
    const outsider = await mallory.request({
      t: 'unoMove',
      gameId: GAME_ID,
      roomId,
      nonce: 'm1',
      move: { type: 'draw' },
    });
    expect(outsider.ok).toBe(false);

    // Whoever is NOT on turn is refused; the reducer is total, so this refusal is the message, not
    // the safety.
    const turn = ada.lastState()?.turn ?? 0;
    const offTurn = turn === 0 ? bob : ada;
    const res = await offTurn.request({
      t: 'unoMove',
      gameId: GAME_ID,
      roomId,
      nonce: 'm2',
      move: { type: 'draw' },
    });
    expect(res.ok).toBe(false);

    mallory.close();
    ada.close();
    bob.close();
  });

  it('a bot seat is driven by the REFEREE, with its hand written nowhere', async () => {
    // The AI-as-occupant rule with the host taken out of it: no client asked for this move, and a
    // table whose humans have all closed their tabs still finishes and still settles.
    const ada = await Client.open(url, 'ada');
    const created = await ada.request({
      t: 'create',
      gameId: GAME_ID,
      host: { uid: 'ada', name: 'Ada' },
      seatCount: 2,
      anteCents: 0,
    });
    const roomId = created.value as string;
    await ada.request({ t: 'claimSeat', gameId: GAME_ID, roomId, index: 0, who: { uid: 'ada', name: 'Ada' } });
    await ada.request({ t: 'setAi', gameId: GAME_ID, roomId, index: 1, name: 'CPU' });
    ada.fire({ t: 'subscribe', gameId: GAME_ID, roomId });
    ada.fire({ t: 'subPrivate', gameId: GAME_ID, roomId, index: 1 }); // the bot's seat
    ada.fire({ t: 'presence', gameId: GAME_ID, roomId });
    await ada.request({ t: 'setStatus', gameId: GAME_ID, roomId, status: 'playing' });
    await ada.request({ t: 'unoStart', gameId: GAME_ID, roomId, nonce: 'n1', level: 'sharp' });
    await sleep(150);

    // If the bot opened, the referee moved it with nobody asking. Either way its hand was never
    // written to a private node — there is nobody to read it, and a written one is a future bug's
    // opportunity.
    for (const frame of ada.privatesFor(1)) expect(frame.data).toBeNull();
    ada.close();
  });
});

describe('parseMove / parseLevel — refuse, never coerce', () => {
  it('accepts the two real moves and drops every field it does not name', () => {
    expect(parseMove({ type: 'draw' })).toEqual({ type: 'draw' });
    expect(parseMove({ type: 'play', cardId: 'r5' })).toEqual({
      type: 'play',
      cardId: 'r5',
      declareUno: false,
    });
    expect(parseMove({ type: 'play', cardId: 'w1', chosenColor: 'blue', declareUno: true })).toEqual(
      { type: 'play', cardId: 'w1', declareUno: true, chosenColor: 'blue' }
    );
    // A hostile frame's extras have nowhere to go — not validated and rejected, simply absent.
    expect(
      parseMove({ type: 'play', cardId: 'r5', payoutCents: 999, outcome: 'win', winner: 0 })
    ).toEqual({ type: 'play', cardId: 'r5', declareUno: false });
  });

  it('refuses anything that is not a move rather than coercing it to one', () => {
    // The reducer is total, so a coerced malformed move would be a silent no-op — which reads to
    // the player as a click that did nothing rather than an error.
    for (const bad of [null, 'draw', 42, [], {}, { type: 'fold' }, { type: 'play' }, { type: 'play', cardId: '' }]) {
      expect(parseMove(bad)).toBeNull();
    }
    expect(parseMove({ type: 'play', cardId: 'w1', chosenColor: 'octarine' })).toEqual({
      type: 'play',
      cardId: 'w1',
      declareUno: false,
    });
  });

  it('reads an unknown difficulty as the level the game shipped with', () => {
    expect(parseLevel('casual')).toBe('casual');
    expect(parseLevel('sharp')).toBe('sharp');
    for (const bad of [undefined, null, 'perfect', 7, {}]) expect(parseLevel(bad)).toBe('sharp');
  });
});

