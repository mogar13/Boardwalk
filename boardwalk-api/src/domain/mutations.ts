import { randomInt } from 'node:crypto';
import type { Db } from '../db/db';
import { awardAchievements, viewFor } from './achievements';
import { balanceOf, loadProfile } from './profile';
import {
  checkBet,
  checkDaily,
  checkPack,
  checkPurchase,
  checkRefill,
  checkSettle,
  dayIndex,
  rollPack,
  DAY_MS,
  XP_BY_OUTCOME,
  type Decision,
  type Outcome,
  type PackPull,
} from './economy';
import { deviceOfTicket } from './tickets';
import type { Profile } from './types';

/**
 * The six money mutations, as transactions. This is the server half of Phase B: the ONLY code in
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
 *
 * `applyPack` is the exception that proves the rule, and it is worth reading before you touch the
 * replay path: its outcome is RANDOM, so "do nothing and return the current profile" is not a
 * correct replay. It persists its roll and re-serves it. See `pack_opens` in `schema.ts`.
 */

/** Every mutation answers with the authoritative profile — the client replaces its copy with it. */
export interface MutationOk {
  readonly profile: Profile;
  /** True when the nonce had already been applied and this call changed nothing. */
  readonly replayed: boolean;
  /**
   * PACKS ONLY: what the server rolled. Absent on every other intent, because every other
   * intent's outcome is knowable from the request — only a pack has a result the client cannot
   * compute. On a replay this is the ORIGINAL roll read back from `pack_opens`, never a fresh one.
   */
  readonly pull?: PackPull;
}

export type MutationResult = Decision<MutationOk>;

const refuse = (error: string): MutationResult => ({ ok: false, error });

/**
 * Load the profile a mutation must answer with, or throw. A mutation always runs for a uid that
 * has a profile — the auth middleware proved the identity and the frontend creates the record on
 * first sign-in — so a missing one is a bug, not a user-facing state.
 */
function authoritative(
  db: Db,
  uid: string,
  replayed: boolean,
  pull?: PackPull
): MutationResult {
  const profile = loadProfile(db, uid);
  if (profile === null) return refuse('no profile');
  return {
    ok: true,
    value: pull === undefined ? { profile, replayed } : { profile, replayed, pull },
  };
}

/**
 * Claim a nonce inside the caller's transaction. Returns false if it was already used, which the
 * caller turns into a replay. `INSERT OR IGNORE` + `changes` rather than a SELECT-then-INSERT: the
 * two-step version has a window between the read and the write, and this is precisely the code
 * whose job is to survive two identical requests arriving at once.
 */
