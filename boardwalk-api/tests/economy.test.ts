import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/db';
import { balanceOf, loadProfile, upsertProfile } from '../src/domain/profile';
import {
  DAY_MS,
  PRICES_CENTS,
  STARTING_BANKROLL_CENTS,
  checkBet,
  checkDaily,
  checkPurchase,
  checkSettle,
  payoutCeiling,
} from '../src/domain/economy';
import {
  applyBet,
  applyDaily,
  applyPurchase,
  applySettle,
  type SettleInput,
} from '../src/domain/mutations';

/**
 * PHASE B'S CENTRAL CLAIM, under test: the client cannot move its own money.
 *
 * Every `expect(...ok).toBe(false)` here is an attack the Phase-A server would have accepted
 * without blinking, because Phase A's job was to mirror a client-authoritative economy faithfully.
 * The tests that matter most are the refusals, not the happy paths.
 */

const seeded = (): Db => {
  const db = openDb(':memory:');
  upsertProfile(db, 'u1', { name: 'Ada', avatar: '👤', equipped: {} }, { now: 1 });
  return db;
};

/* --------------------------------------------------------- pure decisions */

describe('checkBet', () => {
  it('accepts a positive bet the balance covers', () => {
    expect(checkBet({ amountCents: 1_000, balanceCents: 5_000 })).toEqual({
      ok: true,
      value: { amountCents: 1_000 },
    });
  });

  it('accepts a bet for exactly the whole balance', () => {
    expect(checkBet({ amountCents: 5_000, balanceCents: 5_000 }).ok).toBe(true);
  });

  it('refuses a bet one cent over the balance', () => {
    expect(checkBet({ amountCents: 5_001, balanceCents: 5_000 }).ok).toBe(false);
  });

  it('refuses zero, negative, and non-finite bets', () => {
    expect(checkBet({ amountCents: 0, balanceCents: 5_000 }).ok).toBe(false);
    expect(checkBet({ amountCents: -100, balanceCents: 5_000 }).ok).toBe(false);
    expect(checkBet({ amountCents: Number.NaN, balanceCents: 5_000 }).ok).toBe(false);
    expect(checkBet({ amountCents: Number.POSITIVE_INFINITY, balanceCents: 5_000 }).ok).toBe(false);
  });

  it('refuses a bet too large to be a safe integer (the overflow dodge)', () => {
    expect(checkBet({ amountCents: 1e300, balanceCents: 1e301 }).ok).toBe(false);
  });
});

describe('checkSettle', () => {
  it('caps a blackjack payout at the 3:2 natural (2.5x the stake)', () => {
    expect(payoutCeiling('blackjack', 1_000)).toBe(2_500);
    expect(checkSettle({ gameId: 'blackjack', payoutCents: 2_500, openWagerCents: 1_000 }).ok).toBe(
      true
    );
    expect(checkSettle({ gameId: 'blackjack', payoutCents: 2_501, openWagerCents: 1_000 }).ok).toBe(
      false
    );
  });

  it('refuses ANY payout with no open wager — the mint', () => {
    expect(checkSettle({ gameId: 'blackjack', payoutCents: 1, openWagerCents: null }).ok).toBe(
      false
    );
    expect(
      checkSettle({ gameId: 'blackjack', payoutCents: 1_000_000, openWagerCents: null }).ok
    ).toBe(false);
  });

  it('allows a ZERO payout with no wager — the non-betting games settle this way', () => {
    expect(checkSettle({ gameId: 'chess', payoutCents: 0, openWagerCents: null }).ok).toBe(true);
  });

  it('refuses a negative payout', () => {
    expect(checkSettle({ gameId: 'chess', payoutCents: -1, openWagerCents: 100 }).ok).toBe(false);
  });
});

