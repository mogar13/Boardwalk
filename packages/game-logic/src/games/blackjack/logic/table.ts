/**
 * BLACKJACK AT A TABLE — the same rulebook, dealt to several chairs at once.
 *
 * THIS FILE ADDS NO RULE. Every question about a hand — what it totals, whether it busts, whether
 * two cards make a natural, when the dealer draws, who beat whom, what that pays, what insurance
 * costs and returns — is answered by `blackjack.ts`, imported below and never re-derived. What is
 * here is a CONTAINER: several hands, one dealer, one deck, and an order to act in. That split is
 * the whole design, and it is what stops "the multi-seat game" from becoming a second blackjack.
 *
 * WHY THE ONE-SEAT REDUCER IS NOT DELETED, since a table with one chair is exactly the solo game.
 * It is the shape a LIVE hand is persisted in — `blackjack_hands.state_json` on the Pi, written
 * every time anybody plays the room-less game — so changing it means migrating rows that hold real
 * open stakes. The two containers are one rulebook and two records, and the one that already exists
 * in production keeps its record. A solo hand is dealt, scored and paid by the same functions this
 * one uses; if either ever disagreed with the other about a rule, the disagreement would have to be
 * inside `blackjack.ts`, where it would be wrong for both.
 *
 * WHAT IS HIDDEN, AND FROM WHOM. Every player's cards are face up in blackjack — that is the game —
 * so there is no per-seat private channel here and no `hands/` node. The ONLY hidden things are the
 * deck and `dealer[1]`, and they are hidden from EVERYONE equally, including whoever is hosting the
 * room. Both stay in the stored table and neither reaches `toPublic`, which is the same structural
 * guarantee `viewOf` gives the solo hand: `BlackjackTableState` has no `deck` field, so it cannot be
 * forwarded by accident.
 *
 * THE DECK CANNOT RUN OUT, and it is worth writing down because `drawOne` throws rather than
 * degrading. A fresh 52 holds 340 pips counting every ace as 1 (4×1 + 4×(2+…+9) + 16×10). A hand
 * stops the moment it passes 21, so it can consume at most 21 pips plus one card — under 32 — and
 * that bound holds for the dealer too. Ten hands could therefore take at most 320 pips, so a table
 * of up to nine chairs plus the dealer can never see the deck empty, and this game seats four.
 * `tests/blackjack-table.test.ts` fuzzes it rather than trusting the arithmetic.
 */
import {
  drawOne,
  freshDeck,
  handValue,
  insurancePayout,
  insuranceStake,
  isBlackjack,
  isBust,
  payoutCents,
  playDealer,
  settle,
  shuffle,
  type Card,
  type Result,
} from './blackjack';

/**
 * Where a round is up to. The one-seat `Phase` with `'dealer'` dropped — playing the dealer out is
 * a step inside one transition here, never a state a client can observe, because there is nothing a
 * player may do while it happens and a phase nobody can act in is a phase that can only stall.
 */
export type TablePhase = 'betting' | 'insurance' | 'player' | 'settled';

/**
 * ONE CHAIR'S HAND. The field names are `BlackjackState`'s on purpose, so a reader moving between
 * the two containers is reading the same words about the same money.
 *
 * EVERY FIELD HERE IS PUBLIC. That is not an accident of the projection, it is a property of the
 * game: a blackjack player's cards, stake and result are all face up at a real table. It is also
 * why `toPublic` still maps this field by field rather than passing the object through — a `Spot`
 * that ever gained a hidden field would otherwise start crossing the wire the day it was added,
 * silently and with nothing on screen looking wrong.
 */
