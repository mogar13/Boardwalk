/**
 * UNO, as pure functions and one pure reducer. No React, no DOM, no `@/system`, no Firebase —
 * enforced by `@boardwalk/no-impure-logic`, which is why the whole rulebook (the 108-card deck,
 * legal-play matching, every action card, the direction/skip/draw resolution, the UNO-call penalty,
 * reshuffle-on-empty, and win detection) is unit-tested to the last line before a card is drawn on
 * screen. This is UNO's assigned coverage — hidden hands, seq ordering, AI-as-occupant, a 7-seat
 * table — and the correctness of every one of those rides on this reducer being exactly right.
 *
 * THE STATE MODEL, and why it is split the way it is. Unlike Chess (perfect information, the whole
 * board is `TPublic`), UNO has hidden state — every hand, and the draw pile. So the COMPLETE game
 * (`UnoGame`: all hands + deck + discard) is what this reducer operates on, and it lives only in
 * the HOST's memory (the dealer). The host runs `applyMove` on the complete state, then PROJECTS a
 * public view (`toPublic` → `UnoState`, the `TPublic` on the wire: top card, counts, turn, colour —
 * never a hidden card) and deals each hand to its owner's private node. Non-hosts never run this
 * reducer; they render the projection plus their own hand and submit a `Move` as an intent. The
 * deck therefore never touches the wire at all, which is strictly more private than v1 (whose deck
 * was public) — the privacy principle taken to its conclusion.
 *
 * WIRE-SAFE BY CONSTRUCTION. `UnoState` and `Move` cross RTDB, which drops null/undefined children
 * (Tic-Tac-Toe's null-board crash, Chess's FEN answer). So there is no `null` anywhere in the wire
 * types: `winner`/`value` use a `-1` sentinel, "no pending intent" is a sentinel `PendingMove` with
 * `seat: -1`, and every array is dense.
 */

import { DEFAULT_HOUSE_RULES, resolveHouseRules, type UnoHouseRules } from './houseRules';
import { placesOf, roundOver, seatAfterLive, winnerOf } from './places';
import { answersStack, drawDebt, type UnoTable } from './stacking';

// ── Cards ────────────────────────────────────────────────────────────────────────────────────────

export type UnoColor = 'red' | 'blue' | 'green' | 'yellow';
export const COLORS: readonly UnoColor[] = ['red', 'blue', 'green', 'yellow'];

/**
 * A card's kind. `number` carries a 0–9 in `value`; every action/wild carries the `-1` sentinel in
 * `value` (never null — the wire drops null). The kind names mirror v1's art tokens so the board's
 * `unoCardSrc` maps a card to a file without a translation table: `skip`→`block`, `reverse`→
 * `inverse`, `draw2`→`2plus`, `wild4`→`4_plus`.
 */
export type CardKind = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  /** A stable id assigned at deck build, unique across the 108 cards; the intent plays a card BY id. */
  readonly id: string;
  /** A wild/wild4 is colourless on the wire (`'wild'`); the colour it SETS is chosen at play time. */
  readonly color: UnoColor | 'wild';
  readonly kind: CardKind;
  /** 0–9 for a number card; `-1` for every action/wild (sentinel, not null). */
  readonly value: number;
}

/** Exported for `ai.ts` alone — a rules predicate, kept here beside the cards it asks about. */
export const isWild = (c: Card): boolean => c.kind === 'wild' || c.kind === 'wild4';

/**
 * A fresh, ORDERED 108-card deck with stable ids. Ordered on purpose: `shuffle` is the only
 * randomness, so a test builds a known deck and drives an exact hand without stubbing anything.
 * Composition: per colour one `0`, two each of `1–9`, and two each of skip/reverse/draw2 (25×4 =
 * 100), plus four wild and four wild-draw-four (8) = 108.
 */
export function freshDeck(): Card[] {
  const deck: Card[] = [];
  let n = 0;
  const push = (color: UnoColor | 'wild', kind: CardKind, value: number): void => {
    deck.push({ id: `u${n}`, color, kind, value });
    n += 1;
  };
  for (const color of COLORS) {
    push(color, 'number', 0);
    for (let v = 1; v <= 9; v += 1) {
      push(color, 'number', v);
      push(color, 'number', v);
    }
    for (const kind of ['skip', 'reverse', 'draw2'] as const) {
      push(color, kind, -1);
      push(color, kind, -1);
    }
  }
  for (let i = 0; i < 4; i += 1) push('wild', 'wild', -1);
  for (let i = 0; i < 4; i += 1) push('wild', 'wild4', -1);
  return deck;
}

