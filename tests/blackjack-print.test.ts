/**
 * WHAT IS PAINTED ON THE FELT IS WHAT THE TABLE ACTUALLY PAYS.
 *
 * The three lines on a blackjack table are a promise about money, made to somebody about to stake
 * some. Boardwalk's felt now prints them, and the only interesting question about that feature is
 * whether the print can ever come apart from the rulebook — because if it can, it eventually will,
 * and the result is a table advertising 3:2 while the ledger pays 6:5. Nothing else in this repo
 * can see that: it is a string, so it typechecks; it is not a raw colour, so `no-raw-palette` has
 * nothing to say; and `tests/blackjack-house-odds.test.ts` measures the EDGE, which a wrong SIGN
 * on the felt does not move by a basis point.
 *
 * **THE ASSERTIONS ARE PROPERTIES, NOT A SECOND COPY OF THE RULE.** Asserting `naturalOdds()` is
 * `[3, 2]` and stopping there would be the vacuous guard this repo's Enforcement section warns
 * about — a test that the rule equals a restatement of itself. So each printed ratio is asserted
 * against what `payoutCents`/`insurancePayout` MOVE across a sweep of real wagers, and the dealer
 * line is asserted against `dealerShouldHit` at the boundary in both directions. The shipped
 * numbers are pinned too, separately and on purpose, so that changing the game stays a deliberate
 * act rather than a silent one.
 */
import { describe, it, expect } from 'vitest';
import {
  dealerShouldHit,
  insurancePayout,
  payoutCents,
  type Card,
  type Rank,
} from '@boardwalk/game-logic/games/blackjack';
import {
  dealerStandsOn,
  dealerStandsSoft,
  insuranceOdds,
  naturalOdds,
  tablePrint,
} from '@/games/blackjack/tablePrint';

/** A hard hand of a given total — ten plus the remainder, no aces. */
function hard(total: number): Card[] {
  return [
    { suit: 'spades', rank: '10' },
    { suit: 'hearts', rank: String(total - 10) as Rank },
  ];
}

describe('the printed odds are the odds that are paid', () => {
  it('quotes a natural at the ratio `payoutCents` actually returns, across every wager', () => {
    const [win, stake] = naturalOdds();
    expect(stake).toBeGreaterThan(0);
    // Sweep wagers that divide evenly by the quoted stake, so the flooring in `payoutCents` cannot
    // be what makes this pass. The print is a claim about the table's terms; this is the money.
    for (let w = stake; w <= 200_000; w += stake * 7) {
      expect(payoutCents('blackjack', w) - w, `wager ${String(w)}c`).toBe((w * win) / stake);
    }
  });

  it('quotes insurance at the ratio `insurancePayout` actually returns', () => {
    const [win, stake] = insuranceOdds();
    for (let s = stake; s <= 50_000; s += stake * 13) {
      expect(insurancePayout(s) - s, `stake ${String(s)}c`).toBe((s * win) / stake);
    }
  });

  it('quotes a stand value the dealer really stands on — and draws one below it', () => {
    const stand = dealerStandsOn();
    expect(dealerShouldHit(hard(stand)), `stands on ${String(stand)}`).toBe(false);
    expect(dealerShouldHit(hard(stand - 1)), `draws to ${String(stand - 1)}`).toBe(true);
  });

  it('BUILDS each line from the derivation rather than carrying a literal', () => {
    // THE HOLE THE PINNED CASES BELOW CANNOT SEE. If `tablePrint` were rewritten as a literal
    // array of three strings, every property above would still pass (they test the derivers, which
    // would still be correct and simply unused) and the pins would still pass (they expect the old
    // strings, which is what the literal says). The felt would lie the moment a rule moved, with
    // the whole suite green. So each line is asserted to CONTAIN the numbers the derivers produce.
    const [nw, ns] = naturalOdds();
    const [iw, is] = insuranceOdds();
    const stand = dealerStandsOn();
    const lines = tablePrint();
    expect(lines[0]).toContain(`${String(nw)} TO ${String(ns)}`);
    expect(lines[1]).toContain(String(stand));
    expect(lines[1]).toContain(String(stand - 1));
    expect(lines[2]).toContain(`${String(iw)} TO ${String(is)}`);
  });

  it('says "ALL" only when the dealer also stands on the SOFT total', () => {
    const stand = dealerStandsOn();
    const soft: Card[] = [
      { suit: 'spades', rank: 'A' },
      { suit: 'hearts', rank: String(stand - 11) as Rank },
    ];
    expect(dealerStandsSoft()).toBe(!dealerShouldHit(soft));
    // And the word tracks it, which is the half a reader on the felt actually sees.
    expect(tablePrint()[1]?.includes('ALL')).toBe(dealerStandsSoft());
  });
});

describe('the shipped table', () => {
  it('is the one this game has always dealt', () => {
    // Pinned deliberately, the way `tests/blackjack.test.ts` pins the soft-17 boundary hand by
    // hand: these three lines are the game, and moving one should be a decision somebody made on
    // purpose and had to come here to record.
    expect(naturalOdds()).toEqual([3, 2]);
    expect(insuranceOdds()).toEqual([2, 1]);
    expect(dealerStandsOn()).toBe(17);
    expect(dealerStandsSoft()).toBe(true);
  });

  it('reads as a blackjack table', () => {
    expect(tablePrint()).toEqual([
      'BLACKJACK PAYS 3 TO 2',
      'DEALER MUST DRAW TO 16 AND STAND ON ALL 17s',
      'INSURANCE PAYS 2 TO 1',
    ]);
  });

  it('prints three lines and no empty one', () => {
    const lines = tablePrint();
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.trim().length).toBeGreaterThan(0);
  });
});