export interface Spot {
  /**
   * Whether this chair is IN this round — occupied when the round opened.
   *
   * It exists because the deal waits for everybody to bet, and "everybody" cannot include an empty
   * chair or the table never deals at all. Fixed at the open and never recomputed: a chair vacated
   * mid-round is handed to the house (the crash-recovery rule releases a mid-game seat to `'ai'`,
   * never to `'open'`), so the occupant changes and the seat's obligation to act does not.
   */
  readonly seated: boolean;
  readonly cards: readonly Card[];
  /** Cents at risk — already the DOUBLED figure after a double, as the one-seat state records it.
   *  `0` means this chair has not bet yet, which in `'betting'` is what the table is waiting for. */
  readonly wagerCents: number;
  readonly doubled: boolean;
  readonly insuranceCents: number;
  readonly insurancePaidCents: number;
  /** Whether this chair has answered the insurance offer — what the table waits on in `'insurance'`. */
  readonly answered: boolean;
  /** Whether this chair has finished acting: stood, busted, doubled, or dealt a natural. */
  readonly done: boolean;
  /** Non-null only once the round is settled. A bust is `'lose'` there, not the moment it happens —
   *  every result comes out of one call to the shared `settle`, so there is one place to be wrong. */
  readonly result: Result | null;
}

export interface BlackjackTable {
  /** NEVER PROJECTED. The remainder of this round's deck. */
  readonly deck: readonly Card[];
  /** `dealer[0]` is the up-card; `dealer[1]` is the hole card, dropped from the projection until
   *  the round settles. Hidden from every seat equally — there is no seat it belongs to. */
  readonly dealer: readonly Card[];
  /** One entry per CHAIR, indexed by the room's seat index, so a board can draw seat 3 without a map. */
  readonly spots: readonly Spot[];
  readonly phase: TablePhase;
  /** The chair on turn in `'player'`; `-1` in every other phase. Betting and insurance are answered
   *  simultaneously — there is nothing to serialise, and a turn order there is a stall per chair. */
  readonly turn: number;
  /** Which round of this table's evening. Drives the client's per-round keys, as UNO's does. */
  readonly round: number;
}

/** A chair's decision. There is no card, no outcome and no payout on any of them — a stake is how
 *  much to risk, and the other five are choices a player is allowed to make badly. */
export type TableMove =
  | { readonly type: 'bet'; readonly wagerCents: number }
  | { readonly type: 'hit' }
  | { readonly type: 'stand' }
  | { readonly type: 'double' }
  | { readonly type: 'insure' }
  | { readonly type: 'decline' };

const EMPTY_SPOT: Spot = {
  seated: false,
  cards: [],
  wagerCents: 0,
  doubled: false,
  insuranceCents: 0,
  insurancePaidCents: 0,
  answered: false,
  done: false,
  result: null,
};

/**
 * Open a round: every occupied chair in, nothing dealt, waiting for stakes.
 *
 * `seated` comes from the room's own seat array and is the referee's to supply — a client never
 * says who is in a round, any more than it says what a chair costs.
 */
export function openRound(seated: readonly boolean[], round: number): BlackjackTable {
  return {
    deck: [],
    dealer: [],
    spots: seated.map((inRound) => ({ ...EMPTY_SPOT, seated: inRound })),
    phase: 'betting',
    turn: -1,
    round,
  };
}

// ── who the table is waiting for ────────────────────────────────────────────────────────────────

/**
 * The chairs that owe the table an action right now.
 *
 * ONE FUNCTION, THREE READERS, and that is why it exists rather than each of them asking its own
 * way: the referee drives a bot from it, the board says "waiting for Alice" from it, and the deal
 * fires when it comes back empty. Three copies of "whose move is it" is three chances for the board
 * to prompt a player the referee is not waiting for.
 *
 * Empty means the phase is finished (or the round is), which is exactly when a transition fires.
 */
export function pendingSeats(table: BlackjackTable): number[] {
  const out: number[] = [];
  if (table.phase === 'betting') {
    table.spots.forEach((spot, seat) => {
      if (spot.seated && spot.wagerCents === 0) out.push(seat);
    });
    return out;
  }
  if (table.phase === 'insurance') {
    table.spots.forEach((spot, seat) => {
      if (spot.seated && spot.wagerCents > 0 && !spot.answered) out.push(seat);
    });
    return out;
  }
  if (table.phase === 'player' && table.turn >= 0) out.push(table.turn);
  return out;
}

