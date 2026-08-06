/**
 * RANKED PLACES — the house rule that stops a round ending the instant somebody goes out. 1st sits
 * out, the rest play on for 2nd, then 3rd, and the last player standing is last.
 *
 * Slice 3 of `plans/UNO_HOUSE_RULES.md`, riding the seam slice 1 built and the same one stacking
 * uses: `playToLast` is a boolean on the TABLE (chosen at create, stamped onto the round by `deal`,
 * published by `toPublic`), so `unoStart` still has no field for it.
 *
 * WHY THIS FILE EXISTS AT ALL, rather than a `finished[]` field and three `if`s in the reducer. Two
 * rules stop being about SEATS and start being about LIVE seats — who is next, and whether a reverse
 * acts as a skip — and every one of them is a question about the placement list. Keeping the list's
 * readers together is what makes "the rotation skips a finished seat" one rule with one home instead
 * of a condition repeated at four call sites, which is how the non-stacking draw-2 and the turn
 * advance would eventually come to disagree about who is still playing.
 *
 * THE PLACEMENT LIST IS THE ONLY RECORD OF WHO WON. `UnoGame.winner` is GONE — not kept alongside,
 * which would be two sources of truth for one fact, the defect this repo names most often. Every
 * read site asks `winnerOf` (who came first) or `roundOver` (is anybody still playing), and those
 * are DIFFERENT QUESTIONS the moment `playToLast` is on: for most of a ranked round first place is
 * decided and the round is not over.
 *
 * Pure — no React, no DOM, no `@/system` (`@boardwalk/no-impure-logic` enforces it over this tree).
 * It imports only TYPES from `./uno`, exactly as `stacking.ts` does, so the module graph runs one
 * way and `verbatimModuleSyntax` erases the edge entirely.
 */

import { resolveHouseRules } from './houseRules';
import type { UnoGame } from './uno';

/** Shared so a table with nobody out does not allocate a fresh empty array on every read. */
const NOBODY: readonly number[] = Object.freeze([]);

/**
 * THE SEATS THAT HAVE GONE OUT, in the order they did it — the one reader of `finished`, and the
 * reason nothing reads the field directly.
 *
 * Same contract as `drawDebt`, for the same two reasons, and the first is not theoretical here:
 *
 *   • THE DEPLOY ORDER. The frontend ships on push and the Pi by hand, so a client WILL read a
 *     projection from a referee that has never heard of this field, and `undefined.length` is a
 *     TypeError that takes the board down mid-round. Absent reads as "nobody is out", which is both
 *     crash-free and TRUE — a referee not running ranked places has nobody sitting out.
 *   • A MATCH ROW WRITTEN BEFORE THIS SLICE. `uno_matches.state_json` is a blob, so a round dealt by
 *     the previous build comes back through `JSON.parse` with no `finished` at all. It carries a
 *     `winner` instead; see `winnerOf`.
 *
 * Non-integer and negative entries are dropped rather than trusted, because every consumer uses
 * these as seat indices and a `-1` smuggled in here would mark a seat that does not exist as out
 * while `liveSeats` went on counting all of them.
 */
export function placesOf(source: { readonly finished: readonly number[] }): readonly number[] {
  const raw: unknown = source.finished;
  if (!Array.isArray(raw)) return NOBODY;
  const clean = (raw as unknown[]).filter(
    (seat): seat is number => typeof seat === 'number' && Number.isInteger(seat) && seat >= 0
  );
  return clean.length === 0 ? NOBODY : clean;
}

/** Has this seat already gone out? What the rotation asks about every seat it steps onto. */
export function isOut(game: UnoGame, seat: number): boolean {
  return placesOf(game).includes(seat);
}

/** The seats still holding cards, ascending. The rotation's universe once places are in play. */
export function liveSeats(game: UnoGame): number[] {
  const out = placesOf(game);
  const live: number[] = [];
  for (let seat = 0; seat < game.hands.length; seat += 1) if (!out.includes(seat)) live.push(seat);
  return live;
}

