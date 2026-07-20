import type { GameManifest } from '@/games/registry';

/**
 * LIAR'S DICE — the sixth game, and the first the SERVER deals for a table.
 *
 * Its coverage is the two things ROADMAP item 4 named as still open: the `dice` cosmetic, declared
 * since P2 and withheld for want of a reader, and a betting game that is not Blackjack — which
 * forces the question that item raised and then flinched from, namely who holds a multiplayer
 * match. The answer here is the referee. See `plans/LIARS_DICE.md`.
 *
 * `modes: ['ai', 'online']` — NOT hot-seat, for UNO's reason exactly: hidden dice and one shared
 * screen are a contradiction, and passing a laptop around is not a mode, it is a way to see
 * everyone's cup.
 *
 * `betting` IS PRESENT, which no room game has had before. Every human seat antes and the last
 * player standing takes the pot — but the referee prices all of it, so unlike every other betting
 * surface in the app there is no client arithmetic behind the number. A table with fewer than two
 * humans plays for XP and stats alone (the pot would be your own ante handed back), and the lobby
 * says so rather than offering a stake that cannot move.
 *
 * `seats { min: 2, max: 6 }`. Note the lobby creates rooms at `seats.max` and `canStart` requires a
 * full table, so a real table is six chairs with bots filling the empty ones — the same shape UNO
 * lives with. Variable table size has no seam yet; `plans/LIARS_DICE.md` records it as open.
 *
 * `as const satisfies GameManifest` is load-bearing as always: `as const` freezes `id` to the
 * literal `'liars-dice'`, so the registry key, the stats key, the room path, the `/play/liars-dice`
 * route and the referee's `GAME_ID` are one string by construction. v1 recorded `texas_holdem` as
 * `"poker"` and five games' stats never reached the hub.
 */
export const liarsDiceManifest = {
  id: 'liars-dice',
  name: "Liar's Dice",
  blurb: 'Five dice under a cup. Bid high, call a bluff, or nail it exactly. Two to six, or fill with bots.',
  icon: 'liars-dice.png',
  pier: 'casino',
  seats: { min: 2, max: 6 },
  modes: ['ai', 'online'],
  betting: { min: 100, max: 50_000 },
} as const satisfies GameManifest;
