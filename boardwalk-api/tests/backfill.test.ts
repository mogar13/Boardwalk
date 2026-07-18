import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/db';
import {
  MIGRATION_NONCE,
  backfillAll,
  backfillProfile,
  isProfileNode,
  planBackfill,
  readSourceProfile,
  summarizeBackfill,
} from '../src/domain/backfill';
import { balanceOf, loadProfile, upsertProfile } from '../src/domain/profile';
import { STARTING_BANKROLL_CENTS } from '../src/domain/economy';
import { reconcile, withTimeout } from '../src/backfill/source';

/**
 * THE CLAIM UNDER TEST: cutting over does not cost anybody their account.
 *
 * The two tests that matter most are the ones about things NOT happening — that a re-run does not
 * double a balance, and that a backfilled player signing in afterwards is not handed a second
 * $5,000 signup stake. Both of those bugs are silent (the numbers just look a bit generous), both
 * are unfixable after the fact against an append-only ledger, and neither is visible from any code
 * path a normal test would exercise.
 */

const fresh = (): Db => openDb(':memory:');

/** A realistic RTDB record — the shape `firebaseProfileRepo.save` writes. */
const wire = (over: Record<string, unknown> = {}) => ({
  name: 'Ada',
  avatar: '🎩',
  bankrollCents: 1_234_500,
  xp: 8_400,
  stats: {
    blackjack: { played: 90, won: 41, lost: 45, pushed: 4 },
    chess: { played: 12, won: 7, lost: 5, pushed: 0 },
  },
  achievements: { first_win: 1_700_000_000_000, high_roller: 1_700_000_500_000 },
  inventory: { cb_gold: true, title_shark: true },
  equipped: { cardback: 'cb_gold', title: 'title_shark' },
  daily: { lastClaimDay: 20_290, streak: 6 },
  ...over,
});

/* ------------------------------------------------------------------ the wire */

describe('readSourceProfile', () => {
  it('reads a complete record faithfully', () => {
    const p = readSourceProfile(wire());
    expect(p.name).toBe('Ada');
    expect(p.avatar).toBe('🎩');
    expect(p.bankrollCents).toBe(1_234_500);
    expect(p.xp).toBe(8_400);
    expect(p.stats.blackjack).toEqual({ played: 90, won: 41, lost: 45, pushed: 4 });
    expect(p.achievements.first_win).toBe(1_700_000_000_000);
    expect(p.inventory).toEqual({ cb_gold: true, title_shark: true });
    expect(p.equipped).toEqual({ cardback: 'cb_gold', title: 'title_shark' });
    expect(p.daily).toEqual({ lastClaimDay: 20_290, streak: 6 });
  });

  it('survives the fields RTDB strips when empty', () => {
    // A fresh account writes `{}` for stats/achievements/inventory/equipped and RTDB stores
    // NOTHING, so they come back missing. This is v1's oldest bug and the frontend's reader
    // documents it; the backfill's reader has to be at least as forgiving or it drops real data.
    const p = readSourceProfile({ name: 'Bo', avatar: '👤', bankrollCents: 500_000, xp: 0 });
    expect(p.stats).toEqual({});
    expect(p.achievements).toEqual({});
    expect(p.inventory).toEqual({});
    expect(p.equipped).toEqual({});
    expect(p.daily).toEqual({ lastClaimDay: 0, streak: 0 });
  });

  it('defaults a missing bankroll to the opening stake, not to zero', () => {
    // The frontend renders a missing balance as $5,000, so that is what the player sees today.
    // Migrating 0 instead would take their money on cutover.
    expect(readSourceProfile({ name: 'Bo' }).bankrollCents).toBe(STARTING_BANKROLL_CENTS);
  });

  it('coerces hostile and legacy field types rather than throwing', () => {
    const p = readSourceProfile({
      name: '',
      avatar: 42,
      bankrollCents: '900',
      xp: -50,
      stats: { uno: { played: 'x', won: 2.6, lost: null } },
      achievements: { good: 1_700, bad: 'nope' },
      inventory: { real: true, fake: 'true' },
      equipped: { cardback: '', title: 7 },
      level: 12, // a Phase-2 record still carries one; it is derived and must be ignored
    });
    expect(p.name).toBe('Player');
    expect(p.avatar).toBe('👤');
    expect(p.bankrollCents).toBe(STARTING_BANKROLL_CENTS); // '900' is not a number
    expect(p.xp).toBe(0);
    expect(p.stats.uno).toEqual({ played: 0, won: 3, lost: 0, pushed: 0 });
    expect(p.achievements).toEqual({ good: 1_700 });
    expect(p.inventory).toEqual({ real: true });
    expect(p.equipped).toEqual({});
    expect(p).not.toHaveProperty('level');
  });

  it('rounds a fractional cent, because RTDB cannot say "integer"', () => {
    expect(readSourceProfile({ bankrollCents: 1_000.6 }).bankrollCents).toBe(1_001);
  });
});

