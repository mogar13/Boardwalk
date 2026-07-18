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
    const raw = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(raw) ? Math.min(MAX_LIMIT, Math.max(1, raw)) : DEFAULT_LIMIT;
    res.json({ entries: leaderboard(db, limit) });
  });

  return router;
}
