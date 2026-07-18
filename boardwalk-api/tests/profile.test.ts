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
    upsertProfile(db, 'u1', cosmetics({ equipped: { cardback: 'cb_red3', title: 'ttl_regular' } }), {
      now: 1,
    });
    const loaded = loadProfile(db, 'u1');
    expect(loaded?.name).toBe('Ada');
    expect(loaded?.equipped).toEqual({ cardback: 'cb_red3', title: 'ttl_regular' });
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
    upsertProfile(db, 'u1', cosmetics({ equipped: { cardback: 'cb_red3', title: 'ttl_regular' } }), {
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
});
