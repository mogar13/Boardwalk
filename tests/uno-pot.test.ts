import { describe, expect, it } from 'vitest';
import {
  MIN_HUMANS_TO_BET,
  humanSeats,
  isBetting,
  potFor,
  potOf,
  stakePerSeat,
  stakesFor,
  type PotSeat,
} from '@boardwalk/game-logic/games/uno';

/**
 * THE POT — slice 1 of it: ante at the deal, winner takes the pot.
 *
 * The rules here are small, and the tests are not, because what they guard is money. The one that
 * matters most is the last block: **no arrangement of stakes creates or destroys a chip.** Today
 * that is nearly a tautology (every human pays the same ante) and it will stop being one the moment
 * raising lands, which is precisely why it is written now — a conservation property added after the
 * feature that breaks it is a property written to fit the bug.
 */

const human = (uid: string): PotSeat => ({ kind: 'human', uid });
const ai = (): PotSeat => ({ kind: 'ai', uid: null });
const open = (): PotSeat => ({ kind: 'open', uid: null });

const ANTE = 2_500;

describe('humanSeats — only an account can stake anything', () => {
  it('is the indices of the seats with a real uid, in seat order', () => {
    expect(humanSeats([human('a'), ai(), human('b'), open()])).toEqual([0, 2]);
  });

  it('does not count a "human" seat with no account behind it', () => {
    // A seat mid-handover — the crash-recovery grace window writes `kind: 'ai', uid: null`, but a
    // wire shape that arrived with `human` and no uid must not be charged an ante there is no
    // account to take it from. Absent uid and empty-string uid are both nobody.
    expect(
      humanSeats([
        { kind: 'human', uid: null },
        { kind: 'human', uid: '' },
      ])
    ).toEqual([]);
  });
});