describe('isProfileNode', () => {
  it('rejects nothing-shaped nodes', () => {
    for (const v of [undefined, null, {}, 'x', 5]) expect(isProfileNode(v)).toBe(false);
  });
  it('accepts a node with any field', () => {
    expect(isProfileNode({ name: 'Ada' })).toBe(true);
  });
});

/* ------------------------------------------------------------- the happy path */

describe('backfillProfile', () => {
  it('creates the whole account and lands the balance in ONE migration row', () => {
    const db = fresh();
    const r = backfillProfile(db, 'u1', wire(), { now: 1_000 });

    expect(r.outcome).toBe('migrated');
    expect(r.deltaCents).toBe(1_234_500);

    const p = loadProfile(db, 'u1');
    expect(p?.bankrollCents).toBe(1_234_500);
    expect(p?.name).toBe('Ada');
    expect(p?.xp).toBe(8_400);
    expect(p?.stats.blackjack).toEqual({ played: 90, won: 41, lost: 45, pushed: 4 });
    expect(p?.achievements.first_win).toBe(1_700_000_000_000);
    expect(p?.inventory).toEqual({ cb_gold: true, title_shark: true });
    expect(p?.equipped).toEqual({ cardback: 'cb_gold', title: 'title_shark' });
    expect(p?.daily).toEqual({ lastClaimDay: 20_290, streak: 6 });

    const rows = db
      .prepare('SELECT delta_cents, reason FROM ledger WHERE uid = ?')
      .all('u1') as { delta_cents: number; reason: string }[];
    expect(rows).toEqual([{ delta_cents: 1_234_500, reason: 'migration' }]);
  });

  it('migrates the daily clock, so nobody gets a free claim or a broken streak', () => {
    const db = fresh();
    backfillProfile(db, 'u1', wire(), { now: 1_000 });
    expect(loadProfile(db, 'u1')?.daily).toEqual({ lastClaimDay: 20_290, streak: 6 });
  });

  it('skips a node that holds no profile', () => {
    const db = fresh();
    const r = backfillProfile(db, 'ghost', undefined, { now: 1_000 });
    expect(r.outcome).toBe('skipped-empty');
    expect(loadProfile(db, 'ghost')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual({ n: 0 });
  });
});

/* ------------------------------------------------------------- idempotency */

describe('idempotency', () => {
  it('a second run changes nothing at all', () => {
    const db = fresh();
    backfillProfile(db, 'u1', wire(), { now: 1_000 });

    const second = backfillProfile(db, 'u1', wire(), { now: 2_000 });
    expect(second.outcome).toBe('already-migrated');

    expect(balanceOf(db, 'u1')).toBe(1_234_500);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE uid = ?').get('u1')).toEqual({ n: 1 });
  });

  it('re-running ten times does not multiply the money', () => {
    const db = fresh();
    for (let i = 0; i < 10; i++) backfillProfile(db, 'u1', wire(), { now: 1_000 + i });
    expect(balanceOf(db, 'u1')).toBe(1_234_500);
  });

  it('a re-run does NOT re-apply a balance the player has since changed by playing', () => {
    // The nastiest version of a double-run: migrate, the player loses $100 through the referee,
    // then someone runs the backfill again. Re-reconciling to the stale Firebase number would
    // silently refund the loss. The marker means the second run does not look at money at all.
    const db = fresh();
    backfillProfile(db, 'u1', wire(), { now: 1_000 });
    db.prepare(
      "INSERT INTO ledger (uid, game_id, delta_cents, reason, created_at) VALUES ('u1', 'blackjack', -10000, 'bet', 1500)"
    ).run();

    backfillProfile(db, 'u1', wire(), { now: 2_000 });
    expect(balanceOf(db, 'u1')).toBe(1_224_500);
  });

  it('writes the marker as a mutations row keyed on the uid', () => {
    const db = fresh();
    backfillProfile(db, 'u1', wire(), { now: 1_000 });
    const row = db
      .prepare('SELECT nonce, kind FROM mutations WHERE uid = ?')
      .get('u1') as { nonce: string; kind: string };
    expect(row).toEqual({ nonce: MIGRATION_NONCE, kind: 'migration' });
  });

  it("one uid's marker does not block another's", () => {
    const db = fresh();
    backfillProfile(db, 'u1', wire(), { now: 1_000 });
    expect(backfillProfile(db, 'u2', wire(), { now: 1_000 }).outcome).toBe('migrated');
  });
});

/* ------------------------------------------------- no second signup stake */

describe('the signup stake', () => {
  it('a backfilled player signing in afterwards is NOT granted a second stake', () => {
    // THE BUG THIS FILE EXISTS TO PREVENT. `upsertProfile` grants the opening $5,000 when no
    // profiles row exists. The backfill writes that row, so the grant cannot fire — and a
    // sign-in, which is a PUT /profile, must leave the migrated balance untouched.
    const db = fresh();
    backfillProfile(db, 'u1', wire(), { now: 1_000 });

    upsertProfile(db, 'u1', { name: 'Ada', avatar: '🎩', equipped: {} }, { now: 2_000 });

    expect(balanceOf(db, 'u1')).toBe(1_234_500);
    const reasons = db
      .prepare('SELECT reason FROM ledger WHERE uid = ?')
      .all('u1') as { reason: string }[];
    expect(reasons.map((r) => r.reason)).toEqual(['migration']);
    expect(reasons.some((r) => r.reason === 'signup')).toBe(false);
  });

  it('reconciles a uid that ALREADY had a signup grant instead of stacking on top of it', () => {
    // The one profile Phase A's shadow mirror created. It already holds a $5,000 signup row.
    // Depositing its Firebase balance as-is would leave it $5,000 rich and make the runbook's
    // total-cents check verify a sum the migration had itself corrupted.
    const db = fresh();
    upsertProfile(db, 'u1', { name: 'Ada', avatar: '👤', equipped: {} }, { now: 500 });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);

    const r = backfillProfile(db, 'u1', wire(), { now: 1_000 });
    expect(r.priorCents).toBe(STARTING_BANKROLL_CENTS);
    expect(r.deltaCents).toBe(1_234_500 - STARTING_BANKROLL_CENTS);
    expect(balanceOf(db, 'u1')).toBe(1_234_500);
  });

  it('writes a NEGATIVE migration row when SQLite is ahead of Firebase', () => {
    const db = fresh();
    upsertProfile(db, 'u1', { name: 'Ada', avatar: '👤', equipped: {} }, { now: 500 });
    backfillProfile(db, 'u1', wire({ bankrollCents: 100 }), { now: 1_000 });
    expect(balanceOf(db, 'u1')).toBe(100);
  });

  it('writes no ledger row at all when the balances already agree', () => {
    const db = fresh();
    upsertProfile(db, 'u1', { name: 'Ada', avatar: '👤', equipped: {} }, { now: 500 });
    backfillProfile(db, 'u1', wire({ bankrollCents: STARTING_BANKROLL_CENTS }), { now: 1_000 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE reason = 'migration'").get()
    ).toEqual({ n: 0 });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
  });
});

/* ------------------------------------------------------------------ dry run */

describe('dry run', () => {
  it('reports exactly what it would do and writes nothing', () => {
    const db = fresh();
    const r = backfillProfile(db, 'u1', wire(), { now: 1_000, dryRun: true });

    expect(r.outcome).toBe('migrated');
    expect(r.deltaCents).toBe(1_234_500);

    expect(loadProfile(db, 'u1')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM mutations').get()).toEqual({ n: 0 });
  });

  it('a dry run does not consume the marker, so the real run still works', () => {
    const db = fresh();
    backfillProfile(db, 'u1', wire(), { now: 1_000, dryRun: true });
    expect(backfillProfile(db, 'u1', wire(), { now: 2_000 }).outcome).toBe('migrated');
    expect(balanceOf(db, 'u1')).toBe(1_234_500);
  });

  it('planBackfill is read-only', () => {
    const db = fresh();
    planBackfill(db, 'u1', wire());
    expect(db.prepare('SELECT COUNT(*) AS n FROM mutations').get()).toEqual({ n: 0 });
  });
});

/* ------------------------------------------------------------------ the batch */

describe('backfillAll', () => {
  const batch = [
    { uid: 'u1', wire: wire({ bankrollCents: 100_000 }) },
    { uid: 'u2', wire: wire({ bankrollCents: 250_000 }) },
    { uid: 'ghost', wire: undefined },
    { uid: 'u3', wire: { name: 'Cy' } }, // no bankrollCents — takes the opening stake
  ];

  it('summarizes migrated, skipped and defaulted counts and the totals', () => {
    const db = fresh();
    const s = backfillAll(db, batch, { now: 1_000 });

    expect(s.migrated).toBe(3);
    expect(s.skippedEmpty).toBe(1);
    expect(s.alreadyMigrated).toBe(0);
    expect(s.bankrollDefaulted).toBe(1);
    expect(s.targetCentsTotal).toBe(100_000 + 250_000 + STARTING_BANKROLL_CENTS);
    expect(s.deltaCentsTotal).toBe(s.targetCentsTotal);
  });

  it('a second pass migrates nobody', () => {
    const db = fresh();
    backfillAll(db, batch, { now: 1_000 });
    const again = backfillAll(db, batch, { now: 2_000 });
    expect(again.migrated).toBe(0);
    expect(again.alreadyMigrated).toBe(3);
    expect(again.skippedEmpty).toBe(1);
  });

  it('one malformed record does not roll back the others', () => {
    // Per-uid transactions: 2 good and 1 junk must leave 2 migrated, not 0. A batch that is
    // all-or-nothing turns one bad row into a migration nobody can complete.
    const db = fresh();
    const s = backfillAll(
      db,
      [
        { uid: 'u1', wire: wire({ bankrollCents: 100_000 }) },
        { uid: 'junk', wire: 'not an object' },
        { uid: 'u2', wire: wire({ bankrollCents: 250_000 }) },
      ],
      { now: 1_000 }
    );
    expect(s.migrated).toBe(2);
    expect(s.skippedEmpty).toBe(1);
    expect(balanceOf(db, 'u1')).toBe(100_000);
    expect(balanceOf(db, 'u2')).toBe(250_000);
  });

  it('summarizeBackfill names the dry run in its first line', () => {
    const db = fresh();
    const s = backfillAll(db, batch, { now: 1_000, dryRun: true });
    expect(summarizeBackfill(s, true)).toContain('DRY RUN');
    expect(summarizeBackfill(s, false)).toContain('backfill complete');
  });
});

/* ------------------------------------------------------------------ hanging */

describe('withTimeout', () => {
  it('passes a value through untouched', async () => {
    await expect(withTimeout(Promise.resolve(7), 1_000, 'x')).resolves.toBe(7);
  });

  it('passes a rejection through untouched', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000, 'x')).rejects.toThrow('boom');
  });

  it('rejects a promise that never settles, naming the likely cause', async () => {
    // The observed failure: with a bad service-account path, RTDB retries forever and `get()`
    // never settles — so the migration script hangs mid-window instead of going red.
    await expect(withTimeout(new Promise(() => {}), 20, 'reading users/')).rejects.toThrow(
      /reading users\/ did not complete within 20ms.*credentials/s
    );
  });
});

