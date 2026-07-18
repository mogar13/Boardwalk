import type { Db } from '../db/db';
import { awardAchievements, viewFor } from './achievements';
import { balanceOf, loadProfile } from './profile';
import {
  checkBet,
  checkDaily,
  checkPurchase,
  checkSettle,
  XP_BY_OUTCOME,
  type Decision,
  type Outcome,
} from './economy';
import type { Profile } from './types';

/**
 * The four money mutations, as transactions. This is the server half of Phase B: the ONLY code in
 * the system that appends to the ledger during play, and therefore the only thing that can move a
 * balance.
 *
 * EVERY MUTATION IS ONE TRANSACTION AND IS IDEMPOTENT.
 *
 * The transaction is the same guarantee the frontend's `applyResult` gives by being one function:
 * money and stats and XP move together or not at all. v1's whole economy failure was that they
 * were separate calls and one of them got forgotten; here they are separate TABLES, which is the
 * same hazard wearing a different hat, so they go inside `db.transaction`.
 *
 * The idempotency is the replay-hardening BACKEND_PLAN.md owes Phase B. Each request carries a
 * client-minted `nonce`; the first arrival inserts `(uid, nonce)` into `mutations` and does the
 * work, and every later arrival with that nonce finds the row, does NOTHING, and returns the
 * current authoritative profile. A retry on a flaky connection, a double-tap, and an offline
 * result re-sent on reconnect all collapse to one effect. The nonce is scoped per uid, so one
 * account cannot consume another's — and because the check and the write are in the SAME
 * transaction, two simultaneous requests with one nonce cannot both pass it.
 */

/** Every mutation answers with the authoritative profile — the client replaces its copy with it. */
export interface MutationOk {
  readonly profile: Profile;
  /** True when the nonce had already been applied and this call changed nothing. */
  readonly replayed: boolean;
}

export type MutationResult = Decision<MutationOk>;

const refuse = (error: string): MutationResult => ({ ok: false, error });

/**
 * Load the profile a mutation must answer with, or throw. A mutation always runs for a uid that
 * has a profile — the auth middleware proved the identity and the frontend creates the record on
 * first sign-in — so a missing one is a bug, not a user-facing state.
 */
function authoritative(db: Db, uid: string, replayed: boolean): MutationResult {
  const profile = loadProfile(db, uid);
  if (profile === null) return refuse('no profile');
  return { ok: true, value: { profile, replayed } };
}

/**
 * Claim a nonce inside the caller's transaction. Returns false if it was already used, which the
 * caller turns into a replay. `INSERT OR IGNORE` + `changes` rather than a SELECT-then-INSERT: the
 * two-step version has a window between the read and the write, and this is precisely the code
 * whose job is to survive two identical requests arriving at once.
 */
