import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { ApiConfig } from '../src/config';
import { openDb } from '../src/db/db';
import type { TokenVerifier } from '../src/auth/verify';
import type { LeaderboardEntry, Profile } from '../src/domain/types';
import { STARTING_BANKROLL_CENTS } from '../src/domain/economy';

/**
 * The generic /bet + /settle path is exercised with a gameId the referee does NOT deal.
 *
 * It used to be spelled 'blackjack', which stopped being valid in Phase D: the server deals that
 * game now, so `checkSettle` refuses a claim for it outright (`SERVER_DEALT_GAMES`) — otherwise
 * `POST /bet` + `POST /settle` at the 2.5x ceiling would be a standing bypass of the dealer, and
 * the whole phase would be opt-in. 'roulette' stands in for what this route is actually for: a
 * betting game the referee does not run the rules of, bounded by the default 3x ceiling.
 */
const BETTING_GAME = 'roulette';

/**
 * supertest types `res.body` as `any`, so every assertion below was untyped — the type checker
 * saw nothing, and a misspelled `bankRollCents` would have compared
 * `undefined` and failed for a reason that has nothing to do with the money. Narrow ONCE, here,
 * and the response shapes come back: a typo in a field name is a compile error again.
 */
const bodyOf = <T>(res: { body: unknown }): T => res.body as T;
const profileOf = (res: { body: unknown }): Profile => bodyOf<{ profile: Profile }>(res).profile;

const cfg: ApiConfig = {
  port: 0,
  dbPath: ':memory:',
  firebaseProjectId: 'test',
  allowedOrigin: '*',
  authMode: 'firebase',
  allowInsecure: false,
  // Offline hardening: no ticket secret, so `/settle` keeps accepting client-minted nonces —
  // these suites predate tickets and must stay unaffected by them, which is the fallback's whole job.
  ticketSecret: '',
  ticketSecretPrevious: '',
};

// A fake verifier: the token IS the uid, so tests name a caller by sending `Bearer <uid>`.
// Anything starting with 'bad' is rejected, to exercise the 401 path.
const fakeVerifier: TokenVerifier = {
  verify(token) {
    return token.startsWith('bad') ? Promise.reject(new Error('nope')) : Promise.resolve(token);
  },
};

const app = () => buildApp({ cfg, db: openDb(':memory:'), verifier: fakeVerifier });

const profile: Profile = {
  name: 'Ada',
  avatar: '👤',
  bankrollCents: 500_000,
  xp: 10,
  stats: { chess: { played: 2, won: 1, lost: 1, pushed: 0 } },
  achievements: {},
  inventory: {},
  equipped: {},
  daily: { lastClaimDay: 0, streak: 0 },
};

describe('auth', () => {
  it('health needs no token', async () => {
    await request(app()).get('/health').expect(200, { ok: true, db: 'up', tickets: 'off' });
  });

  it('401 without a bearer token', async () => {
    await request(app()).get('/profile').expect(401);
  });

  it('401 on an invalid token', async () => {
    await request(app()).get('/profile').set('Authorization', 'Bearer bad-token').expect(401);
  });
});

describe('private network access (Chrome PNA preflight)', () => {
  it('echoes Access-Control-Allow-Private-Network on a PNA preflight', async () => {
    const res = await request(app())
      .options('/profile')
      .set('Origin', 'https://mogar13.github.io')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Private-Network', 'true')
      .expect(204);
    expect(res.headers['access-control-allow-private-network']).toBe('true');
  });

  it('omits the PNA header when the request does not ask for it', async () => {
    const res = await request(app())
      .options('/profile')
      .set('Origin', 'https://mogar13.github.io')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
    expect(res.headers['access-control-allow-private-network']).toBeUndefined();
  });
});

