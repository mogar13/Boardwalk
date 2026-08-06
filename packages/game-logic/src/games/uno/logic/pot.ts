/**
 * THE POT — who pays, how much, and what the winner takes.
 *
 * Pure, shared, and imported by BOTH sides on purpose. The referee pays the pot; the board draws
 * it. If those were two pieces of arithmetic the UI would eventually quote a number the ledger did
 * not pay, which is a worse failure than paying the wrong number — it is paying the right number
 * while telling the player it was a different one. CLAUDE.md's Money rule ("there is no server copy
 * of the money rules — both sides import the same module") is exactly this, and `PRICES_CENTS`
 * being DERIVED from the shared catalogue rather than transcribed from it is the precedent.
 *
 * WHAT IS DELIBERATELY NOT HERE. This is slice 1 of v1's pot: **ante at the deal, winner takes
 * the pot**. v1 also had a poker layer — raise on your turn, everyone still in owes call-or-fold
 * when their own turn comes round, three raises a round capped at 3× the ante, short stacks shove
 * and stay in, no side pots. That is a second slice, and it is separate because it is the half
 * that changes UNO's RULES: a folded seat leaves the turn rotation, so a reverse acts as a skip
 * once only two players are LIVE rather than two seated. Ante-only touches `uno.ts` not at all.
 *
 * The shape below is built to receive it. `stakes` is already a per-seat array rather than one
 * number times a count, and `potOf` already sums it, because that is the invariant the whole
 * design rests on and it should not have to be re-derived when raising arrives:
 *
 *     the pot is the LITERAL SUM of what everyone put in
 *
 * v1 states it in those words, and it is what makes money conserved "no matter who paid what" —
 * a short stack that could only cover half an ante is still exactly its own contribution, and no
 * arrangement of stakes can create or destroy a chip.
 */

/** A seat, narrowed to the two facts the pot cares about. Structurally the OS's `Seat`. */
export interface PotSeat {
  readonly kind: 'open' | 'human' | 'ai';
  readonly uid: string | null;
}

/**
 * A POT MADE OF PLAYERS' MONEY NEEDS TWO PLAYERS.
 *
 * Bots have no bankroll, so a bot cannot ante. One human against six bots would therefore be a pot
 * made of that player's own ante handed straight back — a betting UI that cannot move a chip,
 * which is worse than no betting UI.
 *
 * **This used to be the threshold between betting and not; since slice 5 it is the threshold
 * between a PLAYERS' pot and a HOUSE one** (see `potBacking`). What has not changed by one line is
 * the thing it was bought to refuse: v1's *"the house antes for each bot so the pot matches what
 * the player put up"*, which on a 4-seat table is a $25 stake winning $100 — a $75 grant on a coin
 * flip, at FAIR odds, funded by nobody. This repo spent a whole plan getting `refillGrantFor` right
 * precisely so that no sequence of payouts leaves anyone richer than the rules intend. A house pot
 * paid at `HOUSE_RETURN` of fair is the opposite arrangement: the money flows the way it does at
 * every other table in the building.
 */
export const MIN_HUMANS_TO_BET = 2;

/**
 * WHAT THE HOUSE RETURNS, AS A FRACTION OF FAIR ODDS — the one number slice 5 exists to place, and
 * the only place in this repo it may be spelled.
 *
 * A table of `N` seats pays a winning player `ante × N × HOUSE_RETURN`, so it pays strictly less
 * than the `N×` that would be EV-neutral, and the difference is the house edge.
 *
 * **2/3, where the MEASUREMENTS ALONE would carry 0.813.** `tests/uno-house-odds.test.ts` played
 * 2,000 seeded rounds a cell through the real reducer and the real bots at every declared table
 * size and under both rule sets, and the attentive-human proxy's worst lift anywhere was **1.230**
 * (six seats) against a break-even of `1 / HOUSE_RETURN`. That harness imports THIS constant rather
 * than restating it, so the bound it asserts is the bound the referee pays at.
 *
 * THE ASSUMPTION, WRITTEN NEXT TO THE CONSTANT because retuning a tier is what silently re-prices
 * it: the number is safe because `p × N < 1 / HOUSE_RETURN` for the best player anyone has
 * MEASURED, and everything measured is a policy rather than a person — so every figure is a LOWER
 * bound on human skill and the margin is the only protection against the player a harness cannot
 * play. The extra quarter-turn past 3/4 is that protection and not timidity. **Anyone who changes
 * `chooseAiMove` at `sharp` has to go back to that test and re-read the table**, exactly as a
 * mastery chain added without a Pi deploy has to go back to the shelf.
 *
 * Spelled as a numerator and a denominator, with the rate DERIVED, so the payout below can be
 * computed in integer arithmetic and the two spellings cannot drift.
 */
