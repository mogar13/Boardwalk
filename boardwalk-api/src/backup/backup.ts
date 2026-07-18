/**
 * Taking the backup.
 *
 * WHY THE ONLINE BACKUP API AND NOT `cp`. The obvious backup is `cp boardwalk.db backups/`. It is
 * also wrong, and wrong in the way that only shows up under load: SQLite writes a database as a set
 * of pages, and a copy made while a transaction is in flight can capture some pages from before the
 * commit and some from after. The result is a file that exists, has the right size, and is torn.
 * WAL mode (which db.ts enables) makes this worse for naive copies, not better — the committed
 * truth may live in `-wal` sidecars the copy never took.
 *
 * `db.backup(path)` is SQLite's online backup API. It copies page-by-page while holding the right
 * locks, restarting if a writer moves under it, and produces a single self-contained file that is a
 * consistent snapshot of some real committed instant. It works on a LIVE database with the service
 * running, which is the only kind of backup that actually gets taken.
 *
 * WHY WE VERIFY WHAT WE JUST WROTE. Because the failure mode of a backup system is silence. A full
 * disk, a stick that remounted read-only, a half-flushed write — all of these produce an exit code
 * of 0 from a copy and a file you discover is useless on the worst day of the year. So the backup
 * re-opens its own output and runs the full verify (integrity + tables + ledger balances) before
 * declaring success, and exits non-zero if it cannot. An unverified backup is not a backup.
 */

import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { verifyBackupFile, type VerifyReport } from './verify';

/** Matches `boardwalk-20260718T031500Z.db` — the names this module writes, and only those. */
const BACKUP_NAME = /^boardwalk-\d{8}T\d{6}Z\.db$/;

export interface BackupOptions {
  /** Source database. Defaults to the same value config.ts uses, so ops and the server agree. */
  readonly dbPath: string;
  readonly backupDir: string;
  /** Prune backups whose mtime is older than this. `0` disables pruning. */
  readonly keepDays: number;
  /** Injected for tests; defaults to now. */
  readonly now?: Date;
}

export interface BackupResult {
  readonly path: string;
  readonly bytes: number;
  readonly report: VerifyReport;
  /** Filenames removed by the retention sweep. */
  readonly pruned: readonly string[];
}

/** Defaults live here, in one place, so the CLI wrapper carries no policy of its own. */
export const DEFAULT_DB_PATH = './data/boardwalk.db';
export const DEFAULT_BACKUP_DIR = '/mnt/boardwalk-db/backups';
export const DEFAULT_KEEP_DAYS = 14;

export type EnvLike = Readonly<Record<string, string | undefined>>;

export function readBackupOptions(env: EnvLike = process.env): BackupOptions {
  const days = Number.parseInt(env.BACKUP_KEEP_DAYS ?? '', 10);
  return {
    dbPath: env.DB_PATH?.trim() ? env.DB_PATH : DEFAULT_DB_PATH,
    backupDir: env.BACKUP_DIR?.trim() ? env.BACKUP_DIR : DEFAULT_BACKUP_DIR,
    keepDays: Number.isFinite(days) && days >= 0 ? days : DEFAULT_KEEP_DAYS,
  };
}

/**
 * `2026-07-18T03:15:00.123Z` → `20260718T031500Z`. Sortable as a plain string (which is why the
 * timestamp is UTC and fixed-width — the same reason chat message keys are, over in the frontend:
 * lexicographic order must equal chronological order, with no clock or locale in the middle).
 */
export function backupFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `boardwalk-${stamp}.db`;
}

/**
 * Delete backups older than `keepDays`. Only files matching this module's own naming pattern are
 * ever considered — a retention sweep that deletes by "everything in this directory" is one
 * mis-set env var away from being the incident it was meant to prevent.
 */
export function pruneBackups(dir: string, keepDays: number, now: Date): readonly string[] {
  if (keepDays <= 0) return [];
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  const pruned: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!BACKUP_NAME.test(name)) continue;
    const full = join(dir, name);
    if (statSync(full).mtimeMs < cutoff) {
      rmSync(full, { force: true });
      pruned.push(name);
    }
  }
  return pruned.sort();
}

/** Newest backup in `dir` by filename (which sorts chronologically), or null if there are none. */
export function newestBackup(dir: string): string | null {
  const names = readdirSync(dir)
    .filter((n) => BACKUP_NAME.test(n))
    .sort();
  const last = names[names.length - 1];
  return last === undefined ? null : join(dir, last);
}

/**
 * Take, verify and prune. Throws with a specific message on a failed verify — the caller (the CLI)
 * turns that into a non-zero exit. It deliberately does NOT delete the bad file: a corrupt backup
 * is evidence, and you want to look at it before the next run overwrites the story.
 */
export async function runBackup(opts: BackupOptions): Promise<BackupResult> {
  const now = opts.now ?? new Date();
  mkdirSync(opts.backupDir, { recursive: true });

  const dest = join(opts.backupDir, backupFileName(now));

  // Read-only on the SOURCE: this process is a spectator. It cannot be the thing that corrupts the
  // live database, no matter what else it gets wrong.
  const src = new Database(opts.dbPath, { readonly: true, fileMustExist: true });
  try {
    await src.backup(dest);
  } finally {
    src.close();
  }

  const bytes = statSync(dest).size;
  const report = verifyBackupFile(dest);
  if (!report.ok) {
    throw new Error(`backup verification FAILED for ${dest}:\n  - ${report.problems.join('\n  - ')}`);
  }

  // Prune only after a verified success. If today's backup is bad, yesterday's is the last good one
  // and this is the worst possible moment to be deleting old ones.
  const pruned = pruneBackups(opts.backupDir, opts.keepDays, now);

  return { path: dest, bytes, report, pruned };
}

/** The one-line summary the cron/systemd log will carry. Kept here so the drill can reuse the shape. */
export function summarize(r: BackupResult): string {
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return (
    `backup ok: ${r.path} ${r.bytes} bytes — ` +
    `${r.report.profiles} profiles, ${r.report.ledgerRows} ledger rows, ` +
    `${r.report.users} users totalling ${money(r.report.totalCents)}` +
    (r.pruned.length > 0 ? ` — pruned ${r.pruned.length}` : '')
  );
}