/** Whether this round is over — the settle predicate, so no call site spells the phase literal. */
export function roundOver(table: BlackjackTable): boolean {
  return table.phase === 'settled';
}

/** Whether a chair is playing this round for money: seated, and it got a stake down before the deal. */
function playing(spot: Spot): boolean {
  return spot.seated && spot.wagerCents > 0;
}

/**
 * Whether this chair would be offered a double: its turn, its opening two cards, still live.
 * `canDouble`'s sibling one container out, and the affordability check is still the caller's.
 */
export function canDoubleAt(table: BlackjackTable, seat: number): boolean {
  const spot = table.spots[seat];
  if (spot === undefined) return false;
  return table.phase === 'player' && table.turn === seat && !spot.done && spot.cards.length === 2;
}

/**
 * Whether this chair is being offered insurance.
 *
 * **IT IS A FUNCTION OF THE PHASE AND OF THIS CHAIR'S OWN PUBLIC FACTS, and never of the hole
 * card.** Identical security property to `canInsure`, and it matters more here rather than less:
 * this boolean is projected to every seat at the table while `dealer[1]` is withheld from all of
 * them, so an offer that consulted what the dealer TOTALS would hand the bought bit (§3.3) to
 * everybody for free, and nothing on any screen would look wrong.
 */
export function canInsureAt(table: BlackjackTable, seat: number): boolean {
  const spot = table.spots[seat];
  if (spot === undefined) return false;
  return table.phase === 'insurance' && playing(spot) && !spot.answered;
}

// ── the transitions ─────────────────────────────────────────────────────────────────────────────

/** The next chair that still has to act, from `after` onward, or -1. Skips chairs that never bet
 *  and chairs that are done — a table where somebody stood is a table with a hole in the order. */
function nextToAct(spots: readonly Spot[], after: number): number {
  for (let seat = after + 1; seat < spots.length; seat += 1) {
    const spot = spots[seat];
    if (spot !== undefined && playing(spot) && !spot.done) return seat;
  }
  return -1;
}

/** Replace one chair, leaving every other object identical — structural sharing, so a board can
 *  compare spots by reference and a re-render is only ever for a chair that actually moved. */
function withSpot(table: BlackjackTable, seat: number, spot: Spot): BlackjackTable {
  return { ...table, spots: table.spots.map((s, i) => (i === seat ? spot : s)) };
}

/**
 * THE PEEK — the dealer looks for a natural, and the round is over if it is there.
 *
 * The one-seat `peek`, and it settles the WHOLE table: a dealer natural beats every hand that is
 * not also a natural, and pushes the ones that are. `settle` decides each of those, so the rule
 * this file applies is "everybody settles now" and not "everybody loses".
 *
 * Reached from exactly two places, as it is one container in: the deal (for any up-card that is not
 * an Ace) and the exit from `'insurance'` (for the ones that are). Every stake this round is
 * already down when it runs, and no second one can go down after it, which is the whole of what
 * slice 1 bought — `canDoubleAt` is false in `'settled'`, so a table cannot take a double against a
 * hand that was over before anybody acted.
 */
function peek(table: BlackjackTable): BlackjackTable {
  if (!isBlackjack(table.dealer)) return table;
  return settleRound(table);
}