export const HOUSE_RETURN_NUMERATOR = 2;
export const HOUSE_RETURN_DENOMINATOR = 3;
export const HOUSE_RETURN = HOUSE_RETURN_NUMERATOR / HOUSE_RETURN_DENOMINATOR;

/**
 * WHAT A HOUSE TABLE PAYS A WINNER, gross, in integer cents: `ante × seats × HOUSE_RETURN`.
 *
 * Gross, so it INCLUDES the stake the player already paid — `EV = ante × (p × M − 1)` is the form
 * the odds were measured in, and quoting a net figure here would make the harness and the ledger
 * two different pieces of arithmetic.
 *
 * Floored, which is `potSplit`'s discipline one function across: floor the MONEY, never the rate,
 * and a floor only ever favours the house. The multiplication is integer throughout (`× 2 / 3`
 * rather than `× 0.666…`) so a large ante cannot land a fraction of a cent in the ledger.
 *
 * Garbage in, zero out, never throws — `stakePerSeat`'s rule, for its reason.
 */
export function housePayout(anteCents: number, seatCount: number): number {
  if (!Number.isFinite(anteCents) || !Number.isFinite(seatCount)) return 0;
  const ante = Math.floor(anteCents);
  const seats = Math.floor(seatCount);
  if (ante <= 0 || seats <= 0) return 0;
  return Math.floor((ante * seats * HOUSE_RETURN_NUMERATOR) / HOUSE_RETURN_DENOMINATOR);
}

/**
 * THE MOST ONE ROUND MAY PAY ONE SEAT — the per-match ceiling §4.1 asks for, and the reason it
 * cannot be a constant.
 *
 * `DEFAULT_PAYOUT_MULTIPLE` is 3× and could never bound this: a 7-seat human pot legitimately pays
 * a player 7× their stake, and a constant sized for that is wide open on a 2-seat table. So the
 * bound is computed from the MATCH's own facts — its ante and its seat count — the way blackjack's
 * 2.5× is computed from its own rules.
 *
 * `ante × every chair` bounds BOTH modes at once, which is why it is one function rather than two:
 * a players' pot is `ante × payers` and payers never exceed chairs, and a house pot is `2/3` of the
 * same product. **So the ceiling never binds on an honest round** — it is the guard that a mistake
 * in the pot arithmetic cannot mint unbounded money, and a settle that clamps is a bug upstream
 * rather than a rule doing its job. It CLAMPS rather than refusing, deliberately: a settle that
 * threw would roll back its own transaction and leave the antes taken and the round unsettled
 * forever, which is a worse failure than paying a bounded amount.
 */
export function maxRoundPayout(anteCents: number, seatCount: number): number {
  if (!Number.isFinite(anteCents) || !Number.isFinite(seatCount)) return 0;
  const ante = Math.floor(anteCents);
  const seats = Math.floor(seatCount);
  if (ante <= 0 || seats <= 0) return 0;
  return ante * seats;
}

/**
 * WHO IS FUNDING THIS TABLE'S POT. The question `stakePerSeat` and `potFor` both start from, and
 * the one the lobby's copy turns on.
 *
 * - `'players'` — two or more humans, each paying the ante. Conserved by construction: the pot is
 *   the literal sum of what they put in, and nobody can be paid a cent nobody staked.
 * - `'house'` — exactly ONE human, against bots. The player antes and the house funds the rest of
 *   the pot, paying `HOUSE_RETURN` of fair odds if they win and keeping the ante if they do not.
 * - `'none'` — no usable ante, or nobody with an account to take one from.
 *
 * A HOUSE TABLE NEEDS AN OPPONENT. One human at a one-seat table would be paid `2/3` of their own
 * stake for winning a game they could not lose, which is the only arrangement of this rule that
 * pays out backwards. It cannot arise (`seats.min` is 2 and `startMatch` refuses a smaller table),
 * and it is refused here anyway, where the arithmetic is rather than where the caller is.
 */
