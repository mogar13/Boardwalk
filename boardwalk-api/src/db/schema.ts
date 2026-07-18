/**
 * The schema, as one idempotent DDL string applied at open. Inlined as a TS constant rather
 * than read from a `.sql` file so there is nothing to copy into `dist/` — the compiled server
 * carries its own schema.
 *
 * This is BACKEND_PLAN.md's sketch, with two deliberate scaffold-stage choices:
 *
 *   • `users.username` is NULLABLE. The `save` contract (mirroring the frontend's ProfileRepo)
 *     carries a Profile, which has a display `name` but no canonical username — that comes from
 *     the identity/auth path, which Phase A does not wire yet. SQLite lets many rows hold NULL
 *     under a UNIQUE index, so the column stays faithful to the plan without a value we do not
 *     yet have.
 *
 *   • THERE IS NO bankroll COLUMN, anywhere. The balance is `SUM(ledger.delta_cents)` — a derived
 *     value, never a stored number a write can overwrite. This is the one table BACKEND_PLAN.md
 *     insists on, and the reason `profiles` looks like it is missing money: if the number is
 *     stored, something eventually writes it.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  uid         TEXT PRIMARY KEY,
  username    TEXT UNIQUE,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  uid                   TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  avatar                TEXT NOT NULL,
  xp                    INTEGER NOT NULL DEFAULT 0,
  daily_last_claim_day  INTEGER NOT NULL DEFAULT 0,
  daily_streak          INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL
  -- no bankroll column, on purpose. See the header.
);

CREATE TABLE IF NOT EXISTS stats (
  uid       TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  game_id   TEXT NOT NULL,
  played    INTEGER NOT NULL DEFAULT 0,
  won       INTEGER NOT NULL DEFAULT 0,
  lost      INTEGER NOT NULL DEFAULT 0,
  pushed    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, game_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  uid             TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  achievement_id  TEXT NOT NULL,
  unlocked_at     INTEGER NOT NULL,
  PRIMARY KEY (uid, achievement_id)
);

CREATE TABLE IF NOT EXISTS inventory (
  uid           TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  item_id       TEXT NOT NULL,
  purchased_at  INTEGER NOT NULL,
  PRIMARY KEY (uid, item_id)
);

-- Every chip movement, append-only. The bankroll is the running sum of this table.
-- game_id is nullable: a signup grant or an out-of-band sync is not attributable to a game.
CREATE TABLE IF NOT EXISTS ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  game_id     TEXT,
  delta_cents INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_uid ON ledger(uid);
CREATE INDEX IF NOT EXISTS idx_stats_uid ON stats(uid);
`;
