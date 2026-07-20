/**
 * The Liar's Dice referee — the money, the authority, and the two things that only exist because
 * this is the first MULTIPLAYER game the server deals.
 *
 * Blackjack's suite is the template. The cases that are new here are membership authority (a match
 * has no owner, so "an id is not a secret" becomes a join rather than a WHERE), the pot (many
 * stakes, one payout), and the boot sweep (a room lives in memory and a match does not, so a
 * restart must refund rather than strand).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type LiarsDiceMatch } from '@boardwalk/game-logic/games/liars-dice';
import { openDb, type Db } from '../src/db/db';
import { upsertProfile, balanceOf } from '../src/domain/profile';
import { checkSettle, STARTING_BANKROLL_CENTS } from '../src/domain/economy';
import {
  GAME_ID,
  advance,
  liveMatchInRoom,
  loadMatchFor,
  playAction,
  playAiTurn,
  playersOf,
  seatOf,
  startMatch,
  sweepAbandonedMatches,
  voidMatch,
  type SeatSpec,
  type StartOk,
} from '../src/domain/liarsDice';

const seeded = (): Db => {
  const db = openDb(':memory:');
  for (const uid of ['ada', 'bob', 'cy'])
    upsertProfile(db, uid, { name: uid, avatar: '👤', equipped: {} }, { now: 1 });
  return db;
};

const human = (uid: string): SeatSpec => ({ kind: 'human', uid });
const bot = (): SeatSpec => ({ kind: 'ai', uid: null });

/** An rng that always rolls `face`; the die is `floor(r*6)+1`, so aim at the band's middle. */
const always = (face: number) => () => (face - 1) / 6 + 0.01;

function ok(r: ReturnType<typeof startMatch>): StartOk {
  if (!r.ok) throw new Error(`expected ok, got refusal: ${r.error}`);
  return r.value;
}

const stateOfMatch = (db: Db, id: number): LiarsDiceMatch =>
  JSON.parse(
    (db.prepare('SELECT state_json FROM liars_dice_matches WHERE id = ?').get(id) as {
      state_json: string;
    }).state_json
  ) as LiarsDiceMatch;

const openWagers = (db: Db, uid: string): { wager_cents: number; match_id: number | null }[] =>
  db
    .prepare('SELECT wager_cents, match_id FROM wagers WHERE uid = ? AND settled_at IS NULL')
    .all(uid) as { wager_cents: number; match_id: number | null }[];

const start = (db: Db, seats: SeatSpec[], anteCents = 1_000, nonce = 'n1', host = 'ada') =>
  startMatch(db, host, { nonce, gameId: GAME_ID, roomId: 'ROOM', seats, anteCents }, 100, always(3));

/* ------------------------------------------------------------------ the deal + the ante */

