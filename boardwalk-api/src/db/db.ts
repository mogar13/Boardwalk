import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA } from './schema';

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
  return db;
}
