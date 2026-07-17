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
 * `modes: ['solo']` and `seats: { min: 1, max: 1 }` — Blackjack opts OUT of the room system. You
 * play the house, not other players; the dealer is the bank, not a seat. So there is no lobby, no
 * seat array and no room subscription — the board renders straight into `<GameShell>` and drives a
 * local `useReducer`. This is deliberate coverage: multiplayer and private hands are UNO's job,
 * opting out of rooms is the seam Solitaire also uses, and Blackjack is the first caller of it. The
 * dealer's hole card is hidden the simplest honest way — a face-down card in local state, revealed
 * on the player's stand — not a networked-privacy trick, which is a different game's concern.
 */
export const blackjackManifest = {
  id: 'blackjack',
  name: 'Blackjack',
  blurb: 'Beat the dealer to 21 without busting. A natural pays 3:2 — the house stands on all 17s.',
  pier: 'casino',
  seats: { min: 1, max: 1 },
  modes: ['solo'],
  betting: { min: 500, max: 50000 },
} as const satisfies GameManifest;
