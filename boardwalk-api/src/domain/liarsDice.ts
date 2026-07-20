/**
 * LIAR'S DICE, DEALT BY THE REFEREE — the second server-dealt game, and the first multiplayer one.
 *
 * `domain/blackjack.ts` is the precedent and its opening argument transfers with one word changed:
 * a client that quietly answered "I won" to every match would be inside every rule the server had,
 * and the payout ceiling could bound the theft but never stop it, because "did this player
 * actually win" is not a question you can ask about a number.
 *
 * WHAT IS DIFFERENT, AND WHY IT IS WORSE THAN BLACKJACK. In blackjack the hidden thing is one hole
 * card and the deck; leaking it skews a hand. Here the hidden thing IS the game — a player who can
 * read the other cups wins every challenge and loses none, so a leak does not tilt the odds, it
 * ends the game while leaving it looking played. UNO's answer (the HOST holds every hand) is
 * therefore unavailable: the host would be a player who cannot lose. Nobody at the table holds
 * anyone's dice. This module rolls them and never sends them.
 *
 * THE MONEY SHAPE. Every human seat antes at the start; the last player standing takes the pot.
 * Bots do not ante — they have no bankroll — which is why a table needs TWO humans before a chip
 * moves at all. One human against five bots would be a pot made of your own ante handed back, and
 * a betting UI that cannot move money is a worse lie than no betting UI.
 *
 * WHERE THE RANDOMNESS IS. `deal` and `advanceRound` consume the rng; `applyAction` does not, by
 * construction (see the reducer's docblock). That is what makes a replayed action safe here
 * without the `pack_opens` treatment: re-applying an action cannot re-roll it. The ROUND ADVANCE
 * can, which is why it is the referee that steps out of a reveal and the outcome is persisted the
 * moment it is rolled.
 */
import {
  advanceRound,
  applyAction,
  chooseAiAction,
  deal,
  handFor,
  publicView,
  type Action,
  type LiarsDiceHand,
  type LiarsDiceMatch,
  type LiarsDicePublic,
} from '@boardwalk/game-logic/games/liars-dice';
import type { Db } from '../db/db';
import { appendLedger, claimNonce, recordOutcome } from './mutations';
import { balanceOf } from './profile';
import type { Decision } from './economy';

/** Local, like blackjack's — `economy.ts` keeps its own constructors private. */
const refuse = <T>(error: string): Decision<T> => ({ ok: false, error });

/**
 * The game id, from one place. Never a string literal at a call site — v1 recorded
 * `texas_holdem` as `"poker"` and five games' stats silently never reached the hub.
 */
export const GAME_ID = 'liars-dice';

/** Betting needs a real opponent. See the header. */
export const MIN_HUMANS_TO_BET = 2;

export interface MatchRow {
  readonly id: number;
  readonly state_json: string;
  readonly pot_cents: number;
  readonly settled: number;
}

export interface PlayerRow {
  readonly uid: string;
  readonly seat: number;
  readonly ante_cents: number;
}

/** A seat as the gateway knows it, narrowed to what this module needs. */
export interface SeatSpec {
  readonly kind: 'human' | 'ai' | 'open';
  readonly uid: string | null;
}

const stateOf = (row: MatchRow): LiarsDiceMatch =>
  JSON.parse(row.state_json) as LiarsDiceMatch;

// ── reads, all carrying their authority ──────────────────────────────────────────────────────

/**
 * Load a match, scoped to a uid that is actually IN it.
 *
 * Blackjack scopes its load by ownership (`WHERE id = ? AND uid = ?`) and its docblock explains
 * why: a match id is a small sequential integer, guessable by typing, so an id is not a secret and
 * the query must carry the authority. A match has no owner — it has members — so the same rule
 * becomes a membership join. Without it, one account could act on another table's match and settle
 * money into it.
 */
