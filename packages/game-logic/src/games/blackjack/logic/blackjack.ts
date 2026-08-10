/**
 * Blackjack, as pure functions and one pure reducer. No React, no DOM, no `@/system` — enforced by
 * `@boardwalk/no-impure-logic`, which is why the whole game (deck, ace-soft scoring, the dealer's
 * fixed strategy, the settle matrix, and the integer-safe 3:2 payout) is unit-tested to the last
 * line before a card is drawn on screen. This is where Blackjack's assigned coverage lives — the
 * casino economy — so it is the file that must be exactly right.
 *
 * TWO CARD MODELS ON PURPOSE. This file defines its OWN `Card`/`Suit`/`Rank` rather than importing
 * `@/system/cards`, because `logic/` may not reach into `system/` (the rule that keeps this file
 * server-portable) — and `system/cards` is browser-coupled besides (it reads `import.meta.env`).
 * The literals are kept identical to `system/cards`, so the board can hand a logic `Card` straight
 * to `cardSrc` by structural typing; if the two ever drift, that assignment stops compiling, which
 * is the check that keeps the duplication honest.
 */

// ── Cards ──────────────────────────────────────────────────────────────────────────────────────

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A fresh, ordered 52-card deck. Ordered on purpose: `shuffle` is the only randomness, so a test
 * can build a known deck and drive an exact hand without stubbing anything. */
export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank });
  return deck;
}

/**
 * Fisher–Yates, `rng` injected (defaults to `Math.random`). Injected so a test can shuffle
 * deterministically with a seeded generator and assert the result is a permutation — the "a bad
 * shuffle is how you ship an unfair game" check ARCHITECTURE.md's build order exists to catch. Pure:
 * returns a new array, does not touch the input.
 */
export function shuffle(cards: readonly Card[], rng: () => number = Math.random): Card[] {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    // Guard the index reads for `noUncheckedIndexedAccess`; i and j are always in range here.
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

// ── Hand value ─────────────────────────────────────────────────────────────────────────────────

/** A rank's base value: face cards are 10, an ace is 11 here and downgraded to 1 by `handValue`. */
function rankValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') return 10;
  return Number(rank);
}

/**
 * A hand's total, and whether it is SOFT (an ace still counted as 11, so a hit cannot bust). Aces
 * start at 11 and are demoted to 1 one at a time while the hand is over 21 — the standard
 * best-value rule, and the reason this cannot be a plain sum. `soft` drives the dealer's fixed
 * strategy and is worth returning rather than recomputing.
 */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += rankValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

/** Over 21 — the bust condition. */
export function isBust(cards: readonly Card[]): boolean {
  return handValue(cards).total > 21;
}

/** A natural: exactly two cards totalling 21. Two cards, because a 21 made on a hit is not a
 * blackjack and does not pay 3:2 — the distinction the whole payout rests on. */
export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

/**
 * The house's fixed rule: hit below 17, stand on 17 and up — INCLUDING soft 17. "Stand on all 17s"
 * is chosen over "hit soft 17" because it is marginally player-friendlier and, more to the point,
 * exactly specifiable: the tests assert the boundary at 16→hit, 17→stand, soft-17→stand, so the
 * house cannot quietly start playing a different game.
 */
export function dealerShouldHit(cards: readonly Card[]): boolean {
  return handValue(cards).total < 17;
}

/** Draw the top card. The deck must be non-empty — callers deal from a fresh 52 each hand, so a
 * single hand cannot exhaust it; an empty draw is a bug, not a game state, so it throws. */
export function drawOne(deck: readonly Card[]): { card: Card; deck: Card[] } {
  const [card, ...rest] = deck;
  if (card === undefined) throw new Error('drawOne: the deck is empty');
  return { card, deck: rest };
}

/** Play the dealer's hand to completion against the remaining deck: hit until the fixed rule says
 * stand (or the hand busts). Pure — returns the finished hand and the shortened deck. */
export function playDealer(
  dealer: readonly Card[],
  deck: readonly Card[]
): { dealer: Card[]; deck: Card[] } {
  let hand = dealer.slice();
  let rest = deck.slice();
  while (dealerShouldHit(hand)) {
    const drawn = drawOne(rest);
    hand = [...hand, drawn.card];
    rest = drawn.deck;
  }
  return { dealer: hand, deck: rest };
}

// ── Settlement ─────────────────────────────────────────────────────────────────────────────────