/**
 * Play the dealer out and score every chair.
 *
 * `settle` is called once per playing chair, over the SAME finished dealer hand, so a table cannot
 * pay two seats by two different readings of one dealer total. A chair that busted is scored by the
 * same call as everybody else — `settle` returns `'lose'` for a bust before it looks at the dealer,
 * which is the rule that gives the house its edge and is written down in exactly one place.
 *
 * THE INSURANCE RESOLVES HERE, and not in `'insure'`, because at a table the dealer peeks after the
 * LAST chair has answered — a chair that answered first would otherwise be paid before the dealer
 * looked, and the payout would be the announcement of the hole card to everyone still deciding.
 * `settle` is never told about it: a player who insured against a dealer natural still LOSES the
 * hand, which is what keeps a side bet from changing whether the hand was won.
 */
function settleRound(table: BlackjackTable): BlackjackTable {
  // A dealer holding a natural does not draw: the round ended at the peek, and `playDealer` would
  // stand on 21 anyway. Skipping it keeps the dealer's hand exactly two cards in that case, which
  // is what the board draws and what `settle` reads.
  const dealerNatural = isBlackjack(table.dealer);
  const played = dealerNatural
    ? { dealer: table.dealer.slice(), deck: table.deck.slice() }
    : playDealer(table.dealer, table.deck);
  return {
    ...table,
    dealer: played.dealer,
    deck: played.deck,
    phase: 'settled',
    turn: -1,
    spots: table.spots.map((spot) =>
      playing(spot)
        ? {
            ...spot,
            done: true,
            result: settle(spot.cards, played.dealer),
            insurancePaidCents:
              dealerNatural && spot.insuranceCents > 0 ? insurancePayout(spot.insuranceCents) : 0,
          }
        : { ...spot, result: null }
    ),
  };
}

/**
 * Deal the round: two cards to every chair that bet, two to the dealer, then the peek or the offer.
 *
 * THE DECK IS HANDED IN, exactly as it is on the one-seat reducer's `deal` action, and for both of
 * that seam's reasons. It keeps this function pure and deterministic, so a test drives an exact
 * table — a dealer natural, an odd-wager double — without stubbing a global; and it leaves the
 * shuffle at the referee, where `domain/blackjack.ts` already writes "THE SHUFFLE IS HERE" about
 * the line that makes the deck the server's.
 *
 * It does mean `applyMove` consumes randomness through its default, which UNO's reducer also does
 * and which is load-bearing in the same way: a replayed action re-run against a fresh deck would
 * deal a different table than the player already saw, so the referee re-serves the PERSISTED round
 * and never re-enters this function.
 *
 * The deal order is a real table's — one card to each chair, then the dealer's up-card, then the
 * second card to each chair, then the hole card. It changes nothing about the odds against a
 * shuffled deck and it is what a player watching the felt expects to see. At a table with one chair
 * playing it is `[player, dealer, player, dealer]`, which is the one-seat reducer's order exactly.
 */
function dealRound(table: BlackjackTable, deckSource: () => readonly Card[]): BlackjackTable {
  let deck: readonly Card[] = deckSource();
  const hands = table.spots.map<Card[]>(() => []);
  const dealer: Card[] = [];
  const take = (): Card => {
    const drawn = drawOne(deck);
    deck = drawn.deck;
    return drawn.card;
  };

  for (let pass = 0; pass < 2; pass += 1) {
    table.spots.forEach((spot, seat) => {
      if (playing(spot)) (hands[seat] ?? []).push(take());
    });
    dealer.push(take());
  }

  const spots = table.spots.map<Spot>((spot, seat) => {
    if (!playing(spot)) return spot;
    const cards = hands[seat] ?? [];
    // A natural finishes this chair without ending the round — the other chairs still play, and the
    // dealer still draws for them. `settle` will call it `'blackjack'` unless the dealer also has
    // one, which the peek below has already ruled on by the time anybody is paid.
    return { ...spot, cards, done: isBlackjack(cards) };
  });

  const dealt: BlackjackTable = { ...table, deck, dealer, spots, phase: 'player', turn: -1 };
  const up = dealer[0];

  // AN ACE UP SUSPENDS THE PEEK and offers insurance instead — peeking here would end the round
  // before anyone could take it, which is the whole of what insurance is. `dealer[0]` is the card
  // every seat can already see, so nothing about this branch depends on information a client lacks.
  if (up !== undefined && up.rank === 'A') return { ...dealt, phase: 'insurance', turn: -1 };

  const peeked = peek(dealt);
  if (peeked.phase === 'settled') return peeked;
  return openPlay(peeked, -1);
}

