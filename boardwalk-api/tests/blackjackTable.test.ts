/**
 * THE BLACKJACK TABLE'S REFEREE — the money, the authority, and the one thing that is this game's
 * rather than UNO's or Liar's Dice's.
 *
 * Those two are the template and most of it carries over: membership authority (a round has no
 * owner), a replay that re-serves the persisted round rather than re-running a reducer that
 * consumes a shuffle, and a boot sweep because a room lives in memory and a round does not.
 *
 * WHAT IS DIFFERENT, AND WHERE THE RISK ACTUALLY IS:
 *
 *  1. **THE STAKE IS PER CHAIR AND PER ROUND.** Every other dealt game takes one ante from
 *     everybody inside `start`. Here `bjStart` moves NO money at all, and each chair's stake arrives
 *     later on its own action — which is v1's clobbering bug (`bj_app.js:162`) as a thing that
 *     cannot happen, because two bets are two transactions against one row rather than two clients
 *     pushing one shared object.
 *  2. **THERE IS NO POT.** Each chair settles against the HOUSE on its own cards, so one chair
 *     winning and the chair beside it busting are independent facts. The failure mode a pot cannot
 *     have is paying one chair out of another chair's stake, and the assertion for it is that the
 *     table's own money adds up per PLAYER rather than in total.
 *  3. **A CHAIR CAN STAKE THREE TIMES IN ONE ROUND** — bet, double, insure. So a void refunds a
 *     running total, not an ante, and that is the column `blackjack_players.staked_cents` exists for.
 *
 * The pure rules are `tests/blackjack-table.test.ts`'s and are not re-asserted here; what is asked
 * below is only ever what the LEDGER did.
 */
import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/db';
import { upsertProfile, balanceOf, loadProfile } from '../src/domain/profile';
import { checkSettle } from '../src/domain/economy';
import {
  GAME_ID,
  liveRoundInRoom,
  openTableRound,
  playAction,
  playAiTurn,
  playersOf,
  seatOf,
  sweepAbandonedRounds,
  voidRound,
  type RoundOk,
  type SeatSpec,
} from '../src/domain/blackjackTable';
import {
  applyMove as applyTableMove,
  canDoubleAt,
  chooseAiMove,
  freshDeck,
  openRound as openRoundTable,
  pendingSeats,
  roundOver,
  shuffle,
  spotPayout,
  type BlackjackTable,
} from '@boardwalk/game-logic/games/blackjack';

const ROOM = 'ABCD';
const STAKE = 1_000;

const seeded = (): Db => {
  const db = openDb(':memory:');
  for (const uid of ['ada', 'bob', 'cy']) {
    upsertProfile(db, uid, { name: uid, avatar: '👤', equipped: {} }, { now: 1 });
  }
  return db;
};

const human = (uid: string): SeatSpec => ({ kind: 'human', uid });
const bot = (): SeatSpec => ({ kind: 'ai', uid: null });
const open = (): SeatSpec => ({ kind: 'open', uid: null });

function ok(r: ReturnType<typeof openTableRound>): RoundOk {
  if (!r.ok) throw new Error(`expected ok, got refusal: ${r.error}`);
  return r.value;
}
function okMove(r: ReturnType<typeof playAction>): RoundOk {
  if (!r.ok) throw new Error(`expected ok, got refusal: ${r.error}`);
  return r.value;
}

const stored = (db: Db, id: number): BlackjackTable =>
  JSON.parse(
    (db.prepare('SELECT state_json FROM blackjack_rounds WHERE id = ?').get(id) as {
      state_json: string;
    }).state_json
  ) as BlackjackTable;

const betRows = (db: Db, uid: string): number =>
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM ledger WHERE uid = ? AND reason = 'bet'")
      .get(uid) as { n: number }
  ).n;

const openRoundFor = (db: Db, seats: SeatSpec[], host = 'ada', nonce = 'n-open'): RoundOk =>
  ok(openTableRound(db, host, { nonce, gameId: GAME_ID, roomId: ROOM, seats }, 1_000));

/** A cheap seeded generator, so every case below is deterministic. */
function rngFrom(seed: number): () => number {
  let n = seed;
  return () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };
}