export function loadMatchFor(db: Db, uid: string, matchId: number): MatchRow | undefined {
  return db
    .prepare(
      `SELECT m.id, m.state_json, m.pot_cents, m.settled
         FROM liars_dice_matches m
         JOIN liars_dice_players p ON p.match_id = m.id
        WHERE m.id = ? AND p.uid = ?`
    )
    .get(matchId, uid) as MatchRow | undefined;
}

/** The live match in a room, if any. Used by the gateway to route an action to its match. */
export function liveMatchInRoom(db: Db, gameId: string, roomId: string): MatchRow | undefined {
  return db
    .prepare(
      `SELECT id, state_json, pot_cents, settled
         FROM liars_dice_matches
        WHERE game_id = ? AND room_id = ? AND settled = 0
        ORDER BY id DESC LIMIT 1`
    )
    .get(gameId, roomId) as MatchRow | undefined;
}

export function playersOf(db: Db, matchId: number): PlayerRow[] {
  return db
    .prepare('SELECT uid, seat, ante_cents FROM liars_dice_players WHERE match_id = ? ORDER BY seat')
    .all(matchId) as PlayerRow[];
}

/** The seat this uid holds in this match, or -1. The turn check reads it. */
export function seatOf(db: Db, matchId: number, uid: string): number {
  const row = db
    .prepare('SELECT seat FROM liars_dice_players WHERE match_id = ? AND uid = ?')
    .get(matchId, uid) as { seat: number } | undefined;
  return row?.seat ?? -1;
}

function persist(db: Db, matchId: number, match: LiarsDiceMatch, now: number): void {
  db.prepare('UPDATE liars_dice_matches SET state_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(match),
    now,
    matchId
  );
}

// ── the projections the gateway hands out ────────────────────────────────────────────────────

export const viewOf = (match: LiarsDiceMatch): LiarsDicePublic => publicView(match);
export const cupOf = (match: LiarsDiceMatch, seat: number): LiarsDiceHand => handFor(match, seat);

// ── starting a match ─────────────────────────────────────────────────────────────────────────

export interface StartInput {
  readonly nonce: string;
  readonly gameId: string;
  readonly roomId: string;
  readonly seats: readonly SeatSpec[];
  readonly anteCents: number;
}

export interface StartOk {
  readonly matchId: number;
  readonly match: LiarsDiceMatch;
  readonly potCents: number;
  readonly replayed: boolean;
}

/**
 * Deal a match and take every human's ante, in one transaction.
 *
 * NOTHING IS WRITTEN UNTIL NOTHING CAN REFUSE — the hazard `blackjack.ts` documents at length: a
 * `return` out of a better-sqlite3 transaction COMMITS, and only a throw rolls back. So "refuse
 * and change nothing" is earned by the order of these statements, not given by the transaction.
 * Every affordability check runs before the first ledger row.
 *
 * AN ANTE NOBODY CAN COVER REFUSES THE WHOLE START. Not "seat them without a stake" and not "deal
 * anyway" — a table where one player is playing for free and the others are not is a different
 * game than the one the lobby offered.
 */
