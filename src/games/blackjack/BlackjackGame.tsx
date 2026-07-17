import type { GameProps } from '@/games/registry';
import { Table } from '@/games/blackjack/components/Table';

/**
 * Blackjack — the SDK's economy smoke test, and the shape of a room-LESS game. Where Tic-Tac-Toe
 * hands its board to the shared `<Lobby>`, Blackjack has no lobby: it plays the house, not other
 * players, so it renders its table straight into the `<GameShell>` the play route already wrapped
 * it in and drives a local `useReducer`. `onExit` — the one prop a game gets (CLAUDE.md) — is
 * passed through to the table's "Leave table", since there is no lobby to own the way back.
 *
 * Everything with weight is elsewhere and owed to the OS: the bet math and payout ledger are
 * `useBet`/`reportResult`, the rules are the tested pure `logic/`, the card art and sounds are the
 * shared `system/cards` + `useAudio`. This file is the seam, and it is a few lines — the same test
 * Tic-Tac-Toe ran, pointed at the betting path.
 */
export default function BlackjackGame({ onExit }: GameProps) {
  return <Table onExit={onExit} />;
}
