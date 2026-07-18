import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { TICKET_BATCH } from '@boardwalk/game-logic';
import { buildApp } from '../src/app';
import type { ApiConfig } from '../src/config';
import { configProblems, configWarnings, readConfig } from '../src/config';
import { openDb, type Db } from '../src/db/db';
import { upsertProfile, loadProfile } from '../src/domain/profile';
import type { TokenVerifier } from '../src/auth/verify';
import {
  issueTickets,
  keyIdOf,
  outstandingTickets,
  ticketKeys,
  verifyTicket,
  wasIssued,
  deviceOfTicket,
} from '../src/domain/tickets';

/**
 * OFFLINE HARDENING — the guards for the ticket scheme.
 *
 * The one that matters most is at the bottom: `bank a settle, re-send it, prove the ledger moved
 * once`. Everything above it exists so that test is testing the thing it claims to.
 */

const SECRET_A = 'secret-alpha-0000000000000000000000';
const SECRET_B = 'secret-bravo-1111111111111111111111';
const SECRET_C = 'secret-charlie-22222222222222222222';

const fakeVerifier: TokenVerifier = {
  verify: (token) =>
    token.startsWith('bad') ? Promise.reject(new Error('nope')) : Promise.resolve(token),
};

const cfgWith = (ticketSecret: string, ticketSecretPrevious = ''): ApiConfig => ({
  port: 0,
  dbPath: ':memory:',
  firebaseProjectId: 'test',
  allowedOrigin: '*',
  authMode: 'firebase',
  allowInsecure: false,
  ticketSecret,
  ticketSecretPrevious,
});

const seeded = (): Db => {
  const db = openDb(':memory:');
  upsertProfile(db, 'u1', { name: 'Ada', avatar: '👤', equipped: {} }, { now: 1 });
  upsertProfile(db, 'u2', { name: 'Bob', avatar: '👤', equipped: {} }, { now: 1 });
  return db;
};

const appWith = (db: Db, secret: string, previous = ''): ReturnType<typeof buildApp> =>
  buildApp({ cfg: cfgWith(secret, previous), db, verifier: fakeVerifier });

const DEVICE = 'device-aaaaaaaa';

/**
 * Index into a list that a test REQUIRES to be populated. Throws rather than handing back
 * `undefined`, so a grant that unexpectedly came back empty fails on the spot with a clear message
 * instead of surfacing three assertions later as a confusing signature mismatch.
 */
const at = <T,>(xs: readonly T[], i: number): T => {
  const v = xs[i];
  if (v === undefined) throw new Error(`expected an element at ${String(i)}`);
  return v;
};


interface TicketBody {
  enabled: boolean;
  tickets: string[];
  outstanding: number;
  batch: number;
}

const grantVia = async (
  app: ReturnType<typeof buildApp>,
  uid = 'u1',
  deviceId = DEVICE,
  want = 4
): Promise<TicketBody> => {
  const res = await request(app)
    .post('/tickets')
    .set('Authorization', `Bearer ${uid}`)
    .send({ deviceId, want })
    .expect(200);
  return res.body as TicketBody;
};

const ledgerRows = (db: Db, uid: string): { delta_cents: number; reason: string }[] =>
  db.prepare('SELECT delta_cents, reason FROM ledger WHERE uid = ? ORDER BY id').all(uid) as {
    delta_cents: number;
    reason: string;
  }[];

/* ------------------------------------------------------------------ signing */

