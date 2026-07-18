import { Router } from 'express';
import type { Db } from '../db/db';

/**
 * `GET /health` → a liveness + DB probe. Unauthenticated on purpose: a tunnel/uptime check and
 * the deploy's smoke test both hit this, and neither has a token. It touches the DB (a trivial
 * query) so "up" means "can actually serve", not merely "process is running".
 */
export function healthRouter(db: Db, ticketsOn = false): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      // `tickets` is here because of a lesson this repo has learned twice: a health check that
      // answers identically under two configurations is not evidence of either, and the offline
      // bound is exactly the kind of switch that can be off in production while every test that
      // covers it is green. This makes the state readable from the artifact.
      res.json({ ok: true, db: 'up', tickets: ticketsOn ? 'on' : 'off' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  return router;
}
