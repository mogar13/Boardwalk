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
 * BETTING NEEDS TWO HUMANS.
 *
 * Bots have no bankroll, so a bot cannot ante. One human against six bots would therefore be a pot
 * made of that player's own ante handed straight back — a betting UI that cannot move a chip,
 * which is worse than no betting UI.
 *
 * v1 solved it the other way: *"The house antes for each bot so the pot matches what the player put
 * up."* On a 4-seat table that is a $25 stake winning $100 — a $75 grant on a coin flip, funded by
 * nobody. This repo spent a whole plan getting `refillGrantFor` right precisely so that no sequence
 * of payouts leaves anyone richer than the rules intend (a top-up TO a floor, never a grant OF an
 * amount); a house-funded pot fails that on the first hand. So the house does not ante, and below
 * two humans the table plays for XP and stats alone.
 */
export const MIN_HUMANS_TO_BET = 2;

/** The seat indices holding a human with an account — the only seats that can stake anything. */
export function humanSeats(seats: readonly PotSeat[]): number[] {
  const out: number[] = [];
  seats.forEach((seat, index) => {
    if (seat.kind === 'human' && seat.uid !== null && seat.uid !== '') out.push(index);
  });
  return out;
}

/**
 * What each human actually pays, given the table's ante.
 *
 * `0` — the table plays for nothing — when the ante is zero, when the number is not a usable
 * integer of cents, or when there are not two humans to make a pot out of. Sanitised rather than
 * trusted because this is money: `bet.ts` REFUSES a fractional bet rather than rounding it, for the
 * reason v1's `parseInt` gave when blackjack's 3:2 natural silently dropped a chip.
 *
 * Note this answers a STAKE, never a balance. Whether a player can COVER it is the referee's
 * question, asked against the ledger, and a player who cannot refuses the whole start — nothing
 * here knows what anyone has.
 */
export function stakePerSeat(seats: readonly PotSeat[], anteCents: number): number {
  if (!Number.isFinite(anteCents)) return 0;
  const ante = Math.floor(anteCents);
  if (ante <= 0) return 0;
  return humanSeats(seats).length >= MIN_HUMANS_TO_BET ? ante : 0;
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

/** The pot a table would build at this ante. `potOf(stakesFor(...))`, named because both sides say it. */
export function potFor(seats: readonly PotSeat[], anteCents: number): number {
  return potOf(stakesFor(seats, anteCents));
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
