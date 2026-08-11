/**
 * BLACKJACK AT A TABLE, DEALT BY THE REFEREE — the fourth server-dealt game and, unusually, one
 * whose game the referee was ALREADY dealing.
 *
 * `domain/blackjack.ts` has dealt the solo hand since Phase D. This is the same rulebook with
 * several chairs at it, and almost everything that made UNO's pot expensive is simply absent:
 *
 *   • NO PRIVATE CHANNEL. Every player's cards are face up in blackjack, so nothing is written to a
 *     seat's private node and `handOf`/`writeHand` have no counterpart here. The only hidden things
 *     are the deck and the hole card, and they are hidden from EVERY seat equally — the host's
 *     included — which is why they live in `state_json` and stop there.
 *   • NO POT. Each chair settles against the HOUSE on its own cards, so `potSplit`, `rankedPayees`
 *     and `maxRoundPayout` acquire no case: there is nothing to divide and no placement ladder.
 *   • NO HOUSE-BANKING QUESTION. The house has banked this game since it existed, at odds
 *     `tests/blackjack-house-odds.test.ts` measured, so `betting.house`, `HOUSE_RETURN` and the
 *     "two humans or no betting" rule are all untouched. One human at a blackjack table is the
 *     ordinary case rather than the faucet risk it is at UNO.
 *   • NO NEW CEILING. A chair can win at most 2.5× its own stake, inside `DEFAULT_PAYOUT_MULTIPLE`.
 *
 * WHAT IT DOES COST is the thing v1 got wrong: PER-SEAT BETTING. `bj_app.js:162` pushed the whole
 * game state on every bet, so two players betting at the same moment clobbered each other's stakes.
 * That is arbitrated away by construction here — a bet is a message to the referee, applied inside
 * one SQLite transaction against the round's own row, so there is no shared object for two clients
 * to race over and no last-writer-wins.
 *
 * A ROUND IS A ROW, exactly as an UNO round is. A table plays many rounds and each is its own set of
 * stakes, its own deal and its own settlement, so a round has its own `blackjack_rounds` row and its
 * own `blackjack_players` membership. Authority is MEMBERSHIP rather than ownership, for the reason
 * `liars_dice_players` records: a round has many participants and no owner, and a row id is a small
 * integer anybody can type.
 *
 * WHERE THE RANDOMNESS IS. `applyMove` deals when the last chair bets, so a bet CONSUMES the
 * shuffle. A replayed bet re-run against a fresh deck would deal a different table than the player
 * already saw, so — exactly as UNO does, and for the reason `pack_opens` exists — every replay
 * re-serves the PERSISTED round and never re-enters the reducer.
 */
import {
  applyMove,
  freshDeck,
  openRound,
  pendingSeats,
  roundOver,
  shuffle,
  spotPayout,
  toPublic,
  type BlackjackTable,
  type BlackjackTableState,
  type Spot,
  type TableMove,
} from '@boardwalk/game-logic/games/blackjack';
import { payoutCents, resultOutcome } from '@boardwalk/game-logic/games/blackjack';
import type { Db } from '../db/db';
import { checkBet, type Decision } from './economy';
import { appendLedger, claimNonce, recordOutcome } from './mutations';
import { balanceOf } from './profile';

/** Local, like blackjack's, UNO's and Liar's Dice's — `economy.ts` keeps its constructors private. */
const refuse = <T>(error: string): Decision<T> => ({ ok: false, error });

/**
 * From `manifest.id`, never a string literal — and deliberately the SAME id the solo game records
 * under. A hand of blackjack is a hand of blackjack: splitting the stat would give the mastery chain
 * two numbers to count and leave a player who only ever plays at a table unable to finish it.
 */
export const GAME_ID = 'blackjack';

export interface RoundRow {
  readonly id: number;
  readonly state_json: string;
  readonly round: number;
  readonly settled: number;
}

export interface PlayerRow {
  readonly uid: string;
  readonly seat: number;
  /** Every cent this uid has put into this round: the stake, a double's second stake, insurance.
   *  It is what a void refunds, and it is why this is a running total rather than one wager. */
  readonly staked_cents: number;
}

/** A seat as the gateway knows it, narrowed to what this module needs. */
export interface SeatSpec {
  readonly kind: 'human' | 'ai' | 'open';
  readonly uid: string | null;
}

const stateOf = (row: RoundRow): BlackjackTable => JSON.parse(row.state_json) as BlackjackTable;

// ── reads, all carrying their authority ──────────────────────────────────────────────────────