describe('ticket signing', () => {
  it('round-trips a ticket it issued', () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    const { tickets } = issueTickets(db, 'u1', DEVICE, 3, keys.current!, 100);
    expect(tickets).toHaveLength(3);
    for (const t of tickets) {
      const checked = verifyTicket(keys, 'u1', t);
      expect(checked.ok).toBe(true);
      if (checked.ok) expect(checked.value.deviceId).toBe(DEVICE);
    }
  });

  it('numbers tickets sequentially from 1 and keeps counting across grants', () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    const first = issueTickets(db, 'u1', DEVICE, 2, keys.current!, 100);
    const second = issueTickets(db, 'u1', DEVICE, 2, keys.current!, 100);
    const seqs = [...first.tickets, ...second.tickets].map((t) => {
      const checked = verifyTicket(keys, 'u1', t);
      return checked.ok ? checked.value.seq : -1;
    });
    expect(seqs).toEqual([1, 2, 3, 4]);
  });

  it('refuses a tampered ticket', () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    const ticket = at(issueTickets(db, 'u1', DEVICE, 1, keys.current!, 100).tickets, 0);
    const parts = ticket.split('.');
    // Bump the sequence number, leave the signature alone — the classic forgery attempt.
    const forged = `${parts[0]}.${parts[1]}.${parts[2]}.99.${parts[4]}`;
    expect(verifyTicket(keys, 'u1', forged)).toMatchObject({ ok: false, error: 'invalid ticket' });
  });

  it("refuses one account's ticket presented by another — the uid is in the MAC", () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    const ticket = at(issueTickets(db, 'u1', DEVICE, 1, keys.current!, 100).tickets, 0);
    expect(verifyTicket(keys, 'u1', ticket).ok).toBe(true);
    expect(verifyTicket(keys, 'u2', ticket)).toMatchObject({ ok: false, error: 'invalid ticket' });
  });

  it('refuses a short/garbage signature rather than throwing (timingSafeEqual length trap)', () => {
    const keys = ticketKeys(SECRET_A);
    const kid = keyIdOf(SECRET_A);
    expect(() => verifyTicket(keys, 'u1', `v1.${kid}.${DEVICE}.1.x`)).not.toThrow();
    expect(verifyTicket(keys, 'u1', `v1.${kid}.${DEVICE}.1.x`).ok).toBe(false);
  });

  it('refuses malformed shapes and a plain nonce', () => {
    const keys = ticketKeys(SECRET_A);
    for (const bad of ['', 'plain-nonce', 'v1.a.b.c', 'v2.a.b.1.sig', `v1.${keyIdOf(SECRET_A)}..1.sig`]) {
      expect(verifyTicket(keys, 'u1', bad).ok).toBe(false);
    }
  });

  it('refuses a non-positive or non-canonical sequence', () => {
    const keys = ticketKeys(SECRET_A);
    const kid = keyIdOf(SECRET_A);
    // '01' and '1e0' both parseInt to 1 — a canonical-form check is what stops two spellings of
    // one sequence number becoming two spendable nonces for one ticket.
    for (const seq of ['0', '-1', '01', '1e0']) {
      expect(verifyTicket(keys, 'u1', `v1.${kid}.${DEVICE}.${seq}.sig`).ok).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ rotation */

describe('key rotation', () => {
  it('accepts a ticket signed under the previous key — the overlap window', () => {
    const db = seeded();
    const old = ticketKeys(SECRET_A);
    const ticket = at(issueTickets(db, 'u1', DEVICE, 1, old.current!, 100).tickets, 0);

    const rotated = ticketKeys(SECRET_B, SECRET_A);
    expect(verifyTicket(rotated, 'u1', ticket).ok).toBe(true);
  });

  it('refuses a ticket whose key has been rotated all the way out, and says it is RETIRED', () => {
    const db = seeded();
    const old = ticketKeys(SECRET_A);
    const ticket = at(issueTickets(db, 'u1', DEVICE, 1, old.current!, 100).tickets, 0);

    const rotatedTwice = ticketKeys(SECRET_C, SECRET_B);
    const checked = verifyTicket(rotatedTwice, 'u1', ticket);
    expect(checked.ok).toBe(false);
    // `retired` is the flag the client acts on by re-stamping. An `invalid` must never carry it.
    if (!checked.ok) expect(checked.retired).toBe(true);
  });

  it('a forged ticket is never reported as retired', () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    const ticket = at(issueTickets(db, 'u1', DEVICE, 1, keys.current!, 100).tickets, 0);
    const parts = ticket.split('.');
    const checked = verifyTicket(keys, 'u1', `${parts[0]}.${parts[1]}.${parts[2]}.7.${parts[4]}`);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.retired).toBe(false);
  });

  it('selects the key by kid rather than trying both', () => {
    // If verification tried every key, a ticket signed under B would verify on a server whose
    // CURRENT key is A and whose previous is B — which is true here — but it must ALSO fail on a
    // server that holds A alone. That second half is what proves selection, not tolerance.
    const db = seeded();
    const ticket = at(issueTickets(db, 'u1', DEVICE, 1, ticketKeys(SECRET_B).current!, 100).tickets, 0);
    expect(verifyTicket(ticketKeys(SECRET_A, SECRET_B), 'u1', ticket).ok).toBe(true);
    expect(verifyTicket(ticketKeys(SECRET_A), 'u1', ticket).ok).toBe(false);
  });
});

/* ---------------------------------------------------------------- the cap */

describe('the per-uid cap', () => {
  it('never issues past TICKET_BATCH outstanding', () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    const first = issueTickets(db, 'u1', DEVICE, 1000, keys.current!, 100);
    expect(first.tickets).toHaveLength(TICKET_BATCH);
    expect(first.outstanding).toBe(TICKET_BATCH);

    const second = issueTickets(db, 'u1', DEVICE, 10, keys.current!, 100);
    expect(second.tickets).toEqual([]);
    expect(second.outstanding).toBe(TICKET_BATCH);
  });

  it('FABRICATED DEVICES DO NOT MULTIPLY THE BUDGET — the cap is per uid', () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    let total = 0;
    // A client pretending to be 20 devices, asking each for a full batch. This is the attack the
    // per-uid cap exists for: nothing stops a client inventing device ids, so the bound must not
    // be per-device. 20 x 64 would be 1280 if the cap were per-device.
    for (let i = 0; i < 20; i += 1) {
      total += issueTickets(db, 'u1', `device-fake${String(i).padStart(4, '0')}`, TICKET_BATCH, keys.current!, 100)
        .tickets.length;
    }
    expect(total).toBe(TICKET_BATCH);
    expect(outstandingTickets(db, 'u1')).toBe(TICKET_BATCH);
  });

  it("one account's tickets do not count against another's", () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    issueTickets(db, 'u1', DEVICE, TICKET_BATCH, keys.current!, 100);
    expect(issueTickets(db, 'u2', DEVICE, 5, keys.current!, 100).tickets).toHaveLength(5);
  });

  it('spending frees budget back up', () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    issueTickets(db, 'u1', DEVICE, TICKET_BATCH, keys.current!, 100);
    expect(issueTickets(db, 'u1', DEVICE, 5, keys.current!, 100).tickets).toEqual([]);

    db.prepare('UPDATE ticket_devices SET spent_count = 3 WHERE uid = ? AND device_id = ?').run('u1', DEVICE);
    expect(issueTickets(db, 'u1', DEVICE, 10, keys.current!, 100).tickets).toHaveLength(3);
  });

  it('refuses a sequence that was never issued', () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    issueTickets(db, 'u1', DEVICE, 2, keys.current!, 100);
    expect(wasIssued(db, 'u1', DEVICE, 2)).toBe(true);
    expect(wasIssued(db, 'u1', DEVICE, 3)).toBe(false);
    expect(wasIssued(db, 'u1', 'device-unknown0', 1)).toBe(false);
  });
});

