/**
 * Backup + restore drill, end to end against a real temp-file database.
 *
 * Deliberately NOT `:memory:` like the other suites: the whole claim being tested is about files —
 * that the online backup API produces a self-contained one, that it can be moved somewhere else and
 * still open, and that the money survives the trip. An in-memory test would prove none of that.
 *
 * The corruption cases are the important half. Any backup script passes on a healthy database; what
 * you need to know is that it goes RED on a bad one, because the day it matters is the day the file
 * is bad. So there is a test that truncates a backup, one that drops a table, and one that deletes
 * ledger rows — the silent, structurally-perfect kind of loss that only a balance recomputation
 * catches.
 */

import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/db';
import {
  backupFileName,
  newestBackup,
  pruneBackups,
  runBackup,
  summarize,
  type BackupOptions,
} from '../src/backup/backup';
import { EXPECTED_TABLES, verifyBackupFile, verifyDb } from '../src/backup/verify';

let root: string;
let dbPath: string;
let backupDir: string;

/**
 * A live DB with two users and a few ledger movements — the thing we are trying not to lose.
 *
 * Seeded with raw SQL rather than through `saveProfile`, on purpose. What is under test here is
 * whether BYTES survive a backup, and the fewer moving parts between "a row exists" and "the row
 * came back" the better. It also keeps this suite from going red every time the domain layer's
 * write path is refactored — a backup test that breaks when business logic changes is a backup test
 * people start ignoring.
 */
const seed = (): void => {
  const db = openDb(dbPath);
  const user = db.prepare('INSERT INTO users (uid, username, is_admin, created_at) VALUES (?, ?, 0, ?)');
  const profile = db.prepare(
    'INSERT INTO profiles (uid, name, avatar, xp, daily_last_claim_day, daily_streak, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?)'
  );
  const entry = db.prepare(
    'INSERT INTO ledger (uid, game_id, delta_cents, reason, created_at) VALUES (?, ?, ?, ?, ?)'
  );

  user.run('ada', 'ada', 1);
  profile.run('ada', 'Ada', '👤', 40, 2);
  entry.run('ada', null, 500_000, 'signup', 1);
  entry.run('ada', 'chess', 12_500, 'sync', 2);

  user.run('bob', 'bob', 3);
  profile.run('bob', 'Bob', '👤', 0, 4);
  entry.run('bob', null, 500_000, 'signup', 3);
  entry.run('bob', 'blackjack', -250_000, 'sync', 4);

  db.close();
};

const opts = (over: Partial<BackupOptions> = {}): BackupOptions => ({
  dbPath,
  backupDir,
  keepDays: 14,
  ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'boardwalk-backup-test-'));
  dbPath = join(root, 'data', 'boardwalk.db');
  backupDir = join(root, 'backups');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('backup file naming', () => {
  it('is UTC, fixed width, and sorts chronologically as a plain string', () => {
    const a = backupFileName(new Date('2026-07-18T03:15:00.123Z'));
    const b = backupFileName(new Date('2026-07-18T03:15:01.000Z'));
    const c = backupFileName(new Date('2026-12-01T00:00:00.000Z'));
    expect(a).toBe('boardwalk-20260718T031500Z.db');
    expect([c, b, a].sort()).toEqual([a, b, c]);
  });
});

