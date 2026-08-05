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

import { DEAL_EVENT, type Card, type Move, type UnoEvent, type UnoGame } from './uno';

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

  // A skip is "the turn passed over somebody": the seat one step along from the actor, in the
  // direction that was in force AFTER any reverse, is not the seat now holding the turn.
  const n = after.hands.length;
  const next = (((seat + after.direction) % n) + n) % n;
  const skipped = after.winner === -1 && after.turn !== next && n > 1 ? next : -1;

  // The actor going to one card either declared (calledUno flips true) or paid the standard +2.
  const actorGrew = grewBy(before, after, seat);
  const calledUno = after.calledUno[seat] === true && before.calledUno[seat] !== true;
  const penalty = move.type === 'play' && actorGrew > -1;

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
    winner: after.winner,
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