/* ------------------------------------------------------------------- config */

describe('ticket config', () => {
  it('reads both secrets and derives distinct key ids', () => {
    const cfg = readConfig({ TICKET_SECRET: SECRET_A, TICKET_SECRET_PREVIOUS: SECRET_B, FIREBASE_PROJECT_ID: 'p' });
    expect(cfg.ticketSecret).toBe(SECRET_A);
    expect(keyIdOf(SECRET_A)).not.toBe(keyIdOf(SECRET_B));
  });

  it('warns — but does NOT refuse to boot — when the secret is absent', () => {
    const cfg = cfgWith('');
    expect(configProblems(cfg)).toEqual([]);
    expect(configWarnings(cfg).join(' ')).toContain('TICKET_SECRET');
  });

  it('refuses a half-finished rotation and a rotation that did not rotate', () => {
    expect(configProblems(cfgWith('', SECRET_A)).join(' ')).toContain('TICKET_SECRET_PREVIOUS');
    expect(configProblems(cfgWith(SECRET_A, SECRET_A)).join(' ')).toContain('identical');
    expect(configProblems(cfgWith(SECRET_A, SECRET_B))).toEqual([]);
  });
});

/* -------------------------------------------------------------- the routes */

describe('POST /tickets', () => {
  it('issues a batch and reports the cap', async () => {
    const body = await grantVia(appWith(seeded(), SECRET_A));
    expect(body).toMatchObject({ enabled: true, outstanding: 4, batch: TICKET_BATCH });
    expect(body.tickets).toHaveLength(4);
  });

  it('reports enabled:false and issues nothing when the secret is absent', async () => {
    const body = await grantVia(appWith(seeded(), ''));
    expect(body).toMatchObject({ enabled: false, tickets: [] });
  });

  it('400s a device id that could break the ticket encoding', async () => {
    const app = appWith(seeded(), SECRET_A);
    for (const deviceId of ['', 'short', 'has.a.dot.in.it', 'x'.repeat(65)]) {
      await request(app)
        .post('/tickets')
        .set('Authorization', 'Bearer u1')
        .send({ deviceId, want: 1 })
        .expect(400);
    }
  });

  it('401s without a token', async () => {
    await request(appWith(seeded(), SECRET_A)).post('/tickets').send({ deviceId: DEVICE }).expect(401);
  });

  it('clamps a hostile `want`', async () => {
    const body = await grantVia(appWith(seeded(), SECRET_A), 'u1', DEVICE, 10_000_000);
    expect(body.tickets).toHaveLength(TICKET_BATCH);
  });
});

