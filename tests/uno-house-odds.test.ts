/**
 * THE HOUSE-ODDS SIMULATION — slice 4 of `plans/UNO_HOUSE_RULES.md`, and the only slice whose whole
 * output is a NUMBER rather than a rule.
 *
 * §4 of that plan wants to let a player bet at a table of bots, paying `ante × M` from the house at
 * a sub-fair `M` so the money flows the way it does at every other table in the building. The plan
 * then refuses to name `M`, and the sentence it refuses with is the reason this file exists:
 *
 *   > `M = N × edge` assumes a player wins about `1/N` against `sharp` bots. **That assumption is
 *   > the entire safety of the feature and nobody has measured it.**
 *
 * So this is a measuring instrument, not a rulebook. It ships as a test rather than a script for
 * the reason every guard here does: a number nobody re-derives is a number that silently stops
 * being true, and `sharp` is one refactor away from moving at any time. **A tier retune must come
 * here and read what else it moved** — that is the whole point, and it is why the bands below are
 * tight enough to go red rather than loose enough to survive.
 *
 * WHAT IT CAN AND CANNOT PROVE, stated first because it decides how the answer must be read. It
 * cannot measure a person. It measures POLICIES, so every rate below is a LOWER bound on what a
 * human extracts, never an upper one, and no arrangement of seeds turns it into one. What makes the
 * bound useful is the second measurement rather than the first: the harness plays a deliberately
 * modest CHALLENGER against `sharp` and finds the gap small, while the same harness finds the gap
 * between `sharp` and `casual` large. A game whose skill gradient has already flattened by `sharp`
 * is one where the unmeasured human tail is short — and that, not any single win rate, is what
 * licenses pricing the house at all.
 *
 * Every game is played through the REAL reducer and the REAL bots, seeded, so every number here is
 * exact and reproducible rather than sampled afresh each run.
 */
import { describe, it, expect } from 'vitest';
import {
  HOUSE_RETURN,
  HOUSE_TABLE_LEVEL,
  applyMove,
  canPlay,
  chooseAiMove,
  deal,
  housePayout,
  resolveHouseRules,
  roundOver,
  tableOf,
  winnerOf,
  type Card,
  type Move,
  type UnoGame,
  type UnoLevel,
} from '@boardwalk/game-logic/games/uno';

/** The same seeded PRNG the rest of the UNO suite uses, so a shuffle is deterministic. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UNO's declared table range (`manifest.seats`), which is exactly what has to be priced. */
const SEAT_COUNTS = [2, 3, 4, 5, 6, 7] as const;

/**
 * THE MULTIPLE §4 PAYS, as a fraction of fair odds: the house returns `N × HOUSE_RETURN` times the
 * ante to a winner, so a table of N pays strictly less than the `N×` that would be EV-neutral.
 *
 * **IT IS IMPORTED, NOT RESTATED — and that is slice 5's doing.** While the number lived here it
 * was a measurement with no consumer; it is now the constant the referee actually pays at, so this
 * harness asserts a bound on the money that moves rather than on a number that resembles it. §4.2
 * left it in the test on purpose ("a constant landing before its reader is `loadout.color`"), and
 * the reader arrived with slice 5.
 *
 * **2/3, where the measurements alone would carry 0.813**, and the gap is bought deliberately. The
 * challenger below is a LOWER bound (see the header), so the margin is not padding around a known
 * number — it is the only protection against the player this harness cannot play. At 3/4 the
 * measured break-even is cleared by 8%; at 2/3 it is cleared by 22%, which is the difference between
 * "a better human than we wrote is fine" and "a better human than we wrote is a faucet".
 *
 * The cost is named rather than hidden: the house edge this implies runs 18–27% across the table
 * sizes, which is steep beside Blackjack's. That is the correct trade here and not a compromise —
 * Blackjack's edge is computed against a rulebook that is fully known, and this one is computed
 * against an opponent nobody has measured.
 */

/**
 * The most a player may win, as a multiple of fair, before the house starts losing money:
 * `EV = ante × (p × M − 1)`, so `EV < 0` needs `p × M < 1`, and with `M = N × HOUSE_RETURN` that is
 * `p × N < 1 / HOUSE_RETURN`. **`p × N` is the "lift" every assertion below is phrased in** — a
 * player winning exactly their fair share lifts 1.00 — because it is the one form of the number
 * that is comparable across seat counts.
 */
const MAX_SAFE_LIFT = 1 / HOUSE_RETURN; // 1.50

