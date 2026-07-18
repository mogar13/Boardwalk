import { Router } from 'express';
import type { Db } from '../db/db';
import { requireUid } from '../auth/middleware';
import { loadProfile, saveProfile } from '../domain/profile';
import type { DailyState, GameStat, Profile } from '../domain/types';

/**
 * `GET /profile`  → the caller's own profile (404 if none — the frontend maps that to `null`).
 * `PUT /profile`  → upsert the caller's own profile (serves the frontend's create AND save).
 *
 * The uid ALWAYS comes from the verified token, never the body or the path. A client cannot ask
 * for or write someone else's profile because it cannot name one — the same guarantee the
 * frontend's rules give with `auth.uid`, enforced here in code instead of in prose.
 */

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;
const nonNeg = (v: unknown): number => Math.max(0, Math.round(num(v)));
const text = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Coerce an untrusted body into a valid Profile — the server never trusts a wire shape. */
function coerceProfile(body: unknown): Profile {
  const b = obj(body);

  const stats: Record<string, GameStat> = {};
  for (const [gameId, raw] of Object.entries(obj(b.stats))) {
    const s = obj(raw);
    stats[gameId] = {
      played: nonNeg(s.played),
      won: nonNeg(s.won),
      lost: nonNeg(s.lost),
      pushed: nonNeg(s.pushed),
    };
  }

  const achievements: Record<string, number> = {};
  for (const [id, raw] of Object.entries(obj(b.achievements))) {
    if (typeof raw === 'number' && Number.isFinite(raw)) achievements[id] = raw;
  }

  const inventory: Record<string, true> = {};
  for (const [id, raw] of Object.entries(obj(b.inventory))) {
    if (raw === true) inventory[id] = true;
  }

  const d = obj(b.daily);
  const daily: DailyState = { lastClaimDay: nonNeg(d.lastClaimDay), streak: nonNeg(d.streak) };

  return {
    name: text(b.name, 'Player'),
    avatar: text(b.avatar, '👤'),
    bankrollCents: nonNeg(b.bankrollCents),
    xp: nonNeg(b.xp),
    stats,
    achievements,
    inventory,
    daily,
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
    const profile = coerceProfile(req.body);
    // Phase A mirrors the client, so the reason is a plain sync. Phase B replaces this route
    // with `/bet` and `/settle`, where the SERVER computes the delta and the client cannot.
    saveProfile(db, uid, profile, { reason: 'sync' });
    res.status(204).end();
  });

  return router;
}
