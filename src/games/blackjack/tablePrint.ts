import {
  dealerShouldHit,
  insurancePayout,
  payoutCents,
  type Card,
  type Rank,
} from '@boardwalk/game-logic/games/blackjack';

/**
 * WHAT IS PRINTED ON THE FELT — DERIVED FROM THE RULEBOOK, never typed out.
 *
 * A real blackjack table has its terms painted on it, and they are the reason a player can sit down
 * at a stranger's table and know what they are being offered. Those three lines are also the most
 * consequential sentences on this screen: they are a promise about money, made to somebody who is
 * about to stake some.
 *
 * **SO THEY ARE COMPUTED, AND THE ALTERNATIVE IS THE FAILURE THIS REPO KEEPS NAMING.** Typing
 * "BLACKJACK PAYS 3 TO 2" onto the felt would put a string next to `payoutCents` that nothing
 * checks. `tests/blackjack-house-odds.test.ts` says it plainly about the very same constants: they
 * are *"each a one-character edit away from moving this number, and none of those edits looks like
 * a money change in a diff."* Change the natural to 6:5 and the felt keeps advertising 3:2 — a
 * table that lies about its own odds, which is worse than either number being wrong on its own,
 * and which no typecheck, lint rule or existing test can see.
 *
 * Deriving it costs one probe of each rule. `tests/blackjack-print.test.ts` then asserts the LINES
 * against the rulebook independently, so the felt and the ledger cannot come apart.
 */

/** A hard hand of a given total, for probing the dealer's rule. Ten plus the remainder, no aces. */
function hardHand(total: number): Card[] {
  return [
    { suit: 'spades', rank: '10' },
    { suit: 'hearts', rank: String(total - 10) as Rank },
  ];
}

/** Reduce a ratio to its lowest terms, so 300:200 prints as "3 TO 2". */
function reduce(a: number, b: number): [number, number] {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const g = gcd(a, b) || 1;
  return [a / g, b / g];
}

/**
 * The lowest total the dealer STANDS on — found by walking up from 12 and asking the rulebook,
 * rather than by reading the 17 out of `dealerShouldHit` and writing it down again.
 */
export function dealerStandsOn(): number {
  for (let total = 12; total <= 21; total += 1) {
    if (!dealerShouldHit(hardHand(total))) return total;
  }
  return 21;
}

/** Whether the dealer also stands on a SOFT total of that value — an ace still counted as 11. */
export function dealerStandsSoft(): boolean {
  const stand = dealerStandsOn();
  const soft: Card[] = [
    { suit: 'spades', rank: 'A' },
    { suit: 'hearts', rank: String(stand - 11) as Rank },
  ];
  return !dealerShouldHit(soft);
}

/**
 * What a natural pays, as a reduced ratio of WINNINGS to stake. Probed on an even wager so the
 * integer flooring in `payoutCents` cannot round the quoted ratio — the print states the table's
 * terms, and a hand's actual cents are always the rulebook's own arithmetic.
 */
export function naturalOdds(): [number, number] {
  const wager = 200;
  return reduce(payoutCents('blackjack', wager) - wager, wager);
}

/** What insurance pays, as a reduced ratio of winnings to side stake. */
export function insuranceOdds(): [number, number] {
  const stake = 100;
  return reduce(insurancePayout(stake) - stake, stake);
}

/**
 * The three lines painted on the felt, top to bottom. Every number in them came from the rulebook
 * this table is actually dealt by.
 */
export function tablePrint(): string[] {
  const [nw, ns] = naturalOdds();
  const [iw, is] = insuranceOdds();
  const stand = dealerStandsOn();
  return [
    `BLACKJACK PAYS ${String(nw)} TO ${String(ns)}`,
    `DEALER MUST DRAW TO ${String(stand - 1)} AND STAND ON ${dealerStandsSoft() ? 'ALL ' : ''}${String(stand)}s`,
    `INSURANCE PAYS ${String(iw)} TO ${String(is)}`,
  ];
}
