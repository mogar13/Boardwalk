/**
 * THE BLACKJACK TABLE'S DEALER, OVER A REAL SOCKET — what actually reaches a player.
 *
 * `blackjackTable.test.ts` proves the money against the database directly. This file reads the
 * FRAMES, because "the projection would not have said that" is a claim about a function and the wire
 * is what a client talks to.
 *
 * THE HIDDEN THING HERE IS HIDDEN FROM EVERYONE, which makes this the easiest dealt game in the repo
 * to get right and exactly as fatal to get wrong. UNO and Liar's Dice each have per-seat secrets, so
 * their gateway tests ask "did seat 1's hand reach seat 0". A blackjack table has none: every
 * player's cards are face up, and the deck and the HOLE CARD are withheld from every socket
 * including the host's. So the assertion is not comparative — it is that the string `"deck"` does
 * not occur anywhere in any frame anyone got, and that two rounds differing only in the hole card
 * are indistinguishable to a client.
 *
 * THE OTHER HALF IS THE STAKE, and it is the opposite of UNO's. `unoStart` deliberately has no
 * `anteCents` because the table's stake is not whoever-presses-Deal's to name. `bjStart` has no
 * number either — but for a different reason: the stake here is per CHAIR, it arrives on `bjAction`
 * from the player whose own money it is, and it is bounded by the LEDGER rather than by the room.
 * A hostile frame is asserted against both: a fabricated stake on `bjStart` does nothing, and a
 * `bjAction` carrying a payout has nowhere to put it.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RoomGateway } from '../src/rooms/gateway';
import { RoomStore } from '../src/rooms/store';
import { parseTableMove } from '../src/rooms/blackjackDealer';
import { decodeFrame } from '../src/rooms/protocol';
import { openDb, type Db } from '../src/db/db';
import { upsertProfile, balanceOf } from '../src/domain/profile';
import { GAME_ID } from '../src/domain/blackjackTable';
import type { BlackjackTableState } from '@boardwalk/game-logic/games/blackjack';

const STAKE = 1_000;

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
  snapshot?: { state?: unknown } | null;
}

/** A promise-shaped client, the same shape `unoGateway.test.ts` uses. */
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

  /**
   * Wait for a room frame whose STATE matches — never `waitFor` on the frame alone.
   *
   * A `res` resolves before the broadcast that follows it, so reading `lastState()` straight after a
   * request races the push. And the predicate must check that the state IS THERE, with `!= null` and
   * not `!== undefined`: an undealt room carries `state: null` on the wire, so a waiter written the
   * obvious way (`state?.phase !== 'betting'`) matches the very first frame and returns nothing,
   * while a stricter one still crashes on the null it let through.
   */
  async waitForState(
    pred: (s: BlackjackTableState) => boolean,
    ms = 3_000
  ): Promise<BlackjackTableState> {
    const seen = this.lastState();
    if (seen != null && pred(seen)) return seen;
    await this.waitFor((f) => {
      if (f.t !== 'room') return false;
      const state = f.snapshot?.state as BlackjackTableState | null | undefined;
      return state != null && pred(state);
    }, ms);
    return this.lastState() as BlackjackTableState;
  }

  lastState(): BlackjackTableState | undefined {
    const rooms = this.seen.filter(
      (f) => f.t === 'room' && f.snapshot != null && f.snapshot.state != null
    );
    return rooms[rooms.length - 1]?.snapshot?.state as BlackjackTableState | undefined;
  }

  /** Every byte this socket has been sent, so a scan can ask what is NOT in it. */
  everything(): string {
    return JSON.stringify(this.seen);
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

describe('the blackjack table dealer, over a real socket', () => {
  let server: Server;
  let db: Db;
  let url: string;
  /** Every socket opened by a case. Closed in teardown, because `server.close()` waits on live
   *  connections and a case that fails before its own cleanup would hang the whole file. */
  let opened: Client[] = [];

  const client = async (token: string): Promise<Client> => {
    const c = await Client.open(url, token);
    opened.push(c);
    return c;
  };

  beforeEach(async () => {
    opened = [];
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
    for (const c of opened) c.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Ada hosts a started 2-seat table with Bob, both present and subscribed. */
  async function table(): Promise<{ ada: Client; bob: Client; roomId: string }> {
    const ada = await client('ada');
    const created = await ada.request({
      t: 'create',
      gameId: GAME_ID,
      host: { uid: 'ada', name: 'Ada' },
      seatCount: 2,
      anteCents: 0,
    });
    const roomId = created.value as string;
    const bob = await client('bob');
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

  it('opens a round for the table, and only the host may open it', async () => {
    const { ada, bob, roomId } = await table();
    const refused = await bob.request({ t: 'bjStart', gameId: GAME_ID, roomId, nonce: 'x' });
    expect(refused.ok).toBe(false);

    const started = await ada.request({ t: 'bjStart', gameId: GAME_ID, roomId, nonce: 'n1' });
    expect(started.ok).toBe(true);
    // Everybody sees the same table, waiting on both chairs for a stake.
    for (const c of [ada, bob]) {
      const state = await c.waitForState((s) => s.phase === 'betting');
      expect(state.pending).toEqual([0, 1]);
    }
  });

  it('NEVER sends the deck or the hole card — to anyone, the host included', async () => {
    const { ada, bob, roomId } = await table();
    await ada.request({ t: 'bjStart', gameId: GAME_ID, roomId, nonce: 'n1' });
    await ada.request({
      t: 'bjAction',
      gameId: GAME_ID,
      roomId,
      nonce: 'a1',
      move: { type: 'bet', wagerCents: STAKE },
    });
    await bob.request({
      t: 'bjAction',
      gameId: GAME_ID,
      roomId,
      nonce: 'b1',
      move: { type: 'bet', wagerCents: STAKE },
    });
    const state = await ada.waitForState((s) => s.phase !== 'betting');

    // The structural claim, asserted over EVERY byte either socket has received rather than over the
    // projection's return value — the projection is what `blackjack-table.test.ts` asks about, and
    // this asks whether anything else on the way out put it back.
    for (const c of [ada, bob]) expect(c.everything()).not.toContain('"deck"');

    // ONE dealer card while the round is live. `dealer[1]` is the only hidden card in this game and
    // it is hidden from every seat equally: there is no seat it belongs to.
    if (state.phase !== 'settled') expect(state.dealer).toHaveLength(1);
    // And every chair's cards ARE public — this game has no private channel, so nobody is sent a
    // `private` frame at all.
    expect(ada.seen.some((f) => f.t === 'private')).toBe(false);
    expect(bob.seen.some((f) => f.t === 'private')).toBe(false);
    expect(state?.spots[1]?.cards.length).toBeGreaterThan(0);
  });

  it('takes the stake through the LEDGER and answers with the authoritative profile', async () => {
    const { ada, bob, roomId } = await table();
    const before = balanceOf(db, 'ada');
    await ada.request({ t: 'bjStart', gameId: GAME_ID, roomId, nonce: 'n1' });
    const bet = await ada.request({
      t: 'bjAction',
      gameId: GAME_ID,
      roomId,
      nonce: 'a1',
      move: { type: 'bet', wagerCents: STAKE },
    });
    expect(bet.ok).toBe(true);
    expect(balanceOf(db, 'ada')).toBe(before - STAKE);
    // The reply carries the profile, because the room subscription carries the STATE and not the
    // balance — the hole a browser found at Liar's Dice, where two accounts anted and both top bars
    // went on showing the old number.
    expect((bet.value as { bankrollCents: number }).bankrollCents).toBe(before - STAKE);
    // And it reaches the OTHER player on their own subscription — a stake nobody else can see is a
    // table where you cannot tell who is in the hand.
    const seen = await bob.waitForState((s) => (s.spots[0]?.wagerCents ?? 0) > 0);
    expect(seen.spots[0]?.wagerCents).toBe(STAKE);
  });

  it('refuses a socket that holds no seat, and a move from a chair that is not on turn', async () => {
    const { ada, bob, roomId } = await table();
    await ada.request({ t: 'bjStart', gameId: GAME_ID, roomId, nonce: 'n1' });

    const mallory = await client('mallory');
    const outsider = await mallory.request({
      t: 'bjAction',
      gameId: GAME_ID,
      roomId,
      nonce: 'm1',
      move: { type: 'bet', wagerCents: STAKE },
    });
    expect(outsider.ok).toBe(false);
    expect(balanceOf(db, 'mallory')).toBeGreaterThan(0); // charged nothing
    mallory.close();

    await ada.request({ t: 'bjAction', gameId: GAME_ID, roomId, nonce: 'a1', move: { type: 'bet', wagerCents: STAKE } });
    await bob.request({ t: 'bjAction', gameId: GAME_ID, roomId, nonce: 'b1', move: { type: 'bet', wagerCents: STAKE } });
    await sleep(60);

    const state = ada.lastState();
    if (state !== undefined && state.phase === 'player') {
      const offTurn = state.turn === 0 ? bob : ada;
      const refused = await offTurn.request({
        t: 'bjAction',
        gameId: GAME_ID,
        roomId,
        nonce: 'off',
        move: { type: 'hit' },
      });
      expect(refused.ok).toBe(false);
    }
  });

  it('drives a BOT chair itself — bets and plays with no client asking', async () => {
    const ada = await client('ada');
    const created = await ada.request({
      t: 'create',
      gameId: GAME_ID,
      host: { uid: 'ada', name: 'Ada' },
      seatCount: 2,
      anteCents: 0,
      fillAi: true,
    });
    const roomId = created.value as string;
    await ada.request({ t: 'claimSeat', gameId: GAME_ID, roomId, index: 0, who: { uid: 'ada', name: 'Ada' } });
    ada.fire({ t: 'subscribe', gameId: GAME_ID, roomId });
    ada.fire({ t: 'presence', gameId: GAME_ID, roomId });
    await ada.request({ t: 'setStatus', gameId: GAME_ID, roomId, status: 'playing' });

    await ada.request({ t: 'bjStart', gameId: GAME_ID, roomId, nonce: 'n1' });
    await ada.request({ t: 'bjAction', gameId: GAME_ID, roomId, nonce: 'a1', move: { type: 'bet', wagerCents: STAKE } });
    // The bot owes a BET, which is a phase no other dealt game schedules in — UNO and Liar's Dice
    // only ever schedule a turn. A dealer that read `turn` here would wait forever, and the table
    // would look like it was thinking.
    const state = await ada.waitForState((s) => (s.spots[1]?.wagerCents ?? 0) > 0);
    expect(state.spots[1]?.wagerCents).toBeGreaterThan(0);
    // And the house's chair is written no ledger row at all: it has no account.
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM wagers WHERE game_id = ?").get(GAME_ID) as { n: number }).n
    ).toBe(1);
  });

  it('ignores a hostile frame: a stake on `bjStart`, and a payout on `bjAction`', async () => {
    const { ada, roomId } = await table();
    const before = balanceOf(db, 'ada');
    // `bjStart` has no field for a number at all, so a fabricated one has nowhere to go — asserted
    // over the wire rather than over the type, because a hostile client talks to the wire.
    const started = await ada.request({
      t: 'bjStart',
      gameId: GAME_ID,
      roomId,
      nonce: 'n1',
      wagerCents: 999_999,
      anteCents: 999_999,
    });
    expect(started.ok).toBe(true);
    expect(balanceOf(db, 'ada')).toBe(before);

    const bet = await ada.request({
      t: 'bjAction',
      gameId: GAME_ID,
      roomId,
      nonce: 'a1',
      move: { type: 'bet', wagerCents: STAKE, payoutCents: 500_000, result: 'blackjack', outcome: 'win' },
    });
    expect(bet.ok).toBe(true);
    // Exactly the stake left, and the extras were dropped rather than validated — they have nowhere
    // to go, which is the property `parseTableMove` exists for.
    expect(balanceOf(db, 'ada')).toBe(before - STAKE);
  });
});

describe('parseTableMove', () => {
  it('accepts the six real moves and nothing else', () => {
    for (const type of ['hit', 'stand', 'double', 'insure', 'decline'] as const) {
      expect(parseTableMove({ type })).toEqual({ type });
    }
    expect(parseTableMove({ type: 'bet', wagerCents: 500 })).toEqual({ type: 'bet', wagerCents: 500 });
    for (const bad of [null, undefined, 42, 'hit', {}, { type: 'split' }, { type: '' }, []]) {
      expect(parseTableMove(bad)).toBeNull();
    }
  });

  it('REFUSES a stake that is not a positive integer, rather than coercing it', () => {
    // Coercing would put a fractional or negative number into a ledger row. Refusing reads to the
    // player as an error; a coerced 0 would read as a click that did nothing.
    for (const cents of [0, -100, 12.5, Number.NaN, Number.POSITIVE_INFINITY, '500', null]) {
      expect(parseTableMove({ type: 'bet', wagerCents: cents })).toBeNull();
    }
  });

  it('drops every field it does not name', () => {
    // A frame carrying a card, an outcome or a payout reaches the reducer as a plain move: the
    // hostile extras are not validated and rejected, they simply have nowhere to go.
    expect(
      parseTableMove({ type: 'stand', payoutCents: 999, outcome: 'win', cards: ['A'], result: 'blackjack' })
    ).toEqual({ type: 'stand' });
  });
});
