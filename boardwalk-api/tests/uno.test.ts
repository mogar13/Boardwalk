/**
 * The UNO referee — the money, the authority, and the two things that are UNO's rather than Liar's
 * Dice's.
 *
 * `liarsDice.test.ts` is the template and most of the shape carries over: membership authority (a
 * match has no owner), a pot built from many stakes and paid once, and a boot sweep because a room
 * lives in memory and a round does not.
 *
 * WHAT IS NEW, AND WHERE THE RISK ACTUALLY IS:
 *
 *  1. **The stake is never on the wire.** `startMatch` takes it as an argument that the DEALER reads
 *     off the room, so there is no request shape here that could carry a stake at all. Asserted
 *     structurally rather than by trying a hostile value.
 *  2. **`applyMove` consumes randomness.** An emptied deck reshuffles mid-move, so a replayed move
 *     re-run against a fresh shuffle would deal a different table. Liar's Dice can say its reducer
 *     takes no rng; UNO cannot, which makes "a replay re-serves the persisted match" load-bearing
 *     rather than tidy.
 *  3. **A round is a match.** UNO plays many rounds at one table, each with its own ante and its own
 *     pot, and the last round's winner opens the next.
 */
import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/db';
import { upsertProfile, balanceOf } from '../src/domain/profile';
import { checkSettle, STARTING_BANKROLL_CENTS } from '../src/domain/economy';
import {
  GAME_ID,
  liveMatchInRoom,
  loadMatchFor,
  playAiTurn,
  playMove,
  playersOf,
  seatOf,
  startMatch,
  sweepAbandonedMatches,
  voidMatch,
  type MatchRow,
  type SeatSpec,
  type StartOk,
} from '../src/domain/uno';
import {
  chooseAiMove,
  placesOf,
  roundOver,
  winnerOf,
  type UnoGame,
  type Move,
} from '@boardwalk/game-logic/games/uno';

const ANTE = 2_500;
const ROOM = 'ABCD';

const seeded = (): Db => {
  const db = openDb(':memory:');
  for (const uid of ['ada', 'bob', 'cy']) {
    upsertProfile(db, uid, { name: uid, avatar: '👤', equipped: {} }, { now: 1 });
  }
  return db;
};

const human = (uid: string): SeatSpec => ({ kind: 'human', uid });
const bot = (): SeatSpec => ({ kind: 'ai', uid: null });

function ok(r: ReturnType<typeof startMatch>): StartOk {
  if (!r.ok) throw new Error(`expected ok, got refusal: ${r.error}`);
  return r.value;
}

interface Stored {
  readonly game: UnoGame;
  readonly eventSeq: number;
  readonly level: string;
}

const stored = (db: Db, id: number): Stored =>
  JSON.parse(
    (db.prepare('SELECT state_json FROM uno_matches WHERE id = ?').get(id) as { state_json: string })
      .state_json
  ) as Stored;

const rowOf = (db: Db, id: number): MatchRow =>
  db
    .prepare('SELECT id, state_json, round, pot_cents, settled FROM uno_matches WHERE id = ?')
    .get(id) as MatchRow;

/** Deal a table. Defaults to two humans at the standard ante — the case that actually bets. */
function dealTable(
  db: Db,
  seats: SeatSpec[] = [human('ada'), human('bob')],
  ante = ANTE,
  nonce = 'n-start',
  houseRules: unknown = {}
): StartOk {
  return ok(
    startMatch(
      db,
      'ada',
      { nonce, gameId: GAME_ID, roomId: ROOM, seats, anteCents: ante, level: 'sharp', houseRules },
      1_000
    )
  );
}

/**
 * A move the seat on turn can legally make.
 *
 * It asks the RULEBOOK's own chooser rather than re-deriving "what is playable" here. The first
 * draft hand-rolled the match (colour, or wild, or same value) and looked right — but an action
 * card's `value` is a sentinel, so two different action cards compared equal and the helper kept
 * proposing an illegal play. `applyMove` is total, so the refusal was a silent no-op on a turn only
 * that seat could take, and the table hung: "no winner in 4000 moves". That is the exact failure
 * CLAUDE.md's "a bot's move must be one the reducer ACCEPTS" rule is about, reproduced in a test
 * helper, and the cure is the same — use the chooser that is already guarded to return a legal move.
 */
