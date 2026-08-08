/**
 * WHAT BLACKJACK COSTS THE HOUSE — the one guard in this repo whose whole output is a NUMBER, and
 * the reason `plans/BLACKJACK_DEPTH.md`'s dealer-stand tier was **measured and then not shipped**.
 *
 * ## Why this exists at all
 *
 * Slice 2 of that plan set out to offer v1's difficulty selector properly: a player picks the
 * dealer's stand value (15 / 17 / 19), and every rung is PRICED through the natural's payout so
 * that none is EV-positive — the real-casino mechanism, since 6:5 blackjack is exactly this. The
 * plan deliberately named no payout, on `UNO_HOUSE_RULES.md` §4's precedent: the number IS the
 * safety of the feature, so it has to come off a harness rather than off prose.
 *
 * The harness said no. The numbers below killed the feature, which is the outcome that plan's §4.3
 * explicitly allowed for — *"a tier that cannot be priced non-negative does not ship"*. What is
 * left is this file, pointed at the game that DOES ship.
 *
 * ## The finding, which is structural rather than a matter of tuning
 *
 * **17 is the dealer's optimal stand value, so every alternative favours the PLAYER — in both
 * directions.** Measured at 3:2, 120k hands a cell:
 *
 * | dealer stands on | 14     | 15     | 16     | **17**     | 18     | 19      |
 * |------------------|--------|--------|--------|------------|--------|---------|
 * | house edge       | −5.57% | −4.59% | −0.86% | **+0.50%** | −5.49% | −18.18% |
 *
 * Standing lower leaves the dealer on weak totals a standing player beats; standing higher forces
 * it to hit 17 and 18, which bust on 36 of the 52 cards in the deck. **There is no harder table to
 * be had this way**, so a difficulty ladder built on the dealer's stand value can only ever give
 * money away — and v1 shipped one, labelled Easy / Normal / Hard, with "Hard" being the 19 column.
 *
 * **And the lever cannot reach.** A natural is ~4.8% of hands, so moving 3:2 → 1:1 is worth about
 * 2.4% — enough for the 16 table and nowhere near 15, 18 or 19, which stay player-positive even
 * when a blackjack pays even money. The one candidate that priced at all was *stands-16, pays 6:5*,
 * and three seeds at 300k hands put it at **+0.16% / +0.75% / +0.42%**: a swing wider than the
 * number itself, on a surface that moves real money, with the proxy's own residual bias still
 * pointing the unsafe way. Its sibling *stands-16, pays 1:1* is safe at +1.57% and is strictly
 * worse for the player than classic, so nobody would ever choose it.
 *
 * That is the whole space: a choice that is either meaningless-and-unsafe, or safe-and-pointless.
 * So Blackjack keeps ONE table — `dealerShouldHit` its fixed 17, `payoutCents` its fixed 3:2 — and
 * the plumbing built to carry a tier (a `TABLES` record, a `tableId` on the wire and on the hand, a
 * `table` argument threaded through both rules) was **reverted rather than left standing**. A seam
 * built for a feature the evidence says not to build is `loadout.color` with more steps.
 *
 * ## What it guards now
 *
 * The shipped game's edge, which nothing else in the suite can see. `tests/blackjack.test.ts`
 * proves every rule is followed; only this proves the rules ADD UP to a game the house wins. The
 * dealer's stand value, the settle matrix and the 3:2 ratio are each a one-character edit away from
 * moving this number, and none of those edits looks like a money change in a diff. Falsified with
 * v1's own "Hard" rule (the dealer hitting to 19) and with a 5:2 natural — four cases and three
 * cases red respectively.
 *
 * **What it does NOT catch, stated rather than implied:** teaching the dealer to hit SOFT 17 leaves
 * every case here green, because that change makes the house ~0.2% RICHER and lands inside the band
 * below. That is the band working as described rather than a hole — it is sized for gross moves —
 * and the soft-17 boundary is pinned directly, hand by hand, in `tests/blackjack.test.ts`. A guard
 * that claimed to cover it would be the vacuous kind.
 *
 * ## Why the bound here is an UPPER one, unlike UNO's
 *
 * `tests/uno-house-odds.test.ts` measures policies rather than people, so its rates are LOWER
 * bounds and its safety rests on an argument about the unmeasured tail. Blackjack has no tail:
 * `dealHand` reshuffles `freshDeck()` on EVERY deal, so no card survives a hand, there is no count
 * to keep, and basic strategy is therefore OPTIMAL rather than merely good. The proxy below plays
 * it, so it is a CEILING on human EV. That is also the reason v1's 1/4/6-deck shoe must never be
 * ported: a persistent shoe puts the tail back and turns this bound over.
 *
 * **The proxy is computed, not copied.** A hardcoded strategy chart is a chart for ONE dealer rule,
 * which would have made the sweep above meaningless — it derives the policy from the dealer's own
 * outcome distribution, so it re-derives if the rule moves. It lives here and not in the rulebook
 * because it is an instrument rather than a tier: this game has no AI seat to spend a strategy
 * engine on, and one with no caller in the app is dead weight.
 */
