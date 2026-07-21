import type { Db } from '../db/db';
import { STARTING_BANKROLL_CENTS } from './economy';
import type { DailyState, Equipped, GameStat, LeaderboardEntry, Profile } from './types';

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
  equipped_cardback: string | null;
  equipped_title: string | null;
  equipped_felt: string | null;
  equipped_frame: string | null;
  equipped_dice: string | null;
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
  played: number | null;
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
      `SELECT name, avatar, xp, daily_last_claim_day, daily_streak,
              equipped_cardback, equipped_title, equipped_felt, equipped_frame, equipped_dice
       FROM profiles WHERE uid = ?`
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

  // Absent, not null — see the `Equipped` doc. `exactOptionalPropertyTypes` is on, so a key must
  // be omitted rather than set to undefined, which is also exactly what the frontend expects back.
  const equipped: Equipped = {
    ...(p.equipped_cardback ? { cardback: p.equipped_cardback } : {}),
    ...(p.equipped_title ? { title: p.equipped_title } : {}),
    ...(p.equipped_felt ? { felt: p.equipped_felt } : {}),
    ...(p.equipped_frame ? { frame: p.equipped_frame } : {}),
    ...(p.equipped_dice ? { dice: p.equipped_dice } : {}),
  };

  return {
    name: str(p.name, 'Player'),
    avatar: str(p.avatar, '👤'),
    bankrollCents: balanceOf(db, uid),
    xp: count(p.xp),
    stats,
    achievements,
    inventory,
    equipped,
    daily,
  };
}

/** What a client is allowed to tell the server about itself. Note what is NOT here. */
export interface ProfileUpsert {
  readonly name: string;
  readonly avatar: string;
  readonly equipped: Equipped;
}

export interface SaveOptions {
  /** Injected clock, so tests are deterministic. Defaults to wall time. */
  readonly now?: number;
}

/**
 * Create-or-update the parts of a profile a CLIENT IS ALLOWED TO DECIDE: its display name, its
 * avatar, and which cosmetics are equipped. That is the entire list, and the shrinking of that
 * list from "the whole profile" is what Phase B is.
 *
 * WHAT THIS DELIBERATELY NO LONGER DOES, each of which was a Phase-A behaviour:
 *
 *   • It does not read `bankrollCents`. Phase A diffed the incoming balance against the ledger
 *     and appended the difference — which faithfully mirrored a client-authoritative economy and
 *     would, the moment this became the source of truth, have let anyone POST themselves a
 *     million. Money now moves ONLY through `mutations.ts`, and this route has no field for it.
 *   • It does not read `xp`, `stats`, `achievements` or `inventory`. Those are earned through
 *     `/settle`, `/purchase` and `/daily`. Phase A replaced each set wholesale from the body,
 *     so a client could have deleted a loss or granted itself a badge by omission.
 *   • It does not read `daily`. The streak clock is the server's — see `applyDaily`.
 *
 * A brand-new profile gets its opening bankroll HERE, as a `signup` ledger row of the server's
 * own `STARTING_BANKROLL_CENTS` — not the number in the body. `INSERT OR IGNORE` on users plus a
 * check for an existing profile row makes the grant fire exactly once per uid, so a client
 * replaying create cannot mint a second stake.
 */
export function upsertProfile(
  db: Db,
  uid: string,
  input: ProfileUpsert,
  opts: SaveOptions = {}
): void {
  const now = opts.now ?? Date.now();
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO users (uid, username, is_admin, created_at) VALUES (?, NULL, 0, ?) ON CONFLICT(uid) DO NOTHING'
    ).run(uid, now);

    const existed =
      db.prepare('SELECT 1 FROM profiles WHERE uid = ?').get(uid) !== undefined;

    db.prepare(
      `INSERT INTO profiles (uid, name, avatar, xp, daily_last_claim_day, daily_streak,
                             equipped_cardback, equipped_title, equipped_felt, equipped_frame, equipped_dice,
                             updated_at)
       VALUES (@uid, @name, @avatar, 0, 0, 0, @cardback, @title, @felt, @frame, @dice, @now)
       ON CONFLICT(uid) DO UPDATE SET
         name = excluded.name,
         avatar = excluded.avatar,
         equipped_cardback = excluded.equipped_cardback,
         equipped_title = excluded.equipped_title,
         equipped_felt = excluded.equipped_felt,
         equipped_frame = excluded.equipped_frame,
         equipped_dice = excluded.equipped_dice,
         updated_at = excluded.updated_at`
    ).run({
      uid,
      name: str(input.name, 'Player'),
      avatar: str(input.avatar, '👤'),
      cardback: input.equipped.cardback ?? null,
      title: input.equipped.title ?? null,
      felt: input.equipped.felt ?? null,
      frame: input.equipped.frame ?? null,
      dice: input.equipped.dice ?? null,
      now,
    });

    // The opening stake, granted by the server, once. A profile that already existed keeps the
    // balance its ledger says it has — this branch is the only place a `signup` row is written.
    if (!existed) {
      db.prepare(
        'INSERT INTO ledger (uid, game_id, delta_cents, reason, created_at) VALUES (?, NULL, ?, ?, ?)'
      ).run(uid, STARTING_BANKROLL_CENTS, 'signup', now);
    }
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
              (SELECT COALESCE(SUM(s.played), 0) FROM stats s WHERE s.uid = p.uid) AS played,
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
    played: r.played ?? 0,
  }));
}