function legalMove(game: UnoGame, rng: () => number = Math.random): Move {
  return chooseAiMove(game, game.turn, 'sharp', rng);
}

describe('startMatch — the deal, and the antes', () => {
  it('takes every human ante through the LEDGER and builds the pot from them', () => {
    const db = seeded();
    const res = dealTable(db);
    expect(res.row.pot_cents).toBe(ANTE * 2);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - ANTE);
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS - ANTE);
    // A wager row per human, naming the match, left OPEN until the round settles.
    const open = db
      .prepare('SELECT COUNT(*) AS n FROM wagers WHERE match_id = ? AND settled_at IS NULL')
      .get(res.matchId) as { n: number };
    expect(open.n).toBe(2);
  });

  it('deals seven cards a seat and opens on a number — the rulebook, run by the referee', () => {
    const db = seeded();
    const res = dealTable(db);
    const game = stored(db, res.matchId).game;
    expect(game.hands.map((h) => h.length)).toEqual([7, 7]);
    expect(game.discard).toHaveLength(1);
  });

  it('NOBODY ANTES below two humans — the table plays for XP and stats alone', () => {
    // A bot has no bankroll, so the pot would be this player's own ante handed back. v1 covered the
    // bots from the house instead, which is a grant on a coin flip.
    const db = seeded();
    const res = dealTable(db, [human('ada'), bot(), bot()], ANTE);
    expect(res.row.pot_cents).toBe(0);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);
    const wagers = db.prepare('SELECT COUNT(*) AS n FROM wagers').get() as { n: number };
    expect(wagers.n).toBe(0);
  });

  it('a table at no stake still deals, and moves no money', () => {
    const db = seeded();
    const res = dealTable(db, [human('ada'), human('bob')], 0);
    expect(res.row.pot_cents).toBe(0);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);
  });

  /**
   * AN ANTE NOBODY CAN COVER REFUSES THE WHOLE START, and writes NOTHING.
   *
   * The hazard `blackjack.ts` documents: a `return` out of a better-sqlite3 transaction COMMITS,
   * and only a throw rolls back — so "refuse and change nothing" is earned by the order of the
   * statements, not given. This is the test that the order is right.
   */
  it('refuses the WHOLE start when one player cannot cover, and deals nothing', () => {
    const db = seeded();
    const res = startMatch(
      db,
      'ada',
      {
        nonce: 'n1',
        gameId: GAME_ID,
        roomId: ROOM,
        seats: [human('ada'), human('bob')],
        anteCents: STARTING_BANKROLL_CENTS + 1,
        houseRules: {},
        level: 'sharp',
      },
      1_000
    );
    expect(res.ok).toBe(false);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS);
    expect((db.prepare('SELECT COUNT(*) AS n FROM uno_matches').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM uno_players').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM wagers').get() as { n: number }).n).toBe(0);
    // Not "the ledger is empty" — seeding a profile writes its signup grant, so the baseline is
    // three rows. What must be absent is a STAKE: no `bet` row was written by the refused deal.
    const bets = db
      .prepare("SELECT COUNT(*) AS n FROM ledger WHERE reason = 'bet'")
      .get() as { n: number };
    expect(bets.n).toBe(0);
  });

  it('gives the nonce BACK on a refusal, so the same request works once everyone can cover', () => {
    // Blackjack's bug: a refusal that burns the nonce leaves the host with a one-off error it
    // cannot retry out of.
    const db = seeded();
    const bad = startMatch(
      db,
      'ada',
      {
        nonce: 'same',
        gameId: GAME_ID,
        roomId: ROOM,
        seats: [human('ada'), human('bob')],
        anteCents: STARTING_BANKROLL_CENTS + 1,
        houseRules: {},
        level: 'sharp',
      },
      1_000
    );
    expect(bad.ok).toBe(false);
    const good = dealTable(db, [human('ada'), human('bob')], ANTE, 'same');
    expect(good.replayed).toBe(false);
    expect(good.row.pot_cents).toBe(ANTE * 2);
  });

  it('a replayed deal is the SAME round, not a second one and not a second ante', () => {
    const db = seeded();
    const first = dealTable(db);
    const again = dealTable(db);
    expect(again.replayed).toBe(true);
    expect(again.matchId).toBe(first.matchId);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - ANTE);
    expect((db.prepare('SELECT COUNT(*) AS n FROM uno_matches').get() as { n: number }).n).toBe(1);
  });

  it('refuses a start from somebody not seated at the table', () => {
    const db = seeded();
    const res = startMatch(
      db,
      'cy',
      {
        nonce: 'n1',
        gameId: GAME_ID,
        roomId: ROOM,
        seats: [human('ada'), human('bob')],
        anteCents: ANTE,
        houseRules: {},
        level: 'sharp',
      },
      1_000
    );
    expect(res.ok).toBe(false);
  });
});