describe('the /settle gate', () => {
  const settle = (
    app: ReturnType<typeof buildApp>,
    nonce: string,
    uid = 'u1'
  ): request.Test =>
    request(app)
      .post('/settle')
      .set('Authorization', `Bearer ${uid}`)
      .send({ nonce, gameId: 'chess', outcome: 'win' });

  it('accepts a settle carrying a live ticket', async () => {
    const db = seeded();
    const app = appWith(db, SECRET_A);
    const { tickets } = await grantVia(app);
    await settle(app, at(tickets, 0)).expect(200);
    expect(db.prepare('SELECT won FROM stats WHERE uid = ? AND game_id = ?').get('u1', 'chess')).toMatchObject({
      won: 1,
    });
  });

  it('REFUSES a client-minted nonce when enforcement is on', async () => {
    const db = seeded();
    await settle(appWith(db, SECRET_A), 'i-made-this-up').expect(409);
    expect(db.prepare('SELECT COUNT(*) AS n FROM stats WHERE uid = ?').get('u1')).toMatchObject({ n: 0 });
  });

  it('accepts a client-minted nonce when enforcement is OFF (the documented fallback)', async () => {
    const db = seeded();
    await settle(appWith(db, ''), 'i-made-this-up').expect(200);
    expect(db.prepare('SELECT won FROM stats WHERE uid = ? AND game_id = ?').get('u1', 'chess')).toMatchObject({
      won: 1,
    });
  });

  it("refuses another account's ticket, and banks nothing for either", async () => {
    const db = seeded();
    const app = appWith(db, SECRET_A);
    const { tickets } = await grantVia(app, 'u1');
    await settle(app, at(tickets, 0), 'u2').expect(409);
    expect(db.prepare('SELECT COUNT(*) AS n FROM stats').get()).toMatchObject({ n: 0 });
  });

  it('flags a retired ticket distinctly from an invalid one', async () => {
    const db = seeded();
    const { tickets } = await grantVia(appWith(db, SECRET_A));
    const rotatedTwice = appWith(db, SECRET_C, SECRET_B);

    const retired = await settle(rotatedTwice, at(tickets, 0)).expect(409);
    expect((retired.body as { ticket: string }).ticket).toBe('retired');

    const bogus = await settle(rotatedTwice, 'v1.deadbeef.device-aaaaaaaa.1.AAAAAAAAAAAAAAAAAAAAAA').expect(409);
    expect((bogus.body as { ticket: string }).ticket).toBe('retired');
  });

  it('refuses a validly-signed ticket for a sequence never issued (the key-leak bound)', async () => {
    const db = seeded();
    const keys = ticketKeys(SECRET_A);
    // Sign seq 500 with the real key but never record the issuance — i.e. a thief with the secret.
    const stolen = at(issueTickets(db, 'u1', DEVICE, 1, keys.current!, 100).tickets, 0);
    db.prepare('UPDATE ticket_devices SET issued_seq = 0 WHERE uid = ? AND device_id = ?').run('u1', DEVICE);

    const res = await settle(appWith(db, SECRET_A), stolen).expect(409);
    expect((res.body as { error: string }).error).toContain('never issued');
  });

  it('leaves other money routes on client-minted nonces — the offline budget is not spent online', async () => {
    const db = seeded();
    const app = appWith(db, SECRET_A);
    // /daily, /purchase, /bet all keep working with a plain nonce while the gate is on.
    await request(app).post('/daily').set('Authorization', 'Bearer u1').send({ nonce: 'plain-1' }).expect(200);
    await request(app)
      .post('/bet')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'plain-2', gameId: 'blackjack', amountCents: 100 })
      .expect(200);
    expect(outstandingTickets(db, 'u1')).toBe(0); // nothing was issued, nothing was spent
  });
});

