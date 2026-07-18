#!/usr/bin/env node
/**
 * The restore drill — the deliverable that turns a backup from a rumor into a fact.
 *
 * This does not restore over anything. It takes a backup file (the newest, or one you name), stages
 * a COPY of it in a temp directory, opens that copy READ-ONLY, and asks whether the data is
 * *usable*: integrity, the six tables the referee needs, and — the assertion that actually matters —
 * whether every user's balance still recomputes as SUM(ledger.delta_cents).
 *
 * That last check is the reason this script exists rather than a `sqlite3 backup.db .tables`
 * one-liner. There is no bankroll column in this schema; the money IS the ledger. A backup that
 * opens cleanly and has every table but dropped ledger rows is a perfectly healthy file describing
 * an amount of money nobody has.
 *
 * It never opens the live DB and never writes outside a temp dir, so it is safe to run on the Pi
 * while the referee is serving traffic. Which is the point: a drill you are afraid to run is not a
 * drill.
 *
 *   Usage:  npm run restore:drill
 *           npm run restore:drill -- /mnt/boardwalk-db/backups/boardwalk-20260718T031500Z.db
 *   Env:    BACKUP_DIR (default /mnt/boardwalk-db/backups) — where "newest" is looked up
 */

const load = async (name) => {
  try {
    return (await import(`../dist/backup/${name}.js`)).default;
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('boardwalk restore-drill: dist/backup is missing. Run `npm run build` in boardwalk-api first.');
      process.exit(2);
    }
    throw err;
  }
};

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

const main = async () => {
  const { readBackupOptions, newestBackup } = await load('backup');
  const { verifyBackupFile, EXPECTED_TABLES } = await load('verify');

  const explicit = process.argv[2];
  const opts = readBackupOptions(process.env);
  const path = explicit ?? newestBackup(opts.backupDir);
  if (!path) {
    throw new Error(`no backups found in ${opts.backupDir} (looked for boardwalk-*.db)`);
  }

  console.log(`restore drill: ${path}`);
  const report = verifyBackupFile(path);

  console.log(`  integrity_check ..... ${report.problems.some((p) => p.startsWith('integrity')) ? 'FAIL' : 'ok'}`);
  console.log(`  tables .............. ${report.tables.length} present, expecting ${EXPECTED_TABLES.join(', ')}`);
  console.log(`  users ............... ${report.users}`);
  console.log(`  profiles ............ ${report.profiles}`);
  console.log(`  ledger rows ......... ${report.ledgerRows}`);
  console.log(`  recomputed balances . ${report.balances.length} users totalling ${money(report.totalCents)}`);

  // Show a few so the operator can sanity-check real numbers, not just a checksum. Truncated
  // because a drill that prints 5,000 lines is a drill nobody reads the output of.
  for (const b of report.balances.slice(0, 5)) {
    console.log(`      ${b.uid}: ${money(b.balanceCents)} from ${b.ledgerRows} ledger row(s)`);
  }
  if (report.balances.length > 5) console.log(`      ... and ${report.balances.length - 5} more`);

  if (!report.ok) {
    throw new Error(`DRILL FAILED:\n  - ${report.problems.join('\n  - ')}`);
  }
  console.log('restore drill PASSED — this backup is restorable and the ledger recomputes.');
};

main().catch((err) => {
  console.error(`boardwalk restore-drill FAILED: ${err?.message ?? String(err)}`);
  process.exit(1);
});