describe('authority — a match has no owner, so it has members', () => {
  it('another account cannot load the round, even knowing its id', () => {
    // A match id is a small sequential integer, guessable by typing. Blackjack scopes its load by
    // ownership for that reason; a match has members instead, so the rule becomes a join.
    const db = seeded();
    const res = dealTable(db);
    expect(loadMatchFor(db, 'ada', res.matchId)).toBeDefined();
    expect(loadMatchFor(db, 'cy', res.matchId)).toBeUndefined();
    expect(seatOf(db, res.matchId, 'cy')).toBe(-1);
  });

  it('refuses a move from an account that is not in the round', () => {
    const db = seeded();
    const res = dealTable(db);
    const out = playMove(db, 'cy', res.matchId, 'n', { type: 'draw' }, 2_000);
    expect(out.ok).toBe(false);
  });

  it('refuses a move from the wrong seat', () => {
    const db = seeded();
    const res = dealTable(db);
    const offTurn = res.match.game.turn === 0 ? 'bob' : 'ada';
    const out = playMove(db, offTurn, res.matchId, 'n', { type: 'draw' }, 2_000);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('turn');
  });

  it('refuses an illegal move, and the round is unchanged', () => {
    const db = seeded();
    const res = dealTable(db);
    const onTurn = res.match.game.turn === 0 ? 'ada' : 'bob';
    const before = stored(db, res.matchId);
    const out = playMove(db, onTurn, res.matchId, 'n', { type: 'play', cardId: 'no-such' }, 2_000);
    expect(out.ok).toBe(false);
    expect(stored(db, res.matchId)).toEqual(before);
  });
});

describe('playMove — and the replay rule UNO actually needs', () => {
  it('applies a legal move and persists it', () => {
    const db = seeded();
    const res = dealTable(db);
    const onTurn = res.match.game.turn === 0 ? 'ada' : 'bob';
    const out = playMove(db, onTurn, res.matchId, 'm1', legalMove(res.match.game), 2_000);
    expect(out.ok).toBe(true);
    expect(stored(db, res.matchId).game).not.toEqual(res.match.game);
  });

  /**
   * THE REPLAY RE-SERVES THE PERSISTED ROUND RATHER THAN RE-RUNNING THE REDUCER.
   *
   * This is the case Liar's Dice does not have. `applyMove` takes an rng — an emptied deck
   * reshuffles the discard back in mid-move — so re-running a replayed move would deal a table
   * different from the one the player already saw. Driven with an rng that would produce a
   * DIFFERENT shuffle on the second call, so a re-run would be visible.
   */
  it('a replayed move answers the persisted round, and never re-runs the reducer', () => {
    const db = seeded();
    const res = dealTable(db);
    const onTurn = res.match.game.turn === 0 ? 'ada' : 'bob';
    const move = legalMove(res.match.game);

    let calls = 0;
    const drifting = (): number => {
      calls += 1;
      return (calls % 7) / 7;
    };

    const first = playMove(db, onTurn, res.matchId, 'm1', move, 2_000, drifting);
    expect(first.ok).toBe(true);
    const after = stored(db, res.matchId);
    const callsAfterFirst = calls;

    const replay = playMove(db, onTurn, res.matchId, 'm1', move, 3_000, drifting);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.value.replayed).toBe(true);
    // The reducer was not entered again — the rng was never touched — and the stored round is
    // byte-identical to what the first call produced.
    expect(calls).toBe(callsAfterFirst);
    expect(stored(db, res.matchId)).toEqual(after);
  });

  it('a refused move does not burn the nonce', () => {
    const db = seeded();
    const res = dealTable(db);
    const onTurn = res.match.game.turn === 0 ? 'ada' : 'bob';
    const bad = playMove(db, onTurn, res.matchId, 'reuse', { type: 'play', cardId: 'nope' }, 2_000);
    expect(bad.ok).toBe(false);
    const good = playMove(db, onTurn, res.matchId, 'reuse', legalMove(res.match.game), 2_100);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.replayed).toBe(false);
  });
});

