import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { COLUMN_MIGRATIONS, SCHEMA } from './schema';

export type Db = Database.Database;

/**
 * Open (or create) the database and apply the schema. Synchronous, because better-sqlite3 is —
 * a referee wants a transaction it can reason about, not a pool of promises.
 *
 * WAL mode is on for durability under concurrent reads while a write is in flight, and foreign
 * keys are enabled (SQLite defaults them OFF, so the ON DELETE CASCADE in the schema is inert
 * without this PRAGMA). Both are the kind of correctness that is invisible until the day it is not.
 */
export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    // Create the parent directory (e.g. the stick's ./data) so a first boot on a fresh
    // machine does not fail on a missing folder.
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrateColumns(db);
  return db;
}

interface TableInfoRow {
  name: string;
}

/**
 * Apply the additive column migrations to a database that predates them. Idempotent: a column
 * that is already there is skipped, so this runs on every boot and does nothing after the first.
 *
 * Exported for the test that proves a Phase-A-shaped database is brought forward rather than
 * left one column short — the failure mode this exists to prevent is invisible on a fresh DB.
 */
export function migrateColumns(db: Db): void {
  for (const m of COLUMN_MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as TableInfoRow[];
    if (cols.length === 0) continue; // table absent entirely — the DDL above owns creating it
    if (cols.some((c) => c.name === m.column)) continue;
    db.exec(m.ddl);
  }
}