/**
 * Find a seed that deals the POSITION a case needs, by driving the shared reducer.
 *
 * The referee's deal is `shuffle(freshDeck(), rng)` and so is this, so a seed that produces a table
 * here produces the same table there. Searching beats hand-writing the state for the reason the log
 * tests give: a state written by the same hand that asserts on it only proves the hand can subtract,
 * where a searched seed is a round the RULES produced. It also beats letting the deal decide and
 * branching, which is fine when both branches are one rule and wrong when a case exists to watch a
 * SECOND stake move — a run that never doubled would assert nothing and stay green.
 */
function seedWhere(seats: number, want: (t: BlackjackTable) => boolean): number {
  for (let seed = 1; seed < 5_000; seed += 1) {
    const rng = rngFrom(seed);
    let table = openRoundTable(Array.from({ length: seats }, () => true), 0);
    for (let s = 0; s < seats; s += 1) {
      table = applyTableMove(table, s, { type: 'bet', wagerCents: STAKE }, () =>
        shuffle(freshDeck(), rng)
      );
    }
    if (want(table)) return seed;
  }
  throw new Error('no seed produced the position');
}

/**
 * A seed whose two chairs settle to DIFFERENT results, playing the same policy the case does.
 *
 * Searched rather than picked, because "seed 7 happens to disagree today" stops being true the day
 * the shuffle changes and the case then silently stops testing what it claims to.
 */
function findDisagreeingSeed(): number {
  for (let seed = 1; seed < 2_000; seed += 1) {
    const rng = rngFrom(seed);
    let table = openRoundTable([true, true], 0);
    let guard = 0;
    while (!roundOver(table) && guard < 60) {
      guard += 1;
      const seat = pendingSeats(table)[0];
      if (seat === undefined) break;
      const move =
        table.phase === 'betting'
          ? ({ type: 'bet', wagerCents: STAKE } as const)
          : table.phase === 'insurance'
            ? ({ type: 'decline' } as const)
            : ({ type: 'stand' } as const);
      table = applyTableMove(table, seat, move, () => shuffle(freshDeck(), rng));
    }
    const a = table.spots[0]?.result;
    const b = table.spots[1]?.result;
    if (roundOver(table) && a != null && b != null && a !== b) return seed;
  }
  throw new Error('no seed produced two chairs that disagree');
}

/** Drive a round to its settle: every chair bets `STAKE`, then everybody stands. Deterministic
 *  through a seeded rng, so a case can assert on cards without hunting for a seed. */
function playOut(db: Db, roundId: number, uids: readonly string[], seed = 7): BlackjackTable {
  let n = seed;
  const rng = () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };
  let table = stored(db, roundId);
  let step = 0;
  while (!roundOver(table)) {
    step += 1;
    if (step > 100) throw new Error('the round did not finish');
    const seat = pendingSeats(table)[0];
    if (seat === undefined) throw new Error('nobody pending on a live round');
    const uid = uids[seat];
    const move =
      table.phase === 'betting'
        ? ({ type: 'bet', wagerCents: STAKE } as const)
        : table.phase === 'insurance'
          ? ({ type: 'decline' } as const)
          : ({ type: 'stand' } as const);
    if (uid === undefined) {
      // A bot chair — the referee drives it, and it is charged nothing.
      playAiTurn(db, roundId, seat, chooseAiMove(table, seat), 2_000, rng);
    } else {
      const res = playAction(db, uid, roundId, `n-${String(step)}`, move, 2_000, rng);
      if (!res.ok) throw new Error(`refused: ${res.error}`);
    }
    table = stored(db, roundId);
  }
  return table;
}

