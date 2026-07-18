import { Router } from 'express';
import type { Db } from '../db/db';
import { requireUid } from '../auth/middleware';
import { loadProfile, upsertProfile } from '../domain/profile';
import type { Equipped } from '../domain/types';

/**
 * `GET /profile`  → the caller's own profile (404 if none — the frontend maps that to `null`).
 * `PUT /profile`  → upsert the caller's own COSMETICS (serves the frontend's create AND save).
 *
 * The uid ALWAYS comes from the verified token, never the body or the path. A client cannot ask
 * for or write someone else's profile because it cannot name one — the same guarantee the
 * frontend's rules give with `auth.uid`, enforced here in code instead of in prose.
 *
 * PHASE B SHRANK WHAT `PUT` ACCEPTS TO THREE FIELDS. It used to take a whole Profile and mirror
 * it, money included. Now `coerceUpsert` builds an object with only `name`, `avatar` and
 * `equipped` in it — the rest of the body is not so much ignored as unreachable, because nothing
 * downstream ever looks at it. Money moves through `/bet`, `/settle`, `/purchase` and `/daily`
 * (see `economyRouter`), each of which computes its own delta.
 */

const text = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Cosmetic ids are short opaque strings; anything else is dropped rather than stored. */
const ID_MAX_LEN = 64;
const cosmeticId = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' && v.length <= ID_MAX_LEN ? v : undefined;

const NAME_MAX_LEN = 40;
const AVATAR_MAX_LEN = 8; // an emoji is not one byte — the frontend's rules cap it here too

function coerceUpsert(body: unknown): { name: string; avatar: string; equipped: Equipped } {
  const b = obj(body);
  const e = obj(b.equipped);
  const cardback = cosmeticId(e.cardback);
  const title = cosmeticId(e.title);
  const felt = cosmeticId(e.felt);
  const frame = cosmeticId(e.frame);
  return {
    name: text(b.name, 'Player').slice(0, NAME_MAX_LEN),
    avatar: text(b.avatar, '👤').slice(0, AVATAR_MAX_LEN),
    // Keys omitted rather than set to undefined — `exactOptionalPropertyTypes` is on, and the
    // frontend's `Equipped` reads an absent key as "nothing equipped of that kind".
    equipped: {
      ...(cardback === undefined ? {} : { cardback }),
      ...(title === undefined ? {} : { title }),
      ...(felt === undefined ? {} : { felt }),
      ...(frame === undefined ? {} : { frame }),
    },
  };
}

export function profileRouter(db: Db): Router {
  const router = Router();

  router.get('/profile', (req, res) => {
    const uid = requireUid(req);
    const profile = loadProfile(db, uid);
    if (!profile) {
      res.status(404).json({ error: 'no profile' });
      return;
    }
    res.json({ profile });
  });

  router.put('/profile', (req, res) => {
    const uid = requireUid(req);
    upsertProfile(db, uid, coerceUpsert(req.body));
    // Answer with the authoritative profile rather than 204. The client has just learned its own
    // opening bankroll from us — a fresh account's stake is the server's `signup` grant, not the
    // number it sent — so handing back nothing would leave it displaying its own guess.
    const profile = loadProfile(db, uid);
    if (!profile) {
      res.status(500).json({ error: 'profile vanished after upsert' });
      return;
    }
    res.json({ profile });
  });

  return router;
}
