/**
 * Verification — the half of "backups" that is usually missing.
 *
 * A backup nobody has opened is a rumor. Worse, it is a rumor that LOOKS like a fact: there is a
 * file, it has a plausible size, the cron job exits 0. Every one of those things is true of a
 * truncated database. So this module never asks "does the file exist" — it asks three questions
 * that a corrupt or half-written file cannot answer:
 *
 *   1. Does SQLite itself say the pages are coherent (`PRAGMA integrity_check`)?
 *   2. Are the tables the referee actually needs all present?
 *   3. Does the DATA still mean what it meant — specifically, does every user's balance still
 *      recompute as `SUM(ledger.delta_cents)`?
 *
 * (3) is the one that matters and the one a file-level checksum can never give you. There is no
 * bankroll column anywhere in this schema (see db/schema.ts) — the balance IS the ledger sum. A
 * backup that restores the `profiles` table but loses `ledger` rows is structurally perfect and
 * financially wrong, and it would pass every check but this one.
 *
 * Everything here is read-only and takes a path or an open handle, so the same code runs from the
 * backup script (verifying what it just wrote), from the restore drill (verifying the newest
 * backup), and from tests/backup.test.ts (verifying a seeded temp DB). One implementation, three
 * callers — rather than a script whose logic is only ever exercised at 3am on the Pi.
 */

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * The tables the referee cannot function without, straight from db/schema.ts. Indexes are
 * deliberately not listed: a missing index is a performance bug, a missing table is data loss.
 */
export const EXPECTED_TABLES = [
  'users',
  'profiles',
  'stats',
  'achievements',
  'inventory',
  'ledger',
] as const;

export interface UserBalance {
  readonly uid: string;
  /** `SUM(ledger.delta_cents)` for this uid — recomputed here, never read from a column. */
  readonly balanceCents: number;
  /** How many ledger rows fed that sum. A balance of 0 from 0 rows is very different from 0 from 40. */
  readonly ledgerRows: number;
}

export interface VerifyReport {
  readonly ok: boolean;
  /** Human-readable failures. Empty iff `ok`. */
  readonly problems: readonly string[];
  readonly tables: readonly string[];
  readonly users: number;
  readonly profiles: number;
  readonly ledgerRows: number;
  /** Per-user recomputed balances, ordered by uid so two runs are diffable. */
  readonly balances: readonly UserBalance[];
  /** Sum of every balance — the one number an operator can eyeball against yesterday's run. */
  readonly totalCents: number;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * `PRAGMA integrity_check` returns a single row `ok` when healthy, or one row per problem.
 *
 * It can also THROW outright — a sufficiently damaged file ("database disk image is malformed")
 * never gets far enough to produce rows. That throw is a verification RESULT, not a crash, so it is
 * caught and reported like any other problem. Letting it propagate would mean the drill script
 * dies with a stack trace on exactly the input it was written to detect.
 */
export function integrityProblems(db: Db): readonly string[] {
  let rows: ReadonlyArray<{ integrity_check?: string }>;
  try {
    rows = db.pragma('integrity_check') as ReadonlyArray<{ integrity_check?: string }>;
  } catch (err) {
    return [message(err)];
  }
  const messages = rows.map((r) => r.integrity_check ?? '').filter((m) => m !== '');
  if (messages.length === 1 && messages[0] === 'ok') return [];
  // A pragma that returned nothing at all is not a pass — it is an unanswered question.
  return messages.length === 0 ? ['integrity_check returned no rows'] : messages;
}

export function tableNames(db: Db): readonly string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as ReadonlyArray<{ name: string }>;
  return rows.map((r) => r.name);
}

const count = (db: Db, table: string): number => {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number } | undefined;
  return row?.c ?? 0;
};

/**
 * Recompute every user's balance from the ledger. A LEFT JOIN, not an inner one: a user with zero
 * ledger rows must show up as 0, because "this uid vanished from the report" and "this uid has no
 * money" are the two outcomes we most need to tell apart.
 */
