import type { GameProps } from '@/games/registry';
import { useGame } from '@/system/economy/useGame';
import { Lobby } from '@/system/room/Lobby';
import { Board } from '@/games/chess/components/Board';

/**
 * Chess — the whole game, in the same dozen lines Tic-Tac-Toe took. The rulebook is a big pure
 * `logic/`, but the WIRING is not the game's problem: it reads its manifest from `useGame()`, hands
 * the shared `<Lobby>` its board as children, and stops. The lobby owns create/join/seats/chat/start
 * and the one room subscription; the board owns the rules and the drawing. That this file is as
 * short as Tic-Tac-Toe's, with a game an order of magnitude more complex behind it, IS the SDK claim.
 *
 * Hot-seat and online are the same code here — no branch on mode. The lobby offers both (the
 * manifest's `modes`), the seat list fills the two chairs (one screen or two accounts), and the
 * board reads `localSeatIds`/`isMyTurn` and never learns which it is. `onExit` is the one prop a
 * game gets (CLAUDE.md), passed straight through to the lobby's "back to the hub".
 */
export default function ChessGame({ onExit }: GameProps) {
  const { manifest } = useGame();
  return (
    <Lobby manifest={manifest} onExit={onExit}>
      <Board />
    </Lobby>
  );
}
