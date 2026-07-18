import type { Db } from '../db/db';
import { STARTING_BANKROLL_CENTS } from './economy';
import { balanceOf } from './profile';
import type { DailyState, Equipped, GameStat, Profile } from './types';

/**
 * THE ONE-SHOT FIREBASE → SQLITE BACKFILL.
 *
 * The gap this closes: `boardwalk-api`'s SQLite holds one profile (Phase A's shadow mirror only
 * ever ran for the developer's own account), while Firebase RTDB holds every real player. Cutting
 * the frontend over to the referee without this would hand every unmirrored player a brand-new
 * `signup` grant from `upsertProfile` — which reads as "my bankroll reset to $5,000 and my XP,
 * stats, achievements and inventory are gone". That is not a bug you fix afterwards: the ledger is
 * append-only and the old numbers are only in RTDB.
 *
 * THE MARKER, AND WHY IT IS A `mutations` ROW. Idempotency here is the same problem the four money
 * routes already solved, so it uses the same table and the same primitive: `INSERT OR IGNORE INTO
 * mutations (uid, nonce)` with a fixed nonce. The first run claims the row and does the work; every
 * later run finds it claimed and does NOTHING. That means a re-run after a partial failure, a
 * double-invocation, or a nervous operator running it twice all collapse to one effect — and it
 * costs no new table and no new concept. The nonce is VERSIONED (`migration:v1`) so a future,
 * deliberately different backfill can be a `v2` rather than being silently swallowed by this one.
 *
 * THE SECOND SIGNUP STAKE, REFUSED BY CONSTRUCTION. `upsertProfile` grants the opening $5,000 when
 * and only when no `profiles` row exists for the uid. This module inserts that row, so a player who
 * has been backfilled and then signs in — which calls `PUT /profile` — takes the `existed` branch
 * and gets no grant. There is no flag to remember and no ordering to get right: the profile row IS
 * the evidence. `tests/backfill.test.ts` drives exactly that sequence, because it is the failure
 * this whole file exists to prevent and it would be invisible until someone read the ledger.
 *
 * THE LEDGER ROW IS A DELTA TO A TARGET, NOT A DEPOSIT. One row, reason `migration`, sized so the
 * ledger sum ENDS at the player's Firebase `bankrollCents`. For the ~all uids with no SQLite rows
 * that delta simply IS their Firebase balance. For a uid that already has a balance — the one
 * mirrored profile, which already carries a `signup` row — depositing the Firebase number on top
 * would double it, and the runbook's "total cents match Firebase" check would be verifying a sum
 * it had itself corrupted. Reconciling to the target makes that check meaningful for every row.
 */

/** The per-uid marker. Bump the version rather than reusing it for a different migration. */
export const MIGRATION_NONCE = 'migration:v1';
export const MIGRATION_REASON = 'migration';

/* ------------------------------------------------------------------ the wire */

/**
 * The RTDB wire shape, coerced. Every field is `unknown` for the reasons the frontend's
 * `firebaseProfileRepo` documents at length and paid for in v1: RTDB strips empty objects on
 * write (so `stats` on a fresh account comes back MISSING, not `{}`), and a record written by an
 * older version of the app carries whatever fields that version had. This is the one place the
 * wire becomes a domain value, and it must be at least as forgiving as the frontend's reader —
 * otherwise the backfill throws on, or silently drops, a record the app itself renders fine.
 */
const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;

const count = (v: unknown): number => Math.max(0, num(v, 0));

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

function readStats(wire: unknown): Record<string, GameStat> {
  const out: Record<string, GameStat> = {};
  for (const [gameId, raw] of Object.entries(asRecord(wire))) {
    const s = asRecord(raw);
    out[gameId] = {
      played: count(s.played),
      won: count(s.won),
      lost: count(s.lost),
      pushed: count(s.pushed),
    };
  }
  return out;
}

function readAchievements(wire: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(asRecord(wire))) {
    if (typeof raw === 'number' && Number.isFinite(raw)) out[id] = raw;
  }
  return out;
}

function readInventory(wire: unknown): Record<string, true> {
  const out: Record<string, true> = {};
  for (const [id, raw] of Object.entries(asRecord(wire))) {
    if (raw === true) out[id] = true;
  }
  return out;
}

function readEquipped(wire: unknown): Equipped {
  const e = asRecord(wire);
  const out: { cardback?: string; title?: string } = {};
  if (typeof e.cardback === 'string' && e.cardback !== '') out.cardback = e.cardback;
  if (typeof e.title === 'string' && e.title !== '') out.title = e.title;
  return out;
}

function readDaily(wire: unknown): DailyState {
  const d = asRecord(wire);
  return { lastClaimDay: count(d.lastClaimDay), streak: count(d.streak) };
}