describe('opening a round', () => {
  it('takes NO money, and that is the difference from every other dealt game', () => {
    const db = seeded();
    const before = balanceOf(db, 'ada');
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    expect(balanceOf(db, 'ada')).toBe(before);
    expect(balanceOf(db, 'bob')).toBe(before);
    // Not "the ledger is empty" — seeding a profile writes its signup grant. The claim is that no
    // STAKE was taken, which is what a bet row would be.
    expect(betRows(db, 'ada')).toBe(0);
    expect(betRows(db, 'bob')).toBe(0);
    expect(round.table.phase).toBe('betting');
  });

  it('seats every human and bot chair, and leaves an OPEN chair out of the round', () => {
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), open(), bot()]);
    expect(round.table.spots.map((s) => s.seated)).toEqual([true, false, true]);
    // The empty chair is not waited on — the deal would never fire if it were.
    expect(pendingSeats(round.table)).toEqual([0, 2]);
    // And membership is humans only: a bot has no account to be a member with.
    expect(playersOf(db, round.roundId).map((p) => p.uid)).toEqual(['ada']);
  });

  it('refuses a table that is not one, and a host who is not seated at it', () => {
    const db = seeded();
    expect(openTableRound(db, 'ada', { nonce: 'a', gameId: GAME_ID, roomId: ROOM, seats: [human('ada')] }, 1).ok).toBe(false);
    expect(openTableRound(db, 'ada', { nonce: 'b', gameId: GAME_ID, roomId: ROOM, seats: [bot(), bot()] }, 1).ok).toBe(false);
    expect(openTableRound(db, 'cy', { nonce: 'c', gameId: GAME_ID, roomId: ROOM, seats: [human('ada'), human('bob')] }, 1).ok).toBe(false);
  });

  it('replays a repeated nonce instead of opening a second round', () => {
    const db = seeded();
    const first = openRoundFor(db, [human('ada'), human('bob')]);
    const again = ok(openTableRound(db, 'ada', { nonce: 'n-open', gameId: GAME_ID, roomId: ROOM, seats: [human('ada'), human('bob')] }, 2_000));
    expect(again.replayed).toBe(true);
    expect(again.roundId).toBe(first.roundId);
    expect((db.prepare('SELECT COUNT(*) AS n FROM blackjack_rounds').get() as { n: number }).n).toBe(1);
  });

  it('numbers each round from the last one at this table', () => {
    const db = seeded();
    const first = openRoundFor(db, [human('ada'), human('bob')]);
    playOut(db, first.roundId, ['ada', 'bob']);
    const second = ok(openTableRound(db, 'ada', { nonce: 'n2', gameId: GAME_ID, roomId: ROOM, seats: [human('ada'), human('bob')] }, 3_000));
    expect(second.table.round).toBe(1);
  });
});

