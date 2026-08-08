import type { GameManifest } from '@/games/registry';

/**
 * Blackjack — the SDK's economy test. Tic-Tac-Toe proved the OS is cheap for a no-stakes game;
 * Blackjack proves the other half: betting, the casino payout path, and `reportResult` moving real
 * money. Its `logic/` is where that lives (deck, ace-soft scoring, the settle matrix, the
 * integer-safe 3:2 natural — the exact chip v1 dropped), all unit-tested before this manifest had a
 * board to attach to.
 *
 * `pier: 'casino'` — the front of the boardwalk, where the money moves. `betting` is PRESENT (unlike
 * Tic-Tac-Toe's absent one): $5 to $500 a hand, in cents, which is what `useBet` reads to bound the
 * chip rack and what `reportResult` credits back. Money is integer cents everywhere; the field on
 * the profile is `bankrollCents` for the same reason.
 *
 * `modes: ['solo', 'ai', 'online']` — three ways in, and `'solo'` is still the FIRST because it is
 * still the game: one player against the house, no room, no seats, the board straight into
 * `<GameShell>`. Slice 3 of plans/BLACKJACK_DEPTH.md added the other two, which is a real table with
 * a lobby, a seat range and a referee-dealt round. Both are blackjack and both run the same
 * `@boardwalk/game-logic/games/blackjack`; what differs is the CONTAINER, one hand or several.
 *
 * The ROOM-LESS proof moved to Solitaire when this happened, and it was already double-covered:
 * Solitaire is `modes: ['solo']` with no seats AND no bankroll, which is the stronger claim about
 * that seam. What Blackjack keeps is the half that was only ever its own — the economy, the payouts
 * and the server-dealt hand.
 *
 * `seats: { min: 2, max: 4 }` — v1's range was 1–4, and the 1 is not a table: `modes` already
 * carries "you can play this alone", and every room game's `seats.min` must be at least 2 (a table
 * of one is FULL, and it is still not a table — `tests/room.test.ts` asserts it over this registry).
 *
 * `'solo'` NO LONGER MEANS "the client owns the game", and Phase D is where those two came apart.
 * There is still no seat and no room, but the hand is dealt behind `BlackjackRepo` — so the hole
 * card is not a card held locally and declined; it is a card the client was never sent, the same
 * privacy shape UNO's `hands/` node has, reached through a server instead of a room.
 *
 * `betting.perSeat` is what tells the OS this game has no TABLE stake. Every other betting game
 * charges one ante that the room stamps at create and every chair pays; here each chair names its
 * own, every round, from the board. Without the flag the lobby would draw an ante picker whose
 * value nothing charges and then print "$25 a seat · winner takes the pot" over a game with no pot
 * — a lobby that lies about money, which is what `tableBacking` already exists to prevent once.
 */
export const blackjackManifest = {
  id: 'blackjack',
  name: 'Blackjack',
  blurb: 'Beat the dealer to 21 without busting. A natural pays 3:2 — the house stands on all 17s.',
  icon: 'blackjack.png',
  pier: 'casino',
  seats: { min: 2, max: 4 },
  modes: ['solo', 'ai', 'online'],
  betting: { min: 500, max: 50000, perSeat: true },
} as const satisfies GameManifest;
