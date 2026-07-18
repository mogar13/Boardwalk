import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { ApiConfig } from '../src/config';
import { openDb } from '../src/db/db';
import type { TokenVerifier } from '../src/auth/verify';
import type { Profile } from '../src/domain/types';

const cfg: ApiConfig = {
  port: 0,
  dbPath: ':memory:',
  firebaseProjectId: 'test',
  allowedOrigin: '*',
  authMode: 'firebase',
  allowInsecure: false,
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
  daily: { lastClaimDay: 0, streak: 0 },
};

describe('auth', () => {
  it('health needs no token', async () => {
    await request(app()).get('/health').expect(200, { ok: true, db: 'up' });
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
  it('404 before a profile exists, then GET returns what PUT stored', async () => {
    const server = app();
    await request(server).get('/profile').set('Authorization', 'Bearer u1').expect(404);

    await request(server).put('/profile').set('Authorization', 'Bearer u1').send(profile).expect(204);

    const res = await request(server).get('/profile').set('Authorization', 'Bearer u1').expect(200);
    expect(res.body.profile).toEqual(profile);
  });

  it('scopes the profile to the token uid — one caller cannot read another', async () => {
    const server = app();
    await request(server).put('/profile').set('Authorization', 'Bearer u1').send(profile).expect(204);
    // A different token sees no profile of its own.
    await request(server).get('/profile').set('Authorization', 'Bearer u2').expect(404);
  });

  it('coerces a hostile body (negative bankroll, junk stat) into a valid profile', async () => {
    const server = app();
    await request(server)
      .put('/profile')
      .set('Authorization', 'Bearer u1')
      .send({ name: 'X', avatar: '🤖', bankrollCents: -999, xp: -5, stats: { chess: { won: 'lots' } } })
      .expect(204);
    const res = await request(server).get('/profile').set('Authorization', 'Bearer u1').expect(200);
    expect(res.body.profile.bankrollCents).toBe(0);
    expect(res.body.profile.xp).toBe(0);
    expect(res.body.profile.stats.chess).toEqual({ played: 0, won: 0, lost: 0, pushed: 0 });
  });
});

describe('leaderboard route', () => {
  it('returns ranked entries', async () => {
    const server = app();
    await request(server).put('/profile').set('Authorization', 'Bearer u1').send(profile).expect(204);
    const res = await request(server).get('/leaderboard?limit=5').set('Authorization', 'Bearer u1').expect(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({ uid: 'u1', wins: 1, bankrollCents: 500_000 });
  });
});