// ── The challenger: a human proxy, deliberately modest ───────────────────────────────────────────

const isWildCard = (c: Card): boolean => c.color === 'wild';
const PALETTE = ['red', 'blue', 'green', 'yellow'] as const;
type Palette = (typeof PALETTE)[number];

/**
 * WHAT AN ATTENTIVE PERSON DOES, and nothing more. §4.2 names the worry precisely — *"a person who
 * counts colours may well beat three of them far more than 25% of the time"* — so the challenger is
 * built to be exactly that person and no better: it counts its own colours, it watches hand sizes,
 * it saves wilds, and it calls UNO. There is no search, no card counting across the table and no
 * memory of what anyone drew.
 *
 * MODEST ON PURPOSE, because the argument runs the right way only if it is. A strong engine that
 * beat `sharp` would prove nothing anyone can act on (nobody plays like an engine); a cheap policy
 * that a real person would recognise as "how I play" is the one whose result transfers. If THIS
 * wins little more than its fair share, the room above `sharp` is small.
 *
 * It lives in the test rather than in `ai.ts` for the reason this file exists at all: it is an
 * instrument, not a tier. A third `UnoLevel` with no manifest choice behind it would be
 * `loadout.color` — a kind with no reader — and the AI-difficulty rule is that a declared choice and
 * a level are a bijection.
 */
function challengerMove(game: UnoGame, seat: number): Move {
  const hand = game.hands[seat] ?? [];
  const playable = hand.filter((c) => canPlay(c, tableOf(game)));
  const pickable = playable[0];
  if (pickable === undefined) return { type: 'draw' };

  // Going out beats every other consideration, and it is the one case where a wild's colour is
  // irrelevant — the hand is empty behind it.
  if (hand.length === 1) {
    return isWildCard(pickable)
      ? { type: 'play', cardId: pickable.id, chosenColor: 'red', declareUno: false }
      : { type: 'play', cardId: pickable.id, declareUno: false };
  }

  const tally: Record<Palette, number> = { red: 0, blue: 0, green: 0, yellow: 0 };
  for (const c of hand) if (c.color !== 'wild') tally[c.color] += 1;
  let strongest: Palette = 'red';
  for (const color of PALETTE) if (tally[color] > tally[strongest]) strongest = color;

  // Watching hand sizes: is whoever plays next about to go out?
  const counts = game.hands.map((h) => h.length);
  const next = (seat + game.direction + counts.length) % counts.length;
  const threatened = (counts[next] ?? 99) <= 2;

  // Lower is played first. The weights are ordinary priorities, not tuning: hit a player who is
  // nearly out, keep the colour you are strong in alive, and hold the wilds back.
  const cost = (c: Card): number => {
    let score = 0;
    if (threatened && (c.kind === 'draw2' || c.kind === 'wild4' || c.kind === 'skip')) score -= 40;
    if (isWildCard(c)) score += 30;
    if (c.color === strongest) score -= 8;
    return score;
  };
  const pick = playable.slice().sort((a, b) => cost(a) - cost(b))[0] ?? pickable;

  const declareUno = hand.length === 2;
  return isWildCard(pick)
    ? { type: 'play', cardId: pick.id, chosenColor: strongest, declareUno }
    : { type: 'play', cardId: pick.id, declareUno };
}

// ── The harness ──────────────────────────────────────────────────────────────────────────────────

type Policy = UnoLevel | 'challenger';

const moveFor = (game: UnoGame, seat: number, policy: Policy, rng: () => number): Move =>
  policy === 'challenger' ? challengerMove(game, seat) : chooseAiMove(game, seat, policy, rng);

/**
 * Play ONE round to its end and answer who came first, or `-1`.
 *
 * The `next === game` break is the stall guard every UNO test carries: `applyMove` is total, so a
 * move it refuses returns the SAME object, and on a bot's turn that is a table that never moves
 * again. It is asserted rather than merely broken out of — see the harness's own test below, which
 * would otherwise happily measure win rates over games that hung.
 */
function playRound(
  seatCount: number,
  policies: readonly Policy[],
  rules: unknown,
  rng: () => number,
  lead: number
): { winner: number; stalled: boolean } {
  let game = deal(seatCount, rng, lead, resolveHouseRules(rules));
  let guard = 0;
  while (!roundOver(game) && guard < 4_000) {
    const seat = game.turn;
    const next = applyMove(game, seat, moveFor(game, seat, policies[seat] ?? 'sharp', rng), rng);
    if (next === game) return { winner: -1, stalled: true };
    game = next;
    guard += 1;
  }
  return { winner: winnerOf(game), stalled: false };
}