describe('settling — the pot is paid, and the board never claims it', () => {
  /** Play a dealt table out to a winner, driving whoever is on turn. */
  function playToAWinner(db: Db, matchId: number, seatUid: (seat: number) => string | null): void {
    for (let i = 0; i < 4_000; i += 1) {
      const row = rowOf(db, matchId);
      if (row.settled === 1) return;
      const game = stored(db, matchId).game;
      if (roundOver(game)) return;
      const uid = seatUid(game.turn);
      if (uid === null) {
        if (playAiTurn(db, matchId, 2_000 + i) === null) return;
        continue;
      }
      playMove(db, uid, matchId, `m${String(i)}`, legalMove(game), 2_000 + i);
    }
    throw new Error('no winner in 4000 moves');
  }

  it('pays the whole pot to the seat the RULES say won, and closes the wagers', () => {
    const db = seeded();
    const res = dealTable(db);
    playToAWinner(db, res.matchId, (seat) => (seat === 0 ? 'ada' : 'bob'));

    const game = stored(db, res.matchId).game;
    expect(winnerOf(game)).not.toBe(-1);
    const winner = winnerOf(game) === 0 ? 'ada' : 'bob';
    const loser = winnerOf(game) === 0 ? 'bob' : 'ada';

    // The pot was 2 × ante; the winner is up one ante and the loser down one. Money conserved.
    expect(balanceOf(db, winner)).toBe(STARTING_BANKROLL_CENTS + ANTE);
    expect(balanceOf(db, loser)).toBe(STARTING_BANKROLL_CENTS - ANTE);
    const open = db
      .prepare('SELECT COUNT(*) AS n FROM wagers WHERE match_id = ? AND settled_at IS NULL')
      .get(res.matchId) as { n: number };
    expect(open.n).toBe(0);
    expect(rowOf(db, res.matchId).settled).toBe(1);
  });

  it('records the outcome for every human — the reason the board must not report one', () => {
    const db = seeded();
    const res = dealTable(db);
    playToAWinner(db, res.matchId, (seat) => (seat === 0 ? 'ada' : 'bob'));
    const rows = db
      .prepare('SELECT uid, played, won FROM stats WHERE game_id = ? ORDER BY uid')
      .all(GAME_ID) as { uid: string; played: number; won: number }[];
    expect(rows.map((r) => r.uid)).toEqual(['ada', 'bob']);
    expect(rows.reduce((a, r) => a + r.played, 0)).toBe(2);
    expect(rows.reduce((a, r) => a + r.won, 0)).toBe(1);
  });

  /**
   * THE OLD ROAD IS CLOSED, in the same commit that opened the new one.
   *
   * Without this a client could bet a chip and claim the 3× default ceiling on a round it never
   * played — and note that UNO's honest payout ALREADY exceeds that ceiling (a 4-seat table pays
   * 4×), so this game could not have stayed on the generic road even if every client were trusted.
   */
  it('checkSettle refuses uno outright — the dealer settles it', () => {
    const res = checkSettle({
      gameId: 'uno',
      payoutCents: ANTE * 4, // a 4-seat table's honest pot, which is already 4× the 3× ceiling
      openWagerCents: ANTE,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('dealer');
  });

  it('a bot can win, and the pot then goes to nobody — the humans simply lose their antes', () => {
    // Reachable in the real game: a player leaves and their seat is handed to the house. The pot
    // must not be paid to a seat with no account, and must not be paid twice looking for one.
    const db = seeded();
    const res = dealTable(db, [human('ada'), human('bob'), bot()], ANTE);
    playToAWinner(db, res.matchId, (seat) => (seat === 0 ? 'ada' : seat === 1 ? 'bob' : null));
    const game = stored(db, res.matchId).game;
    if (winnerOf(game) !== 2) return; // a human won this deal; the assertion below is for the bot case
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - ANTE);
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS - ANTE);
  });
});

