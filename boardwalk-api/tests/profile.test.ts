import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/db';
import { balanceOf, leaderboard, loadProfile, upsertProfile } from '../src/domain/profile';
import { STARTING_BANKROLL_CENTS } from '../src/domain/economy';
import { applyBet, applySettle } from '../src/domain/mutations';
import type { Equipped } from '../src/domain/types';

/**
 * Profile persistence, PHASE B SEMANTICS. The point of most of these is what the server now
 * REFUSES to take from a client — Phase A's version of this file asserted the opposite (that a
 * whole profile round-tripped byte-for-byte, money included), and that behaviour is exactly what
 * the cut-over had to delete.
 */

const cosmetics = (over: Partial<{ name: string; avatar: string; equipped: Equipped }> = {}) => ({
  name: 'Ada',
  avatar: '👤',
  equipped: {},
  ...over,
});

describe('profile persistence', () => {
  it('returns null for an unknown uid', () => {
    const db = openDb(':memory:');
    expect(loadProfile(db, 'nobody')).toBeNull();
  });

  it('grants the opening bankroll on first upsert, from the SERVER constant', () => {
    const db = openDb(':memory:');
    upsertProfile(db, 'u1', cosmetics(), { now: 1 });

    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
    const rows = db
      .prepare('SELECT delta_cents, reason FROM ledger WHERE uid = ? ORDER BY id')
      .all('u1');
    expect(rows).toEqual([{ delta_cents: STARTING_BANKROLL_CENTS, reason: 'signup' }]);
  });

  it('grants the opening bankroll exactly ONCE, however many times create is replayed', () => {
    const db = openDb(':memory:');
    upsertProfile(db, 'u1', cosmetics(), { now: 1 });
    upsertProfile(db, 'u1', cosmetics({ name: 'Ada Lovelace' }), { now: 2 });
    upsertProfile(db, 'u1', cosmetics(), { now: 3 });

    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
    const n = db.prepare('SELECT COUNT(*) AS c FROM ledger WHERE uid = ?').get('u1') as {
      c: number;
    };
    expect(n.c).toBe(1);
  });

  it('round-trips name, avatar and the equipped cosmetics', () => {
    const db = openDb(':memory:');
    upsertProfile(db, 'u1', cosmetics({ equipped: { cardback: 'cb_red3', title: 'ttl_regular', dice: 'dc_ember' } }), {
      now: 1,
    });
    const loaded = loadProfile(db, 'u1');
    expect(loaded?.name).toBe('Ada');
    expect(loaded?.equipped).toEqual({ cardback: 'cb_red3', title: 'ttl_regular', dice: 'dc_ember' });
  });

  it('an unequipped slot comes back ABSENT, not null — the frontend reads absence', () => {
    const db = openDb(':memory:');
    upsertProfile(db, 'u1', cosmetics({ equipped: { cardback: 'cb_red3' } }), { now: 1 });
    const loaded = loadProfile(db, 'u1');
    expect(loaded?.equipped).toEqual({ cardback: 'cb_red3' });
    expect('title' in (loaded?.equipped ?? {})).toBe(false);
  });

  it('equipping one cosmetic does not drop the other', () => {
    const db = openDb(':memory:');
    upsertProfile(db, 'u1', cosmetics({ equipped: { cardback: 'cb_red3', title: 'ttl_regular', dice: 'dc_ember' } }), {
      now: 1,
    });
    upsertProfile(
      db,
      'u1',
      cosmetics({ equipped: { cardback: 'cb_blue5', title: 'ttl_regular' } }),
      { now: 2 }
    );
    expect(loadProfile(db, 'u1')?.equipped).toEqual({
      cardback: 'cb_blue5',
      title: 'ttl_regular',
    });
  });

  /**
   * THE CUT-OVER ASSERTION. `upsertProfile` has no parameter a balance could arrive in, so this
   * proves the shape rather than a filter: a client that re-saves its cosmetics a thousand times
   * still has exactly the money the ledger gave it. This is BACKEND_PLAN.md's "editing devtools
   * changes nothing durable" for the profile route.
   */
  it('re-saving cosmetics never moves money, XP or stats', () => {
    const db = openDb(':memory:');
    upsertProfile(db, 'u1', cosmetics(), { now: 1 });
    applyBet(db, 'u1', { nonce: 'n1', gameId: 'blackjack', amountCents: 10_000 }, 10);
    applySettle(
      db,
      'u1',
      { nonce: 'n2', gameId: 'blackjack', outcome: 'win', payoutCents: 20_000 },
      11
    );

    const before = loadProfile(db, 'u1');
    for (let i = 0; i < 5; i++) upsertProfile(db, 'u1', cosmetics({ name: `try${i}` }), { now: 20 });
    const after = loadProfile(db, 'u1');

    expect(after?.bankrollCents).toBe(before?.bankrollCents);
    expect(after?.xp).toBe(before?.xp);
    expect(after?.stats).toEqual(before?.stats);
  });
});