import { describe, expect, it } from 'vitest';
import {
  dealerShouldHit,
  freshDeck,
  handValue,
  initialState,
  payoutCents,
  reducer,
  shuffle,
  type BlackjackState,
  type Card,
  type Rank,
} from '@boardwalk/game-logic/games/blackjack';

/* ----------------------------------------------------------- the instrument */

/** Rank draw probabilities in an infinite deck: four of the thirteen ranks are worth ten. */
const RANK_P: readonly (readonly [number, boolean, number])[] = [
  [11, true, 1 / 13],
  [2, false, 1 / 13],
  [3, false, 1 / 13],
  [4, false, 1 / 13],
  [5, false, 1 / 13],
  [6, false, 1 / 13],
  [7, false, 1 / 13],
  [8, false, 1 / 13],
  [9, false, 1 / 13],
  [10, false, 4 / 13],
];

/** Add a card to a running total, demoting an ace the moment the hand would bust. */
function add(total: number, soft: boolean, value: number, isAce: boolean): [number, boolean] {
  let t = total + value;
  let s = soft || isAce;
  if (t > 21 && s) {
    t -= 10;
    s = false;
  }
  return [t, s];
}

/** A HARD hand adding up to `total`, for probing the dealer's rule without involving an ace. */
function handOf(total: number): Card[] {
  const out: Card[] = [];
  let left = total;
  while (left > 10) {
    out.push({ rank: '10', suit: 'spades' });
    left -= 10;
  }
  out.push({ rank: String(left) as Rank, suit: 'hearts' });
  return out;
}

/**
 * The dealer's stand value, READ OFF the rulebook by probing its own predicate rather than
 * restated as 17 here. The sweep in the docblock is only meaningful against the real rule, and a
 * test that hardcodes the number it is measuring against measures nothing.
 */
const STANDS_ON = ((): number => {
  for (let total = 4; total <= 21; total++) {
    if (!dealerShouldHit(handOf(total))) return total;
  }
  return 22;
})();

/**
 * Indexed by the dealer's final TOTAL, 0..21, with `BUST` last.
 *
 * Indexed by the real total and NOT bucketed from 17, which the first draft did — and that draft
 * was biased in the direction that matters. Folding a dealer 15 or 16 into the 17 slot tells the
 * proxy that a standing 16 loses where it actually pushes, so the proxy over-hits, busts more than
 * it needs to, and returns less than an optimal player would. That understates the player and
 * therefore OVERSTATES the house edge — a measurement flattering to the house, used to price a
 * table. It moved the sweep above by up to two percentage points at the low stand values. The
 * first draft's comment claimed the bias ran the safe way, which is how it survived being written.
 */
type DealerDist = readonly number[];
const BUST = 22;
const SLOTS = 23;

/**
 * The dealer's final-total distribution from an up-card. Infinite-deck and unconditioned on the
 * hole card — the standard approximation, and the right one here because it CHOOSES the player's
 * moves rather than pricing anything. The pricing is the measurement below, which runs the real
 * reducer over a real 52-card deck.
 */
