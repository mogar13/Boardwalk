import { describe, expect, it } from 'vitest';
import {
  HOUSE_RETURN,
  MIN_HUMANS_TO_BET,
  houseStakeFor,
  housePayout,
  humanSeats,
  isBetting,
  maxRoundPayout,
  potBacking,
  potFor,
  potOf,
  rankedPayees,
  stakePerSeat,
  stakesFor,
  type PotSeat,
} from '@boardwalk/game-logic/games/uno';

/**
 * THE POT — ante at the deal, and who is on the other side of it.
 *
 * The rules here are small, and the tests are not, because what they guard is money. The one that
 * matters most is the conservation block: **no arrangement of stakes creates or destroys a chip.**
 * It was nearly a tautology while every human paid the same ante and nobody else paid anything; it
 * stopped being one when slice 5 put the HOUSE into the pot, which is exactly why it was written
 * before the feature that would break it — a conservation property added afterwards is a property
 * written to fit the bug.
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

  it('is the SAME ante for a lone player, because what differs is who funds the rest', () => {
    // Slice 5. A bot still has no bankroll and still contributes nothing — what changed is that the
    // HOUSE does, at `HOUSE_RETURN` of fair odds, so a lone player has a counterparty and pays like
    // anybody else. Keeping one stake is what keeps the ledger row, the wager row and a void's
    // refund identical in both modes; only the pot's size moves.
    expect(stakePerSeat([human('a'), ai(), ai(), ai()], ANTE)).toBe(ANTE);
    expect(MIN_HUMANS_TO_BET).toBe(2);
  });

  it('is ZERO with nobody to charge, and ZERO for a lone player with no opponent', () => {
    expect(stakePerSeat([ai(), ai()], ANTE)).toBe(0);
    expect(stakePerSeat([], ANTE)).toBe(0);
    // A one-SEAT table would pay 2/3 of a stake for winning a game with nobody in it — the only
    // arrangement of the house rule that pays out backwards. `seats.min` is 2 and `startMatch`
    // refuses smaller, so it cannot arise; it is refused where the arithmetic is anyway.
    expect(stakePerSeat([human('a')], 1_000_000)).toBe(0);
    expect(potFor([human('a')], 1_000_000)).toBe(0);
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
    expect(stakesFor([ai(), ai(), ai()], ANTE)).toEqual([0, 0, 0]);
  });

  it('still charges NOBODY but the humans at a house table', () => {
    // The house's money is not a seat's stake and must never be indexed as one — `stakesFor` is
    // what the ledger loops over, so a house contribution appearing here would try to charge a bot.
    expect(stakesFor([human('a'), ai(), ai()], ANTE)).toEqual([ANTE, 0, 0]);
  });
});

describe('the pot is the LITERAL SUM of the stakes', () => {
  it('sums what everyone put in, not ante × players', () => {
    expect(potFor([human('a'), human('b')], ANTE)).toBe(5_000);
    expect(potFor([human('a'), human('b'), human('c'), ai()], ANTE)).toBe(7_500);
  });

  it('is zero when the table is not playing for money', () => {
    expect(potFor([ai(), ai(), ai()], ANTE)).toBe(0);
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

          // THE INVARIANT, WITH THE HOUSE INSIDE IT rather than beside it: the pot is the sum of
          // what everyone put in, and the house is one of "everyone". That is the whole reason the
          // house's share is modelled as a STAKE — `potSplit` then divides a pot that conserves,
          // and no downstream reader acquires a second case.
          expect(pot).toBe(stakes.reduce((a, b) => a + b, 0) + houseStakeFor(seats, ante));
          expect(Number.isInteger(pot)).toBe(true);
          expect(pot).toBeGreaterThanOrEqual(0);
          // Nobody who is not a funded human ever CONTRIBUTES A STAKE — the house's money is not a
          // seat's, and `stakesFor` is what the ledger loops over to charge people.
          seats.forEach((seat, i) => {
            if (seat.kind !== 'human') expect(stakes[i]).toBe(0);
          });
          // And a table of PEOPLE is untouched by all of it: the pot is exactly their stakes, no
          // house money anywhere. This is the additivity assertion — the feature has to be
          // invisible to every table that was already betting.
          if (potBacking(seats, ante) !== 'house') {
            expect(pot).toBe(stakePerSeat(seats, ante) * humanSeats(seats).length);
            expect(houseStakeFor(seats, ante)).toBe(0);
          }
        }
      }
    }
  });
});

/**
 * PLAYING THE HOUSE (plans/UNO_HOUSE_RULES.md §4) — the second counterparty, and the one that mints.
 *
 * The rules that matter here are not about arithmetic being right, they are about the arithmetic
 * being SUB-FAIR. v1 paid a lone player fair odds out of the house's pocket, which is EV-neutral
 * against an equal opponent and EV-positive against a bot — a faucet with extra steps. Everything
 * below is a way of asking whether this one still is.
 */