export function startMatch(
  db: Db,
  host: string,
  input: StartInput,
  now: number,
  rng: () => number = Math.random
): Decision<StartOk> {
  const humans = input.seats.filter((s) => s.kind === 'human' && s.uid !== null);
  if (input.seats.length < 2) return refuse('a match needs at least two seats');
  if (humans.length === 0) return refuse('a match needs at least one human');
  if (!humans.some((s) => s.uid === host)) return refuse('only a seated player may start the match');

  const ante = Math.floor(input.anteCents);
  if (!Number.isFinite(ante) || ante < 0) return refuse('bad ante');
  // Betting needs a real opponent; below that the table plays for XP and stats alone.
  const betting = humans.length >= MIN_HUMANS_TO_BET && ante > 0;
  const stake = betting ? ante : 0;

  const run = db.transaction((): Decision<StartOk> => {
    if (!claimNonce(db, host, input.nonce, 'ld-start', now)) {
      const existing = liveMatchInRoom(db, input.gameId, input.roomId);
      if (existing === undefined) return refuse('that nonce was used by a different mutation');
      return {
        ok: true,
        value: {
          matchId: existing.id,
          match: stateOf(existing),
          potCents: existing.pot_cents,
          replayed: true,
        },
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

    const match = deal(input.seats.length, rng);
    const pot = stake * humans.length;

    const info = db
      .prepare(
        `INSERT INTO liars_dice_matches (game_id, room_id, state_json, pot_cents, settled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .run(input.gameId, input.roomId, JSON.stringify(match), pot, now, now);
    const matchId = Number(info.lastInsertRowid);

    input.seats.forEach((seat, index) => {
      if (seat.kind !== 'human' || seat.uid === null) return;
      db.prepare(
        'INSERT INTO liars_dice_players (match_id, uid, seat, ante_cents) VALUES (?, ?, ?, ?)'
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

    return { ok: true, value: { matchId, match, potCents: pot, replayed: false } };
  });

  return run();
}

// ── playing it ───────────────────────────────────────────────────────────────────────────────

export interface ActionOk {
  readonly matchId: number;
  readonly match: LiarsDiceMatch;
  readonly replayed: boolean;
}

/**
 * Apply one player's action, and settle if it ended the match.
 *
 * The turn check is here and NOT in the gateway, because a check in the transport that can drift
 * from the check in the rules is two rules. The reducer is total, so an action from the wrong seat
 * is already a no-op — this refuses it explicitly so the caller gets an error rather than silence,
 * but the safety does not depend on the refusal.
 */
export function playAction(
  db: Db,
  uid: string,
  matchId: number,
  nonce: string,
  action: Action,
  now: number,
  rng: () => number = Math.random
): Decision<ActionOk> {
  const run = db.transaction((): Decision<ActionOk> => {
    const row = loadMatchFor(db, uid, matchId);
    if (row === undefined) return refuse('no such match');

    if (!claimNonce(db, uid, nonce, 'ld-action', now)) {
      // A REPLAY RE-SERVES THE PERSISTED MATCH rather than re-running the reducer. Actions are
      // deterministic, so re-running one would usually agree — but a round advance in between
      // re-rolls, and answering a retry with a freshly rolled table is a retry that changes the
      // dice under the player.
      return { ok: true, value: { matchId, match: stateOf(row), replayed: true } };
    }

    const deny = (why: string): Decision<ActionOk> => {
      db.prepare('DELETE FROM mutations WHERE uid = ? AND nonce = ?').run(uid, nonce);
      return refuse(why);
    };

    if (row.settled === 1) return deny('that match is over');

    const seat = seatOf(db, matchId, uid);
    if (seat < 0) return deny('you are not in that match');

    const before = stateOf(row);
    if (before.turn !== seat) return deny('not your turn');

    const after = applyAction(before, seat, action);
    if (after === before) return deny('that is not a legal action');

    persist(db, matchId, after, now);
    db.prepare('UPDATE mutations SET match_id = ? WHERE uid = ? AND nonce = ?').run(
      matchId,
      uid,
      nonce
    );

    if (after.winner !== -1) settleMatch(db, matchId, after, now);
    return { ok: true, value: { matchId, match: after, replayed: false } };
  });

  return run();
}

/**
 * Step a match out of the reveal into the next round. The REFEREE does this on a timer, not a
 * player — folding it into `playAction` would let one player's click cut short everyone else's
 * look at the dice, which is the only moment in the game the hidden information is public.
 */
export function advance(
  db: Db,
  matchId: number,
  now: number,
  rng: () => number = Math.random
): LiarsDiceMatch | null {
  const run = db.transaction((): LiarsDiceMatch | null => {
    const row = db
      .prepare('SELECT id, state_json, pot_cents, settled FROM liars_dice_matches WHERE id = ?')
      .get(matchId) as MatchRow | undefined;
    if (row === undefined || row.settled === 1) return null;
    const before = stateOf(row);
    const after = advanceRound(before, rng);
    if (after === before) return null;
    persist(db, matchId, after, now);
    return after;
  });
  return run();
}

/** Drive a bot's turn. Host-free: the referee owns every AI seat, so no client can race it. */
export function playAiTurn(
  db: Db,
  matchId: number,
  now: number,
  rng: () => number = Math.random
): LiarsDiceMatch | null {
  const run = db.transaction((): LiarsDiceMatch | null => {
    const row = db
      .prepare('SELECT id, state_json, pot_cents, settled FROM liars_dice_matches WHERE id = ?')
      .get(matchId) as MatchRow | undefined;
    if (row === undefined || row.settled === 1) return null;
    const before = stateOf(row);
    if (before.phase !== 'bidding' || before.winner !== -1) return null;
    const after = applyAction(before, before.turn, chooseAiAction(before, before.turn, rng));
    if (after === before) return null;
    persist(db, matchId, after, now);
    if (after.winner !== -1) settleMatch(db, matchId, after, now);
    return after;
  });
  return run();
}

// ── settling ─────────────────────────────────────────────────────────────────────────────────

/**
 * Pay the pot and record the outcome for every human in the match.
 *
 * The payout has no argument a request can reach: it is the pot this match's own antes built,
 * paid to the seat the REDUCER says won. Wagers close by `match_id` rather than oldest-first, for
 * blackjack's reason — an abandoned match's open stake would otherwise be consumed by a later,
 * unrelated settlement.
 *
 * `recordOutcome` is the shared one, so stats/XP/achievements cannot drift from the generic path.
 * Every human gets a row: the winner a win, everyone else a loss. A bot gets nothing, having no
 * account to record against.
 */
export function settleMatch(db: Db, matchId: number, match: LiarsDiceMatch, now: number): void {
  const row = db
    .prepare('SELECT id, state_json, pot_cents, settled FROM liars_dice_matches WHERE id = ?')
    .get(matchId) as MatchRow | undefined;
  if (row === undefined || row.settled === 1) return; // the second-settle guard

  const players = playersOf(db, matchId);
  const pot = row.pot_cents;
  const winnerSeat = match.winner;

  db.prepare('UPDATE liars_dice_matches SET settled = 1, state_json = ?, updated_at = ? WHERE id = ?').run(
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
 * Void a match and refund every ante — the answer to "the room is in memory and the match is not".
 *
 * A room lives in the gateway's process. A restart takes every room with it, but the antes have
 * already left the ledger, so without this a restart would strand real money in open wagers
 * forever. Refunding is the only honest option: there is no room to reattach players to, and
 * "leave the stake open and hope" is how a ledger stops balancing.
 *
 * Terminal, and idempotent through the same `settled` flag the payout uses — a match cannot be
 * both paid and refunded, and cannot be refunded twice.
 */
export function voidMatch(db: Db, matchId: number, now: number, reason = 'void'): number {
  const run = db.transaction((): number => {
    const row = db
      .prepare('SELECT id, state_json, pot_cents, settled FROM liars_dice_matches WHERE id = ?')
      .get(matchId) as MatchRow | undefined;
    if (row === undefined || row.settled === 1) return 0;

    const players = playersOf(db, matchId);
    db.prepare('UPDATE liars_dice_matches SET settled = 1, updated_at = ? WHERE id = ?').run(now, matchId);
    db.prepare('UPDATE wagers SET settled_at = ? WHERE match_id = ? AND settled_at IS NULL').run(now, matchId);

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
 * At boot, void every match that was live when the process died.
 *
 * Called from `server.ts` before the gateway accepts a socket, so there is no window where a
 * client could act on a match that is about to be refunded.
 */
export function sweepAbandonedMatches(db: Db, now: number): { matches: number; refundedCents: number } {
  const rows = db
    .prepare('SELECT id FROM liars_dice_matches WHERE settled = 0')
    .all() as { id: number }[];
  let refundedCents = 0;
  for (const row of rows) refundedCents += voidMatch(db, row.id, now, 'void');
  return { matches: rows.length, refundedCents };
}
