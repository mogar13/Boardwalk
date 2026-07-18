/**
 * Klondike solitaire, as pure functions and one pure reducer. No React, no DOM, no `@/system` —
 * enforced by `@boardwalk/no-impure-logic`, which is why the whole game (the deal, the tableau and
 * foundation build rules, the stock/waste draw-and-recycle, win detection and the auto-finish) is
 * unit-tested to the last case before a card is drawn on screen. Solitaire's assigned coverage is
 * NOT a new capability — it is the proof that a game can opt out of the room system entirely (the
 * seam Blackjack first used) — so the load-bearing thing here is that it is a real game with real
 * rules that touches neither seats nor the bankroll.
 *
 * TWO CARD MODELS ON PURPOSE. This file defines its OWN `Suit`/`Rank` rather than importing
 * `@/system/cards`, because `logic/` may not reach into `system/` (the rule that keeps this file
 * server-portable) — and `system/cards` is browser-coupled besides (it reads `import.meta.env`).
 * The literals are kept identical to `system/cards`, so the board can hand a logic `Card` straight
 * to `cardSrc` by structural typing; if the two ever drift, that assignment stops compiling, which
 * is the check that keeps the duplication honest. (This is the same arrangement Blackjack uses.)
 */

// ── Cards ──────────────────────────────────────────────────────────────────────────────────────

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

/**
 * A card in play. Suit + rank is the identity (and all `cardSrc` needs); `faceUp` is position
 * state — a stock card is down, a waste/foundation card is always up, and a tableau card flips up
 * when it becomes a column's top. Carried on the card rather than on the pile so a single column
 * can hold a face-down run beneath a face-up one.
 */
export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
  readonly faceUp: boolean;
}

const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A rank's order, Ace low: `A`→1 … `K`→13. Foundations build up by this, tableaux down. */
export function rankOrder(rank: Rank): number {
  return RANKS.indexOf(rank) + 1;
}

/** Hearts and diamonds are red; spades and clubs are black. Derived, so it cannot drift. */
export function isRed(card: Card): boolean {
  return card.suit === 'hearts' || card.suit === 'diamonds';
}

/**
 * A fresh, ordered 52-card deck, every card face DOWN — the pre-shuffle state. Ordered on purpose:
 * `shuffle` is the only randomness, so a test can build a known deck and drive an exact game
 * without stubbing anything.
 */
export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank, faceUp: false });
  return deck;
}

/**
 * Fisher–Yates, `rng` injected (defaults to `Math.random`). Injected so a test can shuffle
 * deterministically with a seeded generator and assert the result is a permutation — the "a bad
 * shuffle is how you ship an unwinnable game" check. Pure: returns a new array, does not touch the
 * input.
 */
