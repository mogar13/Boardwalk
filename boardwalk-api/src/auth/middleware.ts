import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiConfig } from '../config';
import type { TokenVerifier } from './verify';

/**
 * Attach an authenticated `uid` to the request, or 401. Two paths, chosen by `authMode`:
 *
 *   • `firebase` — the `Authorization: Bearer <idToken>` header is verified by the Admin SDK.
 *   • `insecure-dev` — the `x-debug-uid` header is trusted verbatim. Dev only, gated at boot.
 *
 * Nothing downstream reads a header; every route reads `req.uid`, so the two modes are one code
 * path from the route's point of view — the same "a game reads only localSeatIds, never a mode"
 * discipline the frontend uses.
 */

// Express's Request has no `uid`; augment it once, here.
declare module 'express-serve-static-core' {
  interface Request {
    uid?: string;
  }
}

export function authMiddleware(cfg: ApiConfig, verifier: TokenVerifier): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      if (cfg.authMode === 'insecure-dev') {
        const uid = req.header('x-debug-uid')?.trim();
        if (!uid) {
          res.status(401).json({ error: 'x-debug-uid header required in insecure-dev mode' });
          return;
        }
        req.uid = uid;
        next();
        return;
      }

      const header = req.header('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
      if (token === '') {
        res.status(401).json({ error: 'missing bearer token' });
        return;
      }
      try {
        req.uid = await verifier.verify(token);
        next();
      } catch {
        res.status(401).json({ error: 'invalid token' });
      }
    })();
  };
}

/** Read the authenticated uid a route can rely on the middleware having set, or throw (a bug). */
export function requireUid(req: Request): string {
  if (!req.uid) throw new Error('requireUid called without authMiddleware — server misconfiguration');
  return req.uid;
}
