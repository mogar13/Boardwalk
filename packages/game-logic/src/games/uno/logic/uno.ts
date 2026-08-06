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

const isWild = (c: Card): boolean => c.kind === 'wild' || c.kind === 'wild4';

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

/** Whether `card` may be played on `top` given the active `color` (which a wild may have set). */
export function canPlay(card: Card, top: Card, color: UnoColor): boolean {
  if (isWild(card)) return true;
  if (card.color === color) return true;
  return matchKey(card) === matchKey(top);
}

/**
 * Is `draw` this seat's ONLY legal move — a hand holding nothing that plays on the current top?
 * `applyMove` refuses every play from such a hand and accepts exactly one action, so a client that
 * takes it automatically removes a mandatory click rather than a decision. (Drawing here also ENDS
 * the turn — this rulebook has no play-what-you-drew — so there is nothing after it to choose.)
 *
 * AN EMPTY HAND IS `false`, NOT `true`, and that is the whole reason this is a function rather than
 * an inline `!hand.some(…)`: a hand is `[]` both when a player has won and — the case that bites —
 * while their private `hands/` node is still loading, and `![].some(…)` is `true` for both. A caller
 * reading that as "you must draw" auto-draws on behalf of a player who has not been dealt yet.
 */
export function mustDraw(hand: readonly Card[], top: Card, color: UnoColor): boolean {
  return hand.length > 0 && !hand.some((card) => canPlay(card, top, color));
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
  /** The seat that emptied its hand, or `-1` while play continues (sentinel, never null). */
  readonly winner: number;
}

const top = (g: UnoGame): Card => {
  const c = g.discard[g.discard.length - 1];
  // deal guarantees a non-empty discard and every reducer path keeps it non-empty; this satisfies
  // noUncheckedIndexedAccess without a real branch.
  if (c === undefined) throw new Error('uno: empty discard');
  return c;
};

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