/** The hand's result from the PLAYER's side. `blackjack` is a natural that pays 3:2; `win` is any
 * other beat (pays even money); `lose` covers a player bust and a dealer beat. */
export type Result = 'blackjack' | 'win' | 'push' | 'lose';

/**
 * Compare a finished player hand against a finished dealer hand. Order matters: a player bust loses
 * even if the dealer would also bust (the player acted first — this is the rule that gives the
 * house its edge), and both-naturals is a push before either counts as a blackjack win.
 */
export function settle(player: readonly Card[], dealer: readonly Card[]): Result {
  const pv = handValue(player).total;
  const dv = handValue(dealer).total;
  const pBlackjack = isBlackjack(player);
  const dBlackjack = isBlackjack(dealer);

  if (pv > 21) return 'lose'; // player bust — loses regardless of the dealer
  if (pBlackjack && dBlackjack) return 'push';
  if (pBlackjack) return 'blackjack';
  if (dBlackjack) return 'lose';
  if (dv > 21) return 'win'; // dealer bust, player standing
  if (pv > dv) return 'win';
  if (pv < dv) return 'lose';
  return 'push';
}

/**
 * The GROSS cents returned to the player for a result on `wagerCents` — what `reportResult` wants
 * as `payoutCents` (the wager already left the bankroll at bet time). This is the exact spot v1
 * shipped its most-cited bug: `SystemUI.money += bet * 2.5` through a `parseInt` setter dropped the
 * fractional chip on a 3:2 natural. Here everything is integer cents and the 3:2 winnings are
 * `floor(wager * 3 / 2)` — computed in integers, house-rounding the odd half-cent down, so there is
 * no float to drop and no `NaN` to leak. `blackjack` returns stake + winnings; `win` is even money
 * (2×); `push` returns the stake; `lose` returns nothing.
 */
export function payoutCents(result: Result, wagerCents: number): number {
  switch (result) {
    case 'blackjack':
      return wagerCents + Math.floor((wagerCents * 3) / 2);
    case 'win':
      return wagerCents * 2;
    case 'push':
      return wagerCents;
    case 'lose':
      return 0;
  }
}

/** Map a Blackjack result to the economy's three-way `Outcome`, so `reportResult` records the
 * stat/XP correctly. A natural and a plain win are both `win` to the ledger; only the payout differs. */
export function resultOutcome(result: Result): 'win' | 'push' | 'loss' {
  if (result === 'push') return 'push';
  if (result === 'lose') return 'loss';
  return 'win';
}

// ── The hand's state machine (pure reducer) ──────────────────────────────────────────────────────
//
// Local game state, so it is a `useReducer` (ARCHITECTURE.md's stack table) and not a room — this
// game opts out of the room system (its coverage is the economy, not multiplayer; Solitaire shares
// the opt-out proof). The reducer is PURE and deterministic: the only randomness, the shuffle, is
// done by the component and handed in on the `deal` action, so every transition here is testable
// without stubbing `Math.random`.

/**
 * `'insurance'` is a real phase and not a flag, because the dealer's PEEK has to happen somewhere
 * and this is the only design where it happens in one place.
 *
 * A dealer showing an Ace must offer insurance BEFORE peeking — that is what insurance is — while
 * every other up-card peeks at the deal. The tempting alternative is no phase at all: let the
 * player's first `hit`/`stand`/`double` implicitly decline, and peek there. It works and it puts
 * the peek in four branches instead of one, and it breaks the double's stake ordering, because
 * `playMove` commits a second wager around a reducer call that would now sometimes settle the hand
 * instead of doubling it. With an explicit phase, `hit`/`stand`/`double` stay exactly as they were:
 * they are legal only in `'player'`, and `'player'` is only reachable once the peek has happened.
 */
export type Phase = 'betting' | 'insurance' | 'player' | 'dealer' | 'settled';

export interface BlackjackState {
  readonly deck: readonly Card[];
  readonly player: readonly Card[];
  /** `dealer[0]` is the up-card; `dealer[1]` is the hole card, drawn face-down until the reveal. */
  readonly dealer: readonly Card[];
  readonly phase: Phase;
  /** Cents staked on the current hand — doubles on a double-down. Settlement reads this. */
  readonly wagerCents: number;
  readonly doubled: boolean;
  /**
   * Cents staked on INSURANCE, or 0 for a hand that was never insured. A separate bet on the same
   * hand: it does not change `wagerCents`, it is not doubled by a double, and it never moves the
   * hand's own win/loss — a player who insures against a dealer natural still LOSES the hand.
   */
  readonly insuranceCents: number;
  /** Gross cents the insurance returned. 0 both for "never insured" and for "insured and lost";
   *  `insuranceCents > 0` is what tells those apart. */
  readonly insurancePaidCents: number;
  /** The result once `phase === 'settled'`; `null` at every other phase. */
  readonly result: Result | null;
  /** Increments each deal, so the board reports exactly one economy result per hand (a ref keyed
   *  on it), the same shape Tic-Tac-Toe's `round` uses. */
  readonly handId: number;
}