/** Leave `'insurance'`: everybody has answered, so the dealer finally looks. */
function afterInsurance(table: BlackjackTable): BlackjackTable {
  const peeked = peek(table);
  if (peeked.phase === 'settled') return peeked;
  return openPlay(peeked, -1);
}

/**
 * Open the playing phase on the first chair that has to act — OR settle, if none does.
 *
 * The `-1` branch is not defensive. Every playing chair can already be finished the moment the
 * cards land: deal two naturals at a two-handed table and nobody has a move, so a turn of `-1` in
 * `'player'` is a round that `pendingSeats` reports as waiting for nobody and that no client and no
 * bot can ever advance. It is the stall this file's whole totality discipline exists to prevent,
 * arriving through the deal rather than through a refused move, and it was a live bug until the
 * "every chair was dealt a natural" case went red.
 */
function openPlay(table: BlackjackTable, after: number): BlackjackTable {
  const turn = nextToAct(table.spots, after);
  if (turn < 0) return settleRound(table);
  return { ...table, phase: 'player', turn };
}

/** This chair is finished acting: hand the turn on, and settle the round if nobody is left. */
function finishSpot(table: BlackjackTable, seat: number, spot: Spot): BlackjackTable {
  return openPlay(withSpot(table, seat, { ...spot, done: true }), seat);
}

/**
 * The pure transition, and it is TOTAL: an action that is illegal for the phase, the chair or the
 * hand returns the table unchanged rather than throwing.
 *
 * That is the discipline every reducer here follows, and at a dealt table it is also the referee's
 * safety net — `applyMove(before) === before` is how the round refuses a move without the transport
 * having to hold a second copy of the rules. It is why the referee compares identity rather than
 * trusting a boolean, and why every bot's action has to be one this function ACCEPTS: an illegal
 * bot action is a no-op on a turn only the bot can take, and the table then waits forever.
 */
export function applyMove(
  table: BlackjackTable,
  seat: number,
  move: TableMove,
  deckSource: () => readonly Card[] = () => shuffle(freshDeck())
): BlackjackTable {
  const spot = table.spots[seat];
  if (spot === undefined || !spot.seated) return table;

  switch (move.type) {
    case 'bet': {
      if (table.phase !== 'betting' || spot.wagerCents > 0) return table;
      // The stake is checked for affordability by whoever can see a bankroll; what is checked HERE
      // is that it is a number a round can be played for at all. A fractional or negative stake
      // would reach the ledger as a row nobody can read back.
      if (!Number.isInteger(move.wagerCents) || move.wagerCents <= 0) return table;
      const bet = withSpot(table, seat, { ...spot, wagerCents: move.wagerCents });
      // THE DEAL FIRES WHEN THE LAST CHAIR BETS — nobody presses a button for it. A separate
      // "deal now" action would be a second thing that has to happen at a moment the rules already
      // determine, and the two would eventually disagree about when the table is ready.
      return pendingSeats(bet).length === 0 ? dealRound(bet, deckSource) : bet;
    }

    case 'insure':
    case 'decline': {
      if (!canInsureAt(table, seat)) return table;
      // Recorded here and committed by the caller, exactly as a double's second stake is: this file
      // cannot see a bankroll, so affordability is checked by whoever can.
      const stake = move.type === 'insure' ? insuranceStake(spot.wagerCents) : 0;
      const answered = withSpot(table, seat, {
        ...spot,
        answered: true,
        insuranceCents: stake,
      });
      // Nobody peeks until everybody has answered. A chair that answers early must not learn the
      // hole card a beat before the chair still deciding — that bit is what the others are being
      // asked to pay for, and leaking it would make the offer unanswerable in good faith.
      return pendingSeats(answered).length === 0 ? afterInsurance(answered) : answered;
    }

    case 'hit': {
      if (table.phase !== 'player' || table.turn !== seat || spot.done) return table;
      const { card, deck } = drawOne(table.deck);
      const cards = [...spot.cards, card];
      const drawn = { ...table, deck };
      if (isBust(cards)) return finishSpot(drawn, seat, { ...spot, cards });
      return withSpot(drawn, seat, { ...spot, cards });
    }

    case 'stand': {
      if (table.phase !== 'player' || table.turn !== seat || spot.done) return table;
      return finishSpot(table, seat, spot);
    }

    case 'double': {
      if (!canDoubleAt(table, seat)) return table;
      const { card, deck } = drawOne(table.deck);
      // One card, then stand — whether it busted or not. The second stake is committed by the
      // caller before this runs; here it only doubles the recorded figure, which is what settlement
      // reads.
      return finishSpot({ ...table, deck }, seat, {
        ...spot,
        cards: [...spot.cards, card],
        wagerCents: spot.wagerCents * 2,
        doubled: true,
      });
    }
  }
}

