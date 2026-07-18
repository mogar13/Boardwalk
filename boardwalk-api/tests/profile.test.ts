import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/db';
import { balanceOf, leaderboard, loadProfile, saveProfile } from '../src/domain/profile';
import type { Profile } from '../src/domain/types';

const fresh = (over: Partial<Profile> = {}): Profile => ({
  name: 'Ada',
  avatar: '👤',
  bankrollCents: 500_000,
  xp: 0,
  stats: {},
  achievements: {},
  inventory: {},
  daily: { lastClaimDay: 0, streak: 0 },
  ...over,
});

describe('profile persistence', () => {
  it('returns null for an unknown uid', () => {
    const db = openDb(':memory:');
    expect(loadProfile(db, 'nobody')).toBeNull();
  });

  it('round-trips a full profile byte-for-byte', () => {
    const db = openDb(':memory:');
    const p = fresh({
      xp: 4200,
      stats: { chess: { played: 10, won: 6, lost: 3, pushed: 1 } },
      achievements: { big_win: 1_700_000_000_000 },
      inventory: { avatar_robot: true },
      daily: { lastClaimDay: 42, streak: 3 },
    });
    saveProfile(db, 'u1', p, { reason: 'signup', now: 1 });
    expect(loadProfile(db, 'u1')).toEqual(p);
  });

  it('derives bankroll from the ledger, not a stored column', () => {
    const db = openDb(':memory:');
    saveProfile(db, 'u1', fresh({ bankrollCents: 500_000 }), { reason: 'signup', now: 1 });
    expect(balanceOf(db, 'u1')).toBe(500_000);

    // A win moves the balance; only the delta is appended.
    saveProfile(db, 'u1', fresh({ bankrollCents: 512_500 }), { reason: 'sync', now: 2 });
    expect(balanceOf(db, 'u1')).toBe(512_500);
    expect(loadProfile(db, 'u1')?.bankrollCents).toBe(512_500);

    const rows = db.prepare('SELECT delta_cents, reason FROM ledger WHERE uid = ? ORDER BY id').all('u1');
    expect(rows).toEqual([
      { delta_cents: 500_000, reason: 'signup' },
      { delta_cents: 12_500, reason: 'sync' },
    ]);
  });

  it('appends no ledger row when the balance is unchanged (idempotent save)', () => {
    const db = openDb(':memory:');
    saveProfile(db, 'u1', fresh(), { reason: 'signup', now: 1 });
    saveProfile(db, 'u1', fresh({ xp: 99 }), { reason: 'sync', now: 2 });
    const n = db.prepare('SELECT COUNT(*) AS c FROM ledger WHERE uid = ?').get('u1') as { c: number };
    expect(n.c).toBe(1);
  });

  it('handles a losing delta (negative ledger row)', () => {
    const db = openDb(':memory:');
    saveProfile(db, 'u1', fresh({ bankrollCents: 500_000 }), { reason: 'signup', now: 1 });
    saveProfile(db, 'u1', fresh({ bankrollCents: 450_000 }), { reason: 'sync', now: 2 });
    expect(balanceOf(db, 'u1')).toBe(450_000);
    const last = db.prepare('SELECT delta_cents FROM ledger ORDER BY id DESC LIMIT 1').get() as { delta_cents: number };
    expect(last.delta_cents).toBe(-50_000);
  });

  it('replaces stats/achievements/inventory wholesale on re-save', () => {
    const db = openDb(':memory:');
    saveProfile(db, 'u1', fresh({ stats: { chess: { played: 1, won: 1, lost: 0, pushed: 0 } } }), { reason: 'signup', now: 1 });
    saveProfile(db, 'u1', fresh({ stats: { uno: { played: 2, won: 0, lost: 2, pushed: 0 } } }), { reason: 'sync', now: 2 });
    const loaded = loadProfile(db, 'u1');
    expect(loaded?.stats).toEqual({ uno: { played: 2, won: 0, lost: 2, pushed: 0 } });
  });
});

describe('leaderboard', () => {
  it('ranks by summed wins, then xp, with derived balances', () => {
    const db = openDb(':memory:');
    saveProfile(db, 'low', fresh({ name: 'Low', bankrollCents: 100_000, xp: 10, stats: { chess: { played: 1, won: 1, lost: 0, pushed: 0 } } }), { reason: 'signup', now: 1 });
    saveProfile(db, 'high', fresh({ name: 'High', bankrollCents: 900_000, xp: 50, stats: { chess: { played: 9, won: 9, lost: 0, pushed: 0 }, uno: { played: 1, won: 1, lost: 0, pushed: 0 } } }), { reason: 'signup', now: 1 });

    const board = leaderboard(db, 10);
    expect(board.map((e) => e.uid)).toEqual(['high', 'low']);
    expect(board[0]).toEqual({ uid: 'high', name: 'High', avatar: '👤', bankrollCents: 900_000, xp: 50, wins: 10 });
    expect(board[1]?.wins).toBe(1);
  });

  it('includes a player with no stats and no ledger at zero', () => {
    const db = openDb(':memory:');
    saveProfile(db, 'u1', fresh({ bankrollCents: 0 }), { reason: 'signup', now: 1 });
    const board = leaderboard(db, 10);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ uid: 'u1', wins: 0, bankrollCents: 0 });
  });
});
