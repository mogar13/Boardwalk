import { Router } from 'express';
import type { Db } from '../db/db';

/**
 * `GET /health` → a liveness + DB probe. Unauthenticated on purpose: a tunnel/uptime check and
 * the deploy's smoke test both hit this, and neither has a token. It touches the DB (a trivial
 * query) so "up" means "can actually serve", not merely "process is running".
 */
export function healthRouter(db: Db): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  return router;
}