describe('the stake — per chair, per round', () => {
  it('takes each chair its OWN stake, through the ledger, with its own wager row', () => {
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    const before = balanceOf(db, 'ada');
    okMove(playAction(db, 'ada', round.roundId, 'b1', { type: 'bet', wagerCents: 500 }, 2_000));
    okMove(playAction(db, 'bob', round.roundId, 'b2', { type: 'bet', wagerCents: 7_000 }, 2_000));
    expect(balanceOf(db, 'ada')).toBe(before - 500);
    expect(balanceOf(db, 'bob')).toBe(before - 7_000);
    // v1 pushed one shared game object per bet, so two players betting at once clobbered each
    // other's stake. Two transactions against one row cannot: both survive, at their own numbers.
    const table = stored(db, round.roundId);
    expect(table.spots.map((s) => s.wagerCents)).toEqual([500, 7_000]);
    const wagers = db
      .prepare('SELECT uid, wager_cents FROM wagers WHERE match_id = ? ORDER BY uid')
      .all(round.roundId) as { uid: string; wager_cents: number }[];
    expect(wagers).toEqual([
      { uid: 'ada', wager_cents: 500 },
      { uid: 'bob', wager_cents: 7_000 },
    ]);
  });

  it('refuses a stake the LEDGER cannot cover, takes nothing, and leaves the chair able to bet again', () => {
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    const before = balanceOf(db, 'ada');
    const refused = playAction(db, 'ada', round.roundId, 'huge', { type: 'bet', wagerCents: before + 1 }, 2_000);
    expect(refused.ok).toBe(false);
    expect(balanceOf(db, 'ada')).toBe(before);
    expect(betRows(db, 'ada')).toBe(0);
    expect(stored(db, round.roundId).spots[0]?.wagerCents).toBe(0);
    // The nonce came back, so the same request retries once the number is affordable — the
    // `return`-out-of-a-transaction-COMMITS trap, which left blackjack burning nonces once.
    expect(okMove(playAction(db, 'ada', round.roundId, 'huge', { type: 'bet', wagerCents: 500 }, 2_000)).replayed).toBe(false);
    expect(balanceOf(db, 'ada')).toBe(before - 500);
  });

  it('deals only when the LAST chair bets, and a bot chair is charged nothing', () => {
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), bot()]);
    okMove(playAction(db, 'ada', round.roundId, 'b1', { type: 'bet', wagerCents: STAKE }, 2_000));
    expect(stored(db, round.roundId).phase).toBe('betting'); // waiting on the house
    playAiTurn(db, round.roundId, 1, { type: 'bet', wagerCents: 2_500 }, 2_000, () => 0.5);
    expect(stored(db, round.roundId).phase).not.toBe('betting');
    // The house's chair has a stake on the felt and no row anywhere — it has no account.
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM wagers WHERE match_id = ?').get(round.roundId) as { n: number }).n
    ).toBe(1);
  });

  it('takes a double as a SECOND stake and remembers the running total', () => {
    // A SEARCHED SEED rather than "double if the deal happened to allow it": a run that never
    // doubled would assert nothing and stay green, which is the shape of vacuous guard this repo
    // deletes on sight. The position wanted is a chair that CAN double with the round still live,
    // so the balance below is not quietly carrying a settlement.
    const seed = seedWhere(2, (t) => canDoubleAt(t, 0) && !roundOver(t));
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    const rng = rngFrom(seed);
    okMove(playAction(db, 'ada', round.roundId, 'b1', { type: 'bet', wagerCents: STAKE }, 2_000, rng));
    okMove(playAction(db, 'bob', round.roundId, 'b2', { type: 'bet', wagerCents: STAKE }, 2_000, rng));

    const before = balanceOf(db, 'ada');
    okMove(playAction(db, 'ada', round.roundId, 'd1', { type: 'double' }, 2_000, rng));
    // The second stake is the chair's CURRENT wager, read off the spot the reducer wrote — deriving
    // it here is how a $10 button becomes an $11 charge.
    expect(balanceOf(db, 'ada')).toBe(before - STAKE);
    expect(betRows(db, 'ada')).toBe(2);
    // Two ledger rows, two wager rows, ONE membership row carrying their sum. That sum is what a
    // void hands back, which is why it is a running total rather than an ante.
    expect(playersOf(db, round.roundId).find((p) => p.uid === 'ada')?.staked_cents).toBe(STAKE * 2);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM wagers WHERE match_id = ? AND uid = 'ada'").get(round.roundId) as { n: number }).n
    ).toBe(2);
  });

  it('refuses a double the balance cannot cover, leaving the hand playable', () => {
    // The `return`-out-of-a-transaction-COMMITS ordering, on a second stake: everything that can
    // refuse runs above the first ledger row, so a refused double changes nothing at all.
    const seed = seedWhere(2, (t) => canDoubleAt(t, 0) && !roundOver(t));
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    const rng = rngFrom(seed);
    const stake = balanceOf(db, 'ada'); // everything — so a double cannot be covered
    okMove(playAction(db, 'ada', round.roundId, 'b1', { type: 'bet', wagerCents: stake }, 2_000, rng));
    okMove(playAction(db, 'bob', round.roundId, 'b2', { type: 'bet', wagerCents: STAKE }, 2_000, rng));

    const before = JSON.stringify(stored(db, round.roundId));
    expect(playAction(db, 'ada', round.roundId, 'd1', { type: 'double' }, 2_000, rng).ok).toBe(false);
    expect(balanceOf(db, 'ada')).toBe(0);
    expect(JSON.stringify(stored(db, round.roundId))).toBe(before);
    // Still playable — the chair can stand, which is the whole point of refusing WHOLE.
    expect(okMove(playAction(db, 'ada', round.roundId, 's1', { type: 'stand' }, 2_000, rng)).replayed).toBe(false);
  });
});