export function shuffle(cards: readonly Card[], rng: () => number = Math.random): Card[] {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
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

// ── State ────────────────────────────────────────────────────────────────────────────────────────

/**
 * A pile the player can move a card off of, or onto. `foundation`/`tableau` carry an index; `waste`
 * and `stock` are singletons. The reducer speaks this vocabulary so the board can express "move the
 * waste card to tableau column 3" without the rules knowing anything about pixels.
 */
export type Pile =
  | { readonly kind: 'waste' }
  | { readonly kind: 'stock' }
  | { readonly kind: 'foundation'; readonly index: number }
  | { readonly kind: 'tableau'; readonly col: number };

/**
 * The whole game, immutable. Conventions: the LAST element of every pile is its top (the card you
 * can act on). `stock` holds face-down cards drawn from the end; `waste` holds face-up cards, its
 * last the one you can play; `foundations` are four suit stacks built Ace→King; `tableau` is seven
 * columns, each a face-down run beneath a face-up run. Local state (no room), so it lives in a
 * `useReducer`, not a subscription — this game opts out of multiplayer.
 */
export interface SolitaireState {
  readonly stock: readonly Card[];
  readonly waste: readonly Card[];
  readonly foundations: readonly (readonly Card[])[];
  readonly tableau: readonly (readonly Card[])[];
  /** 1 or 3 cards to the waste per draw — the classic difficulty knob, fixed at deal time. */
  readonly drawCount: 1 | 3;
  /** Every draw and every accepted move increments this — the scoreboard, and a cheap change key. */
  readonly moves: number;
  /** True once all 52 cards are on the foundations. Terminal; further actions are no-ops. */
  readonly won: boolean;
}

/** The number of tableau columns and foundations — fixed by the game, named so the loops read. */
export const TABLEAU_COLS = 7;
export const FOUNDATION_COUNT = 4;

/** The empty table before a deal. */
export function initialState(): SolitaireState {
  return {
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    drawCount: 1,
    moves: 0,
    won: false,
  };
}

/**
 * Deal a shuffled deck into the Klondike layout: column `c` gets `c + 1` cards, only its top face
 * up; the remaining 24 go to the stock, face down. Pure — the shuffle is done by the caller and
 * handed in, exactly like Blackjack's `deal`, so every game here is reproducible from a known deck.
 * A short deck (fewer than 52) simply deals what it can; callers pass a full `shuffle(freshDeck())`.
 */
export function deal(deck: readonly Card[], drawCount: 1 | 3 = 1): SolitaireState {
  const cards = deck.slice();
  const tableau: Card[][] = Array.from({ length: TABLEAU_COLS }, () => []);
  let i = 0;
  for (let col = 0; col < TABLEAU_COLS; col++) {
    for (let row = 0; row <= col; row++) {
      const card = cards[i++];
      if (card === undefined) break;
      // Only the last card dealt to a column (row === col) lands face up.
      tableau[col]?.push({ ...card, faceUp: row === col });
    }
  }
  const stock: Card[] = cards.slice(i).map((c) => ({ ...c, faceUp: false }));
  return {
    ...initialState(),
    stock,
    tableau,
    drawCount,
  };
}

// ── Move legality (pure predicates) ──────────────────────────────────────────────────────────────

/**
 * Can `card` be placed on a tableau column whose current top is `onto` (or `undefined` if the
 * column is empty)? Empty columns take only a King; otherwise the card must be one rank lower than
 * the top and the OPPOSITE colour. This is the rule the whole tableau builds on.
 */
export function canStackTableau(card: Card, onto: Card | undefined): boolean {
  if (onto === undefined) return card.rank === 'K';
  return isRed(card) !== isRed(onto) && rankOrder(card.rank) === rankOrder(onto.rank) - 1;
}

/**
 * Can `card` go onto `foundation` (a single suit stack, built up Ace→King)? An empty foundation
 * takes only an Ace; otherwise the card must be the same suit and exactly one rank higher than the
 * top. Only ever a single card — foundations are never built as a run.
 */
export function canStackFoundation(card: Card, foundation: readonly Card[]): boolean {
  const top = foundation[foundation.length - 1];
  if (top === undefined) return card.rank === 'A';
  return card.suit === top.suit && rankOrder(card.rank) === rankOrder(top.rank) + 1;
}

/**
 * Is `cards` a legal tableau run to lift as a unit — every card face up, and each the opposite
 * colour and one rank below the card above it? A single face-up card is trivially a valid run; an
 * empty slice is not. Used to validate a multi-card tableau→tableau move.
 */
export function isValidRun(cards: readonly Card[]): boolean {
  if (cards.length === 0) return false;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (card === undefined || !card.faceUp) return false;
    if (i > 0) {
      const prev = cards[i - 1];
      if (prev === undefined) return false;
      if (isRed(card) === isRed(prev) || rankOrder(card.rank) !== rankOrder(prev.rank) - 1) {
        return false;
      }
    }
  }
  return true;
}

/** All 52 cards on the foundations — the win. */
export function isWon(state: SolitaireState): boolean {
  return state.foundations.reduce((n, f) => n + f.length, 0) === 52;
}

/**
 * Every card in play face up — no face-down card left in any column and the stock empty. This is
 * the condition under which `autoComplete` is guaranteed to finish the game, so the board offers
 * the button only when it holds.
 */