describe('stakePerSeat — what a chair actually costs', () => {
  it('is the ante once two humans are at the table', () => {
    expect(stakePerSeat([human('a'), human('b')], ANTE)).toBe(ANTE);
    expect(stakePerSeat([human('a'), human('b'), ai(), ai()], ANTE)).toBe(ANTE);
  });

  it('is ZERO below two humans, however large the ante', () => {
    // The rule with the whole design behind it. A bot has no bankroll, so one human against six
    // bots would ante into a pot made of their own money and win it back. v1 covered the bots from
    // the house instead — a $25 stake winning $100 is a $75 grant on a coin flip, which is the
    // faucet `refillGrantFor` exists to make impossible.
    expect(stakePerSeat([human('a'), ai(), ai(), ai()], ANTE)).toBe(0);
    expect(stakePerSeat([human('a')], 1_000_000)).toBe(0);
    expect(stakePerSeat([ai(), ai()], ANTE)).toBe(0);
    expect(stakePerSeat([], ANTE)).toBe(0);
    expect(MIN_HUMANS_TO_BET).toBe(2);
  });

  it('is ZERO for a table that is not playing for money', () => {
    expect(stakePerSeat([human('a'), human('b')], 0)).toBe(0);
    expect(isBetting([human('a'), human('b')], 0)).toBe(false);
    expect(isBetting([human('a'), human('b')], ANTE)).toBe(true);
  });

  it('never produces a fractional or negative stake, whatever it is handed', () => {
    // `bet.ts` REFUSES a fractional bet rather than rounding it — v1's `parseInt` dropped a chip on
    // blackjack's 3:2 — so a stake that is not integer cents is a start that dies at the ledger.
    const two = [human('a'), human('b')];
    expect(stakePerSeat(two, 2_500.99)).toBe(2_500);
    expect(stakePerSeat(two, -2_500)).toBe(0); // would PAY people to sit down
    expect(stakePerSeat(two, Number.NaN)).toBe(0);
    expect(stakePerSeat(two, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('stakesFor — indexed by seat, so nothing has to reconcile two tables', () => {
  it('lines up with the seat array, zero for every seat that pays nothing', () => {
    expect(stakesFor([human('a'), ai(), human('b'), open()], ANTE)).toEqual([ANTE, 0, ANTE, 0]);
  });

  it('is all zeroes rather than a shorter array when nobody is betting', () => {
    // A hole in an indexed shape is the `-1` sentinel lesson: an absent entry is eventually read as
    // a seat. Same length, always.
    expect(stakesFor([human('a'), ai(), ai()], ANTE)).toEqual([0, 0, 0]);
  });
});

describe('the pot is the LITERAL SUM of the stakes', () => {
  it('sums what everyone put in, not ante × players', () => {
    expect(potFor([human('a'), human('b')], ANTE)).toBe(5_000);
    expect(potFor([human('a'), human('b'), human('c'), ai()], ANTE)).toBe(7_500);
  });

  it('is zero when the table is not playing for money', () => {
    expect(potFor([human('a'), ai(), ai()], ANTE)).toBe(0);
    expect(potFor([human('a'), human('b')], 0)).toBe(0);
  });

  it('sums an UNEQUAL set of stakes — the property that outlives ante-only', () => {
    // Today every human pays the same, so `potOf` is never handed an uneven table. Raising will
    // hand it one on the first short stack that shoves for less than the ante, and v1's whole
    // reason for summing rather than multiplying is that "the pot is still exactly what everyone
    // put in". Asserted directly so the sum cannot quietly become a product later.
    expect(potOf([2_500, 900, 2_500, 0])).toBe(5_900);
  });

  it('ignores garbage in a stake rather than poisoning the whole pot', () => {
    // One NaN in a `reduce` makes the POT NaN, and a NaN pot is a ledger row nobody can read back.
    expect(potOf([2_500, Number.NaN, 2_500])).toBe(5_000);
    expect(potOf([])).toBe(0);
  });

  /**
   * THE CONSERVATION PROPERTY, stated as a property and not an example.
   *
   * Over every table shape from 2 to 7 seats, every mix of humans/bots/open chairs, and every rung
   * of the real ante ladder: the pot equals the sum of what the seats paid, and the winner can
   * therefore never be paid a cent that nobody staked. This is the invariant the referee's payout
   * rests on — `settleMatch` pays `pot_cents` to one seat — so if it can fail, the ledger mints
   * money.
   */
  it('creates and destroys nothing, across every table shape and every rung', () => {
    for (const ante of [0, 100, 2_500, 10_000, 50_000, 100_000]) {
      for (let size = 2; size <= 7; size += 1) {
        for (let mask = 0; mask < 1 << 3; mask += 1) {
          const seats: PotSeat[] = Array.from({ length: size }, (_, i) =>
            // A deterministic sweep of shapes: some humans, some bots, some empty chairs.
            i < size - ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1))
              ? human(`u${String(i)}`)
              : i % 2 === 0
                ? ai()
                : open()
          );
          const stakes = stakesFor(seats, ante);
          const pot = potFor(seats, ante);

          expect(pot).toBe(stakes.reduce((a, b) => a + b, 0));
          expect(Number.isInteger(pot)).toBe(true);
          expect(pot).toBeGreaterThanOrEqual(0);
          // Nobody who is not a funded human ever contributes.
          seats.forEach((seat, i) => {
            if (seat.kind !== 'human') expect(stakes[i]).toBe(0);
          });
          // And the pot is exactly the funded humans' stakes — no house money anywhere.
          expect(pot).toBe(stakePerSeat(seats, ante) * humanSeats(seats).length);
        }
      }
    }
  });

  it('a one-human table can never build a pot, at any rung', () => {
    // The faucet test, stated as its own case because it is the one a future "let the house cover
    // the bots" convenience would break, and it would look reasonable in the diff.
    for (const ante of [100, 2_500, 10_000, 50_000, 100_000, 1_000_000]) {
      for (let bots = 1; bots <= 6; bots += 1) {
        const seats = [human('solo'), ...Array.from({ length: bots }, () => ai())];
        expect(potFor(seats, ante)).toBe(0);
      }
    }
  });
});
