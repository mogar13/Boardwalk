#!/usr/bin/env node
/**
 * The one-shot Firebase → SQLite backfill. CLI wrapper — thin, like backup.mjs, for the same
 * reason: everything that decides anything lives in src/domain/backfill.ts and src/backfill/
 * source.ts, typed and unit-tested. This file reads the environment, calls it, prints, and picks
 * an exit code.
 *
 * It imports from `dist/`, not `src/`, because the Pi runs the compiled server and has no tsx.
 *
 *   Usage:  npm run backfill -- --dry-run     # ALWAYS do this first. Writes nothing.
 *           npm run backfill                  # the real thing
 *           npm run backfill -- --verify      # reconcile only; writes nothing
 *
 *   Env:    DB_PATH               (default ./data/boardwalk.db)
 *           FIREBASE_PROJECT_ID   (required)
 *           FIREBASE_DATABASE_URL (required — e.g. https://<project>-default-rtdb.firebaseio.com)
 *           GOOGLE_APPLICATION_CREDENTIALS (required — the service-account JSON path)
 *           BACKFILL_TIMEOUT_MS   (default 60000 — RTDB retries forever, so this is what
 *                                  turns a bad credential into a red exit instead of a hang)
 *
 * Re-running is SAFE. Each uid is marked with a `migration:v1` nonce in the `mutations` table on
 * its first successful pass, and a marked uid is skipped entirely on every later run.
 */

const load = async (path) => {
  try {
    return (await import(`../dist/${path}.js`)).default;
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('boardwalk backfill: dist/ is missing or stale. Run `npm run build` in boardwalk-api first.');
      process.exit(2);
    }
    throw err;
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verifyOnly = args.includes('--verify');

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const databaseURL = process.env.FIREBASE_DATABASE_URL?.trim();
  const dbPath = process.env.DB_PATH?.trim() || './data/boardwalk.db';

  const missing = [
    !projectId && 'FIREBASE_PROJECT_ID',
    !databaseURL && 'FIREBASE_DATABASE_URL',
    !process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() && 'GOOGLE_APPLICATION_CREDENTIALS',
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`boardwalk backfill: missing required env: ${missing.join(', ')}`);
    process.exit(2);
  }

  const { openDb } = await load('db/db');
  const { backfillAll, summarizeBackfill } = await load('domain/backfill');
  const { readFirebaseProfiles, reconcile, summarizeReconcile, closeFirebase } =
    await load('backfill/source');

  console.log(`reading users/ from ${databaseURL} ...`);
  const timeoutMs = Number.parseInt(process.env.BACKFILL_TIMEOUT_MS ?? '', 10);
  const source = await readFirebaseProfiles({
    projectId,
    databaseURL,
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  });
  console.log(`read ${source.length} user node(s)`);

  // Release the RTDB socket as soon as the read is done. Without it the Admin SDK keeps the event
  // loop alive and this script hangs AFTER succeeding — see closeFirebase.
  await closeFirebase();

  const db = openDb(dbPath);

  if (!verifyOnly) {
    const summary = backfillAll(db, source, { dryRun });
    console.log(summarizeBackfill(summary, dryRun));
  }

  // Reconcile ALWAYS — including after a dry run, where it is expected to fail and shows you
  // exactly how far apart the two sides currently are. A migration script that only prints what it
  // did, and never checks what is now true, is the kind that reports success onto a broken ledger.
  const r = reconcile(db, source);
  console.log(summarizeReconcile(r));

  if (dryRun) {
    console.log('(dry run — nothing was written, so a reconcile failure above is expected)');
    return;
  }
  if (!r.ok) {
    console.error('boardwalk backfill: RECONCILE FAILED — do not cut the frontend over.');
    process.exit(1);
  }
};

main().catch((err) => {
  console.error(`boardwalk backfill FAILED: ${err?.message ?? String(err)}`);
  process.exit(1);
});
