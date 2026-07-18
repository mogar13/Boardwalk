import type { Db } from '../db/db';
import type { DailyState, GameStat, LeaderboardEntry, Profile } from './types';

/**
 * Profile persistence — the seam's server half. Three operations, all synchronous:
 * `loadProfile`, `saveProfile` (upsert = the frontend's create AND save), `leaderboard`.
 *
 * THE BANKROLL IS DERIVED. `balanceOf` sums the ledger; it is never stored. `saveProfile`
 * takes the whole Profile (the frontend always holds it complete) and, if the incoming
 * bankroll differs from the current derived balance, appends ONE ledger row for the delta —
 * so `reportResult`'s save becomes a ledger entry exactly as BACKEND_PLAN.md predicts, without
 * the client having to change. In Phase B the reason becomes 'bet'/'settle' and the server
 * computes the delta itself; in Phase A it mirrors the client and the reason is 'sync'.
 */

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;

interface ProfileRow {
  name: string;
  avatar: string;
  xp: number;
  daily_last_claim_day: number;
  daily_streak: number;
}
interface StatRow {
  game_id: string;
  played: number;
  won: number;
  lost: number;
  pushed: number;
}
interface AchievementRow {
  achievement_id: string;
  unlocked_at: number;
}
interface InventoryRow {
  item_id: string;
}
interface BalanceRow {
  bal: number;
}
interface LeaderRow {
  uid: string;
  name: string;
  avatar: string;
  xp: number;
  wins: number | null;
  bal: number | null;
}

/** The running sum of the ledger — the one and only source of a player's balance. */
export function balanceOf(db: Db, uid: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(delta_cents), 0) AS bal FROM ledger WHERE uid = ?')
    .get(uid) as BalanceRow;
  return row.bal;
}

export function loadProfile(db: Db, uid: string): Profile | null {
  const p = db
    .prepare(
      'SELECT name, avatar, xp, daily_last_claim_day, daily_streak FROM profiles WHERE uid = ?'
    )
    .get(uid) as ProfileRow | undefined;
  if (!p) return null;

  const statRows = db
    .prepare('SELECT game_id, played, won, lost, pushed FROM stats WHERE uid = ?')
    .all(uid) as StatRow[];
  const stats: Record<string, GameStat> = {};
  for (const s of statRows) {
    stats[s.game_id] = {
      played: count(s.played),
      won: count(s.won),
      lost: count(s.lost),
      pushed: count(s.pushed),
    };
  }

  const achRows = db
    .prepare('SELECT achievement_id, unlocked_at FROM achievements WHERE uid = ?')
    .all(uid) as AchievementRow[];
  const achievements: Record<string, number> = {};
  for (const a of achRows) achievements[a.achievement_id] = a.unlocked_at;

  const invRows = db
    .prepare('SELECT item_id FROM inventory WHERE uid = ?')
    .all(uid) as InventoryRow[];
  const inventory: Record<string, true> = {};
  for (const i of invRows) inventory[i.item_id] = true;

  const daily: DailyState = {
    lastClaimDay: count(p.daily_last_claim_day),
    streak: count(p.daily_streak),
  };

  return {
    name: str(p.name, 'Player'),
    avatar: str(p.avatar, '👤'),
    bankrollCents: balanceOf(db, uid),
    xp: count(p.xp),
    stats,
    achievements,
    inventory,
    daily,
  };
}

export interface SaveOptions {
  /** Ledger reason for a bankroll delta. Phase A mirrors the client, so this is 'sync'/'signup'. */
  readonly reason: string;
  /** Injected clock, so tests are deterministic. Defaults to wall time. */
  readonly now?: number;
}

/**
 * Create-or-update. Idempotent in every table EXCEPT the ledger, which is append-only by design:
 * re-saving the same profile appends nothing (delta is 0), but a bankroll that moved appends one
 * row. The whole write is a single transaction, so a partial save can never leave stats credited
 * without the money — the exact split BACKEND_PLAN.md and the frontend's `writeBoth` both guard.
 */
