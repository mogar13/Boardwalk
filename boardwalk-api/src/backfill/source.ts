import type { Db } from '../db/db';
import { balanceOf } from '../domain/profile';
import { isProfileNode, readSourceProfile } from '../domain/backfill';

/**
 * The I/O half of the backfill: reading `users/<uid>/profile` out of Firebase RTDB with the Admin
 * SDK, and the reconciliation that proves the copy landed.
 *
 * Kept thin and separate from `domain/backfill.ts` on purpose. Everything that DECIDES anything is
 * over there, pure and unit-tested against an in-memory database; this file only fetches bytes and
 * compares two numbers. The split is what makes the migration testable at all — you cannot unit-test
 * "the migration is correct" against a live Firebase project, and a migration you only find out
 * about by running it against production is not one you should run against production.
 *
 * The Admin SDK is imported LAZILY, the same call `auth/verify.ts` makes: the test suite must be
 * able to import this module's pure exports without loading a heavy native dependency or requiring
 * service-account credentials to exist.
 */

export interface SourceRecord {
  readonly uid: string;
  readonly wire: unknown;
}

export interface ReadOptions {
  readonly projectId: string;
  readonly databaseURL: string;
  /** Give up (loudly) after this long. See `withTimeout`. */
  readonly timeoutMs?: number;
}

export const DEFAULT_READ_TIMEOUT_MS = 60_000;

/**
 * Fail loudly instead of hanging.
 *
 * RTDB's client is built for a flaky browser: given a bad credential or an unreachable host it
 * RETRIES INDEFINITELY and never rejects — the `get()` above simply never settles. That is the
 * right behaviour for a game client and exactly the wrong one for a migration run inside a
 * maintenance window, where a script that prints "reading users/ ..." and then sits there forever
 * is indistinguishable from one doing slow, useful work. Observed, not theorised: a run with a
 * nonexistent service-account path produced retry warnings for as long as it was left alone.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${what} did not complete within ${String(ms)}ms. RTDB retries forever rather than ` +
            `failing, so this usually means bad credentials (check GOOGLE_APPLICATION_CREDENTIALS) ` +
            `or an unreachable FIREBASE_DATABASE_URL — not a slow database.`
        )
      );
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

/**
 * Every `users/<uid>/profile` in the project, as `{ uid, wire }` pairs.
 *
 * ONE READ OF `users/`, not a per-uid fetch. RTDB has no "list children shallowly then fetch each"
 * that is cheaper than this for a player table of this size, and — more importantly — a single
 * snapshot is a consistent point in time. Reading uid-by-uid across several minutes could catch a
 * player mid-hand and copy a balance that the next read would contradict. The runbook's answer to
 * the residual race is simpler and total: take the site down for the cutover window.
 */
export async function readFirebaseProfiles(opts: ReadOptions): Promise<SourceRecord[]> {
  const admin = await import('firebase-admin');
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: opts.projectId,
      databaseURL: opts.databaseURL,
    });
  }
  const snap = await withTimeout(
    admin.database().ref('users').get(),
    opts.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    'reading users/ from RTDB'
  );
  const users = snap.val() as Record<string, unknown> | null;
  if (users === null) return [];

  const out: SourceRecord[] = [];
  for (const [uid, node] of Object.entries(users)) {
    // The profile lives at `users/<uid>/profile`; `users/<uid>` may carry siblings. A uid whose
    // node has no `profile` child is a real state (an account that never finished creating one)
    // and is passed through as an empty wire so the summary COUNTS it as skipped rather than
    // silently omitting it — a migration that quietly drops rows is how you find out later.
    const profile = typeof node === 'object' && node !== null
      ? (node as Record<string, unknown>).profile
      : undefined;
    out.push({ uid, wire: profile });
  }
  return out;
}

/* ------------------------------------------------------------- reconciliation */

export interface UidMismatch {
  readonly uid: string;
  readonly sourceCents: number;
  readonly ledgerCents: number;
}

export interface Reconciliation {
  /** Records in the source that were expected to land. */
  readonly sourceCount: number;
  /** Profiles now in SQLite. */
  readonly dbCount: number;
  readonly sourceCentsTotal: number;
  readonly dbCentsTotal: number;
  /** Per-uid disagreements — empty is the only acceptable result. */
  readonly mismatches: readonly UidMismatch[];
  readonly ok: boolean;
}

interface CountRow {
  n: number;
}
interface TotalRow {
  total: number;
}

/**
 * Compare what Firebase says to what the ledger now sums to — per uid, not just in total.
 *
 * THE TOTALS ALONE ARE NOT ENOUGH, which is the whole reason this returns `mismatches`. Two players
 * whose balances were swapped produce a perfectly matching grand total, and so does one player
 * gaining exactly what another lost. A per-uid check is the only version of "the money came across"
 * that means what it sounds like; the totals are there because they are what a human can eyeball in
 * the runbook.
 */
export function reconcile(db: Db, source: readonly SourceRecord[]): Reconciliation {
  const expected = source.filter((r) => isProfileNode(r.wire));

  const mismatches: UidMismatch[] = [];
  let sourceCentsTotal = 0;
  for (const r of expected) {
    const sourceCents = readSourceProfile(r.wire).bankrollCents;
    const ledgerCents = balanceOf(db, r.uid);
    sourceCentsTotal += sourceCents;
    if (sourceCents !== ledgerCents) mismatches.push({ uid: r.uid, sourceCents, ledgerCents });
  }

  const dbCount = (db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as CountRow).n;
  const dbCentsTotal = (
    db.prepare('SELECT COALESCE(SUM(delta_cents), 0) AS total FROM ledger').get() as TotalRow
  ).total;

  return {
    sourceCount: expected.length,
    dbCount,
    sourceCentsTotal,
    dbCentsTotal,
    mismatches,
    // `dbCount >= sourceCount`, not `===`: SQLite may legitimately hold a profile Firebase does
    // not (a test account created straight against the API). An unmigrated PLAYER is what would
    // be a `<`, and that is a failure.
    ok: mismatches.length === 0 && dbCount >= expected.length,
  };
}

export function summarizeReconcile(r: Reconciliation): string {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const lines = [
    r.ok ? 'reconcile OK' : 'reconcile FAILED',
    `  profiles: ${String(r.sourceCount)} in firebase, ${String(r.dbCount)} in sqlite`,
    `  cents:    ${money(r.sourceCentsTotal)} in firebase, ${money(r.dbCentsTotal)} in sqlite (ledger sum, all uids)`,
  ];
  for (const m of r.mismatches.slice(0, 20)) {
    lines.push(`  MISMATCH ${m.uid}: firebase ${money(m.sourceCents)} vs ledger ${money(m.ledgerCents)}`);
  }
  if (r.mismatches.length > 20) {
    lines.push(`  ...and ${String(r.mismatches.length - 20)} more`);
  }
  return lines.join('\n');
}