describe('checkPurchase', () => {
  it('refuses an earn-only item at ANY balance', () => {
    expect(PRICES_CENTS.ttl_grandmaster).toBeNull();
    const d = checkPurchase({
      itemId: 'ttl_grandmaster',
      balanceCents: 999_999_999,
      owned: false,
    });
    expect(d.ok).toBe(false);
  });

  it('refuses an unknown item id', () => {
    expect(checkPurchase({ itemId: 'av_nonexistent', balanceCents: 1e9, owned: false }).ok).toBe(
      false
    );
  });

  it('refuses an item already owned, and one the balance cannot cover', () => {
    expect(checkPurchase({ itemId: 'av_cowboy', balanceCents: 1e9, owned: true }).ok).toBe(false);
    expect(checkPurchase({ itemId: 'av_cowboy', balanceCents: 99_999, owned: false }).ok).toBe(
      false
    );
  });

  it('accepts a free starter at a zero balance', () => {
    expect(checkPurchase({ itemId: 'av_smile', balanceCents: 0, owned: false }).ok).toBe(true);
  });
});

describe('checkDaily', () => {
  const day = (n: number) => n * DAY_MS + 1_000;

  it('pays day one, then refuses a second claim the same day', () => {
    const first = checkDaily({ lastClaimDay: 0, streak: 0 }, day(100));
    expect(first).toMatchObject({ ok: true, value: { rewardCents: 50_000 } });
    expect(checkDaily({ lastClaimDay: 100, streak: 1 }, day(100)).ok).toBe(false);
  });

  it('climbs the streak on a consecutive day and caps at day seven', () => {
    expect(checkDaily({ lastClaimDay: 100, streak: 1 }, day(101))).toMatchObject({
      ok: true,
      value: { state: { streak: 2 }, rewardCents: 75_000 },
    });
    expect(checkDaily({ lastClaimDay: 100, streak: 20 }, day(101))).toMatchObject({
      value: { rewardCents: 500_000 },
    });
  });

  it('resets the streak after a gap', () => {
    expect(checkDaily({ lastClaimDay: 100, streak: 6 }, day(103))).toMatchObject({
      value: { state: { streak: 1 }, rewardCents: 50_000 },
    });
  });

  /**
   * The cheat this route exists to kill. A client that winds its clock back cannot re-open the
   * claim — and because the route never accepts a timestamp at all, it cannot even try.
   */
  it('refuses a claim from a wound-back clock', () => {
    expect(checkDaily({ lastClaimDay: 500, streak: 3 }, day(400)).ok).toBe(false);
  });
});

/* ------------------------------------------------------- the transactions */

describe('applyBet', () => {
  it('deducts the stake and opens a wager', () => {
    const db = seeded();
    const r = applyBet(db, 'u1', { nonce: 'n1', gameId: 'blackjack', amountCents: 10_000 }, 5);
    expect(r.ok).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 10_000);
    const open = db
      .prepare('SELECT COUNT(*) AS c FROM wagers WHERE uid = ? AND settled_at IS NULL')
      .get('u1') as { c: number };
    expect(open.c).toBe(1);
  });

  it('refuses a bet beyond the LEDGER balance, whatever the client believes', () => {
    const db = seeded();
    const r = applyBet(
      db,
      'u1',
      { nonce: 'n1', gameId: 'blackjack', amountCents: STARTING_BANKROLL_CENTS + 1 },
      5
    );
    expect(r.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
  });

  it('a replayed nonce deducts NOTHING and returns the same balance', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'same', gameId: 'blackjack', amountCents: 10_000 }, 5);
    const again = applyBet(db, 'u1', { nonce: 'same', gameId: 'blackjack', amountCents: 10_000 }, 6);

    expect(again).toMatchObject({ ok: true, value: { replayed: true } });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 10_000);
    const n = db
      .prepare("SELECT COUNT(*) AS c FROM ledger WHERE uid = ? AND reason = 'bet'")
      .get('u1') as { c: number };
    expect(n.c).toBe(1);
  });

  it('a nonce is scoped per uid — one player cannot burn another\'s', () => {
    const db = seeded();
    upsertProfile(db, 'u2', { name: 'Bob', avatar: '👤', equipped: {} }, { now: 1 });
    applyBet(db, 'u1', { nonce: 'shared', gameId: 'blackjack', amountCents: 10_000 }, 5);
    const other = applyBet(db, 'u2', { nonce: 'shared', gameId: 'blackjack', amountCents: 10_000 }, 5);
    expect(other).toMatchObject({ ok: true, value: { replayed: false } });
    expect(balanceOf(db, 'u2')).toBe(STARTING_BANKROLL_CENTS - 10_000);
  });
});