export type PotBacking = 'none' | 'players' | 'house';

/** The seat indices holding a human with an account — the only seats that can stake anything. */
export function humanSeats(seats: readonly PotSeat[]): number[] {
  const out: number[] = [];
  seats.forEach((seat, index) => {
    if (seat.kind === 'human' && seat.uid !== null && seat.uid !== '') out.push(index);
  });
  return out;
}

export function potBacking(seats: readonly PotSeat[], anteCents: number): PotBacking {
  if (!Number.isFinite(anteCents) || Math.floor(anteCents) <= 0) return 'none';
  const humans = humanSeats(seats).length;
  if (humans >= MIN_HUMANS_TO_BET) return 'players';
  if (humans === 1 && seats.length >= 2) return 'house';
  return 'none';
}

/**
 * What each human actually pays, given the table's ante.
 *
 * `0` — the table plays for nothing — when the ante is zero, when the number is not a usable
 * integer of cents, or when there is nobody with an account to take one from. Sanitised rather than
 * trusted because this is money: `bet.ts` REFUSES a fractional bet rather than rounding it, for the
 * reason v1's `parseInt` gave when blackjack's 3:2 natural silently dropped a chip.
 *
 * **A LONE PLAYER PAYS THE SAME ANTE AS ANYBODY ELSE.** It answered `0` until slice 5, which was
 * the whole of "betting needs two humans"; what differs at a house table is not the stake but WHO
 * FUNDS THE REST OF THE POT (`houseStakeFor`). Keeping one stake means the ledger row, the wager
 * row and the refund on a void are the same in both modes, and only the pot's size moves.
 *
 * Note this answers a STAKE, never a balance. Whether a player can COVER it is the referee's
 * question, asked against the ledger, and a player who cannot refuses the whole start — nothing
 * here knows what anyone has.
 */
export function stakePerSeat(seats: readonly PotSeat[], anteCents: number): number {
  return potBacking(seats, anteCents) === 'none' ? 0 : Math.floor(anteCents);
}

/**
 * Every seat's contribution, indexed by seat. An AI or open seat contributes nothing and is `0`
 * rather than absent, so the array lines up with `seats` and a caller never has to reconcile two
 * different indexings of one table (the `-1` sentinel lesson: a hole in a wire shape is a hole
 * somebody eventually reads as a seat).
 */
export function stakesFor(seats: readonly PotSeat[], anteCents: number): number[] {
  const stake = stakePerSeat(seats, anteCents);
  return seats.map((seat) =>
    seat.kind === 'human' && seat.uid !== null && seat.uid !== '' ? stake : 0
  );
}

/**
 * THE POT IS THE SUM OF THE STAKES. Not `ante × players`, which is the same number today and stops
 * being the same number the moment a short stack shoves for less than the ante — v1's own rule, and
 * the reason its pot was correct under raising while its UI was not.
 */
export function potOf(stakes: readonly number[]): number {
  return stakes.reduce((total, stake) => total + (Number.isFinite(stake) ? stake : 0), 0);
}

/**
 * WHAT THE HOUSE PUTS IN — zero at a table of people, and the rest of the pot at a table of bots.
 *
 * Stated as a STAKE rather than as a payout on purpose, because it is what keeps the file's one
 * invariant true in both modes: *the pot is the literal sum of what everyone put in*, with the
 * house simply being one of "everyone". `potSplit` then divides a pot that conserves, `voidMatch`
 * refunds the players' half and the house's evaporates, and no downstream reader acquires a case.
 *
 * The amount is what makes the winner's return exactly `housePayout` — the player has already put
 * their ante in, so the house tops the pot up to the figure the odds were measured against.
 */
export function houseStakeFor(seats: readonly PotSeat[], anteCents: number): number {
  if (potBacking(seats, anteCents) !== 'house') return 0;
  const ante = Math.floor(anteCents);
  return Math.max(0, housePayout(ante, seats.length) - ante);
}

/** The pot a table would build at this ante — what the players staked, plus what the house did. */
export function potFor(seats: readonly PotSeat[], anteCents: number): number {
  return potOf(stakesFor(seats, anteCents)) + houseStakeFor(seats, anteCents);
}

/** Is this table playing for money at all? What the lobby and the board both ask before drawing a pot. */
export function isBetting(seats: readonly PotSeat[], anteCents: number): boolean {
  return stakePerSeat(seats, anteCents) > 0;
}

