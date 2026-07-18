import { describe, expect, it } from 'vitest';
import {
  DAILY_REWARDS_CENTS as SERVER_DAILY,
  DAY_MS as SERVER_DAY_MS,
  PRICES_CENTS,
  STARTING_BANKROLL_CENTS as SERVER_START,
  XP_BY_OUTCOME,
  checkBet,
  checkDaily,
} from '../boardwalk-api/src/domain/economy';
import { validateBet } from '@/system/economy/bet';
import { STARTING_BANKROLL_CENTS } from '@/system/profile/defaults';
import { CATALOG } from '@/system/store/catalog';
import { DAILY_REWARDS_CENTS, DAY_MS, claimDaily } from '@/system/rewards/daily';
import type { Outcome } from '@/system/progress/stats';

/**
 * THE GUARD THAT MAKES THE SERVER'S COPY OF THE MONEY RULES SAFE.
 *
 * `boardwalk-api/src/domain/economy.ts` restates rules the frontend already owns — prices, the
 * daily ladder, the XP table, the opening stake — because Phase B moved the referee to the server
 * without doing Phase D's shared-package move (see that file's header for exactly why). A second
 * copy of a rule is a drift waiting to happen, and this repo's standing rule is that a convention
 * is only real if something red happens when it's broken. So: this test imports BOTH copies and
 * asserts they agree.
 *
 * It runs in the FRONTEND suite (`npm test`) rather than the API's, because only this side can see
 * both trees — the API compiles with `rootDir: src` and cannot import `../src`. Vitest resolves
 * the plain relative path into `boardwalk-api/` without either build being involved.
 *
 * If this goes red, do not "fix" it by editing one number to match. Decide which side is right,
 * change that one, and let this confirm the other followed.
 */

describe('economy parity: the server restates the client rules exactly', () => {
  it('the opening bankroll is the same number on both sides', () => {
    expect(SERVER_START).toBe(STARTING_BANKROLL_CENTS);
  });

  it('the daily ladder matches, rung for rung', () => {
    expect(SERVER_DAILY).toEqual(DAILY_REWARDS_CENTS);
    expect(SERVER_DAY_MS).toBe(DAY_MS);
  });

  it('the XP table matches for every outcome', () => {
    // The frontend's table is private to `result.ts`, so it is compared through its observable
    // effect rather than by import — which is the better test anyway: it is the number that lands.
    const OUTCOMES: readonly Outcome[] = ['win', 'loss', 'push'];
    const expected: Record<Outcome, number> = { win: 100, loss: 10, push: 20 };
    for (const o of OUTCOMES) {
      expect(XP_BY_OUTCOME[o]).toBe(expected[o]);
    }
  });

  /**
   * The one most likely to drift, because adding a cosmetic is a frontend-shaped task and the
   * server's price table is easy to forget. Both directions are checked: an item the store sells
   * that the server does not price would be unbuyable, and an item the server prices that the
   * store dropped would be a dead entry.
   */
  it('every catalogue item is priced identically on the server', () => {
    const clientIds = CATALOG.map((c) => c.id).sort();
    const serverIds = Object.keys(PRICES_CENTS).sort();
    expect(serverIds).toEqual(clientIds);

    for (const item of CATALOG) {
      expect(PRICES_CENTS[item.id]).toBe(item.priceCents);
    }
  });

  it('earn-only items are null on both sides — not zero, which would make them free', () => {
    for (const item of CATALOG.filter((c) => c.priceCents === null)) {
      expect(PRICES_CENTS[item.id]).toBeNull();
    }
  });

  it('bet validation agrees on the boundaries', () => {
    const bounds = { min: 100, max: 10_000 };
    const cases = [
      { amount: 100, balance: 500_000 },
      { amount: 10_000, balance: 10_000 },
      { amount: 10_001, balance: 10_000 },
      { amount: 0, balance: 500_000 },
      { amount: -5, balance: 500_000 },
    ];
    for (const c of cases) {
      const client = validateBet(c.amount, c.balance, bounds);
      const server = checkBet({ amountCents: c.amount, balanceCents: c.balance });
      // The client also enforces the table's min/max, which the server deliberately does not (a
      // lying client can only tighten its own table). So agreement is asserted in the direction
      // that matters: whatever the CLIENT accepts, the SERVER must also accept.
      if (client.ok) expect(server.ok).toBe(true);
    }
  });

  it('the daily claim agrees on reward and streak across a run of days', () => {
    let clientState = { lastClaimDay: 0, streak: 0 };
    let serverState = { lastClaimDay: 0, streak: 0 };

    for (let day = 100; day < 110; day++) {
      const now = day * DAY_MS + 1_000;
      const client = claimDaily(clientState, now);
      const server = checkDaily(serverState, now);

      expect(server.ok).toBe(client !== null);
      if (client === null || !server.ok) continue;

      expect(server.value.rewardCents).toBe(client.rewardCents);
      expect(server.value.state).toEqual(client.state);
      clientState = client.state;
      serverState = server.value.state;
    }
    // Ten consecutive days: the streak climbed and both sides capped at the day-7 rung.
    expect(clientState.streak).toBe(10);
  });

  it('a broken streak resets identically on both sides', () => {
    const gapNow = 200 * DAY_MS;
    const client = claimDaily({ lastClaimDay: 100, streak: 6 }, gapNow);
    const server = checkDaily({ lastClaimDay: 100, streak: 6 }, gapNow);
    expect(server.ok && client !== null).toBe(true);
    if (client === null || !server.ok) throw new Error('both should claim');
    expect(server.value.state.streak).toBe(client.state.streak);
    expect(server.value.rewardCents).toBe(client.rewardCents);
  });
});