describe('startMatch', () => {
  it('takes every human ante through the LEDGER and opens a wager naming the match', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 1_000));

    expect(res.potCents).toBe(2_000);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - 1_000);
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS - 1_000);
    expect(openWagers(db, 'ada')).toEqual([{ wager_cents: 1_000, match_id: res.matchId }]);
    expect(playersOf(db, res.matchId)).toEqual([
      { uid: 'ada', seat: 0, ante_cents: 1_000 },
      { uid: 'bob', seat: 1, ante_cents: 1_000 },
    ]);
  });

  it('does NOT bet when there is only one human, however large the ante', () => {
    // A pot made of your own ante handed back is a betting UI that cannot move money. The table
    // still plays — for XP and stats — which is what `modes: ['ai']` is for.
    const db = seeded();
    const res = ok(start(db, [human('ada'), bot(), bot()], 5_000));

    expect(res.potCents).toBe(0);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);
    expect(openWagers(db, 'ada')).toEqual([]);
    expect(res.match.dice).toHaveLength(3);
  });

  it('seats only humans in the players table — a bot has no account to stake', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), bot(), human('cy')], 500));
    expect(playersOf(db, res.matchId).map((p) => p.uid)).toEqual(['ada', 'cy']);
    expect(playersOf(db, res.matchId).map((p) => p.seat)).toEqual([0, 2]);
    expect(res.potCents).toBe(1_000); // two humans, not three seats
  });

  it('refuses the WHOLE start when one player cannot cover the ante, and writes nothing', () => {
    // Nothing is written until nothing can refuse — a `return` out of a better-sqlite3
    // transaction COMMITS, so this is earned by statement order, not given by the transaction.
    const db = seeded();
    const res = start(db, [human('ada'), human('bob')], STARTING_BANKROLL_CENTS + 1);

    expect(res.ok).toBe(false);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS);
    expect(db.prepare('SELECT COUNT(*) AS n FROM liars_dice_matches').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE reason = ?').get('bet')).toEqual({ n: 0 });
  });

  it('gives the nonce back on a refusal, so the same request deals once affordable', () => {
    const db = seeded();
    expect(start(db, [human('ada'), human('bob')], STARTING_BANKROLL_CENTS + 1, 'n7').ok).toBe(false);
    // Same nonce, an affordable ante — must DEAL, not take the replay branch.
    const second = start(db, [human('ada'), human('bob')], 1_000, 'n7');
    expect(second.ok).toBe(true);
    expect(ok(second).replayed).toBe(false);
  });

  it('refuses a start from someone who is not seated at the table', () => {
    const db = seeded();
    const res = startMatch(
      db,
      'cy',
      { nonce: 'n1', gameId: GAME_ID, roomId: 'ROOM', seats: [human('ada'), human('bob')], anteCents: 100 },
      100,
      always(3)
    );
    expect(res.ok).toBe(false);
  });

  it('replays a repeated nonce instead of dealing a second match', () => {
    const db = seeded();
    const first = ok(start(db, [human('ada'), human('bob')], 1_000, 'same'));
    const second = ok(start(db, [human('ada'), human('bob')], 1_000, 'same'));

    expect(second.replayed).toBe(true);
    expect(second.matchId).toBe(first.matchId);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - 1_000); // charged once
    expect(db.prepare('SELECT COUNT(*) AS n FROM liars_dice_matches').get()).toEqual({ n: 1 });
  });
});

/* ------------------------------------------------------------------ authority */

