/**
 * UNO, DEALT BY THE REFEREE — the third server-dealt game, and the one that had to give something up
 * to become one.
 *
 * Blackjack and Liar's Dice were built this way. UNO was not: it shipped as HOST-AS-DEALER, one
 * client holding every hand plus the draw pile in memory, and that was the right call for a game
 * with no stakes. Adding a pot ends it, for two reasons either of which is fatal on its own.
 *
 * THE CEILING. A 4-seat $25-ante table pays $100 on a $25 stake — 4×; a 7-seat table pays 7×. The
 * generic `/settle` ceiling is 3× (`DEFAULT_PAYOUT_MULTIPLE`). Raising it so a client-dealt game can
 * pay itself raises it for every game sharing the constant, which is the move the Money rules exist
 * to refuse.
 *
 * THE DEALER IS A PLAYER. `blackjack.ts` says a ceiling could bound theft but never stop it, because
 * "did this player actually win" is not a question you can ask about a number. Liar's Dice says a
 * host who can see every cup is a player who cannot lose. UNO's host can see every hand AND holds
 * the draw pile, so with money on the table it is the same sentence.
 *
 * SO THE MONEY AND THE CARDS MOVED TOGETHER. There is no version of this where the pot is refereed
 * and the deal is not, and `useUnoHost.ts` was DELETED rather than kept as a fallback: two dealers
 * running two copies of the rulebook is the drift this repo has a lint rule about, and "the cheapest
 * way to defeat a cutover is to leave the road it replaced standing."
 *
 * WHERE THE RANDOMNESS IS, and why it matters more here than in Liar's Dice. That module can say its
 * `applyAction` takes no rng, so re-applying an action cannot re-roll it. UNO's `applyMove` DOES
 * take one — an empty deck reshuffles the discard back in mid-move — so a replayed move re-run
 * against a fresh shuffle would deal different cards. Every replay therefore re-serves the PERSISTED
 * match and never re-runs the reducer. That is the `pack_opens` rule, and here it is load-bearing
 * rather than merely tidy.
 *
 * A ROUND IS A MATCH. UNO plays many rounds at one table and each is its own pot, so each is its own
 * row with its own antes and its own settle. v1 gated this with `payAnteIfNeeded(roundId)` so a
 * resync could not double-charge; the nonce does that job here.
 */
import {
  applyMove,
  chooseAiMove,
  deal,
  dealEvent,
  describeMove,
  potFor,
  toPublic,
  type Move,
  type UnoEvent,
  type UnoGame,
  type UnoLevel,
  type UnoState,
} from '@boardwalk/game-logic/games/uno';
import type { Db } from '../db/db';
import { appendLedger, claimNonce, recordOutcome } from './mutations';
import { balanceOf } from './profile';
import type { Decision } from './economy';

/** Local, like blackjack's and Liar's Dice's — `economy.ts` keeps its own constructors private. */
const refuse = <T>(error: string): Decision<T> => ({ ok: false, error });

/**
 * The game id, from one place. Never a string literal at a call site — v1 recorded `texas_holdem`
 * as `"poker"` and five games' stats silently never reached the hub.
 */
export const GAME_ID = 'uno';

export interface MatchRow {
  readonly id: number;
  readonly state_json: string;
  readonly round: number;
  readonly pot_cents: number;
  readonly settled: number;
}

export interface PlayerRow {
  readonly uid: string;
  readonly seat: number;
  readonly ante_cents: number;
}

/** A seat as the gateway knows it, narrowed to what this module needs. Structurally `PotSeat`. */
export interface SeatSpec {
  readonly kind: 'human' | 'ai' | 'open';
  readonly uid: string | null;
}

/**
 * The complete match, as stored. `UnoGame` plus the one fact the rulebook has no opinion about:
 * the move log's ordering counter, which restarts with each round and is what lets a client tell
 * "no move happened" from "I missed one". It rides in the blob rather than a column because nothing
 * queries it and the shape is the referee's.
 */
interface StoredMatch {
  readonly game: UnoGame;
  readonly eventSeq: number;
  readonly lastEvent: UnoEvent;
  /**
   * How hard the bots play, stamped at the deal.
   *
   * IT IS THE ONE THING `unoStart` STILL CARRIES FROM A CLIENT, and the distinction is worth being
   * precise about: a difficulty is not money. It cannot move a chip, cannot name an outcome, and
   * the worst a hostile value could do is make the house play badly against the person who chose
   * it. The ante is the opposite on every count, which is exactly why that one is read off the room
   * and not off this frame.
   *
   * Stored rather than passed per turn because the referee drives bots on its own timer, long after
   * whoever picked it may have closed their tab — and because a level that changed mid-round would
   * be v1's Chess bug, which deferred a difficulty change to the next game for this reason.
   */
  readonly level: UnoLevel;
}