describe('applySettle', () => {
  it('credits a bounded payout, closes the wager, and bumps the stat and XP', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'b', gameId: 'blackjack', amountCents: 10_000 }, 5);
    const r = applySettle(
      db,
      'u1',
      { nonce: 's', gameId: 'blackjack', outcome: 'win', payoutCents: 20_000 },
      6
    );

    expect(r.ok).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS + 10_000);
    const p = loadProfile(db, 'u1');
    expect(p?.stats.blackjack).toEqual({ played: 1, won: 1, lost: 0, pushed: 0 });
    expect(p?.xp).toBe(100);
  });

  /** The headline attack: settle with no stake, asking for a fortune. */
  it('refuses a payout with no open wager', () => {
    const db = seeded();
    const r = applySettle(
      db,
      'u1',
      { nonce: 's', gameId: 'blackjack', outcome: 'win', payoutCents: 1_000_000 },
      6
    );
    expect(r.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
  });

  it('refuses a payout above the ceiling and leaves the wager OPEN', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'b', gameId: 'blackjack', amountCents: 10_000 }, 5);
    const r = applySettle(
      db,
      'u1',
      { nonce: 's', gameId: 'blackjack', outcome: 'win', payoutCents: 25_001 },
      6
    );
    expect(r.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 10_000);
    const open = db
      .prepare('SELECT COUNT(*) AS c FROM wagers WHERE uid = ? AND settled_at IS NULL')
      .get('u1') as { c: number };
    expect(open.c).toBe(1);
  });

  it('one wager pays out ONCE — a second settle finds no open stake', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'b', gameId: 'blackjack', amountCents: 10_000 }, 5);
    applySettle(db, 'u1', { nonce: 's1', gameId: 'blackjack', outcome: 'win', payoutCents: 20_000 }, 6);
    const second = applySettle(
      db,
      'u1',
      { nonce: 's2', gameId: 'blackjack', outcome: 'win', payoutCents: 20_000 },
      7
    );
    expect(second.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS + 10_000);
  });

  it('a replayed settle nonce credits nothing and does not double the stat', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'b', gameId: 'blackjack', amountCents: 10_000 }, 5);
    applySettle(db, 'u1', { nonce: 'same', gameId: 'blackjack', outcome: 'win', payoutCents: 20_000 }, 6);
    const again = applySettle(
      db,
      'u1',
      { nonce: 'same', gameId: 'blackjack', outcome: 'win', payoutCents: 20_000 },
      7
    );

    expect(again).toMatchObject({ ok: true, value: { replayed: true } });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS + 10_000);
    expect(loadProfile(db, 'u1')?.stats.blackjack).toEqual({
      played: 1,
      won: 1,
      lost: 0,
      pushed: 0,
    });
  });

  it('a non-betting game settles at zero payout and still earns XP and a stat', () => {
    const db = seeded();
    const r = applySettle(db, 'u1', { nonce: 's', gameId: 'chess', outcome: 'win', payoutCents: 0 }, 6);
    expect(r.ok).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
    expect(loadProfile(db, 'u1')?.xp).toBe(100);
  });

  it('XP and stat counts come from the OUTCOME, never from the wire', () => {
    const db = seeded();
    applySettle(db, 'u1', { nonce: 'a', gameId: 'chess', outcome: 'loss', payoutCents: 0 }, 6);
    applySettle(db, 'u1', { nonce: 'b', gameId: 'chess', outcome: 'push', payoutCents: 0 }, 7);
    const p = loadProfile(db, 'u1');
    expect(p?.xp).toBe(10 + 20);
    expect(p?.stats.chess).toEqual({ played: 2, won: 0, lost: 1, pushed: 1 });
  });

  /**
   * PHASE D: the server decides which badges were earned, and the request has nowhere to ask.
   *
   * Through Phase B this test asserted the opposite — that `unlockedAchievementIds` and
   * `grantedItemIds` were recorded as handed. That was the honest residual of a catalogue the
   * server could not see. It can see it now (`@boardwalk/game-logic`), so the fields are gone and
   * these tests are their replacement: the badge lands because the player won, and a client that
   * asks for one gets nothing.
   */
  it('awards first_win itself, on a real win, with nobody reporting it', () => {
    const db = seeded();
    applySettle(db, 'u1', { nonce: 'a', gameId: 'chess', outcome: 'win', payoutCents: 0 }, 6);
    // `chess_bronze` too, and that is the point: the server evaluates the WHOLE catalogue against
    // the state it owns — including the per-game mastery chain, which reads the chess win count
    // out of the `stats` row this same transaction just wrote.
    expect(Object.keys(loadProfile(db, 'u1')?.achievements ?? {}).sort()).toEqual([
      'chess_bronze',
      'first_win',
    ]);
  });

  it('does NOT award first_win on a loss — the predicate is asked about real state', () => {
    const db = seeded();
    applySettle(db, 'u1', { nonce: 'a', gameId: 'chess', outcome: 'loss', payoutCents: 0 }, 6);
    expect(loadProfile(db, 'u1')?.achievements).toEqual({});
  });

  it('unlocks once and never revokes — a second win does not duplicate or drop it', () => {
    const db = seeded();
    applySettle(db, 'u1', { nonce: 'a', gameId: 'chess', outcome: 'win', payoutCents: 0 }, 6);
    applySettle(db, 'u1', { nonce: 'b', gameId: 'chess', outcome: 'win', payoutCents: 0 }, 7);
    const p = loadProfile(db, 'u1');
    expect(Object.keys(p?.achievements ?? {}).sort()).toEqual(['chess_bronze', 'first_win']);
    // The timestamp is the FIRST unlock, not the latest — `INSERT OR IGNORE`, not upsert.
    expect(p?.achievements.first_win).toBe(6);
  });

  it('a replayed settle nonce does not re-award or re-grant', () => {
    const db = seeded();
    applySettle(db, 'u1', { nonce: 'a', gameId: 'chess', outcome: 'win', payoutCents: 0 }, 6);
    const before = loadProfile(db, 'u1');
    const again = applySettle(
      db,
      'u1',
      { nonce: 'a', gameId: 'chess', outcome: 'win', payoutCents: 0 },
      9
    );
    expect(again.ok && again.value.replayed).toBe(true);
    expect(loadProfile(db, 'u1')).toEqual(before);
  });

  /**
   * THE FORGERY, ATTEMPTED. `ttl_grandmaster` is earn-only — the store refuses to sell it at any
   * price, and only the Platinum rung of the chess mastery chain grants it. A Phase-B client
   * could name it in `grantedItemIds` and be believed. This body carries every field that used to
   * work, plus the chain ids themselves through the feats channel.
   */
  it('refuses a forged badge, a forged grant, and a chain id smuggled through feats', () => {
    const db = seeded();
    applySettle(
      db,
      'u1',
      {
        nonce: 'a',
        gameId: 'chess',
        outcome: 'loss',
        payoutCents: 0,
        // `recordedFeats` keeps only ids marked `feat: true`; these are chain tiers and a
        // standalone, so all three are dropped.
        feats: ['chess_platinum', 'bankroll_gold', 'first_win'],
        // The Phase-B fields, still on the wire from a stale client. Not read at all.
        unlockedAchievementIds: ['chess_platinum'],
        grantedItemIds: ['ttl_grandmaster'],
      } as SettleInput,
      6
    );
    const p = loadProfile(db, 'u1');
    expect(p?.achievements).toEqual({});
    expect(p?.inventory).toEqual({});
  });

  it('records a real feat, which no state predicate could have seen', () => {
    const db = seeded();
    applySettle(
      db,
      'u1',
      {
        nonce: 'a',
        gameId: 'blackjack',
        outcome: 'win',
        payoutCents: 0,
        feats: ['feat_natural'],
      },
      6
    );
    const p = loadProfile(db, 'u1');
    // `first_win` + `blackjack_bronze` from the predicates, `feat_natural` from the report —
    // two sources, one diff.
    expect(Object.keys(p?.achievements ?? {}).sort()).toEqual([
      'blackjack_bronze',
      'feat_natural',
      'first_win',
    ]);
  });

  /**
   * Two open wagers (a blackjack double-down) settle oldest-first, so each payout is bounded by
   * the stake it belongs to rather than by whichever happens to be biggest.
   */
  it('consumes open wagers oldest-first', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'b1', gameId: 'blackjack', amountCents: 1_000 }, 5);
    applyBet(db, 'u1', { nonce: 'b2', gameId: 'blackjack', amountCents: 100_000 }, 6);

    // Bounded by the 1,000 stake, not the 100,000 one.
    const over = applySettle(
      db,
      'u1',
      { nonce: 's1', gameId: 'blackjack', outcome: 'win', payoutCents: 3_000 },
      7
    );
    expect(over.ok).toBe(false);
    expect(
      applySettle(db, 'u1', { nonce: 's2', gameId: 'blackjack', outcome: 'win', payoutCents: 2_500 }, 8)
        .ok
    ).toBe(true);
  });
});

