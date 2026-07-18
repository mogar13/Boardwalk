import cors from 'cors';
import express, { type Express } from 'express';
import type { ApiConfig } from './config';
import { authMiddleware } from './auth/middleware';
import type { TokenVerifier } from './auth/verify';
import { firebaseVerifier, insecureDevVerifier } from './auth/verify';
import type { Db } from './db/db';
import { blackjackRouter } from './routes/blackjack';
import { economyRouter } from './routes/economy';
import { healthRouter } from './routes/health';
import { leaderboardRouter } from './routes/leaderboard';
import { profileRouter } from './routes/profile';

export interface AppDeps {
  readonly cfg: ApiConfig;
  readonly db: Db;
  /** Injectable so tests supply a fake and never load firebase-admin. */
  readonly verifier?: TokenVerifier;
}

/**
 * Build the Express app WITHOUT listening — the unit of the route tests. `/health` is mounted
 * before auth (it needs no token); everything else sits behind `authMiddleware`, so a route
 * added later is authenticated by default rather than by remembering to guard it.
 */
export function buildApp({ cfg, db, verifier }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  // Private Network Access (Chrome). When the SPA's origin resolves the API host to a private-range
  // IP — which happens for anyone on the same Tailscale tailnet, where the Funnel host maps to a
  // 100.x address — Chrome sends a PNA preflight (`Access-Control-Request-Private-Network: true`)
  // and BLOCKS the request unless the response carries `Access-Control-Allow-Private-Network: true`.
  // Set it before `cors` runs: the default cors middleware ends the OPTIONS preflight itself, and a
  // header set here (without ending the response) survives onto that reply. Non-tailnet users reach
  // the public Funnel IP and never trigger this, so it is inert for them.
  app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
  });

  app.use(cors({ origin: cfg.allowedOrigin }));
  app.use(express.json({ limit: '256kb' }));

  // A friendly, unauthenticated root so opening the bare URL in a browser shows something
  // reassuring instead of the auth middleware's 401. Mounted before auth, like /health.
  app.get('/', (_req, res) => {
    res.json({ name: 'boardwalk-api', status: 'ok', health: '/health' });
  });

  app.use(healthRouter(db));

  const tokenVerifier =
    verifier ??
    (cfg.authMode === 'insecure-dev' ? insecureDevVerifier : firebaseVerifier(cfg.firebaseProjectId));
  app.use(authMiddleware(cfg, tokenVerifier));

  app.use(profileRouter(db));
  app.use(economyRouter(db));
  app.use(blackjackRouter(db));
  app.use(leaderboardRouter(db));

  return app;
}
