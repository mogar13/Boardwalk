/**
 * WHAT A BLACKJACK PLAYER IS ALLOWED TO SEE — the projection, shared.
 *
 * This is the single most security-relevant function in the game and it is four lines long. It
 * decides that the hole card is dropped from the wire until the reveal, which is the literal
 * "Done when" of BACKEND_PLAN.md's Phase D: *a player with devtools open cannot see the dealer's
 * hole card, because the server never sent it.*
 *
 * IT LIVES HERE BECAUSE IT BRIEFLY LIVED IN THREE PLACES. The referee had one copy
 * (`boardwalk-api/src/domain/blackjack.ts`), the offline table had a second
 * (`src/system/repo/local/blackjackRepo.ts`), and a test compared them field-for-field to keep
 * the two honest. That test was the tell: a guard comparing two implementations of one rule is
 * the same construction as the `economy-parity` test this phase deleted, and it earns the same
 * answer. Three copies of "what may a client see" is three chances to reveal a card, and the two
 * that are not the referee's are the ones nobody would think to audit.
 *
 * PURE, and it takes the whole state on purpose. `viewOf` is the ONLY sanctioned road from a
 * `BlackjackState` to something that crosses a boundary — which is what makes "never send the
 * deck" a property of the type rather than a habit: `HandView` has no `deck` field, so the deck
 * cannot be forwarded by accident. It cannot be spelled.
 */
import type { BlackjackState, Card, Phase, Result } from './blackjack';
import { canDouble } from './blackjack';

export interface HandView {
  /**
   * The hand's handle — the referee's row id, which `/blackjack/move` addresses. NOT the
   * reducer's `handId` counter, which only ever increments within one local table and would
   * collide across accounts the moment it left the browser.
   */
  readonly handId: number;
  readonly phase: Phase;
  readonly player: readonly Card[];
  /**
   * The up-card ALONE until the reveal. `dealer[1]` is the hole card and it is dropped from this
   * array while the hand is live, so an unsettled view carries exactly one dealer card.
   */
  readonly dealer: readonly Card[];
  /** Cents at risk — already the DOUBLED figure after a double-down, as the reducer records it. */
  readonly wagerCents: number;
  readonly doubled: boolean;
  /** Non-null only once `phase === 'settled'`. */
  readonly result: Result | null;
  /** Whether the table would OFFER a double. Affordability is checked again at the move. */
  readonly canDouble: boolean;
}

/**
 * Project a hand down to what its owner may see.
 *
 * `slice(0, 1)`, not a placeholder card. Sending a fake hole card would put a lie on the wire
 * that a renderer could accidentally believe and a player could accidentally read; an absent card
 * is honestly absent, and the board draws a card back for a card that is not there rather than a
 * card that is not the card.
 */
export function viewOf(handId: number, state: BlackjackState): HandView {
  const revealed = state.phase === 'settled';
  return {
    handId,
    phase: state.phase,
    player: state.player,
    dealer: revealed ? state.dealer : state.dealer.slice(0, 1),
    wagerCents: state.wagerCents,
    doubled: state.doubled,
    result: state.result,
    canDouble: canDouble(state),
  };
}
