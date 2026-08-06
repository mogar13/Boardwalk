/**
 * The move log's facts, derived by DIFFING the game either side of a move.
 *
 * WHY A DIFF rather than having `applyMove` report what it did. `applyMove` is total and pure and
 * every one of UNO's rules is tested through it; threading a second return value through it would
 * touch every path in the reducer to serve a log. Diffing costs nothing (the reducer already gives
 * us both states) and it cannot drift from the rules, because it reads the rules' own output — if
 * a draw-2 stops dealing two cards, this says so, without knowing that a draw-2 exists.
 *
 * It is also what makes a no-op silent for free: `applyMove` returns the game UNCHANGED for an
 * illegal move, so `before === after` and there is nothing to log. v1 logged optimistically at the
 * call site and had to remember not to.
 *
 * Pure — no React, no DOM, no `@/system` (`@boardwalk/no-impure-logic` enforces it over this tree).
 * It deals in seat NUMBERS and never names: a name is room data, it changes under you, and v1 put
 * the sender's copy of everyone's names on the wire inside a pre-formatted sentence. Each client
 * renders its own prose from these facts.
 */

import { DEAL_EVENT, tableOf, type Card, type Move, type UnoEvent, type UnoGame } from './uno';
import { placesOf, roundOver, seatAfterLive, winnerOf } from './places';
import { drawDebt } from './stacking';

/** Seats whose hand grew, and by how much — the only way to see a draw-2/4 without re-deriving it. */
function grewBy(before: UnoGame, after: UnoGame, seat: number): number {
  const b = before.hands[seat]?.length ?? 0;
  const a = after.hands[seat]?.length ?? 0;
  return a - b;
}

/**
 * What `move` by `seat` did, as an event stamped `seq`. Returns the deal sentinel when nothing
 * changed, which is exactly the illegal-move case — `applyMove` returns its input unchanged, so a
 * refused intent produces no log line rather than a line claiming a move that never happened.
 *
 * `seq` is passed in rather than derived: the host owns the ordering (it is the only writer), and a
 * counter living in the event would be a second clock beside the room's own `seq`, which is the
 * ordering mistake this OS already fixed once for everybody.
 */
export function describeMove(
  before: UnoGame,
  after: UnoGame,
  seat: number,
  move: Move,
  seq: number
): UnoEvent {
  if (after === before) return DEAL_EVENT;

  const played: Card | undefined =
    move.type === 'play' ? after.discard[after.discard.length - 1] : undefined;

  // The victim of an action card is the seat OTHER than the actor whose hand grew. Reading it off
  // the result rather than recomputing `seatAfter` means a change to who a draw-2 hits shows up
  // here without this file being touched.
  let victim = -1;
  let drew = 0;
  for (let s = 0; s < after.hands.length; s += 1) {
    if (s === seat) continue;
    const delta = grewBy(before, after, s);
    if (delta > 0) {
      victim = s;
      drew = delta;
      break;
    }
  }

  // A skip is "the turn passed over somebody": the seat one LIVE step along from the actor, in the
  // direction that was in force AFTER any reverse, is not the seat now holding the turn. Live and
  // not modular, because a player who has gone out was never going to take a turn — announcing them
  // as skipped is the log reporting a rule that did not fire.
  const n = after.hands.length;
  const out = placesOf(after);
  const next = seatAfterLive(seat, 1, after.direction, n, out);
  const skipped = !roundOver(after) && after.turn !== next && n > 1 ? next : -1;

  // WHAT PLACE THE ACTOR TOOK, read off the diff like everything else here: they placed on this move
  // if they were not on the podium before it and are now. A ranked round ends by placing TWO seats
  // at once (the actor, then the straggler), so this indexes the actor rather than taking the last
  // entry — which would credit whoever went out with the place the straggler was given.
  const placedBefore = placesOf(before);
  const place = !placedBefore.includes(seat) && out.includes(seat) ? out.indexOf(seat) + 1 : 0;

  // The actor going to one card either declared (calledUno flips true) or paid the standard +2.
  const actorGrew = grewBy(before, after, seat);
  const calledUno = after.calledUno[seat] === true && before.calledUno[seat] !== true;
  const penalty = move.type === 'play' && actorGrew > -1;

  // HOW MANY THE ACTOR DREW, recovered from the same net diff. A play always spends one card, so
  // its net change is `took - 1` and a plain play comes out at zero; a draw's net IS what it drew.
  // Floored at zero rather than trusted, since a diff is arithmetic on two states and a negative
  // number of cards drawn is not a fact the log should ever be able to state.
  const took = Math.max(0, move.type === 'play' ? actorGrew + 1 : actorGrew);

  return {
    seq,
    seat,
    action: move.type === 'play' ? 'play' : 'draw',
    card: played ?? DEAL_EVENT.card,
    color: after.color,
    victim,
    drew,
    skipped,
    reversed: after.direction !== before.direction,
    calledUno,
    penalty,
    // The move that ENDED it, not the move somebody went out on — see `UnoEvent.winner`.
    winner: roundOver(after) ? winnerOf(after) : -1,
    place,
    // READ OFF THE RESULT, like the victim and the skip above: the log says what the debt IS, not
    // what this card added to it, so a rule change to what a +4 contributes needs no edit here.
    stacked: drawDebt(tableOf(after)),
    took,
    leads: -1, // a move is not a deal; only `dealEvent` ever sets this
  };
}

/**
 * The event a fresh deal publishes. Seat-less — nobody acted, the dealer did — so `seat` stays `-1`
 * and `leads` carries the round's opener instead.
 *
 * `leads` is the seat that won the LAST round and therefore opens this one, or `-1` on the opening
 * deal. It is read off the game's own `turn` rather than passed separately, because `deal` has just
 * put the leader there: two ways to say the same thing is how the log ends up naming a seat that is
 * not the one holding the turn.
 */
export function dealEvent(game: UnoGame, isFirstRound = true): UnoEvent {
  return { ...DEAL_EVENT, color: game.color, leads: isFirstRound ? -1 : game.turn };
}
