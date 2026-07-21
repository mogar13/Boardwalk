/**
 * WHAT A LIAR'S DICE PLAYER IS ALLOWED TO SEE — the projection, shared.
 *
 * Blackjack's `viewOf` is the model and its docblock is the argument: this is the single most
 * security-relevant function in the game, and the reason it lives in the shared package rather
 * than in the referee is that the alternative is three copies of "what may a client see", two of
 * which nobody would think to audit.
 *
 * THE STAKES ARE HIGHER HERE THAN IN BLACKJACK. There, a leaked hole card costs you one hand of
 * information. Here, the entire game IS the hidden information: a player who can see the other
 * cups wins every challenge and never loses one, so a leak does not skew the odds, it ends the
 * game while leaving it looking like it is still being played. And unlike UNO — where the host
 * legitimately holds every hand — nobody in this game holds anyone else's dice, because the
 * referee deals it.
 *
 * THE GUARANTEE IS STRUCTURAL, NOT PROCEDURAL. `LiarsDicePublic` has no field for another seat's
 * dice. Not a filtered one, not an optional one — none. The wrong thing is unspellable rather
 * than validated, so a future edit cannot forward the cups by accident: there is nowhere to put
 * them. Counts cross the wire, faces do not.
 *
 * THE REVEAL IS A PHASE, NOT A RENDERER FLAG. When a call resolves, every cup opens and the dice
 * become genuinely public — so `revealed` is populated from `match.phase`, decided by the RULES,
 * and is empty at every other moment. A client is never sent dice it is merely trusted not to
 * draw; UNO never had to publish previously-private state, so this is the one seam here with no
 * precedent in the repo.
 */
import type { Bid, Face, LiarsDiceMatch, Phase, Resolution } from './liarsDice';
import { isPalifico, totalDice } from './liarsDice';

/** The public projection: what EVERY player at the table may see, identical for all of them. */
export interface LiarsDicePublic {
  /** How many dice each seat holds. The count is public; the faces are not. */
  readonly counts: readonly number[];
  readonly turn: number;
  readonly bid: Bid | null;
  readonly phase: Phase;
  /** Total dice on the table — derived, but every client needs it to bound the bid controls. */
  readonly total: number;
  /** The seat whose last die opened a palifico round, or `-1`. */
  readonly palificoSeat: number;
  /** The face a palifico round is locked to once opened, or `-1`. */
  readonly lockedFace: number;
  /**
   * Every cup, open — and ONLY during `reveal`/`finished`. Empty at every other moment, because
   * the rules say the dice are hidden then, not because the board declines to draw them.
   */
  readonly revealed: readonly (readonly Face[])[];
  readonly resolution: Resolution | null;
  /** `-1` until the match ends. */
  readonly winner: number;
  readonly round: number;
}

/** A seat's own cup — the private channel's payload, delivered to its owner and nobody else. */
export interface LiarsDiceHand {
  readonly dice: readonly Face[];
}

/**
 * Project a match down to what everyone may see.
 *
 * It takes no viewer, and that is deliberate: the public view is the SAME for every seat, so
 * there is no per-viewer branch that could be called with the wrong seat and hand out a cup. Your
 * own dice reach you by a different road entirely (`handFor`, over the private channel), which
 * means the two concerns cannot be confused at a call site.
 */
export function publicView(match: LiarsDiceMatch): LiarsDicePublic {
  const open = match.phase === 'reveal' || match.phase === 'finished';
  return {
    counts: match.dice.map((hand) => hand.length),
    turn: match.turn,
    bid: match.bid,
    phase: match.phase,
    total: totalDice(match),
    palificoSeat: match.palificoSeat,
    lockedFace: match.lockedFace,
    revealed: open ? match.dice.map((hand) => hand.slice()) : [],
    resolution: match.resolution,
    winner: match.winner,
    round: match.round,
  };
}

/** One seat's cup, for delivery to that seat's owner. The only road from a match to real faces. */
export function handFor(match: LiarsDiceMatch, seat: number): LiarsDiceHand {
  return { dice: (match.dice[seat] ?? []).slice() };
}

/** Whether this round counts 1s as wild — the board says so, and the bid ladder depends on it. */
export function wildsLive(view: LiarsDicePublic): boolean {
  return view.palificoSeat < 0;
}

/** Re-export for the client, which needs the palifico predicate without the whole match. */
export { isPalifico };
