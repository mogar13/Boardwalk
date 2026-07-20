import { buildApp } from './app';
import { configProblems, configWarnings, readConfig } from './config';
import { openDb } from './db/db';
import { firebaseVerifier, insecureDevVerifier } from './auth/verify';
import { RoomGateway } from './rooms/gateway';
import { sweepAbandonedMatches } from './domain/liarsDice';

/**
 * The process entrypoint. Reads config, refuses to boot on a dangerous one (see
 * `configProblems` — notably `insecure-dev` without the explicit opt-in), opens the DB on the
 * mounted stick, and listens. This is the only file that does I/O at module scope.
 */
function main(): void {
  const cfg = readConfig();

  const problems = configProblems(cfg);
  if (problems.length > 0) {
    for (const p of problems) console.error(`[config] ${p}`);
    process.exit(1);
  }
  // Non-fatal, but loud. A bound that is switched off in production while every test covering it is
  // green is exactly the failure this line exists to make impossible to miss at boot.
  for (const w of configWarnings(cfg)) console.warn(`[config] ${w}`);

  const db = openDb(cfg.dbPath);

  // One verifier, shared by the HTTP routes and the WS gateway — a room upgrade authenticates the
  // exact same Firebase ID token a REST call does (BACKEND_PLAN.md: identity stays in Firebase Auth).
  const verifier =
    cfg.authMode === 'insecure-dev'
      ? insecureDevVerifier
      : firebaseVerifier(cfg.firebaseProjectId);

  const app = buildApp({ cfg, db, verifier });

  // Phase C: the realtime rooms move off RTDB onto this WS gateway, sharing the Express port (and so
  // the same Tailscale Funnel / CORS origin). `attach` mounts it at `/rooms` on the HTTP server the
  // `listen` below returns, and echoes the Chrome PNA header onto the handshake for tailnet devices.
  // PHASE E. The gateway gets the database because it now DEALS a game: Liar's Dice matches are
  // durable rows and real ledger stakes, and the gateway is the only thing that knows when a
  // player acted. Rooms themselves still touch nothing durable — that rule is intact.
  const gateway = new RoomGateway(verifier, undefined, undefined, db);

  // A room lives in this process and a match does not, so a restart leaves matches with no table
  // to sit at while their antes have already left the ledger. Void and refund them BEFORE the
  // gateway accepts a socket, so there is no window in which a client can act on a match that is
  // about to be refunded.
  const swept = sweepAbandonedMatches(db, Date.now());
  if (swept.matches > 0) {
    console.log(
      `[liars-dice] voided ${String(swept.matches)} abandoned match(es), refunded ${String(swept.refundedCents)} cents`
    );
  }

  const server = app.listen(cfg.port, () => {
    console.log(
      `boardwalk-api listening on :${String(cfg.port)} — db=${cfg.dbPath} auth=${cfg.authMode}`
    );
  });
  gateway.attach(server);

  // Close cleanly so WAL is checkpointed and no request is cut mid-transaction.
  const shutdown = (signal: string): void => {
    console.log(`\n${signal} — shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