/** What a Firebase record says about a player, as a complete `Profile`. */
export function readSourceProfile(wire: unknown): Profile {
  const w = asRecord(wire);
  return {
    name: str(w.name, 'Player'),
    avatar: str(w.avatar, '👤'),
    // The frontend defaults a missing or malformed balance to the opening stake, so that IS the
    // number the player currently sees in the top bar. Migrating anything else — 0, say — would
    // take money away from them on cutover. `bankrollDefaulted` reports how often this fired so
    // the runbook can eyeball it rather than discovering it from a support message.
    bankrollCents: Math.max(0, num(w.bankrollCents, STARTING_BANKROLL_CENTS)),
    xp: Math.max(0, num(w.xp, 0)),
    stats: readStats(w.stats),
    achievements: readAchievements(w.achievements),
    inventory: readInventory(w.inventory),
    equipped: readEquipped(w.equipped),
    // The daily clock comes across too. Dropping it would reset `lastClaimDay` to 0 and hand
    // everyone a free claim on cutover day — a small gift that is also a broken streak.
    daily: readDaily(w.daily),
  };
}

/** Is this record even a profile? An empty or non-object node is skipped, not defaulted. */
export function isProfileNode(wire: unknown): boolean {
  return typeof wire === 'object' && wire !== null && Object.keys(wire).length > 0;
}

/* ------------------------------------------------------------------ the plan */

export type BackfillOutcome =
  /** Written (or, in a dry run, would be written). */
  | 'migrated'
  /** The marker was already claimed by an earlier run. Nothing touched. */
  | 'already-migrated'
  /** The RTDB node held nothing profile-shaped. Nothing touched. */
  | 'skipped-empty';

export interface BackfillRecord {
  readonly uid: string;
  readonly outcome: BackfillOutcome;
  /** The Firebase balance this uid should end at. */
  readonly targetCents: number;
  /** The ledger balance before this run. */
  readonly priorCents: number;
  /** The single `migration` row's size — `target - prior`. Zero means no row is written. */
  readonly deltaCents: number;
  /** True when the source record carried no usable `bankrollCents` and took the opening stake. */
  readonly bankrollDefaulted: boolean;
}

export interface BackfillOptions {
  readonly now?: number;
  /** Compute and report, write nothing. The runbook's first pass. */
  readonly dryRun?: boolean;
}

const EMPTY = (uid: string, outcome: BackfillOutcome): BackfillRecord => ({
  uid,
  outcome,
  targetCents: 0,
  priorCents: 0,
  deltaCents: 0,
  bankrollDefaulted: false,
});

/**
 * What WOULD happen to this uid — read-only, so `--dry-run` is the same code path as the real run
 * minus the writes rather than a second implementation that can drift from it.
 */
export function planBackfill(db: Db, uid: string, wire: unknown): BackfillRecord {
  if (!isProfileNode(wire)) return EMPTY(uid, 'skipped-empty');

  const claimed =
    db
      .prepare('SELECT 1 FROM mutations WHERE uid = ? AND nonce = ?')
      .get(uid, MIGRATION_NONCE) !== undefined;
  if (claimed) return EMPTY(uid, 'already-migrated');

  const source = readSourceProfile(wire);
  const prior = balanceOf(db, uid);
  return {
    uid,
    outcome: 'migrated',
    targetCents: source.bankrollCents,
    priorCents: prior,
    deltaCents: source.bankrollCents - prior,
    bankrollDefaulted: !Number.isFinite(asRecord(wire).bankrollCents),
  };
}

/* ------------------------------------------------------------------ the write */

/**
 * Migrate one uid, in ONE transaction. Either the marker, the profile, the stats, the badges, the
 * inventory and the ledger row all land, or none of them do — the same reason `applyResult` is one
 * call on the frontend and `applySettle` is one transaction here. A half-migrated player (money but
 * no achievements) is worse than an unmigrated one, because the re-run would then be blocked by the
 * marker it had already written.
 */