/**
 * RANKED PLACES — slice 3, and the half of it that moves money.
 *
 * `potSplit`'s arithmetic is proved in `tests/uno-places.test.ts`, where it is pure. What can only
 * be asked here is whether the REFEREE hands it the right list: the paying seats, in the order they
 * went out. Get that wrong and every share is computed correctly and paid to the wrong person.
 */
describe('settling a ranked round — the pot splits, and only 1st is a win', () => {
  const RANKED = { playToLast: true };

  /** Play a dealt table until the podium is complete, driving whoever is on turn. */
  function playToTheEnd(db: Db, matchId: number, seatUid: (seat: number) => string | null): void {
    for (let i = 0; i < 8_000; i += 1) {
      const row = rowOf(db, matchId);
      if (row.settled === 1) return;
      const game = stored(db, matchId).game;
      if (roundOver(game)) return;
      const uid = seatUid(game.turn);
      if (uid === null) {
        if (playAiTurn(db, matchId, 2_000 + i) === null) return;
        continue;
      }
      playMove(db, uid, matchId, `r${String(i)}`, legalMove(game), 2_000 + i);
    }
    throw new Error('no complete podium in 8000 moves');
  }

  it('does not settle when FIRST place goes out — the table is still playing', () => {
    // The failure this guards is paying the pot with two players still holding cards. It is only
    // visible on a table big enough for the two moments to be different.
    const db = seeded();
    const res = dealTable(db, [human('ada'), human('bob'), human('cy')], ANTE, 'n-rank1', RANKED);
    for (let i = 0; i < 8_000; i += 1) {
      const game = stored(db, res.matchId).game;
      if (placesOf(game).length >= 1) break;
      const uid = ['ada', 'bob', 'cy'][game.turn] ?? 'ada';
      playMove(db, uid, res.matchId, `k${String(i)}`, legalMove(game), 3_000 + i);
    }
    const mid = stored(db, res.matchId).game;
    expect(placesOf(mid)).toHaveLength(1);
    expect(roundOver(mid)).toBe(false);
    expect(rowOf(db, res.matchId).settled).toBe(0); // nothing paid yet
    for (const uid of ['ada', 'bob', 'cy']) {
      expect(balanceOf(db, uid)).toBe(STARTING_BANKROLL_CENTS - ANTE);
    }
  });

  it('splits the pot by placement and CONSERVES it, paying only the top half', () => {
    const db = seeded();
    const seats = [human('ada'), human('bob'), human('cy')];
    const res = dealTable(db, seats, ANTE, 'n-rank2', RANKED);
    playToTheEnd(db, res.matchId, (seat) => ['ada', 'bob', 'cy'][seat] ?? null);

    const game = stored(db, res.matchId).game;
    const podium = placesOf(game);
    expect(podium).toHaveLength(3);
    const uidAt = (place: number): string => ['ada', 'bob', 'cy'][podium[place]!]!;

    // Three payers → `floor(3/2)` is 1 paid place, so the winner still takes the lot. That is not a
    // special case: it is the ladder, and it is why turning places on does not re-price a small
    // table under anyone.
    expect(balanceOf(db, uidAt(0))).toBe(STARTING_BANKROLL_CENTS + ANTE * 2);
    expect(balanceOf(db, uidAt(1))).toBe(STARTING_BANKROLL_CENTS - ANTE);
    expect(balanceOf(db, uidAt(2))).toBe(STARTING_BANKROLL_CENTS - ANTE);

    // The property, stated as one: the table's money is exactly where it started.
    const total = ['ada', 'bob', 'cy'].reduce((sum, uid) => sum + balanceOf(db, uid), 0);
    expect(total).toBe(STARTING_BANKROLL_CENTS * 3);
    const open = db
      .prepare('SELECT COUNT(*) AS n FROM wagers WHERE match_id = ? AND settled_at IS NULL')
      .get(res.matchId) as { n: number };
    expect(open.n).toBe(0);
  });

  it('records ONE win — placing 2nd of 3 is not a win', () => {
    // Inventing a half-win would put a second meaning into a number four leaderboards already rank.
    const db = seeded();
    const res = dealTable(
      db,
      [human('ada'), human('bob'), human('cy')],
      ANTE,
      'n-rank3',
      RANKED
    );
    playToTheEnd(db, res.matchId, (seat) => ['ada', 'bob', 'cy'][seat] ?? null);
    const rows = db
      .prepare('SELECT uid, played, won, lost FROM stats WHERE game_id = ? ORDER BY uid')
      .all(GAME_ID) as { uid: string; played: number; won: number; lost: number }[];
    expect(rows).toHaveLength(3);
    expect(rows.reduce((a, r) => a + r.played, 0)).toBe(3);
    expect(rows.reduce((a, r) => a + r.won, 0)).toBe(1);
    expect(rows.reduce((a, r) => a + r.lost, 0)).toBe(2);
    const winner = ['ada', 'bob', 'cy'][winnerOf(stored(db, res.matchId).game)];
    expect(rows.find((r) => r.uid === winner)?.won).toBe(1);
  });

  it('gives a BOT on the podium nothing, and still pays the whole pot out', () => {
    // A bot placed 1st would take the winner's share of money it never staked. It is simply not on
    // the paying ladder — the pot is split among the seats that PAID and PLACED — so the humans'
    // own money still lands entirely on humans.
    const db = seeded();
    const res = dealTable(
      db,
      [human('ada'), human('bob'), bot(), bot()],
      ANTE,
      'n-rank4',
      RANKED
    );
    playToTheEnd(db, res.matchId, (seat) => (seat === 0 ? 'ada' : seat === 1 ? 'bob' : null));

    const podium = placesOf(stored(db, res.matchId).game);
    expect(podium).toHaveLength(4);
    // Two payers → one paid place: whichever human placed better takes both antes.
    const humansInOrder = podium.filter((seat) => seat < 2);
    const best = humansInOrder[0] === 0 ? 'ada' : 'bob';
    const rest = best === 'ada' ? 'bob' : 'ada';
    expect(balanceOf(db, best)).toBe(STARTING_BANKROLL_CENTS + ANTE);
    expect(balanceOf(db, rest)).toBe(STARTING_BANKROLL_CENTS - ANTE);
    expect(balanceOf(db, 'ada') + balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS * 2);
  });
});