describe('profile routes', () => {
  it('404 before a profile exists, then GET returns what PUT created', async () => {
    const server = app();
    await request(server).get('/profile').set('Authorization', 'Bearer u1').expect(404);

    const put = await request(server)
      .put('/profile')
      .set('Authorization', 'Bearer u1')
      .send(profile)
      .expect(200);
    // PUT answers with the AUTHORITATIVE profile — including the server's own opening stake.
    expect(profileOf(put).bankrollCents).toBe(STARTING_BANKROLL_CENTS);

    const res = await request(server).get('/profile').set('Authorization', 'Bearer u1').expect(200);
    expect(profileOf(res).name).toBe('Ada');
  });

  it('scopes the profile to the token uid — one caller cannot read another', async () => {
    const server = app();
    await request(server).put('/profile').set('Authorization', 'Bearer u1').send(profile).expect(200);
    // A different token sees no profile of its own.
    await request(server).get('/profile').set('Authorization', 'Bearer u2').expect(404);
  });

  /**
   * THE PHASE B CUT-OVER, AT THE ROUTE. Phase A took the whole body and mirrored it, so this
   * request would have set the caller's balance, XP and stats to whatever it asked for. Now the
   * route reads three fields and the rest of the body reaches nothing.
   */
  it('IGNORES bankroll, xp, stats, achievements and inventory in the body', async () => {
    const server = app();
    await request(server).put('/profile').set('Authorization', 'Bearer u1').send(profile).expect(200);

    const res = await request(server)
      .put('/profile')
      .set('Authorization', 'Bearer u1')
      .send({
        name: 'Cheater',
        avatar: '🤖',
        bankrollCents: 999_999_999,
        xp: 500_000,
        stats: { chess: { played: 9999, won: 9999, lost: 0, pushed: 0 } },
        achievements: { bankroll_platinum: 1 },
        inventory: { av_dragon: true },
      })
      .expect(200);

    const p = profileOf(res);
    expect(p.name).toBe('Cheater'); // a name IS the client's to set
    expect(p.bankrollCents).toBe(STARTING_BANKROLL_CENTS); // the money is not
    expect(p.xp).toBe(0);
    expect(p.stats).toEqual({});
    expect(p.achievements).toEqual({});
    expect(p.inventory).toEqual({});
  });

  it('stores the equipped cosmetics — the field Phase A dropped entirely', async () => {
    const server = app();
    const res = await request(server)
      .put('/profile')
      .set('Authorization', 'Bearer u1')
      .send({ ...profile, equipped: { cardback: 'cb_red3', title: 'ttl_regular' } })
      .expect(200);
    expect(profileOf(res).equipped).toEqual({ cardback: 'cb_red3', title: 'ttl_regular' });
  });

  it('stores a felt and a frame too — all four equipped slots round-trip (P5)', async () => {
    // The P5 kinds get their own case rather than riding on the one above, because the failure
    // this guards is PER-COLUMN and silent: an `Equipped` field with no column is dropped on write
    // and reads back absent, so the cosmetic appears to equip and is gone on reload. Nothing about
    // the request errors — which is precisely why the assertion has to be on the read-back.
    const server = app();
    const equipped = {
      cardback: 'cb_red3',
      title: 'ttl_regular',
      felt: 'ft_blue',
      frame: 'fr_ember',
    };
    const res = await request(server)
      .put('/profile')
      .set('Authorization', 'Bearer u1')
      .send({ ...profile, equipped })
      .expect(200);
    expect(profileOf(res).equipped).toEqual(equipped);

    // And it survives a fresh read, not just the write's own answer — the write could echo its
    // input back without the columns ever holding it.
    const back = await request(server).get('/profile').set('Authorization', 'Bearer u1').expect(200);
    expect(profileOf(back).equipped).toEqual(equipped);
  });

  it('un-equipping a felt clears the column rather than leaving the old id', async () => {
    // The `?? null` half of the write. An UPDATE that only ever sets non-null values is a slot you
    // can fill and never empty, which reads to a player as a cosmetic that will not come off.
    const server = app();
    await request(server)
      .put('/profile')
      .set('Authorization', 'Bearer u1')
      .send({ ...profile, equipped: { felt: 'ft_blue', frame: 'fr_steel' } })
      .expect(200);
    const res = await request(server)
      .put('/profile')
      .set('Authorization', 'Bearer u1')
      .send({ ...profile, equipped: { frame: 'fr_steel' } })
      .expect(200);
    expect(profileOf(res).equipped).toEqual({ frame: 'fr_steel' });
  });
});