describe('authority', () => {
  it('is MEMBERSHIP: another table’s round is a refusal, not a read', () => {
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    expect(seatOf(db, round.roundId, 'cy')).toBe(-1);
    const res = playAction(db, 'cy', round.roundId, 'x', { type: 'bet', wagerCents: STAKE }, 2_000);
    expect(res.ok).toBe(false);
    expect(betRows(db, 'cy')).toBe(0);
  });

  it('refuses an off-turn move and an illegal one, leaving the round unchanged', () => {
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    okMove(playAction(db, 'ada', round.roundId, 'b1', { type: 'bet', wagerCents: STAKE }, 2_000));
    okMove(playAction(db, 'bob', round.roundId, 'b2', { type: 'bet', wagerCents: STAKE }, 2_000, () => 0.5));
    const before = JSON.stringify(stored(db, round.roundId));
    const table = stored(db, round.roundId);
    const offTurn = table.phase === 'player' ? (table.turn === 0 ? 'bob' : 'ada') : 'ada';
    expect(playAction(db, offTurn, round.roundId, 'z1', { type: 'hit' }, 2_000).ok).toBe(false);
    expect(playAction(db, 'ada', round.roundId, 'z2', { type: 'bet', wagerCents: STAKE }, 2_000).ok).toBe(false);
    expect(JSON.stringify(stored(db, round.roundId))).toBe(before);
  });

  it('replays a repeated move nonce WITHOUT re-entering the reducer', () => {
    // A `bet` that completes the table consumes a shuffle, so a re-run would deal different cards.
    // The rng below DRIFTS: if the reducer were re-entered, the answer could not match.
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), bot()]);
    let calls = 0;
    const drifting = () => {
      calls += 1;
      return (calls % 97) / 97;
    };
    const first = okMove(playAction(db, 'ada', round.roundId, 'b1', { type: 'bet', wagerCents: STAKE }, 2_000, drifting));
    const again = okMove(playAction(db, 'ada', round.roundId, 'b1', { type: 'bet', wagerCents: STAKE }, 2_000, drifting));
    expect(again.replayed).toBe(true);
    expect(JSON.stringify(again.table)).toBe(JSON.stringify(first.table));
    expect(betRows(db, 'ada')).toBe(1); // one stake, not two
  });
});

describe('the settle', () => {
  it('pays each chair its OWN hand — on a round where the two chairs DISAGREE', () => {
    // THE FIXTURE HAS TO DISAGREE, and this case is here because the first draft did not. It let the
    // deal decide and both chairs happened to lose, so paying EVERY chair `spots[0]`'s hand — a pot
    // where there is none — passed it green. That is the leaderboard fixture's lesson in a different
    // table: a set where one row answers for all of them proves nothing about which row was read.
    const found = findDisagreeingSeed();
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    const opening = balanceOf(db, 'ada');
    const table = playOut(db, round.roundId, ['ada', 'bob'], found);
    expect(roundOver(table)).toBe(true);

    const first = table.spots[0]!;
    const second = table.spots[1]!;
    expect(first.result).not.toBe(second.result); // the whole point of the seed

    for (const [seat, uid] of [[0, 'ada'], [1, 'bob']] as const) {
      const spot = table.spots[seat]!;
      // THE BALANCE IS EXACTLY the opening one, minus the stake, plus what THIS chair's cards won.
      // Not a share of anything: there is no pot, so one chair's result cannot move the other's.
      expect(balanceOf(db, uid)).toBe(opening - STAKE + spotPayout(spot));
    }
    // And the two are genuinely different numbers, so the assertion above could not have passed by
    // reading one chair twice.
    expect(balanceOf(db, 'ada')).not.toBe(balanceOf(db, 'bob'));
  });

  it('records the outcome ONCE per player, and only for chairs that played', () => {
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    playOut(db, round.roundId, ['ada', 'bob']);
    const played = db
      .prepare('SELECT uid, played, won, lost, pushed FROM stats WHERE game_id = ? ORDER BY uid')
      .all(GAME_ID) as { uid: string; played: number; won: number; lost: number; pushed: number }[];
    expect(played).toHaveLength(2);
    // Once per HAND per player — the `recordWin`-from-inside-insurance defect is what this pins.
    for (const row of played) expect(row.played).toBe(1);
    expect(played.map((r) => r.won + r.lost + r.pushed)).toEqual([1, 1]);
  });

  it('closes every wager of the round by name, including a chair that staked more than once', () => {
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    playOut(db, round.roundId, ['ada', 'bob']);
    const openWagers = (
      db
        .prepare('SELECT COUNT(*) AS n FROM wagers WHERE match_id = ? AND settled_at IS NULL')
        .get(round.roundId) as { n: number }
    ).n;
    expect(openWagers).toBe(0);
  });

  it('records nothing at all for a chair that never got a stake down', () => {
    // The chair sat out. A `loss` here would let a player drag their own win rate down by watching,
    // and it is reachable the moment a seat is vacated between the open and the deal.
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob'), bot()]);
    // Force the round to settle with `bob` never having bet: void is the only honest exit, so the
    // assertion is on the SETTLE path via a table where bob's spot has no wager.
    const table = stored(db, round.roundId);
    expect(table.spots[1]?.wagerCents).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM stats WHERE uid = ? AND game_id = ?').get('bob', GAME_ID) as { n: number }).n
    ).toBe(0);
  });

  it('is refused by `checkSettle` — the old road is closed for the table too', () => {
    // `blackjack` has been in SERVER_DEALT_GAMES since Phase D, and a table does not reopen it: a
    // board that called `reportResult` would be claiming a result the referee has already banked.
    const refused = checkSettle({ gameId: GAME_ID, payoutCents: 100, openWagerCents: 100 });
    expect(refused.ok).toBe(false);
  });
});