/** The live round in a room, if any. The dealer routes every move through this. */
export function liveRoundInRoom(db: Db, gameId: string, roomId: string): RoundRow | undefined {
  return db
    .prepare(
      `SELECT id, state_json, round, settled
         FROM blackjack_rounds
        WHERE game_id = ? AND room_id = ? AND settled = 0
        ORDER BY id DESC LIMIT 1`
    )
    .get(gameId, roomId) as RoundRow | undefined;
}

/** The most recent round at this table, settled or not — what the next open reads for its number. */
export function lastRoundInRoom(db: Db, gameId: string, roomId: string): RoundRow | undefined {
  return db
    .prepare(
      `SELECT id, state_json, round, settled
         FROM blackjack_rounds
        WHERE game_id = ? AND room_id = ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(gameId, roomId) as RoundRow | undefined;
}

export function playersOf(db: Db, roundId: number): PlayerRow[] {
  return db
    .prepare('SELECT uid, seat, staked_cents FROM blackjack_players WHERE round_id = ? ORDER BY seat')
    .all(roundId) as PlayerRow[];
}

/** The seat this uid holds in this round, or -1. Every turn check reads it. */
export function seatOf(db: Db, roundId: number, uid: string): number {
  const row = db
    .prepare('SELECT seat FROM blackjack_players WHERE round_id = ? AND uid = ?')
    .get(roundId, uid) as { seat: number } | undefined;
  return row?.seat ?? -1;
}

function persist(db: Db, roundId: number, table: BlackjackTable, settled: boolean, now: number): void {
  db.prepare(
    'UPDATE blackjack_rounds SET state_json = ?, settled = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(table), settled ? 1 : 0, now, roundId);
}

/** Record what a chair has put in, so a void can hand it back. Additive — a double and an insurance
 *  both land on top of the opening stake rather than replacing it. */
function addStake(db: Db, roundId: number, uid: string, cents: number): void {
  db.prepare(
    'UPDATE blackjack_players SET staked_cents = staked_cents + ? WHERE round_id = ? AND uid = ?'
  ).run(cents, roundId, uid);
}

// ── the projection the dealer hands out ──────────────────────────────────────────────────────

/**
 * The public view — every chair's cards, one dealer card, and no deck.
 *
 * `toPublic` is the SHARED projection, imported rather than written here, for the reason `viewOf`
 * gives at length: three copies of "what may a client see" is three chances to reveal a card, and
 * the two that are not the referee's are the ones nobody would think to audit.
 */
export const viewOf = (table: BlackjackTable): BlackjackTableState => toPublic(table);

// ── opening a round ──────────────────────────────────────────────────────────────────────────

export interface OpenInput {
  readonly nonce: string;
  readonly gameId: string;
  readonly roomId: string;
  readonly seats: readonly SeatSpec[];
}

export interface RoundOk {
  readonly roundId: number;
  readonly table: BlackjackTable;
  readonly row: RoundRow;
  readonly replayed: boolean;
}

/**
 * Open a round: seat everybody who is at the table and wait for stakes.
 *
 * NO MONEY MOVES HERE, which is the one structural difference from every other dealt game in this
 * repo. UNO and Liar's Dice take an ante at the deal, because their stake is the TABLE's and is the
 * same for everybody. A blackjack stake is per chair and per round, chosen by its player after the
 * round opens, so this transaction writes a row and a membership list and nothing else — every
 * ledger row is written later, by `playAction`, at the moment its chair names a number.
 *
 * Host-only at the transport, and idempotent through the nonce, so a double-fire is a replay rather
 * than a second round nobody has bet into.
 */
export function openTableRound(db: Db, host: string, input: OpenInput, now: number): Decision<RoundOk> {
  const humans = input.seats.filter((s) => s.kind === 'human' && s.uid !== null && s.uid !== '');
  /*
   * ONE CHAIR IS A BLACKJACK TABLE, and this is the one dealt game where that is true.
   *
   * UNO and Liar's Dice keep `< 2` because their opponents are the other chairs: a one-seat round
   * there is a player alone in a room, and the guard is what stops one being dealt. Blackjack's
   * opponent is the DEALER, who plays a hand out of this same reducer and occupies no seat — so a
   * one-chair round has somebody to beat, and refusing it refuses the ordinary way this game is
   * played.
   *
   * It said `< 2` because it was copied from `uno.ts` when this dealer was written, at a moment when
   * the manifest also declared `min: 2` and the two agreed. They stopped agreeing the moment the
   * client learned that the dealer counts (`GameManifest.dealerPlays`), and the symptom was the
   * clearest possible form of the UI that lies: the entrance offered a 1-chair table, created the
   * room, and the board then sat on "Opening a round…" forever while the referee refused it.
   *
   * What is still refused is a round with NO chairs at all — a table nobody is at, which is a
   * request that cannot have come from a lobby.
   */
  if (input.seats.length < 1) return refuse('a table needs a seat');
  if (humans.length === 0) return refuse('a table needs at least one human');
  if (!humans.some((s) => s.uid === host)) return refuse('only a seated player may open a round');

  const run = db.transaction((): Decision<RoundOk> => {
    if (!claimNonce(db, host, input.nonce, 'bjt-open', now)) {
      const existing = liveRoundInRoom(db, input.gameId, input.roomId);
      if (existing === undefined) return refuse('that nonce was used by a different mutation');
      return {
        ok: true,
        value: { roundId: existing.id, table: stateOf(existing), row: existing, replayed: true },
      };
    }

    const previous = lastRoundInRoom(db, input.gameId, input.roomId);
    const round = previous === undefined ? 0 : previous.round + 1;
    // WHO IS IN THIS ROUND is decided once, here, from the room's own seats — a client never says.
    // An `ai` chair is in it (the house plays a hand); an OPEN chair is not, and that is what stops
    // the table waiting forever for a stake from an empty seat.
    const table = openRound(
      input.seats.map((s) => s.kind === 'human' || s.kind === 'ai'),
      round
    );

    const info = db
      .prepare(
        `INSERT INTO blackjack_rounds (game_id, room_id, state_json, round, settled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .run(input.gameId, input.roomId, JSON.stringify(table), round, now, now);
    const roundId = Number(info.lastInsertRowid);

    input.seats.forEach((seat, index) => {
      if (seat.kind !== 'human' || seat.uid === null || seat.uid === '') return;
      db.prepare(
        'INSERT INTO blackjack_players (round_id, uid, seat, staked_cents) VALUES (?, ?, ?, 0)'
      ).run(roundId, seat.uid, index);
    });

    db.prepare('UPDATE mutations SET match_id = ? WHERE uid = ? AND nonce = ?').run(
      roundId,
      host,
      input.nonce
    );

    const row: RoundRow = { id: roundId, state_json: JSON.stringify(table), round, settled: 0 };
    return { ok: true, value: { roundId, table, row, replayed: false } };
  });

  return run();
}