function dealerDist(standsOn: number): (upValue: number, upAce: boolean) => DealerDist {
  const memo = new Map<string, DealerDist>();
  const walk = (total: number, soft: boolean): DealerDist => {
    const out = new Array<number>(SLOTS).fill(0);
    if (total > 21) {
      out[BUST] = 1;
      return out;
    }
    if (total >= standsOn) {
      out[total] = 1;
      return out;
    }
    const key = `${String(total)}:${soft ? 's' : 'h'}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    for (const [value, isAce, p] of RANK_P) {
      const [t, s] = add(total, soft, value, isAce);
      const sub = walk(t, s);
      for (let i = 0; i < SLOTS; i++) out[i] = (out[i] ?? 0) + p * (sub[i] ?? 0);
    }
    memo.set(key, out);
    return out;
  };
  return (upValue, upAce) => walk(upValue, upAce);
}

/** What standing on this total is worth against that dealer: +1 a win, 0 a push, −1 a loss. */
function standEV(playerTotal: number, dist: DealerDist): number {
  if (playerTotal > 21) return -1;
  let ev = dist[BUST] ?? 0;
  for (let dealerTotal = 0; dealerTotal <= 21; dealerTotal++) {
    const p = dist[dealerTotal] ?? 0;
    if (p === 0) continue;
    if (playerTotal > dealerTotal) ev += p;
    else if (playerTotal < dealerTotal) ev -= p;
  }
  return ev;
}

/** The best the player can do from here, hitting as often as it likes. Memoised per up-card. */
function bestEV(dist: DealerDist): (total: number, soft: boolean) => number {
  const memo = new Map<string, number>();
  const walk = (total: number, soft: boolean): number => {
    if (total > 21) return -1;
    const key = `${String(total)}:${soft ? 's' : 'h'}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    // Seed the memo before recursing: a soft hand can hit back into itself (A,A → A,A,10 → …),
    // and without this the walk would not terminate.
    memo.set(key, standEV(total, dist));
    let hitEv = 0;
    for (const [value, isAce, p] of RANK_P) {
      const [t, s] = add(total, soft, value, isAce);
      hitEv += p * walk(t, s);
    }
    const best = Math.max(standEV(total, dist), hitEv);
    memo.set(key, best);
    return best;
  };
  return walk;
}

type Move = 'hit' | 'stand' | 'double';

/** A near-optimal player. Built once and reused — building it is the expensive part. */
function strategy(): (state: BlackjackState) => Move {
  const dist = dealerDist(STANDS_ON);
  const best = new Map<number, (total: number, soft: boolean) => number>();
  const distFor = new Map<number, DealerDist>();

  return (state: BlackjackState): Move => {
    const up = state.dealer[0];
    if (up === undefined) return 'stand';
    const upValue =
      up.rank === 'A' ? 11 : ['K', 'Q', 'J', '10'].includes(up.rank) ? 10 : Number(up.rank);
    let d = distFor.get(upValue);
    if (d === undefined) {
      d = dist(upValue, up.rank === 'A');
      distFor.set(upValue, d);
    }
    let bev = best.get(upValue);
    if (bev === undefined) {
      bev = bestEV(d);
      best.set(upValue, bev);
    }

    const { total, soft } = handValue(state.player);
    const stand = standEV(total, d);
    let dbl = 0;
    let hit = 0;
    for (const [value, isAce, p] of RANK_P) {
      const [t, s] = add(total, soft, value, isAce);
      dbl += p * 2 * standEV(t, d); // one card, then forced to stand, both sides doubled
      hit += p * bev(t, s);
    }

    if (state.player.length === 2 && dbl > hit && dbl > stand) return 'double';
    return hit > stand ? 'hit' : 'stand';
  };
}

