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
  --
  -- P5 added felt and frame the same way, and it is the same trap twice: a kind that reaches
  -- the client type but not this table round-trips as nothing-equipped, so the cosmetic saves and
  -- then vanishes on reload. A column per kind, plus a COLUMN_MIGRATIONS entry per column, because
  -- the Pi's database already exists and the DDL above never reaches it.
  equipped_cardback     TEXT,
  equipped_title        TEXT,
  equipped_felt         TEXT,
  equipped_frame        TEXT,
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
  settled_at   INTEGER,
  -- PHASE D. The \`blackjack_hands\` row this stake belongs to, so a settle closes THIS hand's
  -- wagers by name — both of them after a double-down — instead of "the oldest open one for this
  -- game". Oldest-first is the right rule when the server cannot see the hand; it is the wrong one
  -- when it can, because an abandoned hand's wager would be consumed by a later, unrelated
  -- settlement. NULL for every non-blackjack wager, which still goes through the generic path.
  hand_id      INTEGER
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
  -- PHASE D. The blackjack hand this mutation acted on, so a REPLAY can answer with the same hand
  -- the first call did rather than "whatever hand is newest". Without it a stale retry of an
  -- earlier deal's nonce would return the CURRENT hand's cards — no money would move (the nonce
  -- still short-circuits), but the client would render someone else's turn, which is the kind of
  -- wrong answer that looks like a dealing bug. NULL for the four money mutations, which have no
  -- hand. Added here AND in COLUMN_MIGRATIONS — see the note below.
  hand_id     INTEGER,
  PRIMARY KEY (uid, nonce)
);

-- PHASE D. The server's own blackjack hands — the table that makes \`payoutCents\` stop being a
-- client claim.
--
-- Through Phase B the server knew a stake existed and what the payout could not exceed; it did not
-- know what cards were on the table, so a client that reported "blackjack, pay me 2.5x" every hand
-- was inside every rule. Now the deck is shuffled here, the reducer runs here, and the payout is
-- computed from THESE cards. The client is told what it is allowed to see (\`HandView\`) and is
-- never sent the deck or the hole card.
--
-- \`state_json\` is the whole \`BlackjackState\` — including the undealt remainder of the deck, which
-- is precisely the thing that must live server-side and nowhere else. It is a blob rather than
-- columns because it is opaque to SQL: nothing queries inside a hand, and the shape is owned by
-- the shared reducer, so columns would be a second definition of it that could drift.
CREATE TABLE IF NOT EXISTS blackjack_hands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  state_json  TEXT NOT NULL,
  -- 1 once the payout has been credited and the wagers closed. The flag is what stops a second
  -- settle: a finished hand is refused rather than replayed through the reducer.
  settled     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- PACKS. The OUTCOME of a pack open, keyed by the same (uid, nonce) that makes the mutation
-- idempotent. This table exists for exactly one reason, and it is the reason packs were the hard
-- intent to move server-side:
--
-- EVERY OTHER MUTATION IS DETERMINISTIC ON REPLAY. A repeated bet, settle, purchase or daily finds
-- its nonce in mutations, does nothing, and re-answers with the current profile — and that answer
-- is right, because nothing about those intents was ever a coin flip. A PACK OPEN IS RANDOM. If a
-- replay took the same "do nothing, return the profile" path, the second response would carry no
-- pull at all and the client's reveal would have nothing to show; if it re-rolled, the player would
-- be told they got two different items for one payment, and a retry on a flaky connection would
-- become a way to reroll a common into a legendary.
--
-- So the roll is PERSISTED at the moment it is made, and a replay REPLAYS IT VERBATIM: same item,
-- same duplicate flag, same dust, no money moved. The row is written inside the same transaction as
-- the ledger entry and the inventory grant, so there is no window in which a player has been
-- charged for a pull that was never recorded.
CREATE TABLE IF NOT EXISTS pack_opens (
  uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  nonce       TEXT NOT NULL,
  pack_id     TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  -- 0/1. SQLite has no boolean; the coercion back to one lives in mutations.ts.
  duplicate   INTEGER NOT NULL,
  dust_cents  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (uid, nonce)
);

CREATE INDEX IF NOT EXISTS idx_ledger_uid ON ledger(uid);
CREATE INDEX IF NOT EXISTS idx_stats_uid ON stats(uid);
CREATE INDEX IF NOT EXISTS idx_wagers_open ON wagers(uid, game_id) WHERE settled_at IS NULL;
-- Every hand lookup is "this player's, live or not" — a hand id alone is never enough, because a
-- hand id from another account must be a REFUSAL and not a read.
CREATE INDEX IF NOT EXISTS idx_blackjack_hands_uid ON blackjack_hands(uid, settled);
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
  // PHASE D. Two columns on tables the Pi already has. `blackjack_hands` needs no entry — a whole
  // new table DOES reach an existing database, because `CREATE TABLE IF NOT EXISTS` runs on every
  // open and there is nothing there to be a no-op against. It is only a new COLUMN on an OLD table
  // that silently never lands, which is the asymmetry this list exists for.
  // PHASE P5. Two more equipped slots on the Pi's existing `profiles` table — the felt and the
  // frame. Without these two lines the columns exist only on a freshly created database, which is
  // every database the test suite makes and none of the ones in production.
  { table: 'profiles', column: 'equipped_felt', ddl: 'ALTER TABLE profiles ADD COLUMN equipped_felt TEXT' },
  { table: 'profiles', column: 'equipped_frame', ddl: 'ALTER TABLE profiles ADD COLUMN equipped_frame TEXT' },
  { table: 'mutations', column: 'hand_id', ddl: 'ALTER TABLE mutations ADD COLUMN hand_id INTEGER' },
  { table: 'wagers', column: 'hand_id', ddl: 'ALTER TABLE wagers ADD COLUMN hand_id INTEGER' },
];
