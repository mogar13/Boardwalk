import type { GameManifest } from '@/games/registry';

/**
 * Chess — the SDK's proof that a full-rules, turn-based game with NO economy is still just a pure
 * `logic/` and a board. Its assigned coverage (ARCHITECTURE.md's five-game matrix) is exactly three
 * things Tic-Tac-Toe and Blackjack did not exercise: an exhaustively unit-tested rulebook far bigger
 * than a win-line check, **hot-seat** (two humans, one screen — the first game to need it), and a
 * two-seat online table with zero betting. No AI: perfect play at chess is a whole engine, and the
 * house is Tic-Tac-Toe's coverage, not this one's — so `modes` is `['hotseat', 'online']` and the
 * board never computes a move for anyone.
 *
 * `as const satisfies GameManifest` is the load-bearing bit (see Tic-Tac-Toe): `as const` freezes
 * `id` to the literal `'chess'`, so the registry key, the stats key, the room path `rooms/chess/…`
 * and the `/play/chess` route are all this one string by construction — nowhere for a second
 * spelling to drift to.
 *
 * `pier: 'tables'` — skill, no stakes. `betting` is ABSENT (not `false`): the manifest says money is
 * not on the table at all, a different fact from "the minimum bet is zero", so `reportResult` moves
 * XP and stats but never the bankroll. `seats { min: 2, max: 2 }`: two chairs, both human — hot-seat
 * fills both from one account (the OS's `sharedScreen` seating), online fills them from two.
 */
export const chessManifest = {
  id: 'chess',
  name: 'Chess',
  blurb: 'The whole rulebook. Sit across a friend on one screen, or play a table online.',
  pier: 'tables',
  seats: { min: 2, max: 2 },
  modes: ['hotseat', 'online'],
} as const satisfies GameManifest;
