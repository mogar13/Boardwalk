import { Router } from 'express';
import type { Db } from '../db/db';
import { leaderboard } from '../domain/profile';

/**
 * `GET /leaderboard?limit=N` → the ranked standings, server-COMPUTED (wins summed from stats,
 * balances summed from the ledger). This is the read the frontend's LeaderboardRepo.top makes.
 * Public in Phase B; in Phase A it sits behind auth like everything else, because shadow mode
 * has no anonymous surface yet. `limit` is clamped so a client cannot ask for the whole table.
 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function leaderboardRouter(db: Db): Router {
  const router = Router();

  router.get('/leaderboard', (req, res) => {
    // Express types `req.query.limit` as `string | string[] | ParsedQs | ParsedQs[]` — a client
    // can send `?limit[x]=1` or `?limit=1&limit=2` and hand us an object or an array. `String()`
    // on those yields `'[object Object]'` / `'1,2'`, which parse to NaN and fall through to the
    // default; harmless, but it only WORKS by accident. Take the string arm and nothing else.
    const asked = req.query.limit;
    const raw = Number.parseInt(typeof asked === 'string' ? asked : '', 10);
    const limit = Number.isFinite(raw) ? Math.min(MAX_LIMIT, Math.max(1, raw)) : DEFAULT_LIMIT;
    res.json({ entries: leaderboard(db, limit) });
  });

  return router;
}