export function backfillProfile(
  db: Db,
  uid: string,
  wire: unknown,
  opts: BackfillOptions = {}
): BackfillRecord {
  const plan = planBackfill(db, uid, wire);
  if (plan.outcome !== 'migrated' || opts.dryRun === true) return plan;

  const now = opts.now ?? Date.now();
  const source = readSourceProfile(wire);

  const tx = db.transaction(() => {
    // The users row comes first because `mutations.uid` — like every other table here — is a
    // FOREIGN KEY into it, and `openDb` turns foreign keys ON. Claiming the marker before the user
    // exists throws. (This ordering is not a style choice; the test suite found it.)
    db.prepare(
      'INSERT INTO users (uid, username, is_admin, created_at) VALUES (?, NULL, 0, ?) ON CONFLICT(uid) DO NOTHING'
    ).run(uid, now);

    // Claim the marker inside this transaction. `INSERT OR IGNORE` + `changes` rather than trusting
    // the SELECT in `planBackfill`, because that read happened outside the transaction and two
    // concurrent runs could both pass it. This is the check that actually holds — and returning
    // here rolls nothing back that matters, since the users insert above was a no-op for a uid that
    // had already been migrated.
    const claim = db
      .prepare('INSERT OR IGNORE INTO mutations (uid, nonce, kind, created_at) VALUES (?, ?, ?, ?)')
      .run(uid, MIGRATION_NONCE, 'migration', now);
    if (claim.changes === 0) return EMPTY(uid, 'already-migrated');

    // The profile row. Writing it is what makes `upsertProfile`'s `existed` check true forever
    // after, which is how a backfilled player is refused a second signup stake on next sign-in.
    db.prepare(
      `INSERT INTO profiles (uid, name, avatar, xp, daily_last_claim_day, daily_streak,
                             equipped_cardback, equipped_title, updated_at)
       VALUES (@uid, @name, @avatar, @xp, @lastClaimDay, @streak, @cardback, @title, @now)
       ON CONFLICT(uid) DO UPDATE SET
         name = excluded.name,
         avatar = excluded.avatar,
         xp = excluded.xp,
         daily_last_claim_day = excluded.daily_last_claim_day,
         daily_streak = excluded.daily_streak,
         equipped_cardback = excluded.equipped_cardback,
         equipped_title = excluded.equipped_title,
         updated_at = excluded.updated_at`
    ).run({
      uid,
      name: source.name,
      avatar: source.avatar,
      xp: source.xp,
      lastClaimDay: source.daily.lastClaimDay,
      streak: source.daily.streak,
      cardback: source.equipped.cardback ?? null,
      title: source.equipped.title ?? null,
      now,
    });

    const stat = db.prepare(
      `INSERT INTO stats (uid, game_id, played, won, lost, pushed)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid, game_id) DO UPDATE SET
         played = excluded.played, won = excluded.won,
         lost = excluded.lost, pushed = excluded.pushed`
    );
    for (const [gameId, s] of Object.entries(source.stats)) {
      stat.run(uid, gameId, s.played, s.won, s.lost, s.pushed);
    }

    const ach = db.prepare(
      'INSERT INTO achievements (uid, achievement_id, unlocked_at) VALUES (?, ?, ?) ON CONFLICT(uid, achievement_id) DO NOTHING'
    );
    for (const [id, at] of Object.entries(source.achievements)) ach.run(uid, id, at);

    const inv = db.prepare(
      'INSERT INTO inventory (uid, item_id, purchased_at) VALUES (?, ?, ?) ON CONFLICT(uid, item_id) DO NOTHING'
    );
    // The purchase timestamp is not in the source — RTDB stores ownership as `true`, not a date.
    // `now` is the honest answer ("we learned of it at migration") rather than a fabricated past.
    for (const id of Object.keys(source.inventory)) inv.run(uid, id, now);

    // The one ledger row. Skipped entirely when the delta is zero: a 0-cent entry moves nothing
    // and would only make the ledger harder to read during the post-cutover audit.
    if (plan.deltaCents !== 0) {
      db.prepare(
        'INSERT INTO ledger (uid, game_id, delta_cents, reason, created_at) VALUES (?, NULL, ?, ?, ?)'
      ).run(uid, plan.deltaCents, MIGRATION_REASON, now);
    }
    return plan;
  });

  return tx();
}

/* ------------------------------------------------------------------ the batch */

export interface BackfillSummary {
  readonly migrated: number;
  readonly alreadyMigrated: number;
  readonly skippedEmpty: number;
  readonly bankrollDefaulted: number;
  /** Sum of every migrated uid's Firebase balance — the runbook's reconciliation number. */
  readonly targetCentsTotal: number;
  /** Sum of the `migration` rows actually written. */
  readonly deltaCentsTotal: number;
  readonly records: readonly BackfillRecord[];
}

/**
 * Migrate every record. Per-uid transactions rather than one big one, deliberately: 500 players
 * where one has a malformed node should migrate 499 and name the one, not roll back the lot. The
 * marker makes the re-run that fixes the straggler a no-op for everyone else.
 */
export function backfillAll(
  db: Db,
  records: Iterable<{ readonly uid: string; readonly wire: unknown }>,
  opts: BackfillOptions = {}
): BackfillSummary {
  const out: BackfillRecord[] = [];
  for (const r of records) out.push(backfillProfile(db, r.uid, r.wire, opts));

  const migrated = out.filter((r) => r.outcome === 'migrated');
  return {
    migrated: migrated.length,
    alreadyMigrated: out.filter((r) => r.outcome === 'already-migrated').length,
    skippedEmpty: out.filter((r) => r.outcome === 'skipped-empty').length,
    bankrollDefaulted: migrated.filter((r) => r.bankrollDefaulted).length,
    targetCentsTotal: migrated.reduce((a, r) => a + r.targetCents, 0),
    deltaCentsTotal: migrated.reduce((a, r) => a + r.deltaCents, 0),
    records: out,
  };
}

export function summarizeBackfill(s: BackfillSummary, dryRun: boolean): string {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const head = dryRun ? 'backfill DRY RUN (nothing written)' : 'backfill complete';
  return [
    `${head}: ${String(s.migrated)} migrated, ${String(s.alreadyMigrated)} already migrated, ${String(s.skippedEmpty)} skipped (empty)`,
    `  target total: ${money(s.targetCentsTotal)}  ledger delta written: ${money(s.deltaCentsTotal)}`,
    `  bankroll defaulted to the opening stake for ${String(s.bankrollDefaulted)} record(s)`,
  ].join('\n');
}