describe('rounds — a table plays many, and each is its own pot', () => {
  it('the next round antes again, and the LAST round’s winner opens it', () => {
    const db = seeded();
    const first = dealTable(db);
    // Settle round one by hand — the leader rule is what is under test, not the play.
    const won: UnoGame = { ...first.match.game, finished: [1] };
    db.prepare('UPDATE uno_matches SET state_json = ?, settled = 1 WHERE id = ?').run(
      JSON.stringify({ ...first.match, game: won }),
      first.matchId
    );

    const second = dealTable(db, [human('ada'), human('bob')], ANTE, 'n-start-2');
    expect(second.matchId).not.toBe(first.matchId);
    expect(second.row.round).toBe(1);
    expect(second.match.game.turn).toBe(1); // seat 1 won round one, so seat 1 leads round two
    // And it took a second ante: both players are down two antes now, pot is a fresh 2×.
    expect(second.row.pot_cents).toBe(ANTE * 2);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS - ANTE * 2);
  });

  it('the live round in a room is the unsettled one', () => {
    const db = seeded();
    const first = dealTable(db);
    expect(liveMatchInRoom(db, GAME_ID, ROOM)?.id).toBe(first.matchId);
    voidMatch(db, first.matchId, 3_000);
    expect(liveMatchInRoom(db, GAME_ID, ROOM)).toBeUndefined();
  });
});