export function canAutoComplete(state: SolitaireState): boolean {
  if (state.won) return false;
  if (state.stock.length > 0) return false;
  return state.tableau.every((col) => col.every((c) => c.faceUp));
}

// ── The lift: what a move takes off a pile ────────────────────────────────────────────────────────

/**
 * The cards a move would lift off `from` starting at `fromIndex`, or `null` if that is not a legal
 * lift. Waste/stock/foundation move only their single top card (`fromIndex` is ignored); a tableau
 * lift takes `fromIndex` to the end of the column and must be a valid face-up run. Exported so the
 * board can grey out an illegal selection before dispatching.
 */
export function liftable(state: SolitaireState, from: Pile, fromIndex: number): Card[] | null {
  switch (from.kind) {
    case 'stock':
      return null; // the stock is only ever drawn from, never a move source
    case 'waste': {
      const top = state.waste[state.waste.length - 1];
      return top === undefined ? null : [top];
    }
    case 'foundation': {
      const pile = state.foundations[from.index];
      const top = pile?.[pile.length - 1];
      return top === undefined ? null : [top];
    }
    case 'tableau': {
      const col = state.tableau[from.col];
      if (col === undefined || fromIndex < 0 || fromIndex >= col.length) return null;
      const run = col.slice(fromIndex);
      return isValidRun(run) ? run : null;
    }
  }
}

// ── Actions & reducer ─────────────────────────────────────────────────────────────────────────────

export type Action =
  | { readonly type: 'deal'; readonly deck: readonly Card[]; readonly drawCount: 1 | 3 }
  | { readonly type: 'draw' }
  | { readonly type: 'move'; readonly from: Pile; readonly fromIndex: number; readonly to: Pile }
  | { readonly type: 'auto'; readonly from: Pile }
  | { readonly type: 'autoComplete' };

/** Remove the last `count` cards from a column and flip the newly exposed top face up. */
function removeFromTableau(col: readonly Card[], count: number): Card[] {
  const rest = col.slice(0, col.length - count);
  const top = rest[rest.length - 1];
  if (top !== undefined && !top.faceUp) {
    return [...rest.slice(0, rest.length - 1), { ...top, faceUp: true }];
  }
  return rest;
}

/** Apply a validated move of `moving` from `from` onto `to`, returning the next full state. */
function commitMove(
  state: SolitaireState,
  from: Pile,
  moving: readonly Card[],
  to: Pile
): SolitaireState {
  // Cards always sit face up once they land on the waste/foundation/tableau top of a move.
  const landed = moving.map((c) => ({ ...c, faceUp: true }));

  const foundations = state.foundations.map((f) => f.slice());
  const tableau = state.tableau.map((c) => c.slice());
  let waste = state.waste.slice();

  // Detach from the source.
  switch (from.kind) {
    case 'waste':
      waste = waste.slice(0, waste.length - 1);
      break;
    case 'foundation':
      foundations[from.index] = (foundations[from.index] ?? []).slice(0, -1);
      break;
    case 'tableau':
      tableau[from.col] = removeFromTableau(tableau[from.col] ?? [], moving.length);
      break;
    case 'stock':
      break; // unreachable — the stock is never a move source
  }

  // Attach to the destination.
  if (to.kind === 'foundation') {
    foundations[to.index] = [...(foundations[to.index] ?? []), ...landed];
  } else if (to.kind === 'tableau') {
    tableau[to.col] = [...(tableau[to.col] ?? []), ...landed];
  }

  const next: SolitaireState = { ...state, foundations, tableau, waste, moves: state.moves + 1 };
  return { ...next, won: isWon(next) };
}

/** Validate a move end to end, returning the next state or the SAME state if it is illegal. */
function tryMove(state: SolitaireState, from: Pile, fromIndex: number, to: Pile): SolitaireState {
  if (from.kind === to.kind && from.kind !== 'tableau' && from.kind !== 'foundation') return state;
  const moving = liftable(state, from, fromIndex);
  if (moving === null || moving.length === 0) return state;
  const head = moving[0];
  if (head === undefined) return state;

  if (to.kind === 'foundation') {
    if (moving.length !== 1) return state; // foundations take one card at a time
    const pile = state.foundations[to.index];
    if (pile === undefined || !canStackFoundation(head, pile)) return state;
  } else if (to.kind === 'tableau') {
    const col = state.tableau[to.col];
    if (col === undefined) return state;
    if (from.kind === 'tableau' && from.col === to.col) return state; // no-op onto itself
    if (!canStackTableau(head, col[col.length - 1])) return state;
  } else {
    return state; // cannot move onto the stock or waste
  }

  return commitMove(state, from, moving, to);
}