interface Result {
  /** Wins by seat. */
  readonly wins: readonly number[];
  /** Each seat's wins as a multiple of its fair share — 1.00 is exactly fair. */
  readonly lift: readonly number[];
  readonly stalls: number;
}

const summarise = (wins: number[], rounds: number, seatCount: number, stalls: number): Result => ({
  wins,
  lift: wins.map((w) => (w / rounds) * seatCount),
  stalls,
});

/**
 * INDEPENDENT ROUNDS, all led from seat 0 — every round a fresh deal and a fresh table.
 *
 * This is the measurement that OVERSTATES a challenger sitting in seat 0, because that seat also
 * holds the lead in every single round and the lead is worth something (proved below). Overstating
 * is the correct direction for a safety bound, which is why the pricing test takes the worse of
 * this and the session below rather than the more realistic one.
 */
function independentRounds(
  seatCount: number,
  policies: readonly Policy[],
  rules: unknown,
  rounds: number
): Result {
  const wins = new Array<number>(seatCount).fill(0);
  let stalls = 0;
  for (let r = 0; r < rounds; r += 1) {
    const { winner, stalled } = playRound(seatCount, policies, rules, seeded(1 + r * 7919), 0);
    if (stalled) stalls += 1;
    if (winner >= 0) wins[winner] = (wins[winner] ?? 0) + 1;
  }
  return summarise(wins, rounds, seatCount, stalls);
}

/**
 * A SESSION — one table playing round after round, where **the winner of a round leads the next**.
 *
 * This is how UNO is actually dealt (`deal`'s `firstSeat` is the last round's winner, and a betting
 * table settles each round as its own match), and it is a different measurement rather than a
 * tidier one: the lead is a rotating asset here instead of a fixed endowment. Which of the two
 * prices the house is not obvious in advance, so both are measured and the worse one is used.
 */
function session(
  seatCount: number,
  policies: readonly Policy[],
  rules: unknown,
  rounds: number
): Result {
  const wins = new Array<number>(seatCount).fill(0);
  const rng = seeded(4242);
  let stalls = 0;
  let lead = 0;
  for (let r = 0; r < rounds; r += 1) {
    const { winner, stalled } = playRound(seatCount, policies, rules, rng, lead);
    if (stalled) stalls += 1;
    if (winner >= 0) {
      wins[winner] = (wins[winner] ?? 0) + 1;
      lead = winner;
    }
  }
  return summarise(wins, rounds, seatCount, stalls);
}

const table = (seatCount: number, policy: Policy): Policy[] =>
  new Array<Policy>(seatCount).fill(policy);

/** A table of `sharp` with the challenger (or whoever) in seat 0 — the shape §4 actually sells. */
const oneAgainstSharp = (seatCount: number, hero: Policy): Policy[] => {
  const seats = table(seatCount, 'sharp');
  seats[0] = hero;
  return seats;
};

const ROUNDS = 2_000;
const NO_RULES = {};
const STACKING = { stack: true };

/**
 * MEASURED ONCE, READ MANY TIMES. Every run is deterministic in its seeds, so the same
 * configuration always yields the same number and computing it twice is pure waste — the pricing
 * bound and its headroom are two assertions about ONE measurement, and the first draft of this file
 * spent half its 33 seconds proving that by running the whole sweep again.
 *
 * Memoising is also what keeps the two honest: a headroom computed from a second, separately-seeded
 * sweep could disagree with the bound it is supposed to be the margin of.
 */