/** A small deterministic LCG, so every number in this file is reproducible. */
function rngWith(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Play the game out and report what it returns per cent staked. 1 is break-even; above 1 is the
 * player winning. Runs the REAL reducer over a REAL shuffled 52-card deck and the REAL
 * `payoutCents`, so what is measured is money the ledger would move rather than a model of it.
 */
function measure(hands: number, seed: number, policy: (s: BlackjackState) => Move): number {
  const rng = rngWith(seed);
  const WAGER = 1000;
  let staked = 0;
  let returned = 0;

  for (let i = 0; i < hands; i++) {
    let state = reducer(initialState(), {
      type: 'deal',
      deck: shuffle(freshDeck(), rng),
      wagerCents: WAGER,
    });
    staked += WAGER;
    // Never insure — see the insurance case below for why that is the correct play, not an omission.
    if (state.phase === 'insurance') state = reducer(state, { type: 'decline' });

    let guard = 0;
    while (state.phase === 'player') {
      if (++guard > 24) throw new Error('policy did not terminate');
      const move = policy(state);
      const next = reducer(state, { type: move });
      // A policy whose move the reducer refuses would loop silently and every rate in this file
      // would be wrong in the quiet direction — the stall check `uno-house-odds` also runs.
      if (next === state) throw new Error(`reducer refused ${move}`);
      state = next;
    }
    staked += state.wagerCents - WAGER; // a double doubled the stake
    if (state.result === null) throw new Error('hand did not settle');
    returned += payoutCents(state.result, state.wagerCents);
  }
  return returned / staked;
}

/* ------------------------------------------------------------- the numbers */

/** Enough hands that the seed-to-seed swing is small against the margin asserted below. */
const HANDS = 400_000;
/** Three, because a single seed swings ±0.15% at this size — the fact that killed the tier. */
const SEEDS = [0x5eed, 0xb1ac, 0x2117];

describe('the house edge of the game we actually ship', () => {
  const optimal = strategy();
  const rates = SEEDS.map((seed) => measure(HANDS, seed, optimal));
  /**
   * The POOLED estimate, and the two assertions below deliberately use different ones.
   *
   * The absolute bound is a safety property and has to hold on every run in isolation. The margin
   * is a claim about the game's TRUE edge, and the best estimate of that is all the hands together
   * — a single 400k run swings ±0.2 percentage points on an edge of 0.5%, which is the same
   * variance that made the near-fair alternative table unpriceable and is worth not forgetting
   * here. Pinning the margin to one seed would either be too loose to mean anything or red on a
   * shuffle change that moved the number without moving the risk.
   */
  const pooled = rates.reduce((a, b) => a + b, 0) / rates.length;

  /** The rule this whole file is measured against is the rulebook's, not a number retyped here. */
  it('is measuring the dealer the game actually deals with', () => {
    expect(STANDS_ON).toBe(17);
    expect(dealerShouldHit(handOf(16))).toBe(true);
    expect(dealerShouldHit(handOf(17))).toBe(false);
  });

  /**
   * THE BOUND, and the only assertion here that must never be relaxed. A game that returns more
   * than a cent per cent staked to a near-optimal player is a money printer, and "nobody plays
   * that well" is not a defence — the proxy is a CEILING, so the claim is that nobody CAN beat it.
   */
  it('never pays a near-optimal player more than they stake', () => {
    for (const rate of rates) expect(rate).toBeLessThan(1);
  });

  /**
   * The review trigger, deliberately a different KIND from the bound above and set looser than the
   * measurement — `uno-house-odds` makes the same split for the same reason. Every figure is
   * seeded, so a band pinned to the last measurement goes red on a shuffle change that moved the
   * number without moving the risk.
   */
  it('keeps a real margin, not a hairline', () => {
    expect(pooled).toBeLessThan(0.998);
  });

  /**
   * The edge is where a 3:2 single-deck game with no split and no surrender belongs — a shade under
   * 1%. Asserted as a BAND rather than a ceiling alone, because a change that made the house far
   * richer is also a change nobody intended: one edit could make this game a faucet and the same
   * edit could make it a mugging, and both deserve a red run.
   */
  it('lands where a 3:2 single-deck game belongs', () => {
    expect(pooled).toBeGreaterThan(0.99);
    expect(pooled).toBeLessThan(1);
  });

  /**
   * THE PROXY HAS TO BE GOOD, or the ceiling above is not a ceiling. Measured against
   * mimic-the-dealer, the classic worst common strategy: if the real policy did not beat it, the
   * whole safety argument would be resting on a bug in the instrument rather than on the game.
   */
  it('plays better than mimic-the-dealer, or it is not measuring a ceiling', () => {
    const mimic = measure(60_000, 99, (s) => (handValue(s.player).total < 17 ? 'hit' : 'stand'));
    const good = measure(60_000, 99, optimal);
    expect(good).toBeGreaterThan(mimic + 0.02);
  });

  /**
   * INSURANCE IS NOT A WAY IN, and it is the one bet here whose odds are fixed by the deck rather
   * than by any rule. A fresh 52-card deck with an ace up leaves 51 unknown cards of which 16 are
   * ten-valued, so it pays 2:1 on a 16/51 = 31.4% shot against a 1/3 break-even. MEASURED rather
   * than asserted from that arithmetic, because the arithmetic is exactly the sort of thing that is
   * right on paper and wrong in the code — and because it is what justifies the proxy declining it
   * on every hand above, which is a choice the measured edge depends on.
   */
  it('never lets insurance be the edge', () => {
    const rng = rngWith(4242);
    let staked = 0;
    let returned = 0;
    for (let i = 0; i < 200_000; i++) {
      const dealt = reducer(initialState(), {
        type: 'deal',
        deck: shuffle(freshDeck(), rng),
        wagerCents: 1000,
      });
      if (dealt.phase !== 'insurance') continue;
      const after = reducer(dealt, { type: 'insure' });
      staked += after.insuranceCents;
      returned += after.insurancePaidCents;
    }
    expect(staked).toBeGreaterThan(0);
    expect(returned / staked).toBeLessThan(1);
  });
});
