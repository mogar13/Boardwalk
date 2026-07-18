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
  -- The equipped cosmetics (P2 of the progression overhaul). NULL = nothing equipped of that
  -- kind, which is the honest default: the free starter card back is what cardBackSrc() falls
  -- back to, so an empty slot still draws. Two columns rather than a JSON blob because the set
  -- of equippable kinds is closed and small, and a column is a thing .validate-style coercion
  -- can pin. THESE WERE MISSING UNTIL PHASE B — Phase A's mirror silently dropped equipped
  -- on every write, so a shadow read-back would have diffed on it forever.
  equipped_cardback     TEXT,
  equipped_title        TEXT,
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

-- PHASE B. An open wager: one row per committed bet, closed by the settle that references it.
--
-- This is what makes POST /settle checkable at all. Without it the server would be taking the
-- client's word for both halves of a hand ("I bet 10, pay me 500"), which is the client-
-- authoritative economy with extra latency. With it, a settle must name a wager that this uid
-- actually placed, on this game, that is still open — and the payout is capped as a multiple of
-- THAT recorded amount. The server still cannot know whether the hand was really won (that is
-- Phase D, where the rules run here), but it can refuse a payout with no stake behind it and a
-- payout larger than the game could ever return.
CREATE TABLE IF NOT EXISTS wagers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  game_id      TEXT NOT NULL,
  wager_cents  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  -- NULL while the hand is live. Set by the settle that consumes it, so a wager pays out ONCE.
  settled_at   INTEGER
);

-- PHASE B. The idempotency log: one row per accepted mutation, keyed by the client's nonce.
--
-- THIS IS THE REPLAY-HARDENING BACKEND_PLAN.md OWES. Every money route is fire-and-forget from
-- a browser that may retry on a flaky connection, and Phase B's locked decision is that offline
-- wins bank on reconnect — both of which mean the same intent can arrive twice. A UNIQUE
-- (uid, nonce) makes the second arrival a no-op that REPLAYS the first response instead of
-- moving money again: the client sees the same authoritative profile either way and cannot tell
-- (or exploit) the difference. The nonce is per-uid, so one client cannot burn another's.
CREATE TABLE IF NOT EXISTS mutations (
  uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  nonce       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (uid, nonce)
);

CREATE INDEX IF NOT EXISTS idx_ledger_uid ON ledger(uid);
CREATE INDEX IF NOT EXISTS idx_stats_uid ON stats(uid);
CREATE INDEX IF NOT EXISTS idx_wagers_open ON wagers(uid, game_id) WHERE settled_at IS NULL;
`;

/**
 * Column additions for a database that already exists — the Pi's, which was created by the
 * Phase-A schema and cannot be re-created without losing the ledger.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so a column added to the DDL
 * above reaches a fresh database and NEVER reaches the deployed one. That asymmetry is the
 * classic way a schema change passes every test (tests always start fresh) and breaks in
 * production only. Each entry here is applied at open if its column is absent, so both paths
 * converge on the same shape.
 *
 * SQLite's `ALTER TABLE ... ADD COLUMN` is safe and cheap; the guard is a `PRAGMA table_info`
 * check rather than catching the duplicate-column error, because swallowing an error is how you
 * also swallow the next, real one.
 */
export const COLUMN_MIGRATIONS: readonly {
  readonly table: string;
  readonly column: string;
  readonly ddl: string;
}[] = [
  { table: 'profiles', column: 'equipped_cardback', ddl: 'ALTER TABLE profiles ADD COLUMN equipped_cardback TEXT' },
  { table: 'profiles', column: 'equipped_title', ddl: 'ALTER TABLE profiles ADD COLUMN equipped_title TEXT' },
];