describe('void and the boot sweep — a restart must refund, never strand', () => {
  it('refunds every ante and closes the wagers', () => {
    const db = seeded();
    const res = dealTable(db);
    const refunded = voidMatch(db, res.matchId, 3_000);
    expect(refunded).toBe(ANTE * 2);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);
    expect(balanceOf(db, 'bob')).toBe(STARTING_BANKROLL_CENTS);
    const open = db
      .prepare('SELECT COUNT(*) AS n FROM wagers WHERE settled_at IS NULL')
      .get() as { n: number };
    expect(open.n).toBe(0);
  });

  it('cannot refund twice, and cannot refund a round that was paid', () => {
    const db = seeded();
    const res = dealTable(db);
    expect(voidMatch(db, res.matchId, 3_000)).toBe(ANTE * 2);
    expect(voidMatch(db, res.matchId, 4_000)).toBe(0);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);
  });

  it('the boot sweep voids every live round and refunds it', () => {
    const db = seeded();
    dealTable(db);
    const swept = sweepAbandonedMatches(db, 5_000);
    expect(swept.matches).toBe(1);
    expect(swept.refundedCents).toBe(ANTE * 2);
    expect(balanceOf(db, 'ada')).toBe(STARTING_BANKROLL_CENTS);
    // And a second boot does nothing — the flag is terminal.
    expect(sweepAbandonedMatches(db, 6_000).matches).toBe(0);
  });

  it('players are recorded per round, with what they actually staked', () => {
    const db = seeded();
    const res = dealTable(db, [human('ada'), human('bob'), bot()], ANTE);
    expect(playersOf(db, res.matchId)).toEqual([
      { uid: 'ada', seat: 0, ante_cents: ANTE },
      { uid: 'bob', seat: 1, ante_cents: ANTE },
    ]);
  });
});

describe('house rules — the table decides, and the match remembers', () => {
  /**
   * SLICE 1 of plans/UNO_HOUSE_RULES.md. Every rule ships OFF, so nothing here asserts what
   * stacking or ranked places DO — they are not built. What it pins is the road they will travel:
   * the rules come off the ROOM (never a frame), are stamped onto the round at the deal, and stay
   * with that round for the whole of its life.
   */
  it("stamps the room's rules onto the dealt match, RESOLVED", () => {
    const db = seeded();
    const res = dealTable(db, [human('ada'), human('bob')], ANTE, 'n1', {
      stack: true,
      playToLast: true,
      nonsense: true,
    });
    // Through the SHARED resolver rather than stored raw: an id the rulebook does not read is gone
    // by the time it reaches the game, and every id it does read is present as a real boolean.
    expect(res.match.game.houseRules).toEqual({
      stack: true,
      crossStack: false,
      playToLast: true,
    });
  });

  it('SURVIVES THE ROW — a round is played under the rules it was dealt with', () => {
    /**
     * The rules live in `uno_matches.state_json`, which makes this the restart property too: the
     * process can die between two moves and the round comes back playing the same game. Had they
     * been left on the ROOM instead, a restart — which clears every room, since rooms are in
     * memory and matches are not — would resume a stacking match with stacking off.
     */
    const db = seeded();
    const res = dealTable(db, [human('ada'), human('bob')], ANTE, 'n1', { stack: true });
    expect(stored(db, res.matchId).game.houseRules).toEqual({
      stack: true,
      crossStack: false,
      playToLast: false,
    });
  });

  it('a table that agreed to nothing is exactly the table that already existed', () => {
    const db = seeded();
    expect(dealTable(db).match.game.houseRules).toEqual({
      stack: false,
      crossStack: false,
      playToLast: false,
    });
  });

  it('never throws on a rule bag from the wire, whatever it turns out to be', () => {
    // `StartInput.houseRules` is `unknown` because that is honestly what arrives — a bag the room
    // store bounded but did not interpret. A deal that THROWS takes the table down; a deal that
    // resolves garbage to defaults plays UNO.
    const db = seeded();
    const junk: unknown[] = [null, undefined, 42, 'stack', [], { stack: 'yes' }];
    junk.forEach((raw, i) => {
      const res = dealTable(db, [human('ada'), human('bob')], 0, `j${String(i)}`, raw);
      expect(res.match.game.houseRules.stack).toBe(false);
    });
  });
});

