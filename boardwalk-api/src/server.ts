import { buildApp } from './app';
import { configProblems, readConfig } from './config';
import { openDb } from './db/db';

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

  const db = openDb(cfg.dbPath);
  const app = buildApp({ cfg, db });

  const server = app.listen(cfg.port, () => {
    console.log(
      `boardwalk-api listening on :${String(cfg.port)} — db=${cfg.dbPath} auth=${cfg.authMode}`
    );
  });

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