export function recomputeBalances(db: Db): readonly UserBalance[] {
  const rows = db
    .prepare(
      `SELECT u.uid AS uid,
              COALESCE(SUM(l.delta_cents), 0) AS balance_cents,
              COUNT(l.id) AS ledger_rows
         FROM users u
         LEFT JOIN ledger l ON l.uid = u.uid
        GROUP BY u.uid
        ORDER BY u.uid`
    )
    .all() as ReadonlyArray<{ uid: string; balance_cents: number; ledger_rows: number }>;
  return rows.map((r) => ({ uid: r.uid, balanceCents: r.balance_cents, ledgerRows: r.ledger_rows }));
}

/**
 * The full check against an already-open handle. Split out from `verifyBackupFile` so a test (or a
 * future in-process health endpoint) can point it at an in-memory DB with no file anywhere.
 */
export function verifyDb(db: Db): VerifyReport {
  const problems: string[] = [...integrityProblems(db)].map((m) => `integrity_check: ${m}`);

  // Reading the catalogue can throw on the same damaged file, for the same reason. If it does,
  // integrity_check has already said so — there is nothing to add but a name for the failure.
  let tables: readonly string[] = [];
  try {
    tables = tableNames(db);
    for (const t of EXPECTED_TABLES) {
      if (!tables.includes(t)) problems.push(`missing table: ${t}`);
    }
  } catch (err) {
    problems.push(`sqlite_master unreadable: ${message(err)}`);
  }

  // Only count rows once the tables are known to exist — otherwise the SELECT throws and we lose
  // the much more useful "missing table" message underneath a SQL error.
  const structural = problems.length === 0;
  const balances = structural ? recomputeBalances(db) : [];
  const totalCents = balances.reduce((sum, b) => sum + b.balanceCents, 0);

  // A ledger row whose uid is not in `users` is orphaned money: it counts toward no balance and
  // would silently disappear from every report. FK cascade should make this impossible, so if it
  // ever appears the backup (or the restore) lost the parent rows.
  if (structural) {
    const orphans = db
      .prepare(`SELECT COUNT(*) AS c FROM ledger l LEFT JOIN users u ON u.uid = l.uid WHERE u.uid IS NULL`)
      .get() as { c: number } | undefined;
    if ((orphans?.c ?? 0) > 0) {
      problems.push(`${orphans?.c ?? 0} ledger row(s) reference a uid that is not in users`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    tables,
    users: structural ? count(db, 'users') : 0,
    profiles: structural ? count(db, 'profiles') : 0,
    ledgerRows: structural ? count(db, 'ledger') : 0,
    balances,
    totalCents,
  };
}

/**
 * Verify a backup FILE without touching it: copy to a fresh temp dir and open the copy read-only.
 *
 * Two separate reasons for the copy, both learned the boring way:
 *   • Opening a SQLite file — even read-only — can want to create or read a sidecar journal next to
 *     it. The backup directory may be a read-only mount or a slow network share; the temp dir is
 *     neither.
 *   • It proves the file is *portable*. A "backup" that only opens in the directory it was written
 *     to is not a backup, and restoring off-box is the entire point.
 */
export function verifyBackupFile(path: string): VerifyReport {
  const dir = mkdtempSync(join(tmpdir(), 'boardwalk-restore-'));
  const staged = join(dir, 'restore.db');
  try {
    copyFileSync(path, staged);
    const db = new Database(staged, { readonly: true });
    try {
      return verifyDb(db);
    } finally {
      db.close();
    }
  } catch (err) {
    // A file too damaged (or too absent) to even open is the most complete failure there is, and
    // it must come back as a red REPORT rather than an exception — the caller's job is to print a
    // verdict, and "unreadable" is a verdict.
    return {
      ok: false,
      problems: [`could not open ${path}: ${message(err)}`],
      tables: [],
      users: 0,
      profiles: 0,
      ledgerRows: 0,
      balances: [],
      totalCents: 0,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