export function claimNonce(db: Db, uid: string, nonce: string, kind: string, now: number): boolean {
  const info = db
    .prepare(
      'INSERT OR IGNORE INTO mutations (uid, nonce, kind, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(uid, nonce, kind, now);
  if (info.changes === 0) return false;

  // OFFLINE HARDENING. If the nonce is a ticket, record the spend against its device, inside this
  // same transaction — so the outstanding count (`issued_seq - spent_count`) can never drift from
  // what was actually claimed, and a crash between the two is not a state that exists.
  //
  // It lives HERE, in the one function every mutation already funnels through, rather than being
  // threaded as a parameter through six `apply*` signatures. That keeps the change to the money
  // paths at zero: `applyBet`, `applySettle`, `applyPurchase`, `applyDaily`, `applyRefill`, `applyPack`
  // and both
  // blackjack routes are untouched by this feature.
  //
  // No signature is checked here and none is needed: the gate verified it before the transaction
  // opened. And when enforcement is OFF, a client-minted nonce that happens to be dot-shaped
  // updates a `ticket_devices` row that does not exist — zero rows changed, no effect. Parsing a
  // shape is not trusting it.
  const deviceId = deviceOfTicket(nonce);
  if (deviceId !== null) {
    db.prepare(
      'UPDATE ticket_devices SET spent_count = spent_count + 1, last_seen_at = ? WHERE uid = ? AND device_id = ?'
    ).run(now, uid, deviceId);
  }
  return true;
}

/**
 * Give a nonce back on a refusal.
 *
 * A refused request did nothing, so it must not have consumed anything either — including the
 * client's nonce. Without this, a refused attempt has burned it: the next request carrying that
 * nonce takes the replay branch, finds nothing pinned to it, and answers "already applied" with an
 * unchanged profile — an apparent success that moved nothing, which is a worse thing to render
 * than the honest refusal it replaced.
 *
 * IT HAS TO BE WRITTEN DOWN, because the transaction will not do it: better-sqlite3 commits a
 * transaction function that RETURNS and only rolls back one that THROWS, and every refusal in this
 * file is a returned value. That is the same `return`-out-of-a-transaction hazard `domain/blackjack.ts`
 * documents at length — this used to be a private copy there, and it is here now because
 * `applyRefill` is the second caller (hoist on the second, never the first).
 */
export function releaseNonce(db: Db, uid: string, nonce: string): void {
  db.prepare('DELETE FROM mutations WHERE uid = ? AND nonce = ?').run(uid, nonce);
}

/** The player's XP as this transaction has just left it — the `AchievementView`'s `xp`. */
export function xpOf(db: Db, uid: string): number {
  const row = db.prepare('SELECT xp FROM profiles WHERE uid = ?').get(uid) as
    | { xp: number }
    | undefined;
  return row?.xp ?? 0;
}

export function appendLedger(
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

/**
 * Everything a finished hand earns that is NOT money: the stat bump, the XP award, the
 * achievements. Call it with the ledger row for the payout already written — the achievement view
 * is read back from the tables, so it must be asked after they are true.
 *
 * SHARED BY BOTH SETTLE PATHS (Phase D). `applySettle` below does it for the games the server does
 * not deal; `domain/blackjack.ts` does it for the one it does. It is one function rather than two
 * copies for the reason the whole `reportResult`-is-one-call rule exists: v1 split money from stats
 * and the second half got forgotten. Two settle paths that each write their own stats SQL is that
 * defect with a fresh place to happen — the day the XP table gains a rung, one of them gets it.
 *
 * `netCents` is payout minus the total staked, so `big_win` fires on what the player actually
 * cleared. On a double-down `wagerCents` is the DOUBLED stake, which is what was really at risk.
 */
export function recordOutcome(
  db: Db,
  uid: string,
  gameId: string,
  outcome: Outcome,
  wagerCents: number,
  payoutCents: number,
  feats: readonly string[] | undefined,
  now: number
): void {
  // Stats: one row per (uid, game). The outcome decides which counter moves; `played` always
  // does. Computed HERE from the outcome — the client sends an outcome, never a count, so it
  // cannot inflate the win-rate board by reporting bigger numbers. (For blackjack it does not even
  // send the outcome: the server reads it off its own cards.)
  const won = outcome === 'win' ? 1 : 0;
  const lost = outcome === 'loss' ? 1 : 0;
  const pushed = outcome === 'push' ? 1 : 0;
  db.prepare(
    `INSERT INTO stats (uid, game_id, played, won, lost, pushed) VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT(uid, game_id) DO UPDATE SET
       played = played + 1, won = won + ?, lost = lost + ?, pushed = pushed + ?`
  ).run(uid, gameId, won, lost, pushed, won, lost, pushed);

  // XP: the flat per-outcome table, added server-side. Also never accepted from the wire —
  // `level` is derived from `xp` on both sides, so an xp the client could set is a level it
  // could set, which is the leaderboard.
  db.prepare('UPDATE profiles SET xp = xp + ?, updated_at = ? WHERE uid = ?').run(
    XP_BY_OUTCOME[outcome],
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
    payoutCents - wagerCents
  );
  awardAchievements(db, uid, view, feats, now);
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

    recordOutcome(
      db,
      uid,
      input.gameId,
      input.outcome,
      wagerCents,
      checked.value.payoutCents,
      input.feats,
      now
    );

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

/* ---------------------------------------------------------------- refill */

export interface RefillInput {
  readonly nonce: string;
}

/** The ledger `reason` a top-up is written under. The daily limit COUNTS these, so it is a rule. */
export const REFILL_REASON = 'refill';

/**
 * How many top-ups this player has already taken today, read off the ledger.
 *
 * Exported because the frontend has no way to know it — the hub card renders "come back tomorrow"
 * from what the last request refused, not from a field — and because a test that asserts the daily
 * limit should be able to ask the same question the check does rather than a lookalike.
 *
 * The window is the UTC day, matching `dayIndex` and therefore the daily reward: two lifelines
 * resetting at different midnights would be two clocks to explain. The comparison is done in
 * milliseconds against the day's start rather than by storing a day index, because `created_at` is
 * already there and is already the truth about when the money moved.
 *
 * THE WINDOW IS OPEN-ENDED AT THE TOP (`>= dayStart`, with no upper bound), and that asymmetry is
 * deliberate — it is `dailyStatus`'s `today > lastClaimDay` wearing SQL. Bounding it at
 * `< dayStart + DAY_MS` would read more naturally and would hand a rewound clock a second grant:
 * set the server back one day and yesterday's refill falls outside "today", so the allowance
 * re-opens. Counting every row from the start of the current day ONWARDS means a clock that moves
 * backwards can only ever make the check stricter, never looser. Which is the correct direction
 * for a control whose failure mode is free money.
 */
export function refillsToday(db: Db, uid: string, now: number): number {
  const dayStartMs = dayIndex(now) * DAY_MS;
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM ledger WHERE uid = ? AND reason = ? AND created_at >= ?')
    .get(uid, REFILL_REASON, dayStartMs) as { n: number };
  return row.n;
}

/**
 * THE BANKRUPT REFILL (V1_FEATURE_GAPS.md #10) — a lifeline back to the table, priced entirely
 * here.
 *
 * The request is `{nonce}` and nothing else, exactly like `/daily`: no amount, because the grant is
 * `refillGrantFor` over the LEDGER'S balance, and no timestamp, because the daily limit is counted
 * against `created_at` rows this same function writes. So the two things a client would want to lie
 * about — how much, and how recently — have no field to travel in.
 *
 * It appends ONE ledger row and touches nothing else. No XP, no stat, no achievement: going broke
 * is not an accomplishment and a top-up is not a result. (It deliberately does not bump
 * `updated_at` on the profile either — the row it writes is the record of the event.)
 */
export function applyRefill(db: Db, uid: string, input: RefillInput, now: number): MutationResult {
  const tx = db.transaction((): MutationResult => {
    if (!claimNonce(db, uid, input.nonce, 'refill', now)) return authoritative(db, uid, true);

    const checked = checkRefill({
      balanceCents: balanceOf(db, uid),
      refillsToday: refillsToday(db, uid, now),
    });
    if (!checked.ok) {
      // A refusal costs nothing — not the nonce, and (because no ledger row is written) not the
      // day's allowance either. A player refused for being solvent at 9am can still top up at 9pm.
      releaseNonce(db, uid, input.nonce);
      return refuse(checked.error);
    }

    appendLedger(db, uid, null, checked.value.grantCents, REFILL_REASON, now);
    return authoritative(db, uid, false);
  });
  return tx();
}

/* ----------------------------------------------------------------- pack */

export interface PackInput {
  readonly nonce: string;
  readonly packId: string;
}

interface PackOpenRow {
  pack_id: string;
  item_id: string;
  duplicate: number;
  dust_cents: number;
}

/**
 * The generator's range. `randomInt(min, max)` is max-EXCLUSIVE and Node refuses a span above
 * 2^48 - 1, so this must stay comfortably under that — `2 ** 48` itself throws
 * `ERR_OUT_OF_RANGE`, which is exactly the off-by-one that shipped here first and which every
 * unit test missed because they all inject their own `rand`. 2^47 is in range with entropy to
 * spare for a four-band rarity roll and a bucket of at most a few dozen items.
 */
const RAND_RANGE = 2 ** 47;

/**
 * A uniform float in [0, 1), from the OS CSPRNG rather than `Math.random`.
 *
 * Not because a play-money pack needs cryptographic randomness — it does not — but because the
 * cost of not having to think about it again is two lines. `Math.random` is seeded per process
 * and its sequence is, in principle, inferable from observed output; a player who could predict
 * the next roll could time their opens. This closes that without a comment explaining why it is
 * probably fine.
 */
function secureRandom(): number {
  return randomInt(0, RAND_RANGE) / RAND_RANGE;
}

/**
 * Open a pack: charge the SERVER'S price, roll the pull HERE, grant the item or credit the dust.
 *
 * THIS CLOSED THE LAST CLIENT-AUTHORITATIVE MONEY PATH. Before it, `openPack()` ran in the
 * browser, computed the whole next profile — price spent, item granted, dust credited — and
 * handed it to `PUT /profile`, which accepts exactly `name`, `avatar` and `equipped` and silently
 * dropped every one of those effects. In production the animation played and nothing happened:
 * the player paid nothing and received nothing, and the UI lied until the next load.
 *
 * The request names a PACK and nothing else. There is no field on it for a price, a balance, a
 * seed or an item, so a client cannot pick its own legendary any more than it can name its own
 * price at `/purchase`. The odds it is rolled against are the shared `PACKS` table the store card
 * publishes — one table, not two.
 *
 * REPLAY, which is what makes this different from the other four. The roll is written to
 * `pack_opens` in the same transaction as the charge, and a repeated nonce reads that row back
 * and returns the IDENTICAL pull with no money moved. See the table's comment for why a random
 * mutation cannot use the plain "do nothing, return the profile" replay path the others do.
 *
 * `rand` is injected so the odds are testable; the route passes `secureRandom`.
 */
export function applyPack(
  db: Db,
  uid: string,
  input: PackInput,
  now: number,
  rand: () => number = secureRandom
): MutationResult {
  const tx = db.transaction((): MutationResult => {
    if (!claimNonce(db, uid, input.nonce, 'pack', now)) {
      // Already applied. Re-serve the ORIGINAL roll rather than re-rolling or answering empty.
      const row = db
        .prepare(
          'SELECT pack_id, item_id, duplicate, dust_cents FROM pack_opens WHERE uid = ? AND nonce = ?'
        )
        .get(uid, input.nonce) as PackOpenRow | undefined;
      if (row === undefined) {
        // The nonce was burned by a DIFFERENT kind of mutation. Reusing one nonce across intents
        // is a client bug, and the honest answer is a refusal — not a pack open charged against
        // someone else's idempotency key.
        return refuse('that nonce was already used for a different mutation');
      }
      return authoritative(db, uid, true, {
        itemId: row.item_id,
        duplicate: row.duplicate !== 0,
        dustCents: row.dust_cents,
      });
    }

    const ownedRows = db.prepare('SELECT item_id FROM inventory WHERE uid = ?').all(uid) as {
      item_id: string;
    }[];
    const ownedIds = new Set(ownedRows.map((r) => r.item_id));

    const checked = checkPack({
      packId: input.packId,
      balanceCents: balanceOf(db, uid),
      ownedIds,
    });
    if (!checked.ok) return refuse(checked.error);

    const { pack } = checked.value;
    const pull = rollPack(pack, ownedIds, rand);
    // `checkPack` already refused an empty pool, so this is unreachable — but it is a refusal
    // rather than a `!` so a future pack with a broken pool cannot charge for nothing.
    if (pull === null) return refuse('nothing in this pack yet');

    // The charge is the pack's price; a duplicate's dust is credited back as its own ledger row
    // rather than netted, so the statement reads "you paid 250,000, you got 25,000 back" — which
    // is what happened — instead of a single mystery delta.
    appendLedger(db, uid, null, -pack.priceCents, 'pack', now);
    if (pull.duplicate) {
      if (pull.dustCents > 0) appendLedger(db, uid, null, pull.dustCents, 'pack_dust', now);
    } else {
      db.prepare(
        'INSERT OR IGNORE INTO inventory (uid, item_id, purchased_at) VALUES (?, ?, ?)'
      ).run(uid, pull.itemId, now);
    }

    db.prepare(
      'INSERT INTO pack_opens (uid, nonce, pack_id, item_id, duplicate, dust_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uid, input.nonce, pack.id, pull.itemId, pull.duplicate ? 1 : 0, pull.dustCents, now);

    return authoritative(db, uid, false, pull);
  });
  return tx();
}