describe('applyPurchase', () => {
  it('charges the SERVER price and grants the item', () => {
    const db = seeded();
    const r = applyPurchase(db, 'u1', { nonce: 'p', itemId: 'av_cowboy' }, 5);
    expect(r.ok).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 100_000);
    expect(loadProfile(db, 'u1')?.inventory).toEqual({ av_cowboy: true });
  });

  it('refuses an earn-only cosmetic — the store cannot sell what must be earned', () => {
    const db = seeded();
    expect(applyPurchase(db, 'u1', { nonce: 'p', itemId: 'ttl_thehouse' }, 5).ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
  });

  it('refuses an item the balance cannot cover, and charges nothing', () => {
    const db = seeded();
    expect(applyPurchase(db, 'u1', { nonce: 'p', itemId: 'av_dragon' }, 5).ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
  });

  it('a replayed purchase charges once', () => {
    const db = seeded();
    applyPurchase(db, 'u1', { nonce: 'same', itemId: 'av_cowboy' }, 5);
    const again = applyPurchase(db, 'u1', { nonce: 'same', itemId: 'av_cowboy' }, 6);
    expect(again).toMatchObject({ ok: true, value: { replayed: true } });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 100_000);
  });

  it('a free starter costs nothing and writes no ledger row', () => {
    const db = seeded();
    applyPurchase(db, 'u1', { nonce: 'p', itemId: 'av_smile' }, 5);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
    const n = db
      .prepare("SELECT COUNT(*) AS c FROM ledger WHERE uid = ? AND reason = 'purchase'")
      .get('u1') as { c: number };
    expect(n.c).toBe(0);
  });
});