/** The first foundation index the top card of `from` can legally go to, or `null`. */
function foundationFor(state: SolitaireState, from: Pile): number | null {
  const moving = liftable(state, from, Math.max(0, (pileTopIndex(state, from) ?? 0)));
  const card = moving?.length === 1 ? moving[0] : undefined;
  if (card === undefined) return null;
  for (let i = 0; i < state.foundations.length; i++) {
    const pile = state.foundations[i];
    if (pile !== undefined && canStackFoundation(card, pile)) return i;
  }
  return null;
}

/** The index of a pile's top card (for a tableau `auto`, the lift is always the single top card). */
function pileTopIndex(state: SolitaireState, from: Pile): number | null {
  switch (from.kind) {
    case 'waste':
      return state.waste.length - 1;
    case 'foundation':
      return (state.foundations[from.index]?.length ?? 0) - 1;
    case 'tableau':
      return (state.tableau[from.col]?.length ?? 0) - 1;
    case 'stock':
      return null;
  }
}

/**
 * The pure transition. Every illegal action is a no-op that returns the state unchanged (never a
 * throw), the same discipline the other games' reducers keep — a mis-click must be harmless, and
 * the board gates its affordances anyway. A won game accepts nothing further.
 */
export function reducer(state: SolitaireState, action: Action): SolitaireState {
  if (state.won && action.type !== 'deal') return state;

  switch (action.type) {
    case 'deal':
      return deal(action.deck, action.drawCount);

    case 'draw': {
      if (state.stock.length === 0) {
        if (state.waste.length === 0) return state; // nothing to recycle
        // Flip the waste back into the stock, face down: its top becomes the stock's bottom, so the
        // draw order repeats. `slice().reverse()` because our top is the LAST element.
        const stock = state.waste
          .slice()
          .reverse()
          .map((c) => ({ ...c, faceUp: false }));
        return { ...state, stock, waste: [], moves: state.moves + 1 };
      }
      const n = Math.min(state.drawCount, state.stock.length);
      const stock = state.stock.slice();
      const waste = state.waste.slice();
      for (let k = 0; k < n; k++) {
        const card = stock.pop();
        if (card !== undefined) waste.push({ ...card, faceUp: true });
      }
      return { ...state, stock, waste, moves: state.moves + 1 };
    }

    case 'move':
      return tryMove(state, action.from, action.fromIndex, action.to);

    case 'auto': {
      const index = foundationFor(state, action.from);
      if (index === null) return state;
      const fromIndex = pileTopIndex(state, action.from);
      if (fromIndex === null) return state;
      return tryMove(state, action.from, fromIndex, { kind: 'foundation', index });
    }

    case 'autoComplete': {
      // Repeatedly send the lowest available top card to a foundation until nothing moves. Only
      // safe once every card is face up (`canAutoComplete`), which the caller checks; guarded here
      // by a fixed iteration ceiling so a hypothetical stuck state cannot loop forever.
      let next = state;
      for (let guard = 0; guard < 52 && !next.won; guard++) {
        let moved = false;
        const sources: Pile[] = [
          { kind: 'waste' },
          ...next.tableau.map((_, col) => ({ kind: 'tableau', col }) as const),
        ];
        for (const from of sources) {
          const index = foundationFor(next, from);
          const fromIndex = pileTopIndex(next, from);
          if (index !== null && fromIndex !== null) {
            const after = tryMove(next, from, fromIndex, { kind: 'foundation', index });
            if (after !== next) {
              next = after;
              moved = true;
              break;
            }
          }
        }
        if (!moved) break;
      }
      return next;
    }
  }
}