// ── playing it ───────────────────────────────────────────────────────────────────────────────

const rowAfter = (row: RoundRow, table: BlackjackTable, settled: number): RoundRow => ({
  ...row,
  state_json: JSON.stringify(table),
  settled,
});

/**
 * WHAT THIS MOVE COSTS BEFORE IT IS MADE — the stake a bet, a double or an insurance is about to
 * commit, or 0 for a move that risks nothing.
 *
 * It is a separate step from committing it, and always runs BEFORE the first write, because a
 * `return` out of a better-sqlite3 transaction COMMITS — only a throw rolls back. "Refuse and change
 * nothing" is earned by the order of the statements in `playAction`, not given by the transaction.
 * `domain/blackjack.ts` pays for this lesson at length and it is the same lesson here.
 *
 * The AMOUNTS come from the rulebook and never from this file: a double's second stake is the
 * chair's current `wagerCents` and an insurance is `insuranceStake` of it, both read off the spot
 * the reducer wrote. Deriving either here is how a $12 button becomes a $13 charge.
 */
function stakeFor(move: TableMove, spot: Spot | undefined): number {
  if (spot === undefined) return 0;
  if (move.type === 'bet') return move.wagerCents;
  if (move.type === 'double') return spot.wagerCents;
  if (move.type === 'insure') return Math.floor(spot.wagerCents / 2);
  return 0;
}

/**
 * Apply one chair's decision, and settle the round if it finished.
 *
 * THE ORDER IS THE SAFETY. Nonce, membership, legality, affordability — then the reducer, then the
 * writes. Everything that can refuse happens above the first ledger row, so a refusal leaves the
 * round exactly as it found it: no orphan stake, no chair charged for a move that did not happen.
 *
 * A REPLAY RE-SERVES THE PERSISTED ROUND rather than re-running the reducer, and here that is
 * load-bearing rather than tidy: a `bet` that completes the table consumes a shuffle, so re-running
 * one would deal cards the player has already seen replaced by different ones.
 */
