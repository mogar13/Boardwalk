/**
 * THE BOTS — how the house plays UNO, at two tiers.
 *
 * WHY IT IS ITS OWN FILE. `uno.ts` is the rulebook's front door and it is inside forty lines of the
 * 800-line ceiling; the AI is self-contained, imports the rulebook one way and is imported back by
 * nothing, so it belongs beside `stacking.ts` and `places.ts` rather than inside it. Splitting it
 * costs no caller a line: `index.ts` re-exports both halves under the same subpath, so
 * `@boardwalk/game-logic/games/uno` is unchanged.
 */

import { COLORS, canPlay, isWild, tableOf, type Card, type Move, type UnoColor } from './uno';
import type { UnoGame } from './uno';

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
  // BOTH TIERS ANSWER A STACK, and neither needed a line of code for it: `canPlay` has already
  // collapsed the legal set to the cards that answer the debt, so `playable` IS the set of answers
  // and "nothing playable → draw" is "cannot answer → take it". That is the factoring earning its
  // keep — the alternative was a stacking branch in each tier, which is two more places for
  // `casual` to acquire a rule that makes the game unwinnable. Guarded by playing whole dealt games
  // to a WINNER at both tiers with `stack` on.
  const playable = hand.filter((c) => canPlay(c, tableOf(game)));
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