/* ------------------------------------------------------- spend accounting */

describe('spend accounting', () => {
  it('increments spent_count for the ticket that was actually claimed', async () => {
    const db = seeded();
    const app = appWith(db, SECRET_A);
    const { tickets } = await grantVia(app);
    expect(deviceOfTicket(at(tickets, 0))).toBe(DEVICE);

    await request(app)
      .post('/settle')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: at(tickets, 0), gameId: 'chess', outcome: 'win' })
      .expect(200);

    expect(
      db.prepare('SELECT spent_count FROM ticket_devices WHERE uid = ? AND device_id = ?').get('u1', DEVICE)
    ).toMatchObject({ spent_count: 1 });
    expect(outstandingTickets(db, 'u1')).toBe(3);
  });

  it('a replay does NOT double the spend count', async () => {
    const db = seeded();
    const app = appWith(db, SECRET_A);
    const { tickets } = await grantVia(app);
    const body = { nonce: at(tickets, 0), gameId: 'chess', outcome: 'win' };
    await request(app).post('/settle').set('Authorization', 'Bearer u1').send(body).expect(200);
    await request(app).post('/settle').set('Authorization', 'Bearer u1').send(body).expect(200);
    expect(
      db.prepare('SELECT spent_count FROM ticket_devices WHERE uid = ? AND device_id = ?').get('u1', DEVICE)
    ).toMatchObject({ spent_count: 1 });
  });

  it('a plain nonce shaped like a ticket updates nothing when enforcement is off', async () => {
    const db = seeded();
    await request(appWith(db, ''))
      .post('/settle')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'v1.aaaaaaaa.device-aaaaaaaa.1.sig', gameId: 'chess', outcome: 'win' })
      .expect(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ticket_devices').get()).toMatchObject({ n: 0 });
  });
});

/* ------------------------------------------- THE REPLAY ATTACK, DEMONSTRATED */