/** The seat `steps` positions from `turn` in `direction`, wrapping the table. */
function seatAfter(turn: number, steps: number, direction: 1 | -1, seatCount: number): number {
  return (((turn + direction * steps) % seatCount) + seatCount) % seatCount;
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
 */
export function deal(seatCount: number, rng: () => number = Math.random, firstSeat = 0): UnoGame {
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
    winner: -1,
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
  if (game.winner !== -1) return game;
  if (seat !== game.turn) return game;
  const hand = game.hands[seat];
  if (hand === undefined) return game;
  const seatCount = game.hands.length;

  if (move.type === 'draw') {
    const { drawn, deck, discard } = drawCards(game.deck, game.discard, 1, rng);
    if (drawn.length === 0) return game;
    return {
      ...game,
      deck,
      discard,
      hands: setAt(game.hands, seat, hand.concat(drawn)),
      calledUno: setAt(game.calledUno, seat, false),
      turn: seatAfter(game.turn, 1, game.direction, seatCount),
    };
  }

  // A play.
  const idx = hand.findIndex((c) => c.id === move.cardId);
  const card = hand[idx];
  if (card === undefined) return game;
  if (!canPlay(card, top(game), game.color)) return game;
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
  if (card.kind === 'skip') {
    steps = 2;
  } else if (card.kind === 'reverse') {
    direction = (game.direction * -1) as 1 | -1;
    steps = seatCount === 2 ? 2 : 1; // heads-up reverse acts as a skip
  } else if (card.kind === 'draw2' || card.kind === 'wild4') {
    const victim = seatAfter(game.turn, 1, game.direction, seatCount);
    const n = card.kind === 'draw2' ? 2 : 4;
    const pulled = drawCards(deck, discardPile, n, rng);
    deck = pulled.deck;
    discardPile = pulled.discard;
    const vHand = hands[victim];
    if (vHand !== undefined) hands = setAt(hands, victim, vHand.concat(pulled.drawn));
    calledUno = setAt(calledUno, victim, false);
    steps = 2; // the victim is skipped
  }

  // UNO call + penalty, and win detection, on the player's NEW hand size.
  const newHand = hands[seat];
  const newLen = newHand === undefined ? 0 : newHand.length;
  let winner = game.winner;
  if (newLen === 0) {
    winner = seat;
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

  return {
    hands,
    deck,
    discard: discardPile,
    color,
    turn: winner === -1 ? seatAfter(game.turn, steps, direction, seatCount) : game.turn,
    direction,
    calledUno,
    winner,
  };
}

// ── AI (host-driven occupant) ────────────────────────────────────────────────────────────────────

/**
 * How hard the bots play (V1_FEATURE_GAPS #1). Two tiers, not three, because there are only two
 * honest ones here: a bot that thinks about its hand and one that does not. UNO's vocabulary is its
 * own — Tic-Tac-Toe's third tier is `perfect`, a word that means nothing in a game of hidden hands
 * and a shuffled deck — which is exactly why the SDK does not hard-code a tier enum (v1's `easy /
 * normal / hard` vs `easy / medium / hard` vs `normal / hard` across 22 games).
 *
 * `sharp` is what UNO's bots have always played and stays the DEFAULT, so the shipped table is
 * unchanged unless a player asks for something easier.
 */
export type UnoLevel = 'casual' | 'sharp';

/** Injected randomness, so `casual` is deterministic in a test. The same shape `applyMove` takes. */
export type Rng = () => number;

/** Pick from `xs` with `rng`, clamping garbage (NaN, 1, negatives) into range rather than trusting it. */
function pickOne<T>(xs: readonly T[], rng: Rng): T | undefined {
  if (xs.length === 0) return undefined;
  const r = rng();
  const i = Number.isFinite(r)
    ? Math.min(xs.length - 1, Math.max(0, Math.floor(r * xs.length)))
    : 0;
  return xs[i];
}

/**
 * Pick a move for an AI `seat` at a given level. Draws when nothing is playable, at either level.
 *
 * - `sharp` — deterministic given the hand order, and unit-testable for it: play a legal non-wild
 *   first (saving wilds), then an action, then a wild as a last resort; the wild colour is the
 *   bot's most-held; and it declares UNO whenever the play leaves exactly one card, so it never
 *   pays its own penalty.
 * - `casual` — a random legal card and a random colour on a wild. It saves nothing for later and
 *   names a colour it may hold none of, which is how a beginner plays.
 *
 * IT STILL CALLS UNO, and that is not an oversight — the first draft skipped the call, on the
 * reasoning that eating the standard +2 is a difficulty made of the game's own rules rather than a
 * handicap invented for the bot. It makes the bot UNWINNABLE: a hand only reaches zero by playing
 * its last card, a hand only reaches one by playing down to it, and going to one undeclared is
 * exactly what the +2 punishes — so an undeclaring bot bounces off one card back to three, forever.
 * A four-casual table ran 3,000 turns with hands sitting at 3–4 and no winner. That is v1's
 * `[5,5,5,5]` Liar's Dice literal in another costume (a match nobody can win), and the test below
 * that plays whole dealt games to a winner is what caught it and what keeps it caught.
 *
 * At BOTH levels the returned move is one `applyMove` accepts — asserted in `tests/uno.test.ts`
 * over whole played-out games, because an action the reducer refuses is a no-op on a bot's turn and
 * a no-op on a bot's turn stalls the table forever.
 */
export function chooseAiMove(
  game: UnoGame,
  seat: number,
  level: UnoLevel = 'sharp',
  rng: Rng = Math.random
): Move {
  const hand = game.hands[seat];
  if (hand === undefined) return { type: 'draw' };
  const playable = hand.filter((c) => canPlay(c, top(game), game.color));
  if (playable.length === 0) return { type: 'draw' };

  if (level === 'casual') {
    const card = pickOne(playable, rng);
    if (card === undefined) return { type: 'draw' };
    const declareUno = hand.length === 2; // see above: without this the bot can never win
    if (!isWild(card)) return { type: 'play', cardId: card.id, declareUno };
    return {
      type: 'play',
      cardId: card.id,
      chosenColor: pickOne(COLORS, rng) ?? 'red',
      declareUno,
    };
  }

  const rank = (c: Card): number => (isWild(c) ? 2 : c.kind === 'number' ? 0 : 1);
  const pick = playable.slice().sort((a, b) => rank(a) - rank(b))[0];
  if (pick === undefined) return { type: 'draw' };

  const declareUno = hand.length === 2; // this play empties us to one
  if (!isWild(pick)) return { type: 'play', cardId: pick.id, declareUno };
  return { type: 'play', cardId: pick.id, chosenColor: bestColor(hand, pick.id), declareUno };
}

/** The colour the AI holds most of (excluding the wild it is about to play); ties break by COLORS order. */
function bestColor(hand: readonly Card[], playingId: string): UnoColor {
  const tally: Record<UnoColor, number> = { red: 0, blue: 0, green: 0, yellow: 0 };
  for (const c of hand) {
    if (c.id === playingId) continue;
    if (c.color !== 'wild') tally[c.color] += 1;
  }
  let best: UnoColor = 'red';
  for (const color of COLORS) if (tally[color] > tally[best]) best = color;
  return best;
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
  /** The seat that emptied its hand on this move, or `-1`. */
  readonly winner: number;
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
  leads: -1,
};

/**
 * Everything a non-host needs to render, and NOTHING hidden — no deck, no opponent's cards, only the
 * top discard, the active colour, per-seat COUNTS, and whose turn it is. This is the `TPublic` the
 * host writes to `state/data`; the deck and every hand stay off the wire. All wire-safe: `winner` is
 * a `-1` sentinel, `pending` is the sentinel above rather than null, every array is dense.
 */
export interface UnoState {
  readonly top: Card;
  readonly color: UnoColor;
  readonly turn: number;
  readonly direction: 1 | -1;
  readonly counts: readonly number[];
  readonly deckCount: number;
  readonly calledUno: readonly boolean[];
  readonly winner: number;
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
  return {
    top: top(game),
    color: game.color,
    turn: game.turn,
    direction: game.direction,
    counts: game.hands.map((h) => h.length),
    deckCount: game.deck.length,
    calledUno: game.calledUno,
    winner: game.winner,
    round,
    potCents,
    lastEvent,
  };
}