const stateOf = (row: MatchRow): StoredMatch => JSON.parse(row.state_json) as StoredMatch;

// ── reads, all carrying their authority ──────────────────────────────────────────────────────

/**
 * Load a round, scoped to a uid that is actually IN it.
 *
 * Blackjack scopes by ownership and explains why: a match id is a small sequential integer,
 * guessable by typing, so an id is not a secret and the query must carry the authority. A match has
 * no owner — it has members — so the rule becomes a membership join, exactly as in Liar's Dice.
 * Without it one account could act on another table's round.
 */
export function loadMatchFor(db: Db, uid: string, matchId: number): MatchRow | undefined {
  return db
    .prepare(
      `SELECT m.id, m.state_json, m.round, m.pot_cents, m.settled
         FROM uno_matches m
         JOIN uno_players p ON p.match_id = m.id
        WHERE m.id = ? AND p.uid = ?`
    )
    .get(matchId, uid) as MatchRow | undefined;
}

/** The live round in a room, if any. Used by the dealer to route a move to its match. */
export function liveMatchInRoom(db: Db, gameId: string, roomId: string): MatchRow | undefined {
  return db
    .prepare(
      `SELECT id, state_json, round, pot_cents, settled
         FROM uno_matches
        WHERE game_id = ? AND room_id = ? AND settled = 0
        ORDER BY id DESC LIMIT 1`
    )
    .get(gameId, roomId) as MatchRow | undefined;
}

/**
 * The most recent round at this table, settled or not — what the next deal reads to decide who
 * leads and which round number this is.
 *
 * WHO OPENS A ROUND is v1's rule: the last round's winner. It is worth keeping and it is worth
 * being explicit about why, because the alternative is not neutral — a fixed leader means seat 0
 * opens every round of the evening and the last seat never opens one at all. In the client dealer
 * this lived in a `lastWinnerRef` that a host reload destroyed; here it is a query.
 */