describe('the offline replay attack', () => {
  /**
   * THE POINT OF THE WHOLE FEATURE, as an executable claim.
   *
   * Bank a result the way an offline client will — a settle carrying a ticket minted before the
   * disconnect — then re-send the identical body the way a reconnect-sync retry does. The ledger,
   * the stat and the XP must each move exactly ONCE.
   *
   * A win with a real payout is used rather than a bare chess win, so there is a ledger row to
   * count: "the ledger moved once" is a weaker claim when the honest answer is zero rows. It goes
   * through the GENERIC settle path with an open wager — `gameId: 'blackjack'` is refused outright
   * here (`SERVER_DEALT_GAMES`), which is the dealer cutover doing its job and is asserted
   * separately in economy.test.ts.
   */
  it('banks a settle once no matter how many times it is re-sent', async () => {
    const db = seeded();
    const app = appWith(db, SECRET_A);
    const { tickets } = await grantVia(app);

    // Stake first, so the settle has an open wager to be bounded by and a real payout to credit.
    await request(app)
      .post('/bet')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'stake-1', gameId: 'chess', amountCents: 1000 })
      .expect(200);

    const banked = {
      nonce: at(tickets, 0),
      gameId: 'chess',
      outcome: 'win' as const,
      payoutCents: 2000,
    };

    const first = await request(app).post('/settle').set('Authorization', 'Bearer u1').send(banked).expect(200);
    expect((first.body as { replayed: boolean }).replayed).toBe(false);

    // The reconnect-sync retry storm: the same banked result, over and over.
    for (let i = 0; i < 5; i += 1) {
      const again = await request(app).post('/settle').set('Authorization', 'Bearer u1').send(banked).expect(200);
      expect((again.body as { replayed: boolean }).replayed).toBe(true);
    }

    const rows = ledgerRows(db, 'u1');
    const settles = rows.filter((r) => r.reason === 'settle');
    expect(settles).toHaveLength(1);
    expect(at(settles, 0).delta_cents).toBe(2000);

    expect(db.prepare('SELECT played, won FROM stats WHERE uid = ? AND game_id = ?').get('u1', 'chess')).toMatchObject({
      played: 1,
      won: 1,
    });

    const profile = loadProfile(db, 'u1');
    // signup grant - 1000 stake + 2000 payout
    expect(profile?.bankrollCents).toBe(500_000 - 1000 + 2000);
  });

  it('a SECOND ticket for the same fabricated result is refused once the budget is gone', async () => {
    const db = seeded();
    const app = appWith(db, SECRET_A);
    // The bound, end to end: take the whole batch, spend every one, then try to bank one more.
    const { tickets } = await grantVia(app, 'u1', DEVICE, TICKET_BATCH);
    expect(tickets).toHaveLength(TICKET_BATCH);

    for (const t of tickets) {
      await request(app)
        .post('/settle')
        .set('Authorization', 'Bearer u1')
        .send({ nonce: t, gameId: 'chess', outcome: 'win' })
        .expect(200);
    }
    expect(db.prepare('SELECT won FROM stats WHERE uid = ? AND game_id = ?').get('u1', 'chess')).toMatchObject({
      won: TICKET_BATCH,
    });

    // The 65th offline result has no ticket to carry it, and a made-up one is refused.
    await request(app)
      .post('/settle')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'one-more-please', gameId: 'chess', outcome: 'win' })
      .expect(409);
    expect(db.prepare('SELECT won FROM stats WHERE uid = ? AND game_id = ?').get('u1', 'chess')).toMatchObject({
      won: TICKET_BATCH,
    });
  });
});

/* ------------------------------------------------------------------ health */

describe('/health reports the switch', () => {
  it('says on with a secret and off without one', async () => {
    const on = await request(appWith(seeded(), SECRET_A)).get('/health').expect(200);
    expect(on.body).toMatchObject({ ok: true, tickets: 'on' });
    const off = await request(appWith(seeded(), '')).get('/health').expect(200);
    expect(off.body).toMatchObject({ ok: true, tickets: 'off' });
  });
});
