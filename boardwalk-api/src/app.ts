import cors from 'cors';
import express, { type Express } from 'express';
import type { ApiConfig } from './config';
import { authMiddleware } from './auth/middleware';
import type { TokenVerifier } from './auth/verify';
import { firebaseVerifier, insecureDevVerifier } from './auth/verify';
import type { Db } from './db/db';
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
  app.use(cors({ origin: cfg.allowedOrigin }));
  app.use(express.json({ limit: '256kb' }));

  app.use(healthRouter(db));

  const tokenVerifier =
    verifier ??
    (cfg.authMode === 'insecure-dev' ? insecureDevVerifier : firebaseVerifier(cfg.firebaseProjectId));
  app.use(authMiddleware(cfg, tokenVerifier));

  app.use(profileRouter(db));
  app.use(leaderboardRouter(db));

  return app;
}