describe('membership is the authority', () => {
  it('refuses to load a match for an account that is not in it', () => {
    // A match id is a small sequential integer, guessable by typing. Blackjack scopes its load by
    // ownership; a match has members instead, so the same rule is a join. Without it, one account
    // could act on another table's match and settle money into it.
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 500));
    expect(loadMatchFor(db, 'ada', res.matchId)).toBeDefined();
    expect(loadMatchFor(db, 'cy', res.matchId)).toBeUndefined();
    expect(seatOf(db, res.matchId, 'cy')).toBe(-1);
  });

  it('refuses an action on a match the caller is not in', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 500));
    const out = playAction(db, 'cy', res.matchId, 'x1', { type: 'bid', quantity: 2, face: 3 }, 200);
    expect(out.ok).toBe(false);
  });

  it('refuses an action from the wrong seat', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 500));
    expect(stateOfMatch(db, res.matchId).turn).toBe(0);
    const out = playAction(db, 'bob', res.matchId, 'x1', { type: 'bid', quantity: 2, face: 3 }, 200);
    expect(out.ok).toBe(false);
    expect(stateOfMatch(db, res.matchId).bid).toBeNull();
  });

  it('refuses an illegal bid and does not burn the nonce', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 500));
    // Opening on wilds is illegal while 1s are wild.
    expect(playAction(db, 'ada', res.matchId, 'x1', { type: 'bid', quantity: 2, face: 1 }, 200).ok).toBe(false);
    // The same nonce must still work for a legal action.
    const good = playAction(db, 'ada', res.matchId, 'x1', { type: 'bid', quantity: 2, face: 3 }, 200);
    expect(good.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ playing + settling */

describe('playAction and the pot', () => {
  it('advances the match and hands the turn on', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 500));
    const out = playAction(db, 'ada', res.matchId, 'a1', { type: 'bid', quantity: 2, face: 3 }, 200);
    expect(out.ok).toBe(true);
    const state = stateOfMatch(db, res.matchId);
    expect(state.bid).toEqual({ quantity: 2, face: 3 });
    expect(state.turn).toBe(1);
  });

  it('pays the WHOLE pot to the winner and closes every wager by match id', () => {
    const db = seeded();
    // Two seats, one die each, so a single challenge ends it.
    const res = ok(start(db, [human('ada'), human('bob')], 1_000));
    const oneEach: LiarsDiceMatch = {
      ...stateOfMatch(db, res.matchId),
      dice: [[3], [5]],
      turn: 0,
    };
    db.prepare('UPDATE liars_dice_matches SET state_json = ? WHERE id = ?').run(
      JSON.stringify(oneEach),
      res.matchId
    );

    // Ada bids two 3s on a two-die table; Bob challenges and is right, so Ada loses her last die.
    playAction(db, 'ada', res.matchId, 'a1', { type: 'bid', quantity: 2, face: 3 }, 200);
    const end = playAction(db, 'bob', res.matchId, 'b1', { type: 'challenge' }, 210);
    expect(end.ok).toBe(true);

    expect(stateOfMatch(db, res.matchId).winner).toBe(1);
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS - 1_000 + 2_000);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - 1_000);
    expect(openWagers(db, 'ada')).toEqual([]);
    expect(openWagers(db, 'bob')).toEqual([]);
  });

  it('records a win for the winner and a loss for everyone else, once each', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 0));
    const oneEach: LiarsDiceMatch = { ...stateOfMatch(db, res.matchId), dice: [[3], [5]], turn: 0 };
    db.prepare('UPDATE liars_dice_matches SET state_json = ? WHERE id = ?').run(JSON.stringify(oneEach), res.matchId);

    playAction(db, 'ada', res.matchId, 'a1', { type: 'bid', quantity: 2, face: 3 }, 200);
    playAction(db, 'bob', res.matchId, 'b1', { type: 'challenge' }, 210);

    const stats = (uid: string) =>
      db.prepare('SELECT played, won, lost FROM stats WHERE uid = ? AND game_id = ?').get(uid, GAME_ID);
    expect(stats('bob')).toEqual({ played: 1, won: 1, lost: 0 });
    expect(stats('ada')).toEqual({ played: 1, won: 0, lost: 1 });
  });

  it('cannot settle twice — a finished match refuses further actions', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 1_000));
    const oneEach: LiarsDiceMatch = { ...stateOfMatch(db, res.matchId), dice: [[3], [5]], turn: 0 };
    db.prepare('UPDATE liars_dice_matches SET state_json = ? WHERE id = ?').run(JSON.stringify(oneEach), res.matchId);

    playAction(db, 'ada', res.matchId, 'a1', { type: 'bid', quantity: 2, face: 3 }, 200);
    playAction(db, 'bob', res.matchId, 'b1', { type: 'challenge' }, 210);
    const after = balanceOf(db, 'bob');

    const again = playAction(db, 'bob', res.matchId, 'b2', { type: 'challenge' }, 220);
    expect(again.ok).toBe(false);
    expect(balanceOf(db, 'bob')).toBe(after);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE reason = ?').get('settle')).toEqual({ n: 1 });
  });

  it('replays a repeated action nonce without moving the match', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 500));
    playAction(db, 'ada', res.matchId, 'a1', { type: 'bid', quantity: 2, face: 3 }, 200);
    const before = stateOfMatch(db, res.matchId);

    const replay = playAction(db, 'ada', res.matchId, 'a1', { type: 'bid', quantity: 9, face: 6 }, 210);
    expect(replay.ok).toBe(true);
    expect(replay.ok && replay.value.replayed).toBe(true);
    expect(stateOfMatch(db, res.matchId)).toEqual(before);
  });
});

/* ------------------------------------------------------------------ the house, and the rounds */

describe('the referee drives the bots and the rounds', () => {
  it('plays an AI turn without any client asking', () => {
    // No host holds this game, so nobody can race the bot or drive it twice.
    const db = seeded();
    const res = ok(start(db, [human('ada'), bot()], 0));
    playAction(db, 'ada', res.matchId, 'a1', { type: 'bid', quantity: 2, face: 3 }, 200);
    expect(stateOfMatch(db, res.matchId).turn).toBe(1);

    const after = playAiTurn(db, res.matchId, 210, always(4));
    expect(after).not.toBeNull();
    expect(stateOfMatch(db, res.matchId).turn === 0 || stateOfMatch(db, res.matchId).phase !== 'bidding').toBe(true);
  });

  it('steps out of a reveal into a fresh round, re-rolling every cup', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob'), human('cy')], 0));
    const mid: LiarsDiceMatch = { ...stateOfMatch(db, res.matchId), dice: [[3], [5], [2, 2]], turn: 0 };
    db.prepare('UPDATE liars_dice_matches SET state_json = ? WHERE id = ?').run(JSON.stringify(mid), res.matchId);

    playAction(db, 'ada', res.matchId, 'a1', { type: 'bid', quantity: 4, face: 3 }, 200);
    playAction(db, 'bob', res.matchId, 'b1', { type: 'challenge' }, 210);
    expect(stateOfMatch(db, res.matchId).phase).toBe('reveal');

    const next = advance(db, res.matchId, 220, always(6));
    expect(next?.phase).toBe('bidding');
    expect(next?.round).toBe(1);
    expect(next?.dice.flat().every((d) => d === 6)).toBe(true);
  });

  it('will not advance a match that is not in a reveal', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 0));
    expect(advance(db, res.matchId, 200, always(3))).toBeNull();
  });
});