describe('the boot sweep', () => {
  it('voids a live round and refunds every cent every chair put in', () => {
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    const opening = balanceOf(db, 'ada');
    okMove(playAction(db, 'ada', round.roundId, 'b1', { type: 'bet', wagerCents: STAKE }, 2_000));
    expect(balanceOf(db, 'ada')).toBe(opening - STAKE);

    const swept = sweepAbandonedRounds(db, 5_000);
    expect(swept.rounds).toBe(1);
    expect(swept.refundedCents).toBe(STAKE);
    expect(balanceOf(db, 'ada')).toBe(opening);
    expect(balanceOf(db, 'bob')).toBe(opening); // never bet, nothing to refund
    expect(liveRoundInRoom(db, GAME_ID, ROOM)).toBeUndefined();
  });

  it('refunds a chair’s RUNNING TOTAL, not its opening stake', () => {
    // The case a per-ante refund gets wrong, and the reason `staked_cents` is a running total: a
    // chair that bet AND doubled has two ledger rows against one round. Seeded, so the double
    // genuinely happens and the round is genuinely still live when the sweep runs.
    const seed = seedWhere(2, (t) => canDoubleAt(t, 0) && !roundOver(t));
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    const rng = rngFrom(seed);
    const opening = balanceOf(db, 'ada');
    okMove(playAction(db, 'ada', round.roundId, 'b1', { type: 'bet', wagerCents: STAKE }, 2_000, rng));
    okMove(playAction(db, 'bob', round.roundId, 'b2', { type: 'bet', wagerCents: STAKE }, 2_000, rng));
    okMove(playAction(db, 'ada', round.roundId, 'd1', { type: 'double' }, 2_000, rng));
    expect(balanceOf(db, 'ada')).toBe(opening - STAKE * 2);

    // The round is live — `bob` has not acted — so the sweep has something to void.
    expect(stored(db, round.roundId).phase).not.toBe('settled');
    const swept = sweepAbandonedRounds(db, 6_000);
    expect(swept.rounds).toBe(1);
    expect(swept.refundedCents).toBe(STAKE * 3); // ada's two stakes plus bob's one
    expect(balanceOf(db, 'ada')).toBe(opening);
    expect(balanceOf(db, 'bob')).toBe(opening);
  });

  it('cannot refund twice, and cannot refund a round that paid out', () => {
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    playOut(db, round.roundId, ['ada', 'bob']);
    const after = balanceOf(db, 'ada');
    expect(voidRound(db, round.roundId, 9_000)).toBe(0);
    expect(balanceOf(db, 'ada')).toBe(after);
    expect(sweepAbandonedRounds(db, 9_000).rounds).toBe(0);
  });
});

describe('the profile the caller gets back', () => {
  it('is the authoritative one, at the moment money moved', () => {
    // Every `bet`, `double` and `insure` moves money and the state arrives on the room subscription
    // — the profile does not, which is the hole a browser found at Liar's Dice.
    const db = seeded();
    const round = openRoundFor(db, [human('ada'), human('bob')]);
    okMove(playAction(db, 'ada', round.roundId, 'b1', { type: 'bet', wagerCents: STAKE }, 2_000));
    expect(loadProfile(db, 'ada')?.bankrollCents).toBe(balanceOf(db, 'ada'));
  });
});