export type Action =
  | { readonly type: 'deal'; readonly deck: readonly Card[]; readonly wagerCents: number }
  | { readonly type: 'hit' }
  | { readonly type: 'stand' }
  | { readonly type: 'double' }
  /** Take insurance, then peek. Legal only in `'insurance'`. */
  | { readonly type: 'insure' }
  /** Decline insurance, then peek. Legal only in `'insurance'`, and it is a real action rather
   *  than an absence because SOMETHING has to trigger the peek and it must not be a card. */
  | { readonly type: 'decline' }
  | { readonly type: 'newHand' };

/** The empty table: nothing dealt, waiting for a bet. */
export function initialState(): BlackjackState {
  return {
    deck: [],
    player: [],
    dealer: [],
    phase: 'betting',
    wagerCents: 0,
    doubled: false,
    insuranceCents: 0,
    insurancePaidCents: 0,
    result: null,
    handId: 0,
  };
}

/**
 * THE PEEK — the dealer looks at the hole card for a natural, and the hand is over if it is there.
 *
 * This is the rule Boardwalk did not have, and its absence cost the PLAYER money in exactly one
 * place. `deal` used to settle a dealt PLAYER natural and return otherwise, so a hand against a
 * dealer natural played on: `canDouble` is true on the opening two cards, so a second stake could
 * go down on a hand that was already lost, and `settle` then took both. A real table ends the hand
 * before anyone acts and takes one. `settle` itself was always right about a dealer natural and is
 * asserted so; nothing ever ASKED it at the moment it mattered, which is why every existing
 * assertion passed while this was live.
 *
 * Called from exactly two places — the deal (for any up-card that is not an Ace) and the exit from
 * `'insurance'` (for the ones that are). Pure: it either settles or hands back the state it got.
 */
function peek(state: BlackjackState): BlackjackState {
  if (!isBlackjack(state.dealer)) return state;
  return { ...state, phase: 'settled', result: settle(state.player, state.dealer) };
}

/** Run the dealer out and settle — the shared tail of `stand` and `double`. */
function resolve(state: BlackjackState): BlackjackState {
  const played = playDealer(state.dealer, state.deck);
  return {
    ...state,
    dealer: played.dealer,
    deck: played.deck,
    phase: 'settled',
    result: settle(state.player, played.dealer),
  };
}

/**
 * The pure transition. Illegal actions for the current phase are no-ops (they return the state
 * unchanged) rather than throwing, the same discipline Tic-Tac-Toe's `play` uses — a double-click
 * on Hit after the hand settled must be harmless, and the component gates the buttons anyway.
 */