describe('leaderboard', () => {
  const seed = (
    db: ReturnType<typeof openDb>,
    uid: string,
    name: string,
    wins: number,
    losses: number
  ) => {
    upsertProfile(db, uid, cosmetics({ name }), { now: 1 });
    let n = 0;
    for (let i = 0; i < wins; i++) {
      applySettle(
        db,
        uid,
        { nonce: `${uid}-w${n++}`, gameId: 'chess', outcome: 'win', payoutCents: 0 },
        2
      );
    }
    for (let i = 0; i < losses; i++) {
      applySettle(
        db,
        uid,
        { nonce: `${uid}-l${n++}`, gameId: 'chess', outcome: 'loss', payoutCents: 0 },
        2
      );
    }
  };

  it('ranks by summed wins, with derived balances and a played denominator', () => {
    const db = openDb(':memory:');
    seed(db, 'low', 'Low', 1, 0);
    seed(db, 'high', 'High', 10, 2);

    const board = leaderboard(db, 10);
    expect(board.map((e) => e.uid)).toEqual(['high', 'low']);
    expect(board[0]).toEqual({
      uid: 'high',
      name: 'High',
      avatar: '👤',
      bankrollCents: STARTING_BANKROLL_CENTS,
      xp: 10 * 100 + 2 * 10,
      wins: 10,
      played: 12,
    });
    expect(board[1]?.wins).toBe(1);
  });

  it('includes a player with no stats at zero wins and zero played', () => {
    const db = openDb(':memory:');
    upsertProfile(db, 'u1', cosmetics(), { now: 1 });
    const board = leaderboard(db, 10);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ uid: 'u1', wins: 0, played: 0 });
  });

  /**
   * THE FOUR BOARDS, SERVER-SIDE. Every case here failed before the ranking moved into
   * `@boardwalk/game-logic`: `leaderboard()` took no `board` argument at all and ended in
   * `ORDER BY wins DESC, p.xp DESC LIMIT ?`, so all four tabs were the wins board.
   *
   * The set is built so the four boards genuinely DISAGREE about who is first — a fixture where
   * the same player tops every board proves nothing, which is the trap that let this ship.
   *   • `grinder`  — most wins, poor, low xp
   *   • `whale`    — richest, few wins
   *   • `leveller` — most xp, middling everything
   *   • `sharp`    — best win rate over a real sample
   *   • `fluke`    — a perfect 1/1 record that must NOT top the skill board
   */
  describe('boards', () => {
    /**
     * Give `uid` a record and a bankroll by betting and settling for real, so every number the
     * boards rank on is one the server itself derived (`stats` sums and a ledger sum) rather than
     * a row poked into a table.
     *
     * NOT `blackjack`. That game is in `SERVER_DEALT_GAMES`, so `checkSettle` refuses it outright
     * and `applySettle` banks nothing — the first draft of this fixture used it and seeded an
     * entirely empty database, which still "passed" the wins assertion because a five-way tie at
     * zero has a first element. A fixture that can be empty and still green is worse than no
     * fixture; `chess` settles through the generic path.
     *
     * `payoutCents` is bounded by `payoutCeiling` at 3× the stake for a non-blackjack game, so the
     * whale gets rich through a big STAKE, not through a big multiple.
     */
    const seedPlayer = (
      db: ReturnType<typeof openDb>,
      uid: string,
      opts: { wins: number; losses: number; wagerCents?: number; payoutCents?: number }
    ) => {
      const wagerCents = opts.wagerCents ?? 100;
      upsertProfile(db, uid, cosmetics({ name: uid }), { now: 1 });
      let n = 0;
      for (let i = 0; i < opts.wins; i++) {
        applyBet(db, uid, { nonce: `${uid}-b${n}`, gameId: 'chess', amountCents: wagerCents }, 2);
        applySettle(
          db,
          uid,
          {
            nonce: `${uid}-w${n++}`,
            gameId: 'chess',
            outcome: 'win',
            payoutCents: opts.payoutCents ?? 0,
          },
          2
        );
      }
      for (let i = 0; i < opts.losses; i++) {
        applySettle(
          db,
          uid,
          { nonce: `${uid}-l${n++}`, gameId: 'chess', outcome: 'loss', payoutCents: 0 },
          2
        );
      }
    };

    /**
     * xp is 100 a win and 10 a loss, which is why `leveller` needs a pile of LOSSES to out-xp
     * `grinder` without out-winning them: 20×100 + 60×10 = 2600 against 25×100 + 5×10 = 2550.
     * That tension is the fixture's whole job — it is what makes the wins board and the level
     * board name different players.
     */
    const seeded = () => {
      const db = openDb(':memory:');
      seedPlayer(db, 'grinder', { wins: 25, losses: 5 }); // most wins; 83% rate
      seedPlayer(db, 'whale', { wins: 4, losses: 6, wagerCents: 10_000, payoutCents: 30_000 });
      seedPlayer(db, 'leveller', { wins: 20, losses: 60 }); // most xp; 25% rate
      seedPlayer(db, 'sharp', { wins: 18, losses: 2 }); // 90% over a real sample
      seedPlayer(db, 'fluke', { wins: 1, losses: 0 }); // 100% over ONE game
      return db;
    };

    it('seeds a database that actually has records in it', () => {
      // Guards the fixture, not the code. The `blackjack` draft above silently seeded nothing and
      // the board assertions still went green on a five-way tie at zero.
      const board = leaderboard(seeded(), 10, 'wins');
      expect(board).toHaveLength(5);
      expect(board.every((e) => e.played > 0)).toBe(true);
    });

    it('ranks each board by its OWN key, and the four disagree', () => {
      const db = seeded();
      expect(leaderboard(db, 10, 'wins')[0]?.uid).toBe('grinder');
      expect(leaderboard(db, 10, 'richest')[0]?.uid).toBe('whale');
      expect(leaderboard(db, 10, 'level')[0]?.uid).toBe('leveller');
      expect(leaderboard(db, 10, 'winRate')[0]?.uid).toBe('sharp');
    });

    it('applies the win-rate floor, so a 1/1 record cannot top the skill board', () => {
      const db = seeded();
      const skill = leaderboard(db, 10, 'winRate');
      // `fluke` is 100% over one game — the highest rate in the set, and absent by rule.
      expect(skill.map((e) => e.uid)).not.toContain('fluke');
      // It is present on every board that has no floor, so this is the FILTER and not a bad seed.
      expect(leaderboard(db, 10, 'wins').map((e) => e.uid)).toContain('fluke');
    });

    it('filters and sorts BEFORE slicing — a limit cannot pre-select the wrong candidates', () => {
      const db = seeded();
      // `whale` has the 4th-most wins of five. Asking for ONE richest row must still find them:
      // the old query sliced in wins order first, so a limit of 1 could only ever return `grinder`.
      const richest = leaderboard(db, 1, 'richest');
      expect(richest).toHaveLength(1);
      expect(richest[0]?.uid).toBe('whale');
    });

    it('serves the wins board for an unknown, empty or absent board id', () => {
      const db = seeded();
      const wins = leaderboard(db, 10, 'wins').map((e) => e.uid);
      // One fallback, in `boardById`. Validating the id here too is how two answers drift.
      expect(leaderboard(db, 10, 'nonsense').map((e) => e.uid)).toEqual(wins);
      expect(leaderboard(db, 10, '').map((e) => e.uid)).toEqual(wins);
      expect(leaderboard(db, 10).map((e) => e.uid)).toEqual(wins);
    });

    it('returns FEWER than the limit when a board filters, rather than padding it', () => {
      const db = openDb(':memory:');
      seedPlayer(db, 'fluke', { wins: 1, losses: 0 });
      // Nobody clears the floor, so the skill board is legitimately empty on a young database —
      // the state the page words as "no one has played enough games to rank yet".
      expect(leaderboard(db, 25, 'winRate')).toEqual([]);
      expect(leaderboard(db, 25, 'wins')).toHaveLength(1);
    });
  });
});