// ── the house ───────────────────────────────────────────────────────────────────────────────────

/**
 * WHAT A BOT STAKES. It is not money: a bot has no account, so the referee opens no ledger row and
 * no wager for it, and a chair the house is sitting in wins and loses nothing. The number exists so
 * the felt reads like a table rather than like three players betting nothing, and it is a constant
 * here rather than a parameter because there is no decision in it to hand anybody.
 */
export const AI_WAGER_CENTS = 2_500;

/**
 * A bot's move. Total by construction: every branch returns something `applyMove` accepts for the
 * phase this table is in, which is the *"a bot's move must be one the reducer ACCEPTS"* rule — an
 * illegal one is a no-op on a turn only the bot can take, and the table hangs forever.
 *
 * It plays the hitting and standing half of basic strategy, off the dealer's UP-CARD, which is all
 * the information any player at the table has. It does not double and it never insures, and both
 * are deliberate: insurance is the bet basic strategy always declines, and a bot that doubled would
 * be a chair asking for a second stake that no ledger row will ever back. Neither omission can cost
 * anybody anything — a bot's cards change which cards come next, and card removal in a shuffled
 * deck is symmetric noise, not an edge for or against the seats around it.
 */
export function chooseAiMove(table: BlackjackTable, seat: number): TableMove {
  const spot = table.spots[seat];
  if (spot === undefined) return { type: 'stand' };
  if (table.phase === 'betting') return { type: 'bet', wagerCents: AI_WAGER_CENTS };
  if (table.phase === 'insurance') return { type: 'decline' };

  const { total, soft } = handValue(spot.cards);
  // A soft hand cannot bust on a hit, so there is never a reason to stand on one below 18.
  if (soft && total <= 17) return { type: 'hit' };
  if (total <= 11) return { type: 'hit' };
  if (total >= 17) return { type: 'stand' };
  // 12–16, the only interval where the up-card decides. A dealer showing 7 or better is likely to
  // reach 17+, so standing on a stiff hand loses to it; showing 2–6 it busts often enough to stand
  // against. An Ace up counts as a strong card, which is what `handValue` already says it is.
  const up = table.dealer[0];
  const upValue = up === undefined ? 10 : handValue([up]).total;
  return upValue >= 7 ? { type: 'hit' } : { type: 'stand' };
}

// ── the projection ──────────────────────────────────────────────────────────────────────────────

/**
 * ONE CHAIR, AS EVERY SEAT AT THE TABLE MAY SEE IT — which is all of it. A blackjack player's
 * cards, stake and result are face up at a real table, so this carries the whole `Spot`.
 *
 * It is still declared field by field rather than aliased to `Spot`, and that is the guard: a
 * `Spot` that ever gains a hidden field (a peeked total, a shuffled remainder, a bot's plan) would
 * otherwise start crossing the wire on the day it was added, with nothing on screen looking wrong
 * and no compiler with an opinion about it.
 */
