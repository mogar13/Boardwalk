import { Router } from 'express';
import type { Db } from '../db/db';
import { leaderboard } from '../domain/profile';

/**
 * `GET /leaderboard?limit=N&board=B` → the ranked standings, server-COMPUTED (wins summed from
 * stats, balances summed from the ledger) and server-RANKED through the shared `boardById`/`rankFor`
 * that the page itself uses. This is the read the frontend's `LeaderboardRepo.top` makes.
 *
 * PUBLIC, AND MOUNTED BEFORE THE AUTH MIDDLEWARE — see `app.ts`. It was mounted after, so every
 * request without a bearer token got 401, which is every signed-out visitor: the standings page
 * showed "Couldn't load the standings" permanently to anyone not logged in, while
 * `useLeaderboard`'s own docblock promised it "works signed out". That promise was true of the
 * Firebase path it was written for (`leaderboard/` is a world-readable node) and quietly stopped
 * being true at the Phase B cutover. The projection carries the same fields that node did — name,
 * avatar, xp, wins, played, bankroll — so serving them unauthenticated is the posture the design
 * always had, restored, not a widening of it.
 *
 * `limit` is clamped so a client cannot ask for the whole table. `board` is NOT validated here:
 * `boardById` falls back to wins for anything it does not recognise, which is the single place that
 * decision belongs — validating it twice is how the two answers drift.
 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Take the string arm of a query param and nothing else. Express types `req.query.x` as
 * `string | string[] | ParsedQs | ParsedQs[]` — a client can send `?limit[x]=1` or `?limit=1&limit=2`
 * and hand us an object or an array. `String()` on those yields `'[object Object]'` / `'1,2'`,
 * which parse to NaN and fall through to the default; harmless, but it only WORKS by accident.
 * `board` lands on the same default either way — `String(['wins','richest'])` is `'wins,richest'`,
 * which `boardById` matches no better than `''` does — so this is about the shape being read
 * honestly rather than a behaviour change: a param typed as five things is narrowed to the one
 * the route actually handles, at the boundary, once.
 */
const oneString = (v: unknown): string => (typeof v === 'string' ? v : '');

export function leaderboardRouter(db: Db): Router {
  const router = Router();

  router.get('/leaderboard', (req, res) => {
    const raw = Number.parseInt(oneString(req.query.limit), 10);
    const limit = Number.isFinite(raw) ? Math.min(MAX_LIMIT, Math.max(1, raw)) : DEFAULT_LIMIT;
    res.json({ entries: leaderboard(db, limit, oneString(req.query.board)) });
  });

  return router;
}