/* ------------------------------------------------------------- reconciliation */

describe('reconcile', () => {
  const batch = [
    { uid: 'u1', wire: wire({ bankrollCents: 100_000 }) },
    { uid: 'u2', wire: wire({ bankrollCents: 250_000 }) },
    { uid: 'ghost', wire: undefined },
  ];

  it('passes once every uid has migrated', () => {
    const db = fresh();
    backfillAll(db, batch, { now: 1_000 });
    const r = reconcile(db, batch);

    expect(r.ok).toBe(true);
    expect(r.mismatches).toEqual([]);
    expect(r.sourceCount).toBe(2); // the ghost is not expected to land
    expect(r.dbCount).toBe(2);
    expect(r.sourceCentsTotal).toBe(350_000);
    expect(r.dbCentsTotal).toBe(350_000);
  });

  it('fails before the backfill has run', () => {
    const db = fresh();
    const r = reconcile(db, batch);
    expect(r.ok).toBe(false);
    expect(r.mismatches).toHaveLength(2);
  });

  it('names the specific uid whose money did not come across', () => {
    const db = fresh();
    backfillAll(db, [batch[0]!], { now: 1_000 });
    const r = reconcile(db, batch);

    expect(r.ok).toBe(false);
    expect(r.mismatches).toEqual([{ uid: 'u2', sourceCents: 250_000, ledgerCents: 0 }]);
  });

  it('catches two swapped balances that a grand total would hide', () => {
    // The reason reconcile is per-uid. Both of these sum to $3,500 either way round.
    const db = fresh();
    backfillAll(
      db,
      [
        { uid: 'u1', wire: wire({ bankrollCents: 100_000 }) },
        { uid: 'u2', wire: wire({ bankrollCents: 250_000 }) },
      ],
      { now: 1_000 }
    );
    const swapped = [
      { uid: 'u1', wire: wire({ bankrollCents: 250_000 }) },
      { uid: 'u2', wire: wire({ bankrollCents: 100_000 }) },
    ];
    const r = reconcile(db, swapped);

    expect(r.sourceCentsTotal).toBe(r.dbCentsTotal); // the totals agree...
    expect(r.ok).toBe(false); // ...and it fails anyway
    expect(r.mismatches).toHaveLength(2);
  });

  it('tolerates a SQLite-only account that Firebase never had', () => {
    const db = fresh();
    backfillAll(db, batch, { now: 1_000 });
    upsertProfile(db, 'api-only', { name: 'Test', avatar: '👤', equipped: {} }, { now: 1_500 });
    expect(reconcile(db, batch).ok).toBe(true);
  });
});