/* ------------------------------------------------------------------ the restart problem */

describe('void and the boot sweep', () => {
  it('refunds every ante and closes the wagers', () => {
    // A room lives in the gateway's memory and a match does not, so a restart has no room to
    // reattach anyone to — but the antes have already left the ledger. Refunding is the only
    // option that leaves the ledger balancing.
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 1_500));
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - 1_500);

    const refunded = voidMatch(db, res.matchId, 300);
    expect(refunded).toBe(3_000);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS);
    expect(openWagers(db, 'ada')).toEqual([]);
  });

  it('cannot refund twice, and cannot refund a match that already paid', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 1_000));
    expect(voidMatch(db, res.matchId, 300)).toBe(3_000 - 1_000);
    expect(voidMatch(db, res.matchId, 310)).toBe(0);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);

    const paid = ok(start(db, [human('ada'), human('bob')], 1_000, 'n2'));
    const oneEach: LiarsDiceMatch = { ...stateOfMatch(db, paid.matchId), dice: [[3], [5]], turn: 0 };
    db.prepare('UPDATE liars_dice_matches SET state_json = ? WHERE id = ?').run(JSON.stringify(oneEach), paid.matchId);
    playAction(db, 'ada', paid.matchId, 'a1', { type: 'bid', quantity: 2, face: 3 }, 320);
    playAction(db, 'bob', paid.matchId, 'b1', { type: 'challenge' }, 330);
    const settled = balanceOf(db, 'bob');

    expect(voidMatch(db, paid.matchId, 340)).toBe(0);
    expect(balanceOf(db, 'bob')).toBe(settled);
  });

  it('sweeps every live match at boot and leaves settled ones alone', () => {
    const db = seeded();
    ok(start(db, [human('ada'), human('bob')], 1_000, 'm1'));
    ok(start(db, [human('ada'), human('cy')], 400, 'm2'));

    const swept = sweepAbandonedMatches(db, 400);
    expect(swept.matches).toBe(2);
    expect(swept.refundedCents).toBe(2_000 + 800);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);

    // Idempotent: a second boot finds nothing.
    expect(sweepAbandonedMatches(db, 500)).toEqual({ matches: 0, refundedCents: 0 });
  });

  it('a swept room has no live match left for a reconnecting client to act on', () => {
    const db = seeded();
    ok(start(db, [human('ada'), human('bob')], 1_000));
    expect(liveMatchInRoom(db, GAME_ID, 'ROOM')).toBeDefined();
    sweepAbandonedMatches(db, 400);
    expect(liveMatchInRoom(db, GAME_ID, 'ROOM')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ the old road */

describe('the generic settle road is closed', () => {
  it('refuses a liars-dice settle outright, at any amount', () => {
    // The referee pays this game's pot. Leaving `/settle` open would let a client bet a chip and
    // then claim the 3x default ceiling on a match it never played — the same standing bypass
    // that blackjack's entry closes.
    expect(checkSettle({ gameId: GAME_ID, payoutCents: 0, openWagerCents: 1_000 }).ok).toBe(false);
    expect(checkSettle({ gameId: GAME_ID, payoutCents: 1, openWagerCents: 1_000 }).ok).toBe(false);
    expect(checkSettle({ gameId: GAME_ID, payoutCents: 3_000, openWagerCents: 1_000 }).ok).toBe(false);
    // A game the server does NOT deal still settles the ordinary way.
    expect(checkSettle({ gameId: 'chess', payoutCents: 0, openWagerCents: null }).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ the projection, at the seam */

describe('what leaves the referee', () => {
  it('a stored match holds every cup — absent from the wire, not absent from the game', () => {
    const db = seeded();
    const res = ok(start(db, [human('ada'), human('bob')], 0));
    const stored = stateOfMatch(db, res.matchId);
    expect(stored.dice).toHaveLength(2);
    expect(stored.dice[0]).toHaveLength(5);
    expect(applyAction(stored, 0, { type: 'bid', quantity: 1, face: 2 })).not.toBe(stored);
  });
});