describe('economy routes', () => {
  const create = (server: ReturnType<typeof app>, uid = 'u1') =>
    request(server).put('/profile').set('Authorization', `Bearer ${uid}`).send(profile).expect(200);

  it('a bet deducts, a settle credits, and the profile comes back each time', async () => {
    const server = app();
    await create(server);

    const bet = await request(server)
      .post('/bet')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'n1', gameId: BETTING_GAME, amountCents: 10_000 })
      .expect(200);
    expect(profileOf(bet).bankrollCents).toBe(STARTING_BANKROLL_CENTS - 10_000);

    const settle = await request(server)
      .post('/settle')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'n2', gameId: BETTING_GAME, outcome: 'win', payoutCents: 20_000 })
      .expect(200);
    expect(profileOf(settle).bankrollCents).toBe(STARTING_BANKROLL_CENTS + 10_000);
    expect(profileOf(settle).xp).toBe(100);
  });

  it('409s a bet the balance cannot cover — a refusal is state, not a malformed request', async () => {
    const server = app();
    await create(server);
    const res = await request(server)
      .post('/bet')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'n1', gameId: BETTING_GAME, amountCents: 99_999_999 })
      .expect(409);
    expect(bodyOf<{ error: string }>(res).error).toMatch(/insufficient/i);
  });

  it('409s a settle with no open wager', async () => {
    const server = app();
    await create(server);
    await request(server)
      .post('/settle')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'n1', gameId: BETTING_GAME, outcome: 'win', payoutCents: 1_000_000 })
      .expect(409);
  });

  it('400s a request with no nonce — replay safety is not optional', async () => {
    const server = app();
    await create(server);
    await request(server)
      .post('/bet')
      .set('Authorization', 'Bearer u1')
      .send({ gameId: BETTING_GAME, amountCents: 100 })
      .expect(400);
    await request(server).post('/daily').set('Authorization', 'Bearer u1').send({}).expect(400);
  });

  it('400s a settle with an outcome that is not win/loss/push', async () => {
    const server = app();
    await create(server);
    await request(server)
      .post('/settle')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'n1', gameId: 'chess', outcome: 'jackpot' })
      .expect(400);
  });

  it('replays a repeated nonce over HTTP without moving money twice', async () => {
    const server = app();
    await create(server);
    const body = { nonce: 'same', gameId: BETTING_GAME, amountCents: 10_000 };
    await request(server).post('/bet').set('Authorization', 'Bearer u1').send(body).expect(200);
    const again = await request(server)
      .post('/bet')
      .set('Authorization', 'Bearer u1')
      .send(body)
      .expect(200);
    expect(bodyOf<{ replayed: boolean }>(again).replayed).toBe(true);
    expect(profileOf(again).bankrollCents).toBe(STARTING_BANKROLL_CENTS - 10_000);
  });

  it('a purchase charges the server price; there is no field to name your own', async () => {
    const server = app();
    await create(server);
    const res = await request(server)
      .post('/purchase')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'p1', itemId: 'av_cowboy', priceCents: 1 })
      .expect(200);
    expect(profileOf(res).bankrollCents).toBe(STARTING_BANKROLL_CENTS - 100_000);
    expect(profileOf(res).inventory).toEqual({ av_cowboy: true });
  });

  it('a daily claim ignores any client clock in the body', async () => {
    const server = app();
    await create(server);
    const first = await request(server)
      .post('/daily')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'd1', nowMs: 0, lastClaimDay: 0 })
      .expect(200);
    expect(profileOf(first).bankrollCents).toBeGreaterThan(STARTING_BANKROLL_CENTS);

    // A second claim on the same real day is refused however the body is dressed up.
    await request(server)
      .post('/daily')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'd2', nowMs: 0, lastClaimDay: -9999 })
      .expect(409);
  });

  it('every economy route needs a token', async () => {
    const server = app();
    for (const path of ['/bet', '/settle', '/purchase', '/daily']) {
      await request(server).post(path).send({ nonce: 'x' }).expect(401);
    }
  });
});

describe('leaderboard route', () => {
  it('returns ranked entries with server-computed wins and played', async () => {
    const server = app();
    await request(server).put('/profile').set('Authorization', 'Bearer u1').send(profile).expect(200);
    await request(server)
      .post('/settle')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'n1', gameId: 'chess', outcome: 'win' })
      .expect(200);

    const res = await request(server)
      .get('/leaderboard?limit=5')
      .set('Authorization', 'Bearer u1')
      .expect(200);
    const entries = bodyOf<{ entries: LeaderboardEntry[] }>(res).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      uid: 'u1',
      wins: 1,
      played: 1,
      bankrollCents: STARTING_BANKROLL_CENTS,
    });
  });
});