export interface SpotView {
  readonly seated: boolean;
  readonly cards: readonly Card[];
  readonly wagerCents: number;
  readonly doubled: boolean;
  /** While the offer stands this is the PRICE; once taken it is what was paid. Quoted from the same
   *  function the reducer stakes with, so a button cannot name a different number than the charge. */
  readonly insuranceCents: number;
  readonly insurancePaidCents: number;
  readonly insured: boolean;
  readonly answered: boolean;
  readonly done: boolean;
  readonly result: Result | null;
  /** Whether the table would offer this chair a double. Affordability is checked again at the move. */
  readonly canDouble: boolean;
  /** Whether this chair is being offered insurance — see `canInsureAt` for why it cannot peek. */
  readonly canInsure: boolean;
}

/**
 * THE WHOLE TABLE, AS A CLIENT MAY SEE IT. `HandView`'s sibling, and it carries the same structural
 * guarantee for the same reason: there is no `deck` field, so the deck cannot be forwarded by
 * accident — it cannot be spelled.
 */
export interface BlackjackTableState {
  readonly round: number;
  readonly phase: TablePhase;
  readonly turn: number;
  /** The up-card ALONE until the round settles. `dealer[1]` is dropped while a round is live, and
   *  it is dropped for everybody: there is no seat this card belongs to. */
  readonly dealer: readonly Card[];
  readonly spots: readonly SpotView[];
  /** The chairs the table is waiting on, so a board says who without asking the rules a second way. */
  readonly pending: readonly number[];
}

/**
 * Project a round down to what the table may see.
 *
 * `slice(0, 1)`, not a placeholder card — `viewOf`'s argument, unchanged: sending a fake hole card
 * puts a lie on the wire that a renderer could believe and a player could read, where an absent
 * card is honestly absent and the board draws a back for it.
 */
export function toPublic(table: BlackjackTable): BlackjackTableState {
  const revealed = table.phase === 'settled';
  return {
    round: table.round,
    phase: table.phase,
    turn: table.turn,
    dealer: revealed ? table.dealer : table.dealer.slice(0, 1),
    pending: pendingSeats(table),
    spots: table.spots.map((spot, seat) => ({
      seated: spot.seated,
      cards: spot.cards,
      wagerCents: spot.wagerCents,
      doubled: spot.doubled,
      insuranceCents: canInsureAt(table, seat)
        ? insuranceStake(spot.wagerCents)
        : spot.insuranceCents,
      insurancePaidCents: spot.insurancePaidCents,
      insured: spot.insuranceCents > 0,
      answered: spot.answered,
      done: spot.done,
      result: spot.result,
      canDouble: canDoubleAt(table, seat),
      canInsure: canInsureAt(table, seat),
    })),
  };
}

/**
 * WHAT THIS ROUND OWES ONE CHAIR, gross — the settlement, as pure arithmetic over the round's own
 * numbers.
 *
 * It exists so the referee has nothing of its own to compute: `payoutCents` is `blackjack.ts`'s and
 * so is the insurance return, and folding them together HERE is what stops the two containers from
 * adding one hand up two ways. `wagerCents` is already the doubled figure, so one call covers both
 * of a doubled chair's stakes — exactly as the solo settle does, and for exactly its reason.
 *
 * It takes a `SpotView` as readily as a `Spot`, so the board can quote the same number the ledger
 * moved rather than re-deriving "+$37.50 this hand" from the two bets by hand.
 */
export function spotPayout(spot: SpotView | Spot): number {
  if (spot.result === null) return 0;
  return payoutCents(spot.result, spot.wagerCents) + spot.insurancePaidCents;
}