export function lastMatchInRoom(db: Db, gameId: string, roomId: string): MatchRow | undefined {
  return db
    .prepare(
      `SELECT id, state_json, round, pot_cents, settled
         FROM uno_matches
        WHERE game_id = ? AND room_id = ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(gameId, roomId) as MatchRow | undefined;
}

export function playersOf(db: Db, matchId: number): PlayerRow[] {
  return db
    .prepare('SELECT uid, seat, ante_cents FROM uno_players WHERE match_id = ? ORDER BY seat')
    .all(matchId) as PlayerRow[];
}

/** The seat this uid holds in this round, or -1. The turn check reads it. */
export function seatOf(db: Db, matchId: number, uid: string): number {
  const row = db
    .prepare('SELECT seat FROM uno_players WHERE match_id = ? AND uid = ?')
    .get(matchId, uid) as { seat: number } | undefined;
  return row?.seat ?? -1;
}

function persist(db: Db, matchId: number, match: StoredMatch, now: number): void {
  db.prepare('UPDATE uno_matches SET state_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(match),
    now,
    matchId
  );
}

// ── the projections the dealer hands out ─────────────────────────────────────────────────────

/**
 * The public view: top card, per-seat COUNTS, whose turn, the pot — and no card anyone holds.
 *
 * `toPublic` is the SHARED projection, written once and imported by every call site, because three
 * copies of "what may a client see" is three chances to reveal a card and the two that are not the
 * referee's are the ones nobody would think to audit. It used to be computed by the host; it is the
 * same lines of code, now run somewhere a player cannot reach.
 */
export const viewOf = (match: StoredMatch, row: MatchRow): UnoState =>
  toPublic(match.game, row.round, row.pot_cents, match.lastEvent);

/** One seat's hand — the only thing ever written to that seat's private node. */
export const handOf = (match: StoredMatch, seat: number): UnoGame['hands'][number] =>
  match.game.hands[seat] ?? [];

// ── starting a round ─────────────────────────────────────────────────────────────────────────

export interface StartInput {
  readonly nonce: string;
  readonly gameId: string;
  readonly roomId: string;
  readonly seats: readonly SeatSpec[];
  /**
   * The table's stake, read off the ROOM by the caller — never off a client frame. `unoStart` has no
   * field for it, so a hostile host cannot charge a table $1M for a game it joined at $25. See
   * `RoomMeta.anteCents`.
   */
  readonly anteCents: number;
  /** How hard the bots play. A difficulty, not money — see `StoredMatch.level`. */
  readonly level: UnoLevel;
  /**
   * WHAT THE TABLE AGREED TO PLAY, read off the ROOM by the caller — never off a client frame, for
   * the ante's reason with the money taken out: whoever presses Deal must not get to choose what
   * game the other six people just sat down to. `unoStart` has no field for it.
   *
   * `unknown` because that is what it is at this point — a bag the room store bounded but did not
   * interpret. `deal` resolves it through the shared `resolveHouseRules`, which is the one place
   * the ids acquire meaning, and stamps the result INTO the match: from there on the round carries
   * its own rules in `state_json` and no later read has to ask the room again.
   */
  readonly houseRules: unknown;
}

export interface StartOk {
  readonly matchId: number;
  readonly match: StoredMatch;
  readonly row: MatchRow;
  readonly replayed: boolean;
}

/**
 * Deal a round and take every human's ante, in one transaction.
 *
 * NOTHING IS WRITTEN UNTIL NOTHING CAN REFUSE — the hazard `blackjack.ts` documents at length: a
 * `return` out of a better-sqlite3 transaction COMMITS, and only a throw rolls back. "Refuse and
 * change nothing" is earned by the order of these statements, not given by the transaction. Every
 * affordability check runs before the first ledger row.
 *
 * AN ANTE NOBODY CAN COVER REFUSES THE WHOLE START. Not "seat them without a stake" and not "deal
 * anyway": a table where one player is playing for free and the others are not is a different game
 * than the one the lobby offered.
 */
export function startMatch(
  db: Db,
  host: string,
  input: StartInput,
  now: number,
  rng: () => number = Math.random
): Decision<StartOk> {
  const humans = input.seats.filter((s) => s.kind === 'human' && s.uid !== null && s.uid !== '');
  if (input.seats.length < 2) return refuse('a table needs at least two seats');
  if (humans.length === 0) return refuse('a table needs at least one human');
  if (!humans.some((s) => s.uid === host)) return refuse('only a seated player may deal');

  // The stake and the pot both come from the SHARED rule, so the number the board draws and the
  // number the ledger takes cannot be two different pieces of arithmetic. It is also where the
  // two-humans rule lives — below that the table plays for XP and stats alone.
  const stake = potFor(input.seats, input.anteCents) === 0 ? 0 : Math.floor(input.anteCents);
  const pot = potFor(input.seats, input.anteCents);

  const run = db.transaction((): Decision<StartOk> => {
    if (!claimNonce(db, host, input.nonce, 'uno-start', now)) {
      const existing = liveMatchInRoom(db, input.gameId, input.roomId);
      if (existing === undefined) return refuse('that nonce was used by a different mutation');
      return {
        ok: true,
        value: { matchId: existing.id, match: stateOf(existing), row: existing, replayed: true },
      };
    }

    // ── every refusal lives above this line ──
    if (stake > 0) {
      for (const seat of humans) {
        if (balanceOf(db, seat.uid ?? '') < stake) {
          // Give the nonce back so the same request can be retried once everyone can cover it —
          // otherwise the host gets a one-off error it cannot retry out of (blackjack's bug).
          db.prepare('DELETE FROM mutations WHERE uid = ? AND nonce = ?').run(host, input.nonce);
          return refuse('a player at the table cannot cover that ante');
        }
      }
    }
    // ── nothing can refuse from here on ──

    // The last round's winner opens this one (v1's rule). `deal` floors an out-of-range seat to 0,
    // which is what makes a table that shrank between rounds safe without a check here.
    const previous = lastMatchInRoom(db, input.gameId, input.roomId);
    const leader = previous === undefined ? 0 : Math.max(0, stateOf(previous).game.winner);
    const round = previous === undefined ? 0 : previous.round + 1;

    // The table's rules are stamped onto the round HERE, once, so the match is played under what it
    // was dealt with and there is no second copy on the room to drift from it.
    const game = deal(input.seats.length, rng, leader, input.houseRules);
    const match: StoredMatch = {
      game,
      eventSeq: 0,
      lastEvent: dealEvent(game, previous === undefined),
      level: input.level,
    };

    const info = db
      .prepare(
        `INSERT INTO uno_matches (game_id, room_id, state_json, round, pot_cents, settled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(input.gameId, input.roomId, JSON.stringify(match), round, pot, now, now);
    const matchId = Number(info.lastInsertRowid);

    input.seats.forEach((seat, index) => {
      if (seat.kind !== 'human' || seat.uid === null || seat.uid === '') return;
      db.prepare(
        'INSERT INTO uno_players (match_id, uid, seat, ante_cents) VALUES (?, ?, ?, ?)'
      ).run(matchId, seat.uid, index, stake);
      if (stake > 0) {
        appendLedger(db, seat.uid, GAME_ID, -stake, 'bet', now);
        db.prepare(
          `INSERT INTO wagers (uid, game_id, wager_cents, created_at, settled_at, match_id)
           VALUES (?, ?, ?, ?, NULL, ?)`
        ).run(seat.uid, GAME_ID, stake, now, matchId);
      }
    });

    db.prepare('UPDATE mutations SET match_id = ? WHERE uid = ? AND nonce = ?').run(
      matchId,
      host,
      input.nonce
    );

    const row: MatchRow = {
      id: matchId,
      state_json: JSON.stringify(match),
      round,
      pot_cents: pot,
      settled: 0,
    };
    return { ok: true, value: { matchId, match, row, replayed: false } };
  });

  return run();
}