function claimNonce(db: Db, uid: string, nonce: string, kind: string, now: number): boolean {
  const info = db
    .prepare(
      'INSERT OR IGNORE INTO mutations (uid, nonce, kind, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(uid, nonce, kind, now);
  return info.changes > 0;
}

/** The player's XP as this transaction has just left it — the `AchievementView`'s `xp`. */
function xpOf(db: Db, uid: string): number {
  const row = db.prepare('SELECT xp FROM profiles WHERE uid = ?').get(uid) as
    | { xp: number }
    | undefined;
  return row?.xp ?? 0;
}

function appendLedger(
  db: Db,
  uid: string,
  gameId: string | null,
  deltaCents: number,
  reason: string,
  now: number
): void {
  db.prepare(
    'INSERT INTO ledger (uid, game_id, delta_cents, reason, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(uid, gameId, deltaCents, reason, now);
}

/* ------------------------------------------------------------------ bet */

export interface BetInput {
  readonly nonce: string;
  readonly gameId: string;
  readonly amountCents: number;
}

/**
 * Take a wager. Appends a NEGATIVE ledger row and opens a `wagers` row the eventual settle must
 * consume — the stake is what bounds the payout, so it has to be recorded, not just deducted.
 *
 * The affordability check reads the balance INSIDE the transaction, so two bets racing against
 * one balance cannot both pass: the second sees the first's row.
 */
export function applyBet(db: Db, uid: string, input: BetInput, now: number): MutationResult {
  const tx = db.transaction((): MutationResult => {
    if (!claimNonce(db, uid, input.nonce, 'bet', now)) return authoritative(db, uid, true);

    const checked = checkBet({ amountCents: input.amountCents, balanceCents: balanceOf(db, uid) });
    if (!checked.ok) return refuse(checked.error);

    const { amountCents } = checked.value;
    appendLedger(db, uid, input.gameId, -amountCents, 'bet', now);
    db.prepare(
      'INSERT INTO wagers (uid, game_id, wager_cents, created_at, settled_at) VALUES (?, ?, ?, ?, NULL)'
    ).run(uid, input.gameId, amountCents, now);

    return authoritative(db, uid, false);
  });
  return tx();
}

/* --------------------------------------------------------------- settle */

export interface SettleInput {
  readonly nonce: string;
  readonly gameId: string;
  readonly outcome: Outcome;
  /**
   * FEAT ids the game earned on this result — and the ONLY achievement input still on the wire.
   *
   * Phase B took `unlockedAchievementIds` and `grantedItemIds` here and recorded whatever it was
   * handed, because the catalogue lived in the frontend and the server could not recompute it.
   * Phase D moved the catalogue into `@boardwalk/game-logic`, so both fields are GONE rather than
   * validated — a chain badge and the earn-only cosmetic it grants are now computed from server
   * state in `domain/achievements.ts`, and the request has nowhere to ask for one.
   *
   * Feats stay because no state predicate can see them: a two-card 21, a Solitaire cleared
   * without recycling the stock. They are filtered through the shared `recordedFeats`, which
   * keeps only ids marked `feat: true` — so this channel cannot smuggle a tier, and no feat row
   * carries a `grants`.
   */
  readonly feats?: readonly string[];
  /** Gross cents claimed back. Bounded by the open wager's ceiling — see `checkSettle`. */
  readonly payoutCents: number;
}

interface OpenWagerRow {
  id: number;
  wager_cents: number;
}

/**
 * Settle a hand: consume the oldest open wager for this game, credit the (bounded) payout, bump
 * the stat, award the XP, record any achievements the client reported.
 *
 * OLDEST-FIRST is deliberate. A blackjack double-down opens two wagers; consuming them in the
 * order they were placed means a second settle is bounded by the second stake rather than by
 * whichever is largest. It also means an abandoned hand's wager is the one a later settle
 * consumes — which is the conservative direction: it can only ever LOWER a ceiling.
 *
 * Note what this does NOT do: it does not verify the player actually won. This is the GENERIC
 * settle path, for games the server does not deal — it verifies that a stake existed and that the
 * payout is inside what the game could conceivably return. Blackjack no longer comes through
 * here: the server deals that hand and computes its own payout (`domain/blackjack.ts`), which is
 * what makes `payoutCents` stop being a claim for the one game that can win money.
 */
export function applySettle(db: Db, uid: string, input: SettleInput, now: number): MutationResult {
  const tx = db.transaction((): MutationResult => {
    if (!claimNonce(db, uid, input.nonce, 'settle', now)) return authoritative(db, uid, true);

    const open = db
      .prepare(
        'SELECT id, wager_cents FROM wagers WHERE uid = ? AND game_id = ? AND settled_at IS NULL ORDER BY id ASC LIMIT 1'
      )
      .get(uid, input.gameId) as OpenWagerRow | undefined;

    const checked = checkSettle({
      gameId: input.gameId,
      payoutCents: input.payoutCents,
      openWagerCents: open ? open.wager_cents : null,
    });
    if (!checked.ok) return refuse(checked.error);

    // The stake this settle consumed — 0 for the non-betting games, which is what makes
    // `big_win`/`high_roller` correctly refuse to fire on a chess win.
    const wagerCents = open ? open.wager_cents : 0;

    if (open) {
      db.prepare('UPDATE wagers SET settled_at = ? WHERE id = ?').run(now, open.id);
    }
    if (checked.value.payoutCents > 0) {
      appendLedger(db, uid, input.gameId, checked.value.payoutCents, 'settle', now);
    }

    // Stats: one row per (uid, game). The outcome decides which counter moves; `played` always
    // does. Computed HERE from the outcome — the client sends an outcome, never a count, so it
    // cannot inflate the win-rate board by reporting bigger numbers.
    const won = input.outcome === 'win' ? 1 : 0;
    const lost = input.outcome === 'loss' ? 1 : 0;
    const pushed = input.outcome === 'push' ? 1 : 0;
    db.prepare(
      `INSERT INTO stats (uid, game_id, played, won, lost, pushed) VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(uid, game_id) DO UPDATE SET
         played = played + 1, won = won + ?, lost = lost + ?, pushed = pushed + ?`
    ).run(uid, input.gameId, won, lost, pushed, won, lost, pushed);

    // XP: the flat per-outcome table, added server-side. Also never accepted from the wire —
    // `level` is derived from `xp` on both sides, so an xp the client could set is a level it
    // could set, which is the leaderboard.
    db.prepare('UPDATE profiles SET xp = xp + ?, updated_at = ? WHERE uid = ?').run(
      XP_BY_OUTCOME[input.outcome],
      now,
      uid
    );

    // Achievements: RECOMPUTED, not accepted. The view is read back from the tables this
    // transaction has just written — the stat bump, the XP award and the ledger row are all
    // above — so the predicates are asked about the state the player is actually in, not the
    // state a request claimed. See `domain/achievements.ts` for what this closes.
    const view = viewFor(
      db,
      uid,
      { bankrollCents: balanceOf(db, uid), xp: xpOf(db, uid) },
      wagerCents,
      checked.value.payoutCents - wagerCents
    );
    awardAchievements(db, uid, view, input.feats, now);

    return authoritative(db, uid, false);
  });
  return tx();
}

/* ------------------------------------------------------------- purchase */

export interface PurchaseInput {
  readonly nonce: string;
  readonly itemId: string;
}

/**
 * Buy a cosmetic AT THE SERVER'S PRICE. The request names an item, never an amount — there is no
 * field on this route a client could put a number in, which is a stronger guarantee than checking
 * that a supplied number is correct.
 */
export function applyPurchase(
  db: Db,
  uid: string,
  input: PurchaseInput,
  now: number
): MutationResult {
  const tx = db.transaction((): MutationResult => {
    if (!claimNonce(db, uid, input.nonce, 'purchase', now)) return authoritative(db, uid, true);

    const owned =
      db.prepare('SELECT 1 FROM inventory WHERE uid = ? AND item_id = ?').get(uid, input.itemId) !==
      undefined;

    const checked = checkPurchase({
      itemId: input.itemId,
      balanceCents: balanceOf(db, uid),
      owned,
    });
    if (!checked.ok) return refuse(checked.error);

    if (checked.value.priceCents > 0) {
      appendLedger(db, uid, null, -checked.value.priceCents, 'purchase', now);
    }
    db.prepare(
      'INSERT OR IGNORE INTO inventory (uid, item_id, purchased_at) VALUES (?, ?, ?)'
    ).run(uid, input.itemId, now);

    return authoritative(db, uid, false);
  });
  return tx();
}

/* ---------------------------------------------------------------- daily */

export interface DailyInput {
  readonly nonce: string;
}

/**
 * Claim the daily reward against the SERVER'S clock. The request carries no time at all — the
 * client's clock is not an input, so winding it back buys exactly nothing. That is the single
 * cheapest cheat in a client-authoritative economy and this route closes it by omission.
 */
export function applyDaily(db: Db, uid: string, input: DailyInput, now: number): MutationResult {
  const tx = db.transaction((): MutationResult => {
    if (!claimNonce(db, uid, input.nonce, 'daily', now)) return authoritative(db, uid, true);

    const row = db
      .prepare('SELECT daily_last_claim_day AS d, daily_streak AS s FROM profiles WHERE uid = ?')
      .get(uid) as { d: number; s: number } | undefined;
    if (row === undefined) return refuse('no profile');

    const checked = checkDaily({ lastClaimDay: row.d, streak: row.s }, now);
    if (!checked.ok) return refuse(checked.error);

    db.prepare(
      'UPDATE profiles SET daily_last_claim_day = ?, daily_streak = ?, updated_at = ? WHERE uid = ?'
    ).run(checked.value.state.lastClaimDay, checked.value.state.streak, now, uid);
    appendLedger(db, uid, null, checked.value.rewardCents, 'daily', now);

    return authoritative(db, uid, false);
  });
  return tx();
}