describe('applyDaily', () => {
  const day = (n: number) => n * DAY_MS + 1_000;

  it('credits the reward and advances the streak on the server clock', () => {
    const db = seeded();
    const r = applyDaily(db, 'u1', { nonce: 'd1' }, day(100));
    expect(r.ok).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS + 50_000);
    expect(loadProfile(db, 'u1')?.daily).toEqual({ lastClaimDay: 100, streak: 1 });
  });

  it('refuses a second claim the same day, with a fresh nonce', () => {
    const db = seeded();
    applyDaily(db, 'u1', { nonce: 'd1' }, day(100));
    const second = applyDaily(db, 'u1', { nonce: 'd2' }, day(100) + 60_000);
    expect(second.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS + 50_000);
  });

  it('a replayed claim credits once', () => {
    const db = seeded();
    applyDaily(db, 'u1', { nonce: 'same' }, day(100));
    const again = applyDaily(db, 'u1', { nonce: 'same' }, day(101));
    expect(again).toMatchObject({ ok: true, value: { replayed: true } });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS + 50_000);
  });

  it('pays the climbing ladder across consecutive days', () => {
    const db = seeded();
    applyDaily(db, 'u1', { nonce: 'd1' }, day(100));
    applyDaily(db, 'u1', { nonce: 'd2' }, day(101));
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS + 50_000 + 75_000);
    expect(loadProfile(db, 'u1')?.daily).toEqual({ lastClaimDay: 101, streak: 2 });
  });
});