describe('the house pot — a lone player has a counterparty, and it is not a faucet', () => {
  it('pays ante × seats × 2/3, in exact integer cents', () => {
    // The constant with its caller. `2/3` is spelled as a numerator over a denominator so the
    // payout is integer arithmetic end to end; `0.666…` would land a fraction of a cent in the
    // ledger on a large ante, which is v1's `parseInt` chip wearing the other hat.
    expect(HOUSE_RETURN).toBeCloseTo(2 / 3, 12);
    expect(housePayout(ANTE, 4)).toBe(6_666); // $25 × 4 × 2/3 = $66.66, floored
    expect(housePayout(ANTE, 2)).toBe(3_333);
    expect(housePayout(ANTE, 7)).toBe(11_666);
    expect(housePayout(100_000, 7)).toBe(466_666);
  });

  it('is strictly BELOW fair odds at every table size, which is the entire point', () => {
    // The one assertion that separates this from v1's version. Fair is `ante × N`; anything at or
    // above it is EV-neutral against an equal opponent and EV-POSITIVE against a bot, and a bot is
    // what is on the other side. Floored, so the rounding also only ever favours the house.
    for (let seats = 2; seats <= 7; seats += 1) {
      for (const ante of [100, 2_500, 10_000, 50_000, 100_000]) {
        const paid = housePayout(ante, seats);
        expect(paid).toBeLessThan(ante * seats);
        expect(Number.isInteger(paid)).toBe(true);
        // …and still worth playing: a win must return more than the stake at the SMALLEST table,
        // or the house rule is one that charges people to win.
        expect(paid).toBeGreaterThan(ante);
      }
    }
  });

  it('tops the pot up to exactly what a winner is paid', () => {
    // `houseStakeFor` is stated as a contribution rather than a payout so the pot conserves; the
    // property that makes the two views one thing is that the player's ante plus the house's share
    // IS the quoted return.
    for (let bots = 1; bots <= 6; bots += 1) {
      const seats = [human('solo'), ...Array.from({ length: bots }, () => ai())];
      expect(potFor(seats, ANTE)).toBe(housePayout(ANTE, seats.length));
      expect(houseStakeFor(seats, ANTE)).toBe(housePayout(ANTE, seats.length) - ANTE);
      expect(stakePerSeat(seats, ANTE)).toBe(ANTE);
    }
  });

  it('never lets the house into a pot two people are already funding', () => {
    // The other half of additivity, said about the money rather than about the shape: the moment a
    // second human sits down the house is out, at every size and every mix.
    for (let bots = 0; bots <= 5; bots += 1) {
      const seats = [human('a'), human('b'), ...Array.from({ length: bots }, () => ai())];
      expect(potBacking(seats, ANTE)).toBe('players');
      expect(houseStakeFor(seats, ANTE)).toBe(0);
      expect(potFor(seats, ANTE)).toBe(ANTE * 2);
    }
  });

  it('names who is funding the pot, and answers "nobody" for anything unusable', () => {
    expect(potBacking([human('a'), human('b')], ANTE)).toBe('players');
    expect(potBacking([human('a'), ai()], ANTE)).toBe('house');
    expect(potBacking([human('a'), open()], ANTE)).toBe('house');
    expect(potBacking([human('a'), ai()], 0)).toBe('none');
    expect(potBacking([ai(), ai()], ANTE)).toBe('none');
    expect(potBacking([human('a')], ANTE)).toBe('none'); // no opponent
    expect(potBacking([human('a'), ai()], Number.NaN)).toBe('none');
    expect(potBacking([human('a'), ai()], -ANTE)).toBe('none');
    expect(potBacking([], ANTE)).toBe('none');
  });

  it('zeroes rather than throwing on any garbage, like every money function here', () => {
    expect(housePayout(Number.NaN, 4)).toBe(0);
    expect(housePayout(ANTE, Number.NaN)).toBe(0);
    expect(housePayout(-ANTE, 4)).toBe(0);
    expect(housePayout(ANTE, 0)).toBe(0);
    expect(housePayout(ANTE, -3)).toBe(0);
    expect(housePayout(2_500.99, 4)).toBe(6_666); // floored before it multiplies
    expect(maxRoundPayout(Number.NaN, 4)).toBe(0);
    expect(maxRoundPayout(ANTE, Number.POSITIVE_INFINITY)).toBe(0);
    expect(maxRoundPayout(-1, 4)).toBe(0);
  });
});

