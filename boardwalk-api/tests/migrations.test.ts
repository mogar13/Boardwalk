import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { COLUMN_MIGRATIONS } from '../src/db/schema';
import { migrateColumns, openDb } from '../src/db/db';
import { loadProfile, upsertProfile } from '../src/domain/profile';

/**
 * THE CLAIM UNDER TEST: a column added to the schema reaches the database that already exists.
 *
 * `migrateColumns` has carried the comment "exported for the test that proves a Phase-A-shaped
 * database is brought forward" since Phase B — and until P5 that test did not exist. The comment
 * described an intention, which is the documentation form of the defect the mechanism itself
 * guards against: something that reads like enforcement and enforces nothing.
 *
 * WHY THIS IS WORTH A FILE. `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so a
 * column added to the DDL reaches every FRESH database and no DEPLOYED one. Every test in this
 * suite starts fresh, so the whole suite passes while production is one column short — and the
 * symptom there is not an error but a silently dropped field. That asymmetry is invisible to every
 * other test here by construction, so it needs a test that deliberately builds the old shape.
 */

/** The `profiles` table as it stood BEFORE P5 — the shape the Pi's database is actually in. */
const PRE_P5_PROFILES = `
CREATE TABLE profiles (
  uid                   TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  avatar                TEXT NOT NULL,
  xp                    INTEGER NOT NULL DEFAULT 0,
  daily_last_claim_day  INTEGER NOT NULL DEFAULT 0,
  daily_streak          INTEGER NOT NULL DEFAULT 0,
  equipped_cardback     TEXT,
  equipped_title        TEXT,
  updated_at            INTEGER NOT NULL
);`;

/**
 * `wagers` and `mutations` as they stood BEFORE Phase E — the shape the Pi's database is in now,
 * carrying Phase D's `hand_id` but not the `match_id` a Liar's Dice ante is closed by.
 */
const PRE_PHASE_E_MONEY = `
CREATE TABLE wagers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL,
  game_id      TEXT NOT NULL,
  wager_cents  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  settled_at   INTEGER,
  hand_id      INTEGER
);
CREATE TABLE mutations (
  uid         TEXT NOT NULL,
  nonce       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  hand_id     INTEGER,
  PRIMARY KEY (uid, nonce)
);`;

const columnsOf = (db: Database.Database, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('additive column migrations', () => {
  it('adds the Phase-E match_id columns to a database that predates them', () => {
    // Liar's Dice closes an ante by match id. Without these two entries the column exists only on
    // the databases this suite creates, and on the Pi every settle would close ZERO wagers — the
    // stake would sit open forever and the bankroll would drift from the ledger that defines it.
    const db = new Database(':memory:');
    db.exec(PRE_PHASE_E_MONEY);
    expect(columnsOf(db, 'wagers')).not.toContain('match_id');
    expect(columnsOf(db, 'mutations')).not.toContain('match_id');

    migrateColumns(db);

    expect(columnsOf(db, 'wagers')).toContain('match_id');
    expect(columnsOf(db, 'mutations')).toContain('match_id');
    // And Phase D's columns are untouched beside them.
    expect(columnsOf(db, 'wagers')).toContain('hand_id');
  });

  it('needs NO migration entry for the two new liars_dice tables', () => {
    // The asymmetry this list exists for: a whole new TABLE does reach an existing database,
    // because `CREATE TABLE IF NOT EXISTS` runs on every open with nothing to be a no-op against.
    // Asserting it keeps someone from "fixing" the omission with entries that would then fail.
    const tables = COLUMN_MIGRATIONS.map((m) => m.table);
    expect(tables).not.toContain('liars_dice_matches');
    expect(tables).not.toContain('liars_dice_players');

    const db = openDb(':memory:');
    expect(columnsOf(db, 'liars_dice_matches')).toContain('pot_cents');
    expect(columnsOf(db, 'liars_dice_players')).toContain('ante_cents');
  });

  it('adds the P5 equipped columns to a database that predates them', () => {
    const db = new Database(':memory:');
    db.exec(PRE_P5_PROFILES);
    expect(columnsOf(db, 'profiles')).not.toContain('equipped_felt');
    expect(columnsOf(db, 'profiles')).not.toContain('equipped_dice');

    migrateColumns(db);

    expect(columnsOf(db, 'profiles')).toContain('equipped_felt');
    expect(columnsOf(db, 'profiles')).toContain('equipped_dice');
    expect(columnsOf(db, 'profiles')).toContain('equipped_frame');
    // The columns it already had are untouched — a migration that rebuilt the table would be a
    // migration that could lose rows.
    expect(columnsOf(db, 'profiles')).toContain('equipped_cardback');
  });

  it('is idempotent — running it on every boot does nothing after the first', () => {
    const db = new Database(':memory:');
    db.exec(PRE_P5_PROFILES);
    migrateColumns(db);
    const after = columnsOf(db, 'profiles');
    // Ten more boots. A duplicate ADD COLUMN would throw, so surviving is the assertion.
    for (let i = 0; i < 10; i++) migrateColumns(db);
    expect(columnsOf(db, 'profiles')).toEqual(after);
  });

  it('every migration entry names a column the fresh schema also creates', () => {
    // The two halves have to agree or they diverge: a column added ONLY to the migration list
    // never reaches a fresh database, and one added ONLY to the DDL never reaches the Pi's. This
    // walks the list and checks each column exists on a database built from the DDL alone.
    const fresh = openDb(':memory:');
    const missing = COLUMN_MIGRATIONS.filter((m) => !columnsOf(fresh, m.table).includes(m.column));
    expect(missing.map((m) => `${m.table}.${m.column}`)).toEqual([]);
  });

  it('a migrated database round-trips a felt and a frame', () => {
    // The end-to-end version: the columns are not the point, the data surviving them is.
    const db = new Database(':memory:');
    db.exec(PRE_P5_PROFILES);
    // The rest of the schema (ledger, mutations, stats…) that `loadProfile` reads.
    const full = openDb(':memory:');
    for (const stmt of (
      full
        .prepare(
          // `sqlite_%` excluded: SQLite's own bookkeeping tables (sqlite_sequence) come back from
          // sqlite_master but are reserved and cannot be re-created by hand.
          `SELECT sql FROM sqlite_master WHERE type='table' AND name != 'profiles' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as {
        sql: string | null;
      }[]
    ).filter((r) => r.sql !== null)) {
      db.exec(stmt.sql as string);
    }
    migrateColumns(db);

    upsertProfile(db, 'u1', {
      name: 'Ada',
      avatar: '👤',
      equipped: { felt: 'ft_red', frame: 'fr_violet' },
    });
    expect(loadProfile(db, 'u1')?.equipped).toEqual({ felt: 'ft_red', frame: 'fr_violet' });
  });
});