const cache = new Map<string, Result>();
function measure(
  regime: 'independent' | 'session',
  seatCount: number,
  policies: readonly Policy[],
  rules: unknown,
  rounds: number
): Result {
  const key = `${regime}:${String(seatCount)}:${policies.join(',')}:${JSON.stringify(rules)}:${String(rounds)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const run = regime === 'independent' ? independentRounds : session;
  const out = run(seatCount, policies, rules, rounds);
  cache.set(key, out);
  return out;
}

/**
 * THE WORST LIFT THE CHALLENGER ACHIEVES ANYWHERE — over both regimes, both rule sets and every
 * declared table size. It is the single number the multiple is priced against, and taking the
 * maximum is the point: a bound assembled from the friendlier half of a measurement is not a bound.
 */
function worstChallengerLift(): number {
  let worst = 0;
  for (const n of SEAT_COUNTS) {
    for (const rules of [NO_RULES, STACKING]) {
      const seats = oneAgainstSharp(n, 'challenger');
      worst = Math.max(
        worst,
        measure('independent', n, seats, rules, ROUNDS).lift[0] ?? 0,
        measure('session', n, seats, rules, ROUNDS).lift[0] ?? 0
      );
    }
  }
  return worst;
}

// ── The measurements ─────────────────────────────────────────────────────────────────────────────

describe('the harness measures games that were actually played', () => {
  it('never stalls, at any table size, under either rule set', () => {
    // Without this every rate below is meaningless in the quiet direction: a stalled round has no
    // winner, so a policy that hangs the table would simply appear to win less often. It is the
    // same reason the tier tests play to a WINNER rather than to a legal move.
    for (const n of SEAT_COUNTS) {
      for (const rules of [NO_RULES, STACKING]) {
        expect(independentRounds(n, oneAgainstSharp(n, 'challenger'), rules, 200).stalls).toBe(0);
      }
    }
  });
});

describe('the null — identical players share a table equally', () => {
  it('gives every seat its fair share over a session, at every table size', () => {
    // The premise `M = N × edge` rests on this and nothing else. If the rotation quietly favoured a
    // seat, the multiple would have to be priced against the BEST chair rather than the average one,
    // and the human always knows which chair they are in.
    for (const n of SEAT_COUNTS) {
      const r = measure('session', n, table(n, 'sharp'), NO_RULES, ROUNDS);
      for (const lift of r.lift) {
        expect(lift).toBeGreaterThan(0.9);
        expect(lift).toBeLessThan(1.1);
      }
    }
  });

  it('holds with stacking on, which redistributes cards but not chances', () => {
    // §4.2 asked for this one by name: stacking punishes whoever is holding the wrong hand, and
    // there was no reason in advance to expect that to fall evenly around the table.
    for (const n of SEAT_COUNTS) {
      const r = measure('session', n, table(n, 'sharp'), STACKING, ROUNDS);
      for (const lift of r.lift) {
        expect(lift).toBeGreaterThan(0.9);
        expect(lift).toBeLessThan(1.1);
      }
    }
  });
});

describe('the lead is worth something — and only for one round', () => {
  it('pays the opening seat above fair in an independent round, and by more than heads-up', () => {
    // MEASURED, all-sharp: seat 0 lifts 1.005 heads-up, 1.078 at four and peaks at 1.209 at six,
    // while the last seat sits correspondingly below fair. It is NOT monotone in the table size
    // (seven measures 1.095, below six), so only the heads-up-to-seven comparison is asserted. This
    // is a real edge and it is the one number here a single-round product WOULD be priced against.
    const lifts = SEAT_COUNTS.map((n) =>
      measure('independent', n, table(n, 'sharp'), NO_RULES, ROUNDS)
    );
    for (const r of lifts) expect(r.lift[0] ?? 0).toBeGreaterThan(1.0);
    // It grows with the table: heads-up the lead is half a tempo, at seven it is most of a lap.
    const heads = lifts[0]?.lift[0] ?? 0;
    const seven = lifts[SEAT_COUNTS.length - 1]?.lift[0] ?? 0;
    expect(seven).toBeGreaterThan(heads);
  });

  it('and the same advantage vanishes over a session, because the lead rotates to the winner', () => {
    // THE FINDING THAT DECIDES WHICH NUMBER PRICES THE HOUSE. The advantage attaches to the LEAD,
    // not to the SEAT, and `deal` hands the lead to whoever just won — so over a session every seat
    // holds it in proportion to its own wins and the effect cancels. A betting table plays rounds
    // back to back, so this is the regime it lives in.
    for (const n of SEAT_COUNTS) {
      const one = measure('independent', n, table(n, 'sharp'), NO_RULES, ROUNDS).lift[0] ?? 0;
      const many = measure('session', n, table(n, 'sharp'), NO_RULES, ROUNDS).lift[0] ?? 0;
      expect(Math.abs(many - 1)).toBeLessThan(Math.abs(one - 1));
    }
  });
});

describe('the tiers are ordered, which is the whole premise of pinning `sharp`', () => {
  it('has `sharp` beating a table of `casual` by a wide margin at every table size', () => {
    // §4.1 pins the difficulty to `sharp` when a stake is set, and that only prices anything if
    // `sharp` is genuinely the strong tier. MEASURED: 1.237× fair heads-up rising to 1.638× at
    // seven — a *policy* difference is worth far more than either the lead (1.005–1.209) or the
    // challenger's whole edge over `sharp` (1.093–1.230). That ordering is the calibration that
    // makes the next block's small number meaningful rather than merely reassuring: the gradient
    // below `sharp` is steep and the gradient above it is shallow, which is what a game whose skill
    // saturates looks like.
    for (const n of SEAT_COUNTS) {
      const seats = table(n, 'casual');
      seats[0] = 'sharp';
      const lift = measure('independent', n, seats, NO_RULES, ROUNDS).lift[0] ?? 0;
      expect(lift).toBeGreaterThan(1.15);
    }
  });
});

describe('the pricing bound — what the house may safely pay', () => {
  it('holds the challenger under the break-even lift at every table size and both rule sets', () => {
    // THE GUARD. `M = N × HOUSE_RETURN` is safe exactly while the best player anyone has measured
    // lifts less than `1 / HOUSE_RETURN`. MEASURED: the challenger lifts 1.093 heads-up, 1.130 at
    // four and 1.230 at six — its worst anywhere — against a bound of 1.50.
    //
    // Both regimes and both rule sets, taking the WORSE of each — a bound assembled from the
    // friendlier half of a measurement is not a bound.
    for (const n of SEAT_COUNTS) {
      for (const rules of [NO_RULES, STACKING]) {
        const seats = oneAgainstSharp(n, 'challenger');
        const worst = Math.max(
          measure('independent', n, seats, rules, ROUNDS).lift[0] ?? 0,
          measure('session', n, seats, rules, ROUNDS).lift[0] ?? 0
        );
        expect(worst).toBeGreaterThan(1.0); // it IS better than sharp — otherwise this proves nothing
        expect(worst).toBeLessThan(MAX_SAFE_LIFT);
      }
    }
  });

  it('keeps a fifth of the bound in hand, which is what pays for the player it cannot play', () => {
    // The margin IS the feature, and it is asserted rather than left as a comment: the challenger is
    // a lower bound on human skill, so what protects the house is the distance between the number
    // measured and the number that breaks even.
    //
    // MEASURED: worst lift **1.230** (six seats), bound 1.50, so the headroom is **1.22× — a real
    // person has to be a further 22% better than the challenger** before `2/3` starts losing money.
    // At `3/4` the same headroom is 8%, which is the whole argument for the smaller number and the
    // reason it is asserted here rather than described.
    //
    // THIS IS A REVIEW TRIGGER, NOT THE SAFETY BOUND — the test above is the safety bound. The band
    // is 1.15 rather than 1.21 for a reason worth stating, because the tighter number is the tempting
    // one: every figure here is seeded and therefore exact, so a band pinned to the last measurement
    // goes red on ANY change to the shuffle, the deal order or the reducer's card ordering — changes
    // that move the number without moving the risk. Firing at 1.15 still fires long before 1.00,
    // which is where the house actually starts losing, and it fires while the multiple is a decision
    // rather than a ledger row. If it goes red: re-read the table in the plan, do not widen the band.
    expect(MAX_SAFE_LIFT / worstChallengerLift()).toBeGreaterThan(1.15);
  });

  it('prices the payout the referee ACTUALLY pays, at the tier it actually deals', () => {
    // WHAT MAKES THIS A GUARD ON MONEY RATHER THAN A MEASUREMENT. Everything above is phrased in
    // lift, which is a ratio and could stay green while the cents diverged; this is the line that
    // ties it to the ledger. `housePayout` is the shared function the settle pays from, so it is
    // asserted to BE `ante × N × HOUSE_RETURN` — falsified by re-pricing the payout without moving
    // `HOUSE_RETURN`, which every assertion above would otherwise sail through.
    for (let n = 2; n <= 7; n += 1) {
      for (const ante of [100, 2_500, 100_000]) {
        expect(housePayout(ante, n)).toBe(Math.floor(ante * n * HOUSE_RETURN));
        // Sub-fair at every size, which is the entire distinction from v1's version.
        expect(housePayout(ante, n)).toBeLessThan(ante * n);
      }
    }
    // AND THE TIER. Every rate in this file was measured against `sharp` opponents; the referee
    // pins a house table to `HOUSE_TABLE_LEVEL`, and if that ever stops being the level measured
    // here the whole table above is priced against a game nobody is playing.
    expect(oneAgainstSharp(4, 'challenger').slice(1)).toEqual([
      HOUSE_TABLE_LEVEL,
      HOUSE_TABLE_LEVEL,
      HOUSE_TABLE_LEVEL,
    ]);
  });
});