/**
 * THE PER-MATCH CEILING (§4.1) — the guard on the one place in this system that mints money.
 *
 * It is not a rule anybody plays under, and it is supposed to be unreachable: what it asserts is
 * that a mistake in the pot arithmetic cannot write an unbounded ledger row. So the tests are about
 * it never binding on an honest round, and about bounding both modes with one number.
 */
describe('maxRoundPayout — the bound the house cannot exceed', () => {
  it('bounds both modes, and never binds on an honest round', () => {
    for (let size = 2; size <= 7; size += 1) {
      for (const ante of [100, 2_500, 10_000, 50_000, 100_000]) {
        const ceiling = maxRoundPayout(ante, size);
        // A house pot is 2/3 of the ceiling by construction…
        const bots = [human('solo'), ...Array.from({ length: size - 1 }, () => ai())];
        expect(potFor(bots, ante)).toBeLessThan(ceiling);
        // …and a full table of people pays exactly it, which is why `DEFAULT_PAYOUT_MULTIPLE`'s 3×
        // could never have been the bound: at 7 seats an honest pot IS 7× a player's stake.
        const people = Array.from({ length: size }, (_, i) => human(`u${String(i)}`));
        expect(potFor(people, ante)).toBe(ceiling);
      }
    }
  });
});

/**
 * WHO A POT IS PAID TO — the rule `potSplit` is handed the length of, and the one place a house
 * table is not simply a small players' table.
 */
describe('rankedPayees — the seats a pot is divided between', () => {
  it('is the paying seats in placement order at a table of people', () => {
    expect(rankedPayees([3, 0, 2, 1], [0, 1, 3], false)).toEqual([3, 0, 1]);
    expect(rankedPayees([2, 1], [0, 1], false)).toEqual([1]);
    expect(rankedPayees([], [0, 1], false)).toEqual([]);
  });

  it('pays a HOUSE pot to first place and to nobody else', () => {
    // The case that would otherwise pay a lone player the whole house pot for finishing fourth of
    // five: with one payer, `places.filter(paying)` is that player at EVERY placement, so the
    // ordinary rule would hand them `potSplit(pot, 1)` — the lot. Under `playToLast` that is not a
    // corner case, it is most rounds.
    expect(rankedPayees([1, 0, 2], [1], true)).toEqual([1]); // won
    expect(rankedPayees([0, 1, 2], [1], true)).toEqual([]); // placed 2nd — nothing
    expect(rankedPayees([0, 2, 1], [1], true)).toEqual([]); // placed last — nothing
    expect(rankedPayees([], [1], true)).toEqual([]);
  });

  it('degrades rather than throwing when the podium and the payers disagree', () => {
    // `placesOf` is read off the wire and the payers off the database; a referee that predates
    // ranked places sends an empty podium, and a seat that changed hands is on one list and not the
    // other. Neither may pay anybody by accident.
    expect(rankedPayees([4], [0, 1], false)).toEqual([]);
    expect(rankedPayees([4], [0, 1], true)).toEqual([]);
    expect(rankedPayees([0], [], true)).toEqual([]);
  });
});