export function playAction(
  db: Db,
  uid: string,
  roundId: number,
  nonce: string,
  move: TableMove,
  now: number,
  rng: () => number = Math.random
): Decision<RoundOk> {
  const run = db.transaction((): Decision<RoundOk> => {
    const row = db
      .prepare(
        `SELECT r.id, r.state_json, r.round, r.settled
           FROM blackjack_rounds r
           JOIN blackjack_players p ON p.round_id = r.id
          WHERE r.id = ? AND p.uid = ?`
      )
      .get(roundId, uid) as RoundRow | undefined;
    if (row === undefined) return refuse('no such round');

    if (!claimNonce(db, uid, nonce, 'bjt-move', now)) {
      return { ok: true, value: { roundId, table: stateOf(row), row, replayed: true } };
    }

    const deny = (why: string): Decision<RoundOk> => {
      db.prepare('DELETE FROM mutations WHERE uid = ? AND nonce = ?').run(uid, nonce);
      return refuse(why);
    };

    if (row.settled === 1) return deny('that round is over');

    const seat = seatOf(db, roundId, uid);
    if (seat < 0) return deny('you are not in that round');

    const before = stateOf(row);
    if (roundOver(before)) return deny('that round is over');

    // AFFORDABILITY BEFORE ANYTHING IS WRITTEN, and judged against the LEDGER balance rather than
    // whatever the client believes it holds. Checked before the reducer runs, so an unaffordable
    // double leaves the chair still able to hit or stand.
    const stake = stakeFor(move, before.spots[seat]);
    let committed = 0;
    if (stake > 0) {
      const checked = checkBet({ amountCents: stake, balanceCents: balanceOf(db, uid) });
      if (!checked.ok) return deny(checked.error);
      committed = checked.value.amountCents;
    }

    // The reducer is the authority on whether the move is LEGAL, and it is total: an off-turn move,
    // a double on three cards, an insurance outside the offer all come back UNCHANGED. Comparing
    // identity is how the transport refuses without holding a second copy of the rules.
    const after = applyMove(before, seat, move, () => shuffle(freshDeck(), rng));
    if (after === before) return deny('that is not a legal move');

    // ── nothing can refuse from here on ──
    if (committed > 0) {
      appendLedger(db, uid, GAME_ID, -committed, 'bet', now);
      db.prepare(
        `INSERT INTO wagers (uid, game_id, wager_cents, created_at, settled_at, match_id)
         VALUES (?, ?, ?, ?, NULL, ?)`
      ).run(uid, GAME_ID, committed, now, roundId);
      addStake(db, roundId, uid, committed);
    }

    const over = roundOver(after);
    persist(db, roundId, after, over, now);
    db.prepare('UPDATE mutations SET match_id = ? WHERE uid = ? AND nonce = ?').run(
      roundId,
      uid,
      nonce
    );
    if (over) settleRoundRow(db, roundId, after, now);

    return { ok: true, value: { roundId, table: after, row: rowAfter(row, after, over ? 1 : 0), replayed: false } };
  });

  return run();
}

/**
 * Drive a bot's decision. HOST-FREE — the referee owns every AI chair, so a table whose humans have
 * all closed their tabs still finishes and still settles the hands they paid for.
 *
 * A bot's chair is written no ledger row and no wager: it has no account, so it stakes nothing and
 * wins nothing. `stakeFor` is never consulted for it, which is why this is a separate entry point
 * rather than `playAction` with a synthetic uid.
 */
export function playAiTurn(
  db: Db,
  roundId: number,
  seat: number,
  move: TableMove,
  now: number,
  rng: () => number = Math.random
): RoundOk | null {
  const run = db.transaction((): RoundOk | null => {
    const row = db
      .prepare('SELECT id, state_json, round, settled FROM blackjack_rounds WHERE id = ?')
      .get(roundId) as RoundRow | undefined;
    if (row === undefined || row.settled === 1) return null;
    const before = stateOf(row);
    if (roundOver(before)) return null;

    const after = applyMove(before, seat, move, () => shuffle(freshDeck(), rng));
    if (after === before) return null;

    const over = roundOver(after);
    persist(db, roundId, after, over, now);
    if (over) settleRoundRow(db, roundId, after, now);
    return { roundId, table: after, row: rowAfter(row, after, over ? 1 : 0), replayed: false };
  });
  return run();
}

// ── settling ─────────────────────────────────────────────────────────────────────────────────

