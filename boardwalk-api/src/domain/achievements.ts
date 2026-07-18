/**
 * Achievements, RECOMPUTED BY THE REFEREE.
 *
 * THE HOLE THIS CLOSES. Through Phase B, `/settle` took `unlockedAchievementIds` and
 * `grantedItemIds` from the request body and recorded them additively. Phase B's own header
 * called it an honest residual, and the reason it was a residual is gone: the catalogue lived in
 * the frontend, so the server could not recompute what it could not see. It can see it now — the
 * catalogue is `@boardwalk/game-logic`, the same rows the store card renders — so the fields come
 * off the wire entirely rather than being validated.
 *
 * What a dishonest client could do before: award itself any badge in the catalogue, including the
 * two Platinum mastery tiers, and with them the earn-only cosmetics those tiers grant
 * (`ttl_thehouse`, `ttl_grandmaster`) — the titles the store deliberately refuses to sell at any
 * price so that wearing one means you earned it. That is a small surface in chips and the whole
 * surface in prestige, which is the thing the earn-only split exists to protect.
 *
 * HOW IT IS COMPUTED. Exactly the way the client computes it, because it is the same function:
 * `satisfiedAchievements(view)` over an `AchievementView` — except every number in that view is
 * read back from the server's own tables INSIDE the settle transaction, after the stat bump, the
 * XP award and the ledger row have landed. The client's copy still runs, for the unlock toast; it
 * is now a prediction, and the authoritative profile the route answers with replaces it.
 *
 * THE ONE THING STILL REPORTED. Feats — `first_win`'s siblings that no state predicate can see: a
 * two-card 21, a Solitaire cleared without recycling the stock. Those are facts only the game
 * knows, so they arrive on the wire and always will until the server deals every game. They are
 * filtered through the shared `recordedFeats`, which keeps only ids marked `feat: true` in the
 * catalogue — so the feats channel cannot be used to smuggle a chain badge, and no `feat` row
 * carries a `grants` (asserted in the frontend's catalogue-integrity test). A dishonest client can
 * still claim a feat it did not perform. It cannot claim a tier, a chain, or a cosmetic.
 */
import {
  achievementById,
  recordedFeats,
  satisfiedAchievements,
  type AchievementView,
} from '@boardwalk/game-logic';
import type { Db } from '../db/db';

/** The per-game win counts and the totals, read back from `stats` after the bump. */
interface StatTotals {
  readonly totalPlayed: number;
  readonly totalWins: number;
  readonly winsByGame: Record<string, number>;
}

interface StatRow {
  game_id: string;
  played: number;
  won: number;
}

function statTotals(db: Db, uid: string): StatTotals {
  const rows = db
    .prepare('SELECT game_id, played, won FROM stats WHERE uid = ?')
    .all(uid) as StatRow[];

  let totalPlayed = 0;
  let totalWins = 0;
  const winsByGame: Record<string, number> = {};
  for (const row of rows) {
    totalPlayed += row.played;
    totalWins += row.won;
    winsByGame[row.game_id] = row.won;
  }
  return { totalPlayed, totalWins, winsByGame };
}

/**
 * The view the predicates read, built from SERVER state.
 *
 * `bankrollCents` and `xp` are passed in rather than re-queried because the caller already has
 * them fresh from inside its transaction, and re-reading would be a second chance to read a
 * different number than the one the settle actually wrote.
 */
export function viewFor(
  db: Db,
  uid: string,
  after: { readonly bankrollCents: number; readonly xp: number },
  lastWagerCents: number,
  lastNetCents: number
): AchievementView {
  const totals = statTotals(db, uid);
  return {
    totalPlayed: totals.totalPlayed,
    totalWins: totals.totalWins,
    bankrollCents: after.bankrollCents,
    xp: after.xp,
    lastWagerCents,
    lastNetCents,
    winsByGame: totals.winsByGame,
  };
}

export interface AwardedAchievements {
  /** Ids written to `achievements` on this settle — already diffed against what was earned. */
  readonly unlockedIds: readonly string[];
  /** Earn-only cosmetic ids the newly-unlocked achievements granted, written to `inventory`. */
  readonly grantedItemIds: readonly string[];
}

/**
 * Award everything this result unlocked, inside the caller's transaction.
 *
 * Unlock is a DIFF and it is one-way: an id counts only if it is satisfied now and was not
 * already recorded, so a predicate that stays true (`bankroll_silver`) fires once and a later
 * losing hand never revokes it. `INSERT OR IGNORE` makes the write idempotent on top of that,
 * which matters because a replayed nonce must not re-grant.
 *
 * A grant rides with its badge in the same transaction — the same guarantee `applyResult` gives
 * the client by being one function. The badge landing without the cosmetic is exactly the shape
 * of v1's `recordWin` defect, so the two cannot be separate statements in separate places.
 */
export function awardAchievements(
  db: Db,
  uid: string,
  view: AchievementView,
  reportedFeats: readonly string[] | undefined,
  now: number
): AwardedAchievements {
  const earned = new Set(
    (db.prepare('SELECT achievement_id FROM achievements WHERE uid = ?').all(uid) as {
      achievement_id: string;
    }[]).map((r) => r.achievement_id)
  );

  // Two sources, one diff: the state predicates the server can now evaluate, and the feats the
  // game reported — filtered by the shared `recordedFeats` to ids actually marked `feat`.
  const candidates = [...satisfiedAchievements(view), ...recordedFeats(reportedFeats)];

  const unlockedIds: string[] = [];
  const grantedItemIds: string[] = [];
  const seen = new Set<string>();

  const insAch = db.prepare(
    'INSERT OR IGNORE INTO achievements (uid, achievement_id, unlocked_at) VALUES (?, ?, ?)'
  );
  const insItem = db.prepare(
    'INSERT OR IGNORE INTO inventory (uid, item_id, purchased_at) VALUES (?, ?, ?)'
  );

  for (const id of candidates) {
    if (earned.has(id) || seen.has(id)) continue;
    seen.add(id);
    const achievement = achievementById.get(id);
    // `satisfiedAchievements` and `recordedFeats` both return catalogue ids, so this cannot miss
    // — but a lookup that silently yields undefined would grant nothing and report success, so
    // it is skipped explicitly rather than asserted away.
    if (achievement === undefined) continue;

    insAch.run(uid, id, now);
    unlockedIds.push(id);

    if (achievement.grants !== undefined) {
      insItem.run(uid, achievement.grants, now);
      grantedItemIds.push(achievement.grants);
    }
  }

  return { unlockedIds, grantedItemIds };
}
