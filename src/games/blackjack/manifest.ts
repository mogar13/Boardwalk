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
 * **`modes: ['ai', 'online']` — TWO ways in, and dropping the third is the point.** This game
 * declared `'solo'` for six phases: a room-less hand, no lobby, no seats, dealt behind
 * `BlackjackRepo` straight into `<GameShell>`. It was correct and it was indistinguishable from
 * `'ai'` at the one place a player meets it — the launch modal drew "Play" above "Solo / AI", two
 * buttons that both mean "blackjack by myself" and differ only in whether the other chairs hold
 * bots. `MODE_LABEL` already argues that two buttons a player cannot tell apart is a picker that
 * cannot be used; this is that argument reaching the manifest that causes it.
 *
 * What went with it is written where it is enforced (`BlackjackGame.tsx`): the board, the hook, the
 * repo and both implementations are DELETED, not left behind a mode nothing offers, and the cost —
 * no blackjack at all on the RTDB fallback, where the room-less hand used to still deal — is named
 * there rather than discovered during an outage.
 *
 * The ROOM-LESS proof was already Solitaire's before this: `modes: ['solo']` with no seats AND no
 * bankroll is the stronger claim about that seam, where Blackjack only ever made half of it. What
 * Blackjack keeps is the half that was only ever its own — the economy, the payouts, and cards it
 * does not deal itself.
 *
 * `seats: { min: 2, max: 4 }` — v1's range was 1–4, and the 1 is not a table: every room game's
 * `seats.min` must be at least 2 (a table of one is FULL, and it is still not a table —
 * `tests/room.test.ts` asserts it over this registry). A lone player gets a table of bots, which is
 * what `'ai'` means everywhere else in this app.
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
  modes: ['ai', 'online'],
  betting: { min: 500, max: 50000, perSeat: true },
} as const satisfies GameManifest;