export function saveProfile(db: Db, uid: string, profile: Profile, opts: SaveOptions): void {
  const now = opts.now ?? Date.now();
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO users (uid, username, is_admin, created_at) VALUES (?, NULL, 0, ?) ON CONFLICT(uid) DO NOTHING'
    ).run(uid, now);

    db.prepare(
      `INSERT INTO profiles (uid, name, avatar, xp, daily_last_claim_day, daily_streak, updated_at)
       VALUES (@uid, @name, @avatar, @xp, @lastClaimDay, @streak, @now)
       ON CONFLICT(uid) DO UPDATE SET
         name = excluded.name,
         avatar = excluded.avatar,
         xp = excluded.xp,
         daily_last_claim_day = excluded.daily_last_claim_day,
         daily_streak = excluded.daily_streak,
         updated_at = excluded.updated_at`
    ).run({
      uid,
      name: profile.name,
      avatar: profile.avatar,
      xp: count(profile.xp),
      lastClaimDay: count(profile.daily.lastClaimDay),
      streak: count(profile.daily.streak),
      now,
    });

    // Bankroll → ledger delta. Derive the current balance, append only the difference.
    const current = balanceOf(db, uid);
    const delta = Math.round(profile.bankrollCents) - current;
    if (delta !== 0) {
      db.prepare(
        'INSERT INTO ledger (uid, game_id, delta_cents, reason, created_at) VALUES (?, NULL, ?, ?, ?)'
      ).run(uid, delta, opts.reason, now);
    }

    // Sets are replaced wholesale — the frontend always sends the complete profile, so the
    // authoritative set is exactly what arrived. (Phase B's server-authoritative writes will
    // mutate these in place instead of trusting the client's copy.)
    db.prepare('DELETE FROM stats WHERE uid = ?').run(uid);
    const insStat = db.prepare(
      'INSERT INTO stats (uid, game_id, played, won, lost, pushed) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const [gameId, s] of Object.entries(profile.stats)) {
      insStat.run(uid, gameId, count(s.played), count(s.won), count(s.lost), count(s.pushed));
    }

    db.prepare('DELETE FROM achievements WHERE uid = ?').run(uid);
    const insAch = db.prepare(
      'INSERT INTO achievements (uid, achievement_id, unlocked_at) VALUES (?, ?, ?)'
    );
    for (const [id, at] of Object.entries(profile.achievements)) insAch.run(uid, id, count(at));

    db.prepare('DELETE FROM inventory WHERE uid = ?').run(uid);
    const insInv = db.prepare(
      'INSERT INTO inventory (uid, item_id, purchased_at) VALUES (?, ?, ?)'
    );
    for (const id of Object.keys(profile.inventory)) insInv.run(uid, id, now);
  });
  tx();
}

/**
 * The public standings, ranked by wins — computed, never stored. `wins` is the sum of each
 * player's per-game `stats.won`; `bankrollCents` is their ledger sum. Both are LEFT JOINs so a
 * player with no stats and no ledger rows still ranks (at zero) rather than vanishing.
 */
export function leaderboard(db: Db, limit: number): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT p.uid AS uid, p.name AS name, p.avatar AS avatar, p.xp AS xp,
              (SELECT COALESCE(SUM(s.won), 0) FROM stats s WHERE s.uid = p.uid) AS wins,
              (SELECT COALESCE(SUM(l.delta_cents), 0) FROM ledger l WHERE l.uid = p.uid) AS bal
       FROM profiles p
       ORDER BY wins DESC, p.xp DESC
       LIMIT ?`
    )
    .all(Math.max(0, Math.floor(limit))) as LeaderRow[];

  return rows.map((r) => ({
    uid: r.uid,
    name: r.name,
    avatar: r.avatar,
    bankrollCents: r.bal ?? 0,
    xp: r.xp,
    wins: r.wins ?? 0,
  }));
}