// ── playing it ───────────────────────────────────────────────────────────────────────────────

export interface MoveOk {
  readonly matchId: number;
  readonly match: StoredMatch;
  readonly row: MatchRow;
  readonly replayed: boolean;
}

const rowAfter = (row: MatchRow, match: StoredMatch, settled: number): MatchRow => ({
  ...row,
  state_json: JSON.stringify(match),
  settled,
});

/**
 * Apply one player's move, and settle if it ended the round.
 *
 * A REPLAY RE-SERVES THE PERSISTED MATCH rather than re-running the reducer, and unlike Liar's Dice
 * this is not a nicety. `applyMove` consumes randomness — an emptied deck reshuffles the discard
 * back in — so re-running a move would deal a different table than the one the player already saw.
 * Same reasoning `pack_opens` exists for.
 *
 * The turn check is here and NOT in the dealer, because a check in the transport that can drift
 * from the check in the rules is two rules. The reducer is total, so a move from the wrong seat is
 * already a no-op — this refuses it explicitly so the caller gets an error rather than silence, but
 * the safety does not depend on the refusal.
 */
export function playMove(
  db: Db,
  uid: string,
  matchId: number,
  nonce: string,
  move: Move,
  now: number,
  rng: () => number = Math.random
): Decision<MoveOk> {
  const run = db.transaction((): Decision<MoveOk> => {
    const row = loadMatchFor(db, uid, matchId);
    if (row === undefined) return refuse('no such match');

    if (!claimNonce(db, uid, nonce, 'uno-move', now)) {
      return { ok: true, value: { matchId, match: stateOf(row), row, replayed: true } };
    }

    const deny = (why: string): Decision<MoveOk> => {
      db.prepare('DELETE FROM mutations WHERE uid = ? AND nonce = ?').run(uid, nonce);
      return refuse(why);
    };

    if (row.settled === 1) return deny('that round is over');

    const seat = seatOf(db, matchId, uid);
    if (seat < 0) return deny('you are not in that round');

    const before = stateOf(row);
    if (before.game.winner !== -1) return deny('that round is over');
    if (before.game.turn !== seat) return deny('not your turn');

    const after = applyMove(before.game, seat, move, rng);
    if (after === before.game) return deny('that is not a legal move');

    const stored = advanceLog(before, after, seat, move);
    persist(db, matchId, stored, now);
    db.prepare('UPDATE mutations SET match_id = ? WHERE uid = ? AND nonce = ?').run(
      matchId,
      uid,
      nonce
    );

    if (after.winner !== -1) settleMatch(db, matchId, stored, now);
    return {
      ok: true,
      value: { matchId, match: stored, row: rowAfter(row, stored, after.winner !== -1 ? 1 : 0), replayed: false },
    };
  });

  return run();
}

/**
 * Fold a transition into the log. `describeMove` returns the deal sentinel when nothing changed, so
 * a refused move burns no seq and produces no line — the reducer's totality carried through to the
 * commentary rather than re-checked here.
 */
function advanceLog(before: StoredMatch, after: UnoGame, seat: number, move: Move): StoredMatch {
  const seq = before.eventSeq + 1;
  const event = describeMove(before.game, after, seat, move, seq);
  return {
    ...before,
    game: after,
    eventSeq: event.seq === seq ? seq : before.eventSeq,
    lastEvent: event,
  };
}

/**
 * Drive a bot's turn. HOST-FREE: the referee owns every AI seat, so no client can race it — and,
 * unlike the client dealer this replaced, a table whose host has closed their tab still finishes.
 */