/**
 * WHO CAME FIRST, or `-1`. Available the moment somebody goes out — which under `playToLast` is
 * several moves before the round ends, and that gap is exactly why this is not `roundOver`.
 *
 * THE LEGACY BRANCH IS NOT A FALLBACK, it is reading an older record. A match dealt before this
 * slice is a real row on the Pi carrying `winner: number` and no placement list, and the only place
 * that is ever read is `lastMatchInRoom` — the query that decides who OPENS the next round. Losing
 * it would mean seat 0 leads instead of the player who just won, silently, at every table that was
 * mid-evening when the referee restarted. It costs three lines and it is asserted.
 */
export function winnerOf(game: UnoGame): number {
  const first = placesOf(game)[0];
  if (first !== undefined) return first;
  const legacy: unknown = (game as { readonly winner?: unknown }).winner;
  return typeof legacy === 'number' && Number.isInteger(legacy) && legacy >= 0 ? legacy : -1;
}

/**
 * IS ANYBODY STILL PLAYING? The predicate that replaced `winner !== -1` at every site that meant
 * "this round has ended" — the reducer's own guard, the referee's settle trigger, the dealer's bot
 * timer, and the projection.
 *
 * The two rules are one sentence each:
 *   • ordinarily, the round ends when the FIRST player goes out (today's game, exactly);
 *   • playing for places, it ends when at most one seat is still holding cards — and the reducer
 *     places that straggler in the same move, so this is `0` live in practice. `<= 1` rather than
 *     `=== 0` because a table with one player left has nobody to play against either way, and a
 *     predicate that answers "not over" for a position nobody can move in is how a table hangs.
 */
export function roundOver(game: UnoGame): boolean {
  const out = placesOf(game);
  // Nobody placed — or a legacy row, whose `winner` is the only thing that can answer this.
  if (out.length === 0) return winnerOf(game) >= 0;
  if (!resolveHouseRules(game.houseRules).playToLast) return true;
  return liveSeats(game).length <= 1;
}

/**
 * The seat `steps` LIVE seats along from `from`, in `direction`, wrapping the table.
 *
 * It REPLACED the plain modular `seatAfter` rather than sitting beside it, and that is the point:
 * with nobody out the two are identical, so every existing rule keeps its meaning and there is no
 * second rotation for a caller to pick the wrong one of. A skip is "two live seats along"; a
 * heads-up reverse is "two live seats along"; a draw-two's victim is "one live seat along". None of
 * them wanted to know about placements and now none of them has to.
 *
 * `from` MAY ITSELF BE OUT, and that is the ordinary case rather than an edge: a player who goes out
 * on their own turn is placed by the same move that then has to advance past them. Stepping starts
 * from the seat and counts only the live ones it lands on, so a dead starting point costs nothing.
 *
 * Total and bounded. With no live seat at all it answers `from` — a position only reachable once the
 * round is over, where nothing reads the turn — because looping forever looking for one is the way
 * this function could take a table down.
 */
export function seatAfterLive(
  from: number,
  steps: number,
  direction: 1 | -1,
  seatCount: number,
  out: readonly number[]
): number {
  if (seatCount <= 0 || steps <= 0) return from;
  let anyLive = false;
  for (let seat = 0; seat < seatCount; seat += 1) {
    if (!out.includes(seat)) {
      anyLive = true;
      break;
    }
  }
  if (!anyLive) return from;

  let seat = from;
  let moved = 0;
  // Each step passes at most `seatCount` seats before finding a live one; the guard is that bound
  // written down rather than trusted, since the loop's exit depends on `out` being well-formed.
  let guard = seatCount * steps + seatCount;
  while (moved < steps && guard > 0) {
    seat = (((seat + direction) % seatCount) + seatCount) % seatCount;
    if (!out.includes(seat)) moved += 1;
    guard -= 1;
  }
  return seat;
}