/**
 * Fisher–Yates, `rng` injected (defaults to `Math.random`). Injected so a test can shuffle
 * deterministically with a seeded generator and assert the result is a permutation — the "a bad
 * shuffle is how you ship an unfair game" check the build order exists to catch. Pure: returns a new
 * array, never touches the input.
 */
export function shuffle(cards: readonly Card[], rng: () => number = Math.random): Card[] {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

/**
 * The match key a card plays ON: a number matches a number of the same value; an action matches the
 * same action of ANY colour (a red skip plays on a blue skip). Colour matching is handled separately
 * in `canPlay`. This is v1's `isValidPlay` value-comparison, made explicit.
 */
function matchKey(card: Card): string {
  return card.kind === 'number' ? `n${String(card.value)}` : card.kind;
}

/**
 * Whether `card` may be played into this position.
 *
 * IT TAKES THE WHOLE TABLE rather than `(top, color)`, and the signature change IS the feature: a
 * live stack suspends colour and value matching entirely, so a call site that could still pass two
 * of the four facts would be one that silently means "and no stack" — which is a client greying out
 * the +2 the referee would have accepted. See `UnoTable`.
 *
 * The stack branch comes FIRST and returns, rather than widening the ordinary rules: while a debt
 * stands, the ordinary rules do not apply at all. In particular a plain wild — which plays on
 * anything below — is refused, because answering a draw card means drawing somebody something.
 */
export function canPlay(card: Card, table: UnoTable): boolean {
  if (drawDebt(table) > 0)
    return answersStack(card, table.top, resolveHouseRules(table.houseRules));
  if (isWild(card)) return true;
  if (card.color === table.color) return true;
  return matchKey(card) === matchKey(table.top);
}

/**
 * Is `draw` this seat's ONLY legal move — a hand holding nothing this position accepts?
 * `applyMove` refuses every play from such a hand and accepts exactly one action, so a client that
 * takes it automatically removes a mandatory click rather than a decision. (Drawing here also ENDS
 * the turn — this rulebook has no play-what-you-drew — so there is nothing after it to choose.)
 *
 * IT NEEDED NO STACKING LOGIC OF ITS OWN, which is the factoring working: "there is a debt and
 * nothing in hand answers it" is not a second condition, it is the first one read against a
 * position where `canPlay` has collapsed the legal set. So the auto-draw takes the stack for you
 * with no new mechanism, and the rule about what answers a stack lives in exactly one place.
 *
 * AN EMPTY HAND IS `false`, NOT `true`, and that is the whole reason this is a function rather than
 * an inline `!hand.some(…)`: a hand is `[]` both when a player has won and — the case that bites —
 * while their private `hands/` node is still loading, and `![].some(…)` is `true` for both. A caller
 * reading that as "you must draw" auto-draws on behalf of a player who has not been dealt yet.
 */
export function mustDraw(hand: readonly Card[], table: UnoTable): boolean {
  return hand.length > 0 && !hand.some((card) => canPlay(card, table));
}

// ── The complete game (host memory + the reducer's unit) ─────────────────────────────────────────

export interface UnoGame {
  readonly hands: readonly (readonly Card[])[];
  readonly deck: readonly Card[];
  /** The play pile; the top is the LAST element. Never empty after `deal`. */
  readonly discard: readonly Card[];
  /** The active colour — a wild sets this to its chosen colour; otherwise the top card's colour. */
  readonly color: UnoColor;
  readonly turn: number;
  readonly direction: 1 | -1;
  readonly calledUno: readonly boolean[];
  /**
   * THE SEATS THAT HAVE GONE OUT, IN THE ORDER THEY DID — empty while everybody is still holding
   * cards. This REPLACED `winner: number`; the two did not ship side by side, because a placement
   * list and a winner are one fact stored twice and the award site that appends to one but forgets
   * the other is the `recordWin` defect reborn.
   *
   * Ordinarily it never holds more than one seat: the round ends the moment somebody empties their
   * hand, so `[3]` means "seat 3 won and it is over". Playing for places it fills up — `[3, 0, 1]`
   * is 1st, 2nd, 3rd — and the last player standing is appended without having to play a final
   * unwinnable hand against nobody.
   *
   * Read it through `placesOf`, and ask `winnerOf`/`roundOver` rather than inspecting it: for most
   * of a ranked round first place is settled and the round is NOT over, so "who won" and "is it
   * finished" stop being the same question.
   */
  readonly finished: readonly number[];
  /**
   * CARDS OWED to the seat on turn by a stack that has not been taken yet; `0` when nothing is
   * owed, which is every position at a table not playing `stack`. Read it through `drawDebt`.
   */
  readonly pendingDraw: number;
  /**
   * THE RULES THIS ROUND WAS DEALT UNDER, stamped once by `deal` and never written again.
   *
   * On the GAME rather than looked up per move, and that is what makes a match played under the
   * rules it was dealt with: the object is inside `uno_matches.state_json`, so it survives a
   * restart, and there is no second copy on the room for it to drift from. A rule cannot change
   * under a hand in progress because nothing after the deal has anywhere to write one.
   *
   * Every read site takes it complete — see `resolveHouseRules` for why that is the whole point.
   */
  readonly houseRules: UnoHouseRules;
}

const top = (g: UnoGame): Card => {
  const c = g.discard[g.discard.length - 1];
  // deal guarantees a non-empty discard and every reducer path keeps it non-empty; this satisfies
  // noUncheckedIndexedAccess without a real branch.
  if (c === undefined) throw new Error('uno: empty discard');
  return c;
};

/**
 * The complete game as the POSITION a card is played into — the four facts `canPlay` reads, lifted
 * off the state that holds twenty. It is the reducer's and the AI's bridge to the same predicate a
 * client calls on `UnoState` directly (which extends `UnoTable`), so there is one legality rule and
 * not a host copy and a client copy.
 */
export function tableOf(game: UnoGame): UnoTable {
  return {
    top: top(game),
    color: game.color,
    pendingDraw: game.pendingDraw,
    houseRules: game.houseRules,
  };
}

/** The active colour of a card as PLAYED — a wild takes the chosen colour, anything else its own. */
function playedColor(card: Card, chosen: UnoColor): UnoColor {
  return isWild(card) ? chosen : (card.color as UnoColor);
}

/**
 * Draw `n` cards off the deck, reshuffling the discard (all but its top) back into the deck when it
 * runs dry — UNO's standard recycle. Pure: returns the drawn cards and the next deck/discard. `rng`
 * is injected for the reshuffle so a test is deterministic.
 */
function drawCards(
  deck: readonly Card[],
  discard: readonly Card[],
  n: number,
  rng: () => number
): { drawn: Card[]; deck: Card[]; discard: Card[] } {
  let d = deck.slice();
  let pile = discard.slice();
  const drawn: Card[] = [];
  for (let i = 0; i < n; i += 1) {
    if (d.length === 0) {
      // Recycle: keep the top card as the discard, shuffle the rest into a fresh deck.
      if (pile.length <= 1) break; // nothing left to recycle — a friendly game simply stops drawing
      const keep = pile[pile.length - 1];
      const rest = pile.slice(0, -1);
      d = shuffle(rest, rng);
      pile = keep === undefined ? [] : [keep];
    }
    const card = d.pop();
    if (card !== undefined) drawn.push(card);
  }
  return { drawn, deck: d, discard: pile };
}

/**
 * Deal a fresh round: shuffle, seven to each seat, and flip the first NON-action, non-wild card as
 * the starting discard (so the opening card never skips or reverses the leader into a rules corner —
 * v1 did the same). `round` is carried through for rematch/result keying.
 *
 * `firstSeat` is WHO LEADS, and it defaults to seat 0 — the opening deal, where nobody has won
 * anything yet. From the second round on the caller passes the LAST ROUND'S WINNER, which is v1's
 * rule and worth stating as a rule rather than a nicety: with a fixed leader the host plays first
 * every single round of the evening, and at a seven-seat table the player sitting last never opens
 * a hand. Rotating on the win also gives winning a second, smaller prize, which is the whole
 * argument for it in a game that has no score.
 *
 * It is a PARAMETER and not a field on `UnoGame` on purpose: who leads is a fact about how this
 * round was dealt, not a piece of state anything reads afterwards, and a `lastWinner` living in the
 * game would be a second copy of `winner` that the next deal has to remember to clear.
 *
 * Out-of-range and non-integer input floors to seat 0 rather than throwing. This is fed by a host
 * that has just read a `winner` off its own reducer, so it should always be in range — but a deal
 * that throws takes the whole table down, and a deal that starts on the wrong seat merely starts on
 * the wrong seat.
 *
 * `rules` is WHAT THIS TABLE AGREED TO PLAY, read off the room by the referee and stamped onto the
 * round here — the one moment they enter the game. It is last and defaulted so every existing call
 * site means "the rules as they have always been", which is also what the default IS.
 */
export function deal(
  seatCount: number,
  rng: () => number = Math.random,
  firstSeat = 0,
  rules: unknown = DEFAULT_HOUSE_RULES
): UnoGame {
  let deck = shuffle(freshDeck(), rng);
  const hands: Card[][] = [];
  for (let s = 0; s < seatCount; s += 1) {
    const hand: Card[] = [];
    for (let i = 0; i < 7; i += 1) {
      const c = deck.pop();
      if (c !== undefined) hand.push(c);
    }
    hands.push(hand);
  }
  // Find the first plain number card for the opening discard; earlier action/wilds go to the bottom.
  const bottom: Card[] = [];
  let start = deck.pop();
  while (start !== undefined && start.kind !== 'number') {
    bottom.unshift(start);
    start = deck.pop();
  }
  if (start === undefined) start = { id: 'u0', color: 'red', kind: 'number', value: 0 };
  deck = bottom.concat(deck);
  const lead =
    Number.isInteger(firstSeat) && firstSeat >= 0 && firstSeat < seatCount ? firstSeat : 0;
  return {
    hands,
    deck,
    discard: [start],
    color: start.color as UnoColor,
    turn: lead,
    direction: 1,
    calledUno: hands.map(() => false),
    // NOBODY HAS PLACED. Stated rather than carried over for the same reason `pendingDraw` is: a
    // round is dealt from scratch, and last round's podium is last round's.
    finished: [],
    // A fresh round owes nobody anything, whatever the last one ended holding. It is stated rather
    // than inherited because a round is dealt from scratch — there is no state to carry over.
    pendingDraw: 0,
    houseRules: resolveHouseRules(rules),
  };
}

// ── Moves & the reducer ──────────────────────────────────────────────────────────────────────────

export type Move =
  | {
      readonly type: 'play';
      readonly cardId: string;
      /** Required (and only meaningful) for a wild/wild4; ignored otherwise. */
      readonly chosenColor?: UnoColor;
      /** True when the player declares "UNO!" as they go to one card — see the penalty below. */
      readonly declareUno?: boolean;
    }
  | { readonly type: 'draw' };

const setAt = <T>(arr: readonly T[], i: number, v: T): T[] => arr.map((x, k) => (k === i ? v : x));

/**
 * Apply `move` for `seat` to the complete game. TOTAL and PURE, exactly like Chess's `playMove`: an
 * illegal move (not your turn, no such card, unplayable card, missing colour on a wild, game over)
 * returns the game UNCHANGED, so the host can hand any intent straight in and trust the result. The
 * host compares hand references afterwards to know which private nodes to re-deal — so unchanged
 * hands keep their array reference (structural sharing), which the immutable updates here preserve.
 */
export function applyMove(
  game: UnoGame,
  seat: number,
  move: Move,
  rng: () => number = Math.random
): UnoGame {
  if (roundOver(game)) return game;
  if (seat !== game.turn) return game;
  const hand = game.hands[seat];
  if (hand === undefined) return game;
  const seatCount = game.hands.length;
  // WHO IS ALREADY OUT — read once, normalised once (a match row dealt before places existed has no
  // list at all), and carried forward on every path so a legacy round acquires one on its first move
  // instead of staying a hole the rest of the reducer has to keep re-deciding about.
  const out = placesOf(game);

  const table = tableOf(game);
  const owed = drawDebt(table);
  // RESOLVED rather than read off the field, for the reason `toPublic` resolves: this is the first
  // line in the reducer that ever ASKS what a rule says, and `game` can arrive from
  // `uno_matches.state_json` — where a row written before house rules existed carries no bag at
  // all, and `undefined.stack` is a TypeError that takes the dealer down mid-round rather than
  // playing that match under the rules it was actually dealt with (none).
  const rules = resolveHouseRules(game.houseRules);

  if (move.type === 'draw') {
    // TAKING THE STACK IS THE `draw` MOVE — it pulls what is owed, clears the debt and ends the
    // turn, which IS the skip the non-stacking version applies up front. Nothing owed is the
    // ordinary one card.
    const { drawn, deck, discard } = drawCards(game.deck, game.discard, Math.max(1, owed), rng);
    // A DRY DECK STOPS A FRIENDLY GAME AND MUST NOT STOP A STACKED ONE, and the asymmetry is the
    // trap this rule has to be tested for. With nothing owed, drawing nothing is a genuine no-op:
    // the game is unchanged, the event seq does not move, and the board's auto-draw fires once and
    // stops rather than spinning on a pile that cannot serve it. With a debt outstanding the same
    // return would HANG THE TABLE FOREVER — the legal set has collapsed to cards that answer the
    // stack, so a victim who can neither answer nor draw has no legal move at all, on a turn only
    // they can take. So the debt clears on any take, including one the deck came up short on.
    if (drawn.length === 0 && owed === 0) return game;
    return {
      ...game,
      deck,
      discard,
      hands: setAt(game.hands, seat, hand.concat(drawn)),
      calledUno: setAt(game.calledUno, seat, false),
      pendingDraw: 0,
      finished: out,
      turn: seatAfterLive(game.turn, 1, game.direction, seatCount, out),
    };
  }

  // A play.
  const idx = hand.findIndex((c) => c.id === move.cardId);
  const card = hand[idx];
  if (card === undefined) return game;
  if (!canPlay(card, table)) return game;
  if (isWild(card) && move.chosenColor === undefined) return game;

  const chosen = move.chosenColor ?? (card.color as UnoColor);
  const color = playedColor(card, chosen);
  let hands = setAt(
    game.hands,
    seat,
    hand.filter((_, k) => k !== idx)
  );
  const discard = game.discard.concat(card);
  let deck = game.deck;
  let discardPile = discard;
  let direction = game.direction;
  let calledUno = game.calledUno;

  // Resolve the action: how far the turn advances, and any victim draw.
  let steps = 1;
  let pendingDraw = owed;
  if (card.kind === 'skip') {
    steps = 2;
  } else if (card.kind === 'reverse') {
    direction = (game.direction * -1) as 1 | -1;
    // A REVERSE ACTS AS A SKIP AT TWO LIVE PLAYERS, not two seated ones. This is the exact line
    // UNO_POT §2 named as the reason raise/call/fold was deferred — a folded seat leaves the
    // rotation the same way a finished one does — so doing places first is what makes that slice
    // cheaper: the rotation surgery is done once and both features read it.
    steps = seatCount - out.length === 2 ? 2 : 1;
  } else if (card.kind === 'draw2' || card.kind === 'wild4') {
    const n = card.kind === 'draw2' ? 2 : 4;
    if (rules.stack) {
      // STACKING: the card deals NOTHING and the turn advances ONE seat, because the victim has to
      // be given the chance to answer. The skip has not vanished — it is deferred into the take
      // (`draw` ends the turn), so a debt nobody answers rotates the table exactly as the immediate
      // version does. `owed` rather than the raw field: a debt only exists where the rule does.
      pendingDraw = owed + n;
      steps = 1;
    } else {
      // The victim is the next LIVE seat: a player who has already gone out holds no hand to deal
      // into, and dealing them two would put cards back in a hand the projection reports as empty.
      const victim = seatAfterLive(game.turn, 1, game.direction, seatCount, out);
      const pulled = drawCards(deck, discardPile, n, rng);
      deck = pulled.deck;
      discardPile = pulled.discard;
      const vHand = hands[victim];
      if (vHand !== undefined) hands = setAt(hands, victim, vHand.concat(pulled.drawn));
      calledUno = setAt(calledUno, victim, false);
      steps = 2; // the victim is skipped
    }
  }

  // UNO call + penalty, and PLACEMENT, on the player's NEW hand size.
  const newHand = hands[seat];
  const newLen = newHand === undefined ? 0 : newHand.length;
  let finished = out;
  if (newLen === 0) {
    finished = out.concat(seat);
    // PLAYING FOR PLACES, the round goes on — unless this leaves one seat holding cards, in which
    // case that straggler is placed last HERE rather than being made to play a final hand against
    // nobody. Doing it in the same move is also what keeps `roundOver` a question about the list
    // instead of a question about the list plus a special case.
    if (rules.playToLast && seatCount - finished.length === 1) {
      for (let s = 0; s < seatCount; s += 1)
        if (!finished.includes(s)) finished = finished.concat(s);
    }
  } else if (newLen === 1) {
    if (move.declareUno === true) {
      calledUno = setAt(calledUno, seat, true);
    } else {
      // Went to one card without declaring: the standard +2 penalty.
      const pulled = drawCards(deck, discardPile, 2, rng);
      deck = pulled.deck;
      discardPile = pulled.discard;
      const h = hands[seat];
      if (h !== undefined) hands = setAt(hands, seat, h.concat(pulled.drawn));
      calledUno = setAt(calledUno, seat, false);
    }
  } else {
    calledUno = setAt(calledUno, seat, false);
  }

  // OVER, ASKED OF THE RESULT rather than of "did somebody go out". Under `playToLast` those stop
  // being the same question the instant first place is decided, and every line below reads this.
  const over = roundOver({ ...game, hands, finished });

  return {
    hands,
    deck,
    discard: discardPile,
    color,
    // The turn stops when the round does; otherwise it advances past whoever has gone out — which
    // now includes this player, if the card they just laid was their last.
    turn: over ? game.turn : seatAfterLive(game.turn, steps, direction, seatCount, finished),
    direction,
    calledUno,
    finished,
    // A FINISHED ROUND OWES NOBODY. Going out on a +2 with a stack live leaves a debt no seat will
    // ever be asked to pay — the turn has stopped and the round is over — so carrying it would
    // leave the board announcing "+6" over a finished hand. Clearing it is not a rules decision; it
    // is refusing to state a fact that has stopped being one. Playing for places the round is NOT
    // over, so the debt passes to the next live seat, which is the whole of stacking's rule: you
    // answer what is coming at you or you take it, whoever laid it and wherever they went.
    pendingDraw: over ? 0 : pendingDraw,
    // CARRIED, because this branch rebuilds the game field by field rather than spreading it. A
    // field added to `UnoGame` and not added here is not a type error (the literal is complete
    // either way once it is written) and not a visible bug on move one — the rules would simply be
    // `undefined` from the first play onward, which `resolveHouseRules` then reads as all-false, so
    // a stacking table would quietly stop stacking the moment anybody played a card. Guarded.
    houseRules: game.houseRules,
  };
}

// ── The public projection (the `TPublic` on the wire) ────────────────────────────────────────────

/*
 * THE INTENT/ACK PAIR IS GONE, and its absence is the shape of this game's cutover.
 *
 * Until the referee dealt UNO, a non-host could not apply its own move: the host held every hand, so
 * a guest wrote a `pending` intent into the shared state and waited for the host to `applyMove` it
 * and bump `ackNonce`. That is a whole consensus protocol, and it existed only because the dealer
 * was a player.
 *
 * Now a move is a message to the referee (`unoAction`), so there is nothing to submit and nothing to
 * acknowledge. `PendingMove`, `NO_PENDING` and `submitMove` were deleted rather than left dangling —
 * a field with no reader is `loadout.color`, and leaving the intent lane open beside the new one is
 * the mistake the Blackjack and Liar's Dice cutovers each named: "the cheapest way to defeat a
 * cutover is to leave the road it replaced standing." Here it would be worse than dead weight, since
 * `pending` is a client-authored field on a state the client is no longer allowed to author.
 */

/**
 * WHAT JUST HAPPENED, as facts rather than prose — the table's move log (v1's `#move-log`, the
 * running commentary that makes a hidden-hand game readable: you cannot see anyone's cards, so the
 * log is the only place "AI 3 drew 4 and is skipped" is ever said).
 *
 * FACTS, NOT SENTENCES, and the split is deliberate. v1 pushed a formatted string over the wire
 * (`lastLogSync`, a JSON'd `{ts, name, msg}`) which meant the wire carried English, the sender's
 * copy of everyone's names, and a wall-clock timestamp used for de-duplication. Here the host
 * writes what the RULES did — which seat, which card, who drew how many, did the direction flip —
 * and each client renders its own sentence from its own seat names. So a rename is not a stale log
 * line, the log needs no clock (`seq` orders it, the OS's rule), and the derivation is unit-testable
 * without asserting on copy.
 *
 * Wire-safe like everything else here: every field is dense, absence is a `-1`/`0`/`false`
 * sentinel, and `card` carries a real card even on a draw (the sentinel below) because RTDB drops a
 * null child and a receiver must never have to distinguish "no card" from "no state".
 */
export interface UnoEvent {
  /** Monotonic within a round; `0` is the deal. A client appends only what it has not shown. */
  readonly seq: number;
  /** The acting seat, or `-1` for the deal (nobody acted). */
  readonly seat: number;
  readonly action: 'deal' | 'play' | 'draw';
  /** The card played. Meaningless (and the sentinel) unless `action === 'play'`. */
  readonly card: Card;
  /** The colour in force AFTER the move — a wild's chosen colour, which the card face cannot say. */
  readonly color: UnoColor;
  /** The seat an action card made draw, or `-1`. */
  readonly victim: number;
  /** How many `victim` drew; `0` when there was none. */
  readonly drew: number;
  /** The seat whose turn was skipped over, or `-1`. */
  readonly skipped: number;
  readonly reversed: boolean;
  /** The actor declared UNO going to one card. */
  readonly calledUno: boolean;
  /** The actor took the +2 for going to one card silently. */
  readonly penalty: boolean;
  /**
   * The seat that WON, on the move that ENDED the round — or `-1`.
   *
   * Playing for places those come apart: first place is settled several moves before the round is,
   * and this stays `-1` until the last card of the last live hand goes down. That is deliberate,
   * because a log line reading "X went out and WINS!" three moves after X left the table is a
   * sentence about the wrong moment. Going out is `place`, below; winning is here.
   */
  readonly winner: number;
  /**
   * WHAT PLACE THE ACTOR TOOK by going out on this move — `1` for first, `0` if they did not go out.
   *
   * The ordinary game only ever produces `1`, on the move that also sets `winner`. Playing for
   * places it counts up, and it is the only thing that can say "2nd" — the state carries the whole
   * podium, but the log is a running commentary and a commentary that can only report the end of a
   * round says nothing at all for most of a ranked one.
   */
  readonly place: number;
  /**
   * CARDS NOW OWED to whoever is on turn, after this move; `0` when nothing is. The running total
   * a stacking table needs said out loud — under stacking a +2 deals nobody anything and skips
   * nobody, so `victim`/`drew`/`skipped` are all empty and the log would otherwise report a played
   * card and nothing about the six coming at somebody.
   */
  readonly stacked: number;
  /**
   * HOW MANY CARDS THE ACTOR DREW on this move — a stack taken, the UNO penalty, or the ordinary
   * one. `0` when they drew none.
   *
   * Separate from `victim`/`drew` rather than folded into them, because that pair means "somebody
   * ELSE was made to draw" and its line reads "…and is skipped!" — which is true of a draw-two's
   * victim and false of a player taking a stack, who is simply spending their own turn.
   */
  readonly took: number;
  /**
   * DEAL EVENTS ONLY: the seat leading this round because it won the last one, or `-1` when nobody
   * has (the opening deal). It is on the event rather than derived from `UnoState.turn` because
   * `turn` at the deal answers "who plays first", which is the same seat but a different fact — a
   * client that read the turn could say "X leads" but never "X leads BECAUSE they won", and it
   * would say it again after the first move moved the turn on. `-1` is the sentinel: the wire
   * drops nulls.
   */
  readonly leads: number;
}

/** The card an event carries when no card was played — never null, because the wire drops null. */
const NO_CARD: Card = { id: '', color: 'wild', kind: 'wild', value: -1 };

/** The opening event: the deal itself, seat-less, seq 0. Also what a no-op move produces. */
export const DEAL_EVENT: UnoEvent = {
  seq: 0,
  seat: -1,
  action: 'deal',
  card: NO_CARD,
  color: 'red',
  victim: -1,
  drew: 0,
  skipped: -1,
  reversed: false,
  calledUno: false,
  penalty: false,
  winner: -1,
  place: 0,
  stacked: 0,
  took: 0,
  leads: -1,
};

/**
 * Everything a non-host needs to render, and NOTHING hidden — no deck, no opponent's cards, only the
 * top discard, the active colour, per-seat COUNTS, and whose turn it is. This is the `TPublic` the
 * host writes to `state/data`; the deck and every hand stay off the wire. All wire-safe: `winner` is
 * a `-1` sentinel, `pending` is the sentinel above rather than null, every array is dense.
 *
 * IT EXTENDS `UnoTable` rather than restating those four fields, and the inheritance is load-bearing
 * rather than tidy: it is what lets a client hand its own state straight to `canPlay`/`mustDraw`, so
 * the feel check a board runs is literally the call the referee made. Two independent copies of
 * `{top, color, pendingDraw, houseRules}` would typecheck perfectly right up until one of them
 * gained a field.
 */
export interface UnoState extends UnoTable {
  readonly turn: number;
  readonly direction: 1 | -1;
  readonly counts: readonly number[];
  readonly deckCount: number;
  readonly calledUno: readonly boolean[];
  /**
   * The seat that won, once the round is OVER; `-1` while anybody is still playing.
   *
   * It is DERIVED here (`roundOver ? finished[0] : -1`) rather than stored, so there is one fact and
   * one place that decides it — the projection's own job, the same way `counts` and `deckCount` are
   * derived. It stays on the wire, rather than being replaced by `finished` + an `over` flag, for a
   * reason the deploy order makes concrete: the Pi ships by hand and the frontend on push, so a
   * client that predates ranked places WILL read this projection, and "did the round end" is the
   * only question it knows how to ask. Removing the field would blank the result panel for every one
   * of them; keeping it means they play the ordinary game exactly as before and simply do not draw
   * the podium.
   */
  readonly winner: number;
  /** The podium: seats in the order they went out. See `UnoGame.finished`; read it via `placesOf`. */
  readonly finished: readonly number[];
  readonly round: number;
  /**
   * WHAT IS IN THE POT, in integer cents; `0` for a table not playing for money.
   *
   * The SERVER's number, read off the match row rather than recomputed here, and that is the whole
   * reason it is on the wire at all. A board could derive it — `potFor(seats, meta.anteCents)` is
   * the same shared function the referee used — and it would be right until the moment it was not:
   * a seat that changed hands after the deal, a player whose ante was refused, a match settled
   * under a table that has since been re-sized. Then the UI quotes a pot nobody staked and nobody
   * will be paid. A dealt game's numbers come from the dealer.
   */
  readonly potCents: number;
  /**
   * The last transition, as facts (see `UnoEvent`). ONE event, not a list: the log is per-client
   * scrollback, so each client appends this to its own and a late joiner simply starts from now —
   * which is the same answer chat gives, and it keeps the room node from growing without bound over
   * a long game.
   */
  readonly lastEvent: UnoEvent;
}

/** Project the complete game to its public wire view. Pure — the host calls it on every transition. */
export function toPublic(
  game: UnoGame,
  round: number,
  potCents = 0,
  lastEvent: UnoEvent = DEAL_EVENT
): UnoState {
  const houseRules = resolveHouseRules(game.houseRules);
  return {
    top: top(game),
    color: game.color,
    turn: game.turn,
    direction: game.direction,
    counts: game.hands.map((h) => h.length),
    deckCount: game.deck.length,
    calledUno: game.calledUno,
    // See `UnoState.winner`: who came first is known long before the round ends under `playToLast`,
    // and this field has always meant "it is over".
    winner: roundOver(game) ? winnerOf(game) : -1,
    // NORMALISED, like `houseRules` and `pendingDraw` below and for the same reason: a match dealt
    // before places existed has no list, and the wire must carry a real empty array rather than the
    // `undefined` every client would then have to decide about on its own.
    finished: placesOf(game),
    round,
    potCents,
    // RESOLVED, NOT PASSED THROUGH. `game` here has usually just come back out of
    // `uno_matches.state_json`, and a row written before this field existed carries no rules at
    // all — `undefined` would then be dropped by the wire and every client would read the field as
    // missing rather than as off. Resolving projects an old match as all-false, which is not a
    // fallback: a match dealt before house rules existed was dealt under exactly these rules.
    houseRules,
    // NORMALISED for the same reason and through the same reader every rules site uses, so the wire
    // carries a real `0` rather than the `undefined` a pre-stacking match row holds — which RTDB
    // would drop and a client would then have to decide about on its own.
    pendingDraw: drawDebt({
      top: top(game),
      color: game.color,
      pendingDraw: game.pendingDraw,
      houseRules,
    }),
    lastEvent,
  };
}