/**
 * Pay every human chair its own hand, and record the outcome once per player.
 *
 * EACH CHAIR SETTLES AGAINST THE HOUSE, INDEPENDENTLY. There is no pot to divide, so a chair's
 * payout is `spotPayout` over its own cards and its own stake — the SHARED function, which folds
 * `payoutCents` and the insurance return together so the referee has no arithmetic of its own. A
 * chair that busted is paid nothing by the same call that pays the chair beside it 3:2, and neither
 * number depends on the other.
 *
 * `recordOutcome` fires ONCE PER HUMAN CHAIR, with that chair's own wager, its own payout and its
 * insurance handed over separately (`sideNetCents`) — v1 called `recordWin` from inside insurance
 * and inflated the win count for a hand the player had just lost. It is also why the BOARD does not
 * call `reportResult`: the stat, the XP and the badges are banked here, before any client learns the
 * round ended.
 *
 * `feat_natural` is DETECTED rather than reported, exactly as the solo settle detects it — the
 * server dealt the two cards, so it can see the two-card 21 for itself.
 *
 * Wagers close by `match_id`, never oldest-first: an abandoned round's open stake would otherwise be
 * consumed by an unrelated settlement later.
 */
export function settleRoundRow(db: Db, roundId: number, table: BlackjackTable, now: number): void {
  const row = db
    .prepare('SELECT id, state_json, round, settled FROM blackjack_rounds WHERE id = ?')
    .get(roundId) as RoundRow | undefined;
  if (row === undefined) return;

  db.prepare('UPDATE blackjack_rounds SET settled = 1, state_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(table), now, roundId);
  db.prepare('UPDATE wagers SET settled_at = ? WHERE match_id = ? AND settled_at IS NULL').run(
    now,
    roundId
  );

  for (const player of playersOf(db, roundId)) {
    const spot = table.spots[player.seat];
    // A chair that never got a stake down is not in this round's economy at all: no ledger row, no
    // stat, no XP. It is the blackjack equivalent of sitting out a hand, and recording a `loss` for
    // it would let a player who never bet drag their own win rate down by watching.
    if (spot === undefined || spot.result === null || spot.wagerCents <= 0) continue;

    const payout = spotPayout(spot);
    if (payout > 0) appendLedger(db, player.uid, GAME_ID, payout, 'settle', now);

    recordOutcome(
      db,
      player.uid,
      GAME_ID,
      resultOutcome(spot.result),
      spot.wagerCents,
      payoutCents(spot.result, spot.wagerCents),
      spot.result === 'blackjack' ? ['feat_natural'] : [],
      now,
      spot.insurancePaidCents - spot.insuranceCents
    );
  }
}

/**
 * Void a round and refund every cent every chair put into it — the answer to "the room is in memory
 * and the round is not".
 *
 * It refunds `staked_cents` rather than the opening wager, because a chair may have doubled and
 * insured before the process died and all of it left the ledger. Terminal and idempotent through the
 * same `settled` flag the payout uses: a round cannot be both paid and refunded, or refunded twice.
 */
export function voidRound(db: Db, roundId: number, now: number, reason = 'void'): number {
  const run = db.transaction((): number => {
    const row = db
      .prepare('SELECT id, state_json, round, settled FROM blackjack_rounds WHERE id = ?')
      .get(roundId) as RoundRow | undefined;
    if (row === undefined || row.settled === 1) return 0;

    const players = playersOf(db, roundId);
    db.prepare('UPDATE blackjack_rounds SET settled = 1, updated_at = ? WHERE id = ?').run(now, roundId);
    db.prepare('UPDATE wagers SET settled_at = ? WHERE match_id = ? AND settled_at IS NULL').run(
      now,
      roundId
    );

    let refunded = 0;
    for (const player of players) {
      if (player.staked_cents <= 0) continue;
      appendLedger(db, player.uid, GAME_ID, player.staked_cents, reason, now);
      refunded += player.staked_cents;
    }
    return refunded;
  });
  return run();
}

/**
 * At boot, void every round that was live when the process died. Called from `server.ts` before the
 * gateway accepts a socket, so no client can act on a round about to be refunded.
 */
export function sweepAbandonedRounds(db: Db, now: number): { rounds: number; refundedCents: number } {
  const rows = db.prepare('SELECT id FROM blackjack_rounds WHERE settled = 0').all() as { id: number }[];
  let refundedCents = 0;
  for (const row of rows) refundedCents += voidRound(db, row.id, now, 'void');
  return { rounds: rows.length, refundedCents };
}

/** Re-exported so the dealer reads "who owes an action" off the rulebook rather than asking twice. */
export { pendingSeats, roundOver };
