import type { GameProps } from '@/games/registry';
import { Table } from '@/games/blackjack/components/Table';

/**
 * Blackjack — the SDK's economy smoke test, and the shape of a room-LESS game. Where Tic-Tac-Toe
 * hands its board to the shared `<Lobby>`, Blackjack has no lobby: it plays the house, not other
 * players, so it renders its table straight into the `<GameShell>` the play route already wrapped
 * it in. `onExit` — the one prop a game gets (CLAUDE.md) — is passed through to the table's "Leave
 * table", since there is no lobby to own the way back.
 *
 * Everything with weight is elsewhere and owed to the OS: the chip rack is `useBet`, and since
 * Phase D the DEAL is `useBlackjackTable` — the cards, the result and the payout all come from
 * behind the repo seam, because this is the one game where a client's claim about a hand was worth
 * money. The rules are the shared, tested `@boardwalk/game-logic/games/blackjack`; the card art and
 * sounds are `system/cards` + `useAudio`. This file is still a few lines.
 */
export default function BlackjackGame({ onExit }: GameProps) {
  return <Table onExit={onExit} />;
}
