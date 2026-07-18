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
  PACKS,
  RARITIES,
  dustFor,
  packById,
  packPool,
  rollPack,
} from '../src/domain/economy';
import { cosmeticById } from '@boardwalk/game-logic';
import {
  applyBet,
  applyDaily,
  applyPack,
  applyPurchase,
  applySettle,
  type SettleInput,
} from '../src/domain/mutations';

/**
 * The generic /bet + /settle path is exercised with a gameId the referee does NOT deal.
 *
 * It used to be spelled 'blackjack', which stopped being valid in Phase D: the server deals that
 * game now, so `checkSettle` refuses a claim for it outright (`SERVER_DEALT_GAMES`) — otherwise
 * `POST /bet` + `POST /settle` at the 2.5x ceiling would be a standing bypass of the dealer, and
 * the whole phase would be opt-in. 'roulette' stands in for what this route is actually for: a
 * betting game the referee does not run the rules of, bounded by the default 3x ceiling.
 */
const BETTING_GAME = 'roulette';


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
  it('caps a payout at the default 3x ceiling for a game the referee does not deal', () => {
    expect(payoutCeiling(BETTING_GAME, 1_000)).toBe(3_000);
    expect(checkSettle({ gameId: BETTING_GAME, payoutCents: 3_000, openWagerCents: 1_000 }).ok).toBe(
      true
    );
    expect(checkSettle({ gameId: BETTING_GAME, payoutCents: 3_001, openWagerCents: 1_000 }).ok).toBe(
      false
    );
  });

  /**
   * PHASE D CLOSED THE OLD ROAD, and this is the test that says so.
   *
   * The ceiling table still knows blackjack's 2.5x — that number is the 3:2 natural and it is
   * correct — but no settle for blackjack may be honoured through this route at ANY amount, because
   * the referee deals that game itself. Without this refusal `POST /bet` + `POST /settle` at the
   * ceiling is a standing bypass of the dealer, and every guarantee `/blackjack/*` provides is
   * opt-in. The cheapest way to defeat a cutover is to leave the old road open.
   */
  it('refuses a blackjack settle outright — the dealer settles that game, not a claim', () => {
    expect(payoutCeiling('blackjack', 1_000)).toBe(2_500);
    for (const payoutCents of [0, 1_000, 2_500]) {
      expect(checkSettle({ gameId: 'blackjack', payoutCents, openWagerCents: 1_000 }).ok).toBe(
        false
      );
    }
  });

  it('refuses ANY payout with no open wager — the mint', () => {
    expect(checkSettle({ gameId: BETTING_GAME, payoutCents: 1, openWagerCents: null }).ok).toBe(
      false
    );
    expect(
      checkSettle({ gameId: BETTING_GAME, payoutCents: 1_000_000, openWagerCents: null }).ok
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
    const r = applyBet(db, 'u1', { nonce: 'n1', gameId: BETTING_GAME, amountCents: 10_000 }, 5);
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
      { nonce: 'n1', gameId: BETTING_GAME, amountCents: STARTING_BANKROLL_CENTS + 1 },
      5
    );
    expect(r.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
  });

  it('a replayed nonce deducts NOTHING and returns the same balance', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'same', gameId: BETTING_GAME, amountCents: 10_000 }, 5);
    const again = applyBet(db, 'u1', { nonce: 'same', gameId: BETTING_GAME, amountCents: 10_000 }, 6);

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
    applyBet(db, 'u1', { nonce: 'shared', gameId: BETTING_GAME, amountCents: 10_000 }, 5);
    const other = applyBet(db, 'u2', { nonce: 'shared', gameId: BETTING_GAME, amountCents: 10_000 }, 5);
    expect(other).toMatchObject({ ok: true, value: { replayed: false } });
    expect(balanceOf(db, 'u2')).toBe(STARTING_BANKROLL_CENTS - 10_000);
  });
});