/**
 * HOW A POT SPLITS ACROSS RANKED PLACES — `places` positions, best first, in integer cents.
 *
 * `places` is THE NUMBER OF PAYING SEATS THAT PLACED, not the number of chairs. A bot stakes
 * nothing, so it takes nothing, and it is simply absent from this ladder rather than allocated a
 * share that would then have to go somewhere. That keeps one rule covering both modes: **the pot is
 * split among the seats that PAID and PLACED, in the order they placed.** Playing for places, that
 * is every human at the table; playing the ordinary game, `finished` holds one seat, so it is
 * `[winner]` — and `potSplit(pot, 1)` is `[pot]`, winner takes all, today's behaviour to the cent.
 * If a bot goes out first in the ordinary game no paying seat placed at all, `places` is 0, and the
 * pot goes to nobody — which is what this game already did, now stated as a consequence of one rule
 * rather than as a separate case.
 *
 * THE LADDER: the top HALF of the paying places share it, weighted `k, k-1, … 1`. Two properties
 * bought deliberately —
 *
 *   • two and three payers collapse to winner-takes-all (`floor(k/2)` is 1), so the tables that
 *     exist today are unchanged whether or not they turn ranked places on. A house rule that
 *     re-prices a game nobody asked to re-price is the default-change mistake in a different hat;
 *   • placing badly costs you. A ladder that pays every position hands last place a rebate for
 *     losing, which is a softer version of the faucet §4 of the plan exists to refuse.
 *
 * CONSERVATION IS BY CONSTRUCTION, NOT BY ARITHMETIC LUCK. Every place below first is floored and
 * the REMAINDER goes to first, so the shares sum to exactly the pot at every table size and every
 * stake. A percentage split that rounds each share independently is the one thing the ledger cannot
 * absorb — it either mints a cent or loses one, on every single hand.
 *
 * Garbage in, zeroes out, never throws: a non-finite or negative pot pays nothing rather than
 * writing a nonsense ledger row, the discipline `stakePerSeat` follows one function up.
 */
export function potSplit(potCents: number, places: number): number[] {
  if (!Number.isFinite(places)) return [];
  const seats = Math.floor(places);
  if (seats <= 0) return [];

  const out = new Array<number>(seats).fill(0);
  const pot = Number.isFinite(potCents) && potCents > 0 ? Math.floor(potCents) : 0;
  if (pot === 0) return out;

  const paid = Math.max(1, Math.floor(seats / 2));
  const weight = (paid * (paid + 1)) / 2;
  let given = 0;
  for (let place = 1; place < paid; place += 1) {
    const share = Math.floor((pot * (paid - place)) / weight);
    out[place] = share;
    given += share;
  }
  out[0] = pot - given; // the remainder rides with first place — see above
  return out;
}

/**
 * THE SEATS A POT IS DIVIDED BETWEEN, best first — what `potSplit` is handed the length of.
 *
 * At a table of PEOPLE it is exactly what it has always been: the paying seats in the order they
 * placed. A bot on the podium is absent rather than allocated a share that would have to go
 * somewhere, which is what makes the split conserve.
 *
 * **A HOUSE-FUNDED POT PAYS FIRST PLACE AND NOTHING ELSE**, and that is the one line here that is
 * not a filter. The ladder exists to divide a pot among the people who paid into it; a house pot
 * has ONE payer, so `places.filter(paying)` is that player whether they came first or last, and
 * `potSplit(pot, 1)` would then hand them the whole thing for finishing fourth of five. Under
 * `playToLast` that is not a corner case, it is most rounds.
 *
 * The deeper reason is that first place is the only thing anybody MEASURED: `HOUSE_RETURN` is
 * priced off a win rate — the probability of coming first — so paying a share for placing third
 * would be paying out on an event with no number behind it. When the player does not come first the
 * list is empty, `potSplit` pays nobody, and the house keeps the pot: the same shape as a bot
 * winning the ordinary game, which this repo already does.
 */
export function rankedPayees(
  places: readonly number[],
  paying: readonly number[],
  houseFunded: boolean
): number[] {
  const pays = new Set(paying);
  if (!houseFunded) return places.filter((seat) => pays.has(seat));
  const first = places[0];
  return first !== undefined && pays.has(first) ? [first] : [];
}