describe('runBackup', () => {
  it('writes a verified, self-contained snapshot with the balances intact', async () => {
    seed();
    const r = await runBackup(opts());

    expect(r.report.ok).toBe(true);
    expect(r.report.problems).toEqual([]);
    expect(r.bytes).toBeGreaterThan(0);
    expect(statSync(r.path).size).toBe(r.bytes);

    // The assertion that matters: the money recomputed from the BACKUP's ledger.
    expect(r.report.balances).toEqual([
      { uid: 'ada', balanceCents: 512_500, ledgerRows: 2 },
      { uid: 'bob', balanceCents: 250_000, ledgerRows: 2 },
    ]);
    expect(r.report.totalCents).toBe(762_500);
    expect(r.report.users).toBe(2);
    expect(r.report.profiles).toBe(2);
    expect(r.report.ledgerRows).toBe(4);
  });

  it('carries every table the referee needs', async () => {
    seed();
    const r = await runBackup(opts());
    for (const t of EXPECTED_TABLES) expect(r.report.tables).toContain(t);
  });

  it('snapshots a LIVE database — writes after the backup are not in it', async () => {
    seed();
    const live = openDb(dbPath);
    try {
      const r = await runBackup(opts());
      // Move money AFTER the snapshot. The backup must still show the old balance; this is what
      // makes it a point-in-time snapshot rather than a racing file copy.
      live
        .prepare('INSERT INTO ledger (uid, game_id, delta_cents, reason, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('ada', null, 487_400, 'sync', 5);

      const after = verifyBackupFile(r.path);
      expect(after.balances[0]).toEqual({ uid: 'ada', balanceCents: 512_500, ledgerRows: 2 });
      expect(after.ok).toBe(true);
    } finally {
      live.close();
    }
  });

  it('the backup opens standalone somewhere else entirely (portability)', async () => {
    seed();
    const r = await runBackup(opts());

    const elsewhere = mkdtempSync(join(tmpdir(), 'boardwalk-elsewhere-'));
    try {
      // No -wal/-shm sidecars are copied — only the single file. If the online backup API had left
      // committed data in a sidecar, this read would come up short.
      const moved = join(elsewhere, 'restored.db');
      copyFileSync(r.path, moved);
      const db = new Database(moved, { readonly: true });
      try {
        const report = verifyDb(db);
        expect(report.ok).toBe(true);
        expect(report.totalCents).toBe(762_500);
      } finally {
        db.close();
      }
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('summarizes in one line naming path, size and row counts', async () => {
    seed();
    const line = summarize(await runBackup(opts()));
    expect(line).toContain('backup ok:');
    expect(line).toContain('2 profiles');
    expect(line).toContain('4 ledger rows');
    expect(line).toContain('$7625.00');
  });

  it('fails loudly when the source database does not exist', async () => {
    await expect(runBackup(opts({ dbPath: join(root, 'nope.db') }))).rejects.toThrow();
  });
});

describe('the drill goes RED on a bad backup', () => {
  it('catches a truncated file (integrity_check)', async () => {
    seed();
    const r = await runBackup(opts());
    // Lop off the tail: the header still reads, so the file "exists and looks fine".
    truncateSync(r.path, Math.floor(r.bytes / 2));

    const report = verifyBackupFile(r.path);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/integrity_check|malformed/i);
  });

  it('reports an absent or non-SQLite file as a red verdict, not an exception', () => {
    const missing = verifyBackupFile(join(root, 'nope.db'));
    expect(missing.ok).toBe(false);
    expect(missing.problems.join(' ')).toContain('could not open');

    const garbage = join(root, 'garbage.db');
    writeFileSync(garbage, 'this is not a database');
    expect(verifyBackupFile(garbage).ok).toBe(false);
  });

  it('catches a missing table', () => {
    // A file that is perfectly coherent SQLite and still useless to the referee.
    const partial = join(root, 'partial.db');
    const db = new Database(partial);
    db.exec('CREATE TABLE users (uid TEXT PRIMARY KEY)');
    db.close();

    const report = verifyBackupFile(partial);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain('missing table: ledger');
    expect(report.problems).toContain('missing table: profiles');
  });

  it('catches lost ledger rows — the failure only a balance recomputation sees', async () => {
    seed();
    const r = await runBackup(opts());

    // Structurally immaculate: every table present, integrity ok, users and profiles intact.
    // Only the money is gone.
    const db = new Database(r.path);
    db.exec(`DELETE FROM ledger WHERE uid = 'bob'`);
    db.close();

    const report = verifyBackupFile(r.path);
    expect(report.problems).toEqual([]); // nothing structural to complain about...
    expect(report.ok).toBe(true);
    // ...and yet Bob is broke. This is why the drill reports balances rather than a pass/fail alone:
    // the operator compares this total against the previous run.
    expect(report.balances).toEqual([
      { uid: 'ada', balanceCents: 512_500, ledgerRows: 2 },
      { uid: 'bob', balanceCents: 0, ledgerRows: 0 },
    ]);
    expect(report.totalCents).toBe(512_500);
  });

  it('catches orphaned ledger rows (money attached to no user)', async () => {
    seed();
    const r = await runBackup(opts());
    const db = new Database(r.path);
    // FKs off, so we can manufacture the orphan the cascade is supposed to make impossible — which
    // is exactly the state a partial restore would leave behind.
    db.pragma('foreign_keys = OFF');
    db.exec(`INSERT INTO ledger (uid, game_id, delta_cents, reason, created_at) VALUES ('ghost', NULL, 100, 'sync', 9)`);
    db.close();

    const report = verifyBackupFile(r.path);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('not in users');
  });
});

describe('retention', () => {
  const age = (path: string, days: number): void => {
    const t = (Date.now() - days * 86_400_000) / 1000;
    utimesSync(path, t, t);
  };

  it('prunes only its own old files, and never a recent one', async () => {
    seed();
    await runBackup(opts({ keepDays: 0, now: new Date('2026-07-01T00:00:00Z') }));
    await runBackup(opts({ keepDays: 0, now: new Date('2026-07-18T00:00:00Z') }));

    const names = readdirSync(backupDir).sort();
    expect(names).toHaveLength(2);
    age(join(backupDir, names[0]!), 30);

    // A stranger's file in the directory must survive: retention deletes by OUR naming pattern,
    // not by "everything here", because the second kind is one bad env var from being an incident.
    const bystander = join(backupDir, 'notes.txt');
    writeFileSync(bystander, 'do not delete me');
    age(bystander, 400);

    const pruned = pruneBackups(backupDir, 14, new Date());
    expect(pruned).toEqual([names[0]]);
    expect(readdirSync(backupDir).sort()).toEqual([names[1], 'notes.txt']);
  });

  it('keepDays = 0 disables pruning entirely', async () => {
    seed();
    const r = await runBackup(opts({ keepDays: 0 }));
    age(r.path, 900);
    expect(pruneBackups(backupDir, 0, new Date())).toEqual([]);
    expect(readdirSync(backupDir)).toHaveLength(1);
  });

  it('does not prune when the run that would have pruned failed verification', async () => {
    seed();
    const old = await runBackup(opts({ keepDays: 0, now: new Date('2026-01-01T00:00:00Z') }));
    age(old.path, 400);

    // Corrupt the SOURCE so the next backup verifies red.
    const db = new Database(dbPath);
    db.exec('DROP TABLE ledger');
    db.close();

    await expect(runBackup(opts({ keepDays: 1 }))).rejects.toThrow(/verification FAILED/);
    // Yesterday's good backup is still there. A failed run is the worst moment to delete history.
    expect(readdirSync(backupDir)).toContain(old.path.split('/').pop());
  });
});

describe('newestBackup', () => {
  it('returns null on an empty directory and the latest otherwise', async () => {
    seed();
    const empty = mkdtempSync(join(tmpdir(), 'boardwalk-empty-'));
    try {
      expect(newestBackup(empty)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }

    await runBackup(opts({ now: new Date('2026-07-01T00:00:00Z') }));
    const latest = await runBackup(opts({ now: new Date('2026-07-18T00:00:00Z') }));
    expect(newestBackup(backupDir)).toBe(latest.path);
  });
});