export function reducer(state: BlackjackState, action: Action): BlackjackState {
  switch (action.type) {
    case 'deal': {
      if (state.phase !== 'betting') return state;
      const [p1, d1, p2, d2, ...deck] = action.deck;
      if (p1 === undefined || d1 === undefined || p2 === undefined || d2 === undefined)
        return state;
      const player = [p1, p2];
      const dealer = [d1, d2];
      const dealt: BlackjackState = {
        deck,
        player,
        dealer,
        phase: 'player',
        wagerCents: action.wagerCents,
        doubled: false,
        insuranceCents: 0,
        insurancePaidCents: 0,
        result: null,
        handId: state.handId + 1,
      };
      // A dealt natural ends the hand immediately: the player stands on 21, the dealer reveals, and
      // `settle` resolves both-naturals as a push. No dealer draw — the player is already done.
      //
      // It is checked BEFORE the insurance branch, which is a simplification and a deliberate one:
      // a real table offers "even money" on a natural against an Ace, which is insurance wearing a
      // different name, and taking it converts a 3:2-or-push into a flat 1:1. Settling here gives
      // the honest outcome of declining it, and adding the offer is a rule about a bet, not about
      // the peek this slice is here to fix.
      if (isBlackjack(player)) {
        return { ...dealt, phase: 'settled', result: settle(player, dealer) };
      }
      // An ACE UP suspends the peek and offers insurance instead — that is the entire point of
      // insurance, and peeking here would end the hand before anyone could take it. Every other
      // up-card peeks now. `d1` is the up-card (`dealer[0]`), which is the card the player can
      // already see, so nothing about this branch depends on information the client lacks.
      if (d1.rank === 'A') return { ...dealt, phase: 'insurance' };
      return peek(dealt);
    }

    case 'hit': {
      if (state.phase !== 'player') return state;
      const { card, deck } = drawOne(state.deck);
      const player = [...state.player, card];
      if (isBust(player)) {
        return { ...state, player, deck, phase: 'settled', result: 'lose' };
      }
      return { ...state, player, deck };
    }

    case 'stand': {
      if (state.phase !== 'player') return state;
      return resolve(state);
    }

    case 'double': {
      // Only legal on the opening two cards; the extra wager is committed by the component before
      // this dispatches, so here it only doubles the recorded stake, draws exactly one, and stands.
      if (state.phase !== 'player' || state.player.length !== 2) return state;
      const { card, deck } = drawOne(state.deck);
      const player = [...state.player, card];
      const doubled: BlackjackState = {
        ...state,
        player,
        deck,
        wagerCents: state.wagerCents * 2,
        doubled: true,
      };
      if (isBust(player)) {
        return { ...doubled, phase: 'settled', result: 'lose' };
      }
      return resolve(doubled);
    }

    case 'insure': {
      if (state.phase !== 'insurance') return state;
      // The side stake is RECORDED here and committed by the caller, exactly as a double's second
      // wager is — this file cannot see a bankroll, so affordability is checked by whoever can.
      const stake = insuranceStake(state.wagerCents);
      const insured: BlackjackState = { ...state, insuranceCents: stake, phase: 'player' };
      // Now the dealer peeks, because that is what was just paid for. A natural pays the insurance
      // 2:1 and loses the main bet; `settle` decides the second half and is not told about the
      // first, which is what keeps a side bet from ever changing whether the HAND was won.
      if (isBlackjack(state.dealer)) {
        return {
          ...insured,
          insurancePaidCents: insurancePayout(stake),
          phase: 'settled',
          result: settle(state.player, state.dealer),
        };
      }
      return insured;
    }

    case 'decline': {
      if (state.phase !== 'insurance') return state;
      // No stake, same peek. The player has bought nothing and learns what everyone learns.
      return peek({ ...state, phase: 'player' });
    }

    case 'newHand': {
      // Keep `handId` so the next deal increments from it; clear everything else back to betting.
      return { ...initialState(), handId: state.handId };
    }
  }
}

/** Whether a double-down is offered: opening two cards, still the player's turn. The component adds
 * the affordability check (it must be able to commit a second wager). */
export function canDouble(state: BlackjackState): boolean {
  return state.phase === 'player' && state.player.length === 2;
}

/**
 * Whether the table is offering insurance right now.
 *
 * **IT IS A FUNCTION OF THE PHASE, AND THE PHASE WAS DECIDED BY THE UP-CARD.** That is the whole
 * security property of this feature, and it is why this is one comparison rather than something
 * that looks more thorough: an offer that asked what the dealer's hand TOTALS would read
 * `dealer[1]`, and `toPublic` sends this boolean to a client while deliberately withholding that
 * card. The bit would be free instead of bought (§3.3 of the plan), and nothing about the screen
 * would look wrong. `tests/blackjack.test.ts` pins it by asserting the answer is identical across
 * two states differing only in the hole card, and `tests/blackjack-table.test.ts` does the same
 * for `canInsureAt`, which is the seated caller.
 */
export function canInsure(state: BlackjackState): boolean {
  return state.phase === 'insurance';
}

/**
 * What insuring this hand costs: half the main wager, floored.
 *
 * Floored, in integer cents, for the reason every payout in this file is — v1 wrote
 * `currentBets[activeSeat] / 2` and put a half-chip into a float bankroll on every odd stake, which
 * is the `parseInt` 3:2 bug with a different sign. The house rounds its own side of a half-cent
 * down, so an odd wager insures for slightly less rather than slightly more.
 */
export function insuranceStake(wagerCents: number): number {
  return Math.floor(wagerCents / 2);
}

/**
 * What a WINNING insurance returns, gross: the side stake back plus 2:1 on it. Integer by
 * construction, since `insuranceStake` already floored.
 */
export function insurancePayout(stakeCents: number): number {
  return stakeCents * 3;
}