describe('applySettle', () => {
  it('credits a bounded payout, closes the wager, and bumps the stat and XP', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'b', gameId: BETTING_GAME, amountCents: 10_000 }, 5);
    const r = applySettle(
      db,
      'u1',
      { nonce: 's', gameId: BETTING_GAME, outcome: 'win', payoutCents: 20_000 },
      6
    );

    expect(r.ok).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS + 10_000);
    const p = loadProfile(db, 'u1');
    expect(p?.stats[BETTING_GAME]).toEqual({ played: 1, won: 1, lost: 0, pushed: 0 });
    expect(p?.xp).toBe(100);
  });

  /** The headline attack: settle with no stake, asking for a fortune. */
  it('refuses a payout with no open wager', () => {
    const db = seeded();
    const r = applySettle(
      db,
      'u1',
      { nonce: 's', gameId: BETTING_GAME, outcome: 'win', payoutCents: 1_000_000 },
      6
    );
    expect(r.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
  });

  it('refuses a payout above the ceiling and leaves the wager OPEN', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'b', gameId: BETTING_GAME, amountCents: 10_000 }, 5);
    const r = applySettle(
      db,
      'u1',
      { nonce: 's', gameId: BETTING_GAME, outcome: 'win', payoutCents: 30_001 },
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
    applyBet(db, 'u1', { nonce: 'b', gameId: BETTING_GAME, amountCents: 10_000 }, 5);
    applySettle(db, 'u1', { nonce: 's1', gameId: BETTING_GAME, outcome: 'win', payoutCents: 20_000 }, 6);
    const second = applySettle(
      db,
      'u1',
      { nonce: 's2', gameId: BETTING_GAME, outcome: 'win', payoutCents: 20_000 },
      7
    );
    expect(second.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS + 10_000);
  });

  it('a replayed settle nonce credits nothing and does not double the stat', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'b', gameId: BETTING_GAME, amountCents: 10_000 }, 5);
    applySettle(db, 'u1', { nonce: 'same', gameId: BETTING_GAME, outcome: 'win', payoutCents: 20_000 }, 6);
    const again = applySettle(
      db,
      'u1',
      { nonce: 'same', gameId: BETTING_GAME, outcome: 'win', payoutCents: 20_000 },
      7
    );

    expect(again).toMatchObject({ ok: true, value: { replayed: true } });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS + 10_000);
    expect(loadProfile(db, 'u1')?.stats[BETTING_GAME]).toEqual({
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
        gameId: BETTING_GAME,
        outcome: 'win',
        payoutCents: 0,
        feats: ['feat_natural'],
      },
      6
    );
    const p = loadProfile(db, 'u1');
    // `first_win` from the predicate, `feat_natural` from the report — two sources, one diff.
    // No mastery bronze here: the chains are per-game and this is not one of the two that have
    // one, which is worth pinning — a feat must not drag an unrelated chain in with it.
    expect(Object.keys(p?.achievements ?? {}).sort()).toEqual(['feat_natural', 'first_win']);
  });

  /**
   * Two open wagers (a blackjack double-down) settle oldest-first, so each payout is bounded by
   * the stake it belongs to rather than by whichever happens to be biggest.
   */
  it('consumes open wagers oldest-first', () => {
    const db = seeded();
    applyBet(db, 'u1', { nonce: 'b1', gameId: BETTING_GAME, amountCents: 1_000 }, 5);
    applyBet(db, 'u1', { nonce: 'b2', gameId: BETTING_GAME, amountCents: 100_000 }, 6);

    // Bounded by the 1,000 stake (3x = 3,000), not by the 100,000 one that is also open. That is
    // the whole point of oldest-first: a second, larger stake sitting open cannot raise the
    // ceiling on the hand being settled now.
    const over = applySettle(
      db,
      'u1',
      { nonce: 's1', gameId: BETTING_GAME, outcome: 'win', payoutCents: 3_001 },
      7
    );
    expect(over.ok).toBe(false);
    expect(
      applySettle(db, 'u1', { nonce: 's2', gameId: BETTING_GAME, outcome: 'win', payoutCents: 3_000 }, 8)
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

/* ------------------------------------------------------------------ packs */

/**
 * PACKS — the last client-authoritative money path, closed.
 *
 * The bug: `openPack()` ran in the browser, computed the whole next profile (price spent, item
 * granted, dust credited) and saved it through `PUT /profile`, which accepts exactly `name`,
 * `avatar` and `equipped`. So the reveal animated and the server discarded every effect — the
 * player paid nothing and got nothing. Now the roll happens HERE.
 *
 * Note what is NOT tested here any more: that the server's pack tables match the client's. After
 * Phase D there is one table — `@boardwalk/game-logic`'s `PACKS` — imported by the store card and
 * by `rollPack` alike, so the published odds ARE the rolled odds by construction rather than by
 * assertion. What is left to test is the server's own half: the decision, the roll, and replay.
 */

/** A scripted generator: hands back the given values in order, then 0. Makes the roll exact. */
const scripted = (...values: readonly number[]): (() => number) => {
  let i = 0;
  return () => values[i++] ?? 0;
};

/**
 * `pk_backs` at [0, 0]: the first draw lands in `common` (0 < 0.6) and the second takes the first
 * item of that bucket. The catalogue order makes that `cb_red1` — a 40,000-cent common.
 */
const FIRST_COMMON_BACK = 'cb_red1';
const BACKS_PRICE = 250_000;

const ownedIdsOf = (db: Db, uid: string): string[] =>
  (db.prepare('SELECT item_id FROM inventory WHERE uid = ? ORDER BY item_id').all(uid) as {
    item_id: string;
  }[]).map((r) => r.item_id);

const backsPack = () => {
  const p = packById('pk_backs');
  if (p === undefined) throw new Error('pk_backs missing');
  return p;
};

describe('the pack pool the server rolls against', () => {
  it('never contains an earn-only cosmetic or a free starter, for any pack', () => {
    for (const pack of PACKS) {
      for (const c of packPool(pack)) {
        expect(c.priceCents).not.toBeNull();
        expect(c.priceCents).toBeGreaterThan(0);
      }
    }
    // The two earn-only titles are in the grand pack's KINDS and still must not be in its pool —
    // the earn-vs-buy split, enforced where the inventory row is written rather than only in the
    // UI that offers the button.
    const grand = packById('pk_grand');
    if (grand === undefined) throw new Error('pk_grand missing');
    const ids = packPool(grand).map((c) => c.id);
    expect(ids).not.toContain('ttl_thehouse');
    expect(ids).not.toContain('ttl_grandmaster');
    expect(packPool(backsPack()).map((c) => c.id)).not.toContain('cb_blue1');
  });

  it('every weighted rarity has a non-empty bucket, so no roll lands nowhere', () => {
    for (const pack of PACKS) {
      for (const rarity of RARITIES) {
        if (pack.odds[rarity] > 0) {
          expect(packPool(pack).filter((c) => c.rarity === rarity).length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('rollPack — the odds are the published odds', () => {
  it('walks the cumulative weights: 0.0 is common, 0.99 is legendary', () => {
    const pack = backsPack();
    const empty = new Set<string>();
    const rarityOf = (r: number): string | undefined =>
      cosmeticById(rollPack(pack, empty, scripted(r, 0))?.itemId ?? '')?.rarity;
    expect(rarityOf(0)).toBe('common');
    expect(rarityOf(0.599)).toBe('common');
    expect(rarityOf(0.601)).toBe('rare');
    expect(rarityOf(0.99)).toBe('legendary');
  });

  it('matches the published distribution over 20k rolls', () => {
    const pack = backsPack();
    const empty = new Set<string>();
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      // A deterministic sweep across [0,1) rather than a real RNG: this asserts the BANDS are
      // where the published table says, which is the property that matters and does not flake.
      const rarity = cosmeticById(rollPack(pack, empty, scripted(i / N, 0.5))?.itemId ?? '')?.rarity;
      if (rarity !== undefined) counts[rarity] = (counts[rarity] ?? 0) + 1;
    }
    for (const rarity of RARITIES) {
      expect((counts[rarity] ?? 0) / N).toBeCloseTo(pack.odds[rarity], 2);
    }
  });
});

describe('applyPack', () => {
  it('charges the SERVER price and grants the pull — the request carries no price at all', () => {
    const db = seeded();
    const r = applyPack(db, 'u1', { nonce: 'k1', packId: 'pk_backs' }, 10, scripted(0, 0));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should open');
    expect(r.value.pull).toEqual({ itemId: FIRST_COMMON_BACK, duplicate: false, dustCents: 0 });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - BACKS_PRICE);
    expect(ownedIdsOf(db, 'u1')).toContain(FIRST_COMMON_BACK);
  });

  it('refuses a pack the balance cannot cover, and moves nothing', () => {
    const db = seeded(); // $5,000.00 — the grand pack is $20,000.00
    const r = applyPack(db, 'u1', { nonce: 'k1', packId: 'pk_grand' }, 10, scripted(0, 0));
    expect(r).toMatchObject({ ok: false });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
    expect(ownedIdsOf(db, 'u1')).toEqual([]);
  });

  it('refuses an unknown packId — state, not a malformed request', () => {
    const db = seeded();
    const r = applyPack(db, 'u1', { nonce: 'k1', packId: 'pk_nope' }, 10, scripted(0, 0));
    expect(r).toMatchObject({ ok: false, error: 'no such pack' });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
  });

  it('refuses a pool the player has completed — that is a fee, not a gamble', () => {
    const db = seeded();
    const ins = db.prepare(
      'INSERT OR IGNORE INTO inventory (uid, item_id, purchased_at) VALUES (?, ?, ?)'
    );
    for (const c of packPool(backsPack())) ins.run('u1', c.id, 1);
    const r = applyPack(db, 'u1', { nonce: 'k1', packId: 'pk_backs' }, 10, scripted(0, 0));
    expect(r).toMatchObject({ ok: false });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
  });

  it('credits completion-scaled dust on a duplicate and grants nothing twice', () => {
    const db = seeded();
    db.prepare('INSERT INTO inventory (uid, item_id, purchased_at) VALUES (?, ?, ?)').run(
      'u1',
      FIRST_COMMON_BACK,
      1
    );
    const r = applyPack(db, 'u1', { nonce: 'k1', packId: 'pk_backs' }, 10, scripted(0, 0));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should open');

    // 1 of the 14 backs owned → rate = 0.1 + 0.9 × (1/14) = 0.164285… → floor(250,000 × rate).
    expect(r.value.pull).toEqual({
      itemId: FIRST_COMMON_BACK,
      duplicate: true,
      dustCents: 41_071,
    });
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - BACKS_PRICE + 41_071);
    // Still owned exactly once — a duplicate grants nothing.
    expect(ownedIdsOf(db, 'u1')).toEqual([FIRST_COMMON_BACK]);
  });

  it('a duplicate can never profit: dust never exceeds the price, at any completion', () => {
    const pack = backsPack();
    for (const rarity of RARITIES) {
      for (const pct of [0, 0.25, 0.5, 0.9, 1, -5, 99]) {
        const dust = dustFor(pack, rarity, pct);
        expect(dust).toBeGreaterThanOrEqual(0);
        expect(dust).toBeLessThanOrEqual(pack.priceCents);
        expect(Number.isInteger(dust)).toBe(true);
      }
    }
  });

  /* ---------------------------------------------------------------- replay */

  it('A REPLAYED NONCE RETURNS THE IDENTICAL PULL AND MOVES NO MONEY', () => {
    const db = seeded();
    const first = applyPack(db, 'u1', { nonce: 'same', packId: 'pk_backs' }, 10, scripted(0, 0));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('should open');
    const balanceAfterFirst = balanceOf(db, 'u1');

    // The retry is handed a generator that would roll a LEGENDARY. If the replay path re-rolled,
    // this is where a flaky connection becomes a reroll — so the assertion is that the scripted
    // values are ignored entirely and the original common comes back.
    const again = applyPack(db, 'u1', { nonce: 'same', packId: 'pk_backs' }, 11, scripted(0.99, 0));
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error('should replay');

    expect(again.value.replayed).toBe(true);
    expect(again.value.pull).toEqual(first.value.pull);
    expect(balanceOf(db, 'u1')).toBe(balanceAfterFirst);
    expect(ownedIdsOf(db, 'u1')).toEqual([FIRST_COMMON_BACK]);
  });

  it('replays a DUPLICATE identically too — same dust, credited once', () => {
    const db = seeded();
    db.prepare('INSERT INTO inventory (uid, item_id, purchased_at) VALUES (?, ?, ?)').run(
      'u1',
      FIRST_COMMON_BACK,
      1
    );
    const first = applyPack(db, 'u1', { nonce: 'dup', packId: 'pk_backs' }, 10, scripted(0, 0));
    const balance = balanceOf(db, 'u1');
    const again = applyPack(db, 'u1', { nonce: 'dup', packId: 'pk_backs' }, 11, scripted(0.99, 0));
    if (!first.ok || !again.ok) throw new Error('both should succeed');
    expect(again.value.pull).toEqual(first.value.pull);
    expect(again.value.pull?.dustCents).toBe(41_071);
    expect(balanceOf(db, 'u1')).toBe(balance);
  });

  it('ten replays of one nonce open exactly one pack', () => {
    const db = seeded();
    applyPack(db, 'u1', { nonce: 'once', packId: 'pk_backs' }, 10, scripted(0, 0));
    for (let i = 0; i < 10; i++) {
      applyPack(db, 'u1', { nonce: 'once', packId: 'pk_backs' }, 11 + i, scripted(0.99, 0));
    }
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - BACKS_PRICE);
    const rows = db.prepare('SELECT COUNT(*) AS c FROM pack_opens WHERE uid = ?').get('u1') as {
      c: number;
    };
    expect(rows.c).toBe(1);
  });

  it('refuses a nonce already burned by a DIFFERENT mutation rather than charging for nothing', () => {
    const db = seeded();
    applyPurchase(db, 'u1', { nonce: 'shared', itemId: 'av_cowboy' }, 5);
    const r = applyPack(db, 'u1', { nonce: 'shared', packId: 'pk_backs' }, 6, scripted(0, 0));
    expect(r.ok).toBe(false);
    // The purchase's charge stands; the pack's does not.
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 100_000);
  });

  it("one player's nonce cannot burn another's", () => {
    const db = seeded();
    upsertProfile(db, 'u2', { name: 'Bo', avatar: '👤', equipped: {} }, { now: 1 });
    const a = applyPack(db, 'u1', { nonce: 'n', packId: 'pk_backs' }, 10, scripted(0, 0));
    const b = applyPack(db, 'u2', { nonce: 'n', packId: 'pk_backs' }, 10, scripted(0, 0));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error('both should open');
    expect(a.value.replayed).toBe(false);
    expect(b.value.replayed).toBe(false);
    expect(balanceOf(db, 'u2')).toBe(STARTING_BANKROLL_CENTS - BACKS_PRICE);
  });
});

/**
 * THE DEFAULT GENERATOR, exercised.
 *
 * Every test above injects a scripted `rand`, which is what makes the odds assertable — and is
 * also how the production RNG shipped broken and green the first time: `randomInt(0, 2 ** 48)`
 * exceeds Node's max-min limit and threw `ERR_OUT_OF_RANGE` on every real request, so a browser
 * saw a 500 while the whole suite passed. A guard that never runs the real path reports success
 * by doing nothing.
 *
 * These call `applyPack` with NO generator, so the default is the thing under test.
 */
describe('applyPack with the real generator', () => {
  it('opens a pack without a scripted rand — the production path actually runs', () => {
    const db = seeded();
    const r = applyPack(db, 'u1', { nonce: 'real', packId: 'pk_backs' }, 10);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should open');
    expect(r.value.pull).toBeDefined();
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - BACKS_PRICE);
  });

  it('rolls only real, packable items across many live opens', () => {
    const pool = new Set(packPool(backsPack()).map((c) => c.id));
    for (let i = 0; i < 200; i++) {
      const db = seeded();
      const r = applyPack(db, 'u1', { nonce: `n${String(i)}`, packId: 'pk_backs' }, 10);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('should open');
      expect(pool.has(r.value.pull?.itemId ?? '')).toBe(true);
    }
  });
});