export function playAiTurn(
  db: Db,
  matchId: number,
  now: number,
  rng: () => number = Math.random
): MoveOk | null {
  const run = db.transaction((): MoveOk | null => {
    const row = db
      .prepare('SELECT id, state_json, round, pot_cents, settled FROM uno_matches WHERE id = ?')
      .get(matchId) as MatchRow | undefined;
    if (row === undefined || row.settled === 1) return null;
    const before = stateOf(row);
    if (before.game.winner !== -1) return null;

    const seat = before.game.turn;
    const move = chooseAiMove(before.game, seat, before.level, rng);
    const after = applyMove(before.game, seat, move, rng);
    if (after === before.game) return null;

    const stored = advanceLog(before, after, seat, move);
    persist(db, matchId, stored, now);
    if (after.winner !== -1) settleMatch(db, matchId, stored, now);
    return {
      matchId,
      match: stored,
      row: rowAfter(row, stored, after.winner !== -1 ? 1 : 0),
      replayed: false,
    };
  });
  return run();
}

// ── settling ─────────────────────────────────────────────────────────────────────────────────

/**
 * Pay the pot and record the outcome for every human in the round.
 *
 * The payout has no argument a request can reach: it is the pot this round's own antes built, paid
 * to the seat the REDUCER says won. Wagers close by `match_id` rather than oldest-first, for
 * blackjack's reason — an abandoned round's open stake would otherwise be consumed by a later,
 * unrelated settlement.
 *
 * `recordOutcome` is the shared one, so stats/XP/achievements cannot drift from the generic path.
 * Every human gets a row: the winner a win, everyone else a loss. A bot gets nothing, having no
 * account to record against. This is also why the BOARD does not call `reportResult` — the stat,
 * the XP and the badges are banked here, before any client learns the round ended.
 */
export function settleMatch(db: Db, matchId: number, match: StoredMatch, now: number): void {
  const row = db
    .prepare('SELECT id, state_json, round, pot_cents, settled FROM uno_matches WHERE id = ?')
    .get(matchId) as MatchRow | undefined;
  if (row === undefined || row.settled === 1) return; // the second-settle guard

  const players = playersOf(db, matchId);
  const pot = row.pot_cents;
  const winnerSeat = match.game.winner;

  db.prepare('UPDATE uno_matches SET settled = 1, state_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(match),
    now,
    matchId
  );
  db.prepare('UPDATE wagers SET settled_at = ? WHERE match_id = ? AND settled_at IS NULL').run(
    now,
    matchId
  );

  for (const player of players) {
    const won = player.seat === winnerSeat;
    const payout = won ? pot : 0;
    if (payout > 0) appendLedger(db, player.uid, GAME_ID, payout, 'settle', now);
    recordOutcome(db, player.uid, GAME_ID, won ? 'win' : 'loss', player.ante_cents, payout, [], now);
  }
}

/**
 * Void a round and refund every ante — the answer to "the room is in memory and the match is not".
 *
 * A room lives in the gateway's process. A restart takes every room with it, but the antes have
 * already left the ledger, so without this a restart would strand real money in open wagers forever.
 * Refunding is the only honest option: there is no room to reattach players to, and "leave the stake
 * open and hope" is how a ledger stops balancing.
 *
 * Terminal, and idempotent through the same `settled` flag the payout uses — a round cannot be both
 * paid and refunded, and cannot be refunded twice.
 */
export function voidMatch(db: Db, matchId: number, now: number, reason = 'void'): number {
  const run = db.transaction((): number => {
    const row = db
      .prepare('SELECT id, state_json, round, pot_cents, settled FROM uno_matches WHERE id = ?')
      .get(matchId) as MatchRow | undefined;
    if (row === undefined || row.settled === 1) return 0;

    const players = playersOf(db, matchId);
    db.prepare('UPDATE uno_matches SET settled = 1, updated_at = ? WHERE id = ?').run(now, matchId);
    db.prepare('UPDATE wagers SET settled_at = ? WHERE match_id = ? AND settled_at IS NULL').run(
      now,
      matchId
    );

    let refunded = 0;
    for (const player of players) {
      if (player.ante_cents <= 0) continue;
      appendLedger(db, player.uid, GAME_ID, player.ante_cents, reason, now);
      refunded += player.ante_cents;
    }
    return refunded;
  });
  return run();
}

/**
 * At boot, void every round that was live when the process died.
 *
 * Called from `server.ts` before the gateway accepts a socket, so there is no window where a client
 * could act on a round that is about to be refunded.
 */
export function sweepAbandonedMatches(
  db: Db,
  now: number
): { matches: number; refundedCents: number } {
  const rows = db.prepare('SELECT id FROM uno_matches WHERE settled = 0').all() as { id: number }[];
  let refundedCents = 0;
  for (const row of rows) refundedCents += voidMatch(db, row.id, now, 'void');
  return { matches: rows.length, refundedCents };
}
