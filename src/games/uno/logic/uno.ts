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
 * the starting discard (so the opening card never skips or reverses seat 0 into a rules corner — v1
 * did the same). `round` is carried through for rematch/result keying.
 */
export function deal(seatCount: number, rng: () => number = Math.random): UnoGame {
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
  return {
    hands,
    deck,
    discard: [start],
    color: start.color as UnoColor,
    turn: 0,
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

const setAt = <T,>(arr: readonly T[], i: number, v: T): T[] => arr.map((x, k) => (k === i ? v : x));

/**
 * Apply `move` for `seat` to the complete game. TOTAL and PURE, exactly like Chess's `playMove`: an
 * illegal move (not your turn, no such card, unplayable card, missing colour on a wild, game over)
 * returns the game UNCHANGED, so the host can hand any intent straight in and trust the result. The
 * host compares hand references afterwards to know which private nodes to re-deal — so unchanged
 * hands keep their array reference (structural sharing), which the immutable updates here preserve.
 */
export function applyMove(game: UnoGame, seat: number, move: Move, rng: () => number = Math.random): UnoGame {
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
  let hands = setAt(game.hands, seat, hand.filter((_, k) => k !== idx));
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
 * Pick a move for an AI `seat`. Deterministic given the hand order, so it is unit-testable: play a
 * legal non-wild first (saving wilds), then an action, then a wild as a last resort; draw when
 * nothing is playable. Declares UNO whenever the play leaves exactly one card, so the bot never
 * pays its own penalty. The chosen wild colour is the bot's most-held colour.
 */
export function chooseAiMove(game: UnoGame, seat: number): Move {
  const hand = game.hands[seat];
  if (hand === undefined) return { type: 'draw' };
  const playable = hand.filter((c) => canPlay(c, top(game), game.color));
  if (playable.length === 0) return { type: 'draw' };

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

/** A submitted-but-unprocessed intent. The sentinel (`seat: -1`) means "nothing pending". */
export interface PendingMove {
  readonly seat: number;
  readonly nonce: number;
  readonly move: Move;
}

export const NO_PENDING: PendingMove = { seat: -1, nonce: 0, move: { type: 'draw' } };

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
  /** The intent a non-host has submitted for the host to apply; `ackNonce` is the last one applied. */
  readonly pending: PendingMove;
  readonly ackNonce: number;
}

/** Project the complete game to its public wire view. Pure — the host calls it on every transition. */
export function toPublic(
  game: UnoGame,
  round: number,
  pending: PendingMove = NO_PENDING,
  ackNonce = 0
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
    pending,
    ackNonce,
  };
}

/**
 * Fold a submitted intent into the public state, minting the next nonce (monotonic, so the host acks
 * in order). Non-hosts call this in their `patch` producer; it copies `prev` and replaces only
 * `pending`, so it never clobbers the host-authored derived fields.
 */
export function submitMove(prev: UnoState, seat: number, move: Move): UnoState {
  return { ...prev, pending: { seat, nonce: prev.pending.nonce + 1, move } };
}
