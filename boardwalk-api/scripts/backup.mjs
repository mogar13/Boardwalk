#!/usr/bin/env node
/**
 * CLI wrapper — thin on purpose.
 *
 * All the real work is in src/backup/*.ts, which is typed and unit-tested (tests/backup.test.ts).
 * This file only reads the environment, calls it, prints one line, and picks an exit code. Logic
 * that lives ONLY in a script is logic that is only ever executed unattended, at night, on the one
 * machine you cannot easily debug — so there is as little of it here as possible.
 *
 * It imports from `dist/`, not `src/`, because the Pi runs the compiled server and has no dev
 * dependencies (no tsx) installed. If `dist/` is stale or missing, it says so instead of failing
 * with a module-resolution stack trace.
 *
 *   Usage:  npm run backup
 *   Env:    DB_PATH (default ./data/boardwalk.db)
 *           BACKUP_DIR (default /mnt/boardwalk-db/backups)
 *           BACKUP_KEEP_DAYS (default 14, 0 disables pruning)
 */

const load = async () => {
  try {
    return (await import('../dist/backup/backup.js')).default;
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('boardwalk backup: dist/backup is missing. Run `npm run build` in boardwalk-api first.');
      process.exit(2);
    }
    throw err;
  }
};

const main = async () => {
  const { readBackupOptions, runBackup, summarize } = await load();
  const result = await runBackup(readBackupOptions(process.env));
  console.log(summarize(result));
  for (const name of result.pruned) console.log(`pruned: ${name}`);
};

main().catch((err) => {
  // Loud, and non-zero. A backup failure that only whispers into a log is the same as no backup.
  console.error(`boardwalk backup FAILED: ${err?.message ?? String(err)}`);
  process.exit(1);
});
