import type { GameProps } from '@/games/registry';
import { useGame } from '@/system/economy/useGame';
import { Lobby } from '@/system/room/Lobby';
import { Board } from '@/games/tic-tac-toe/components/Board';

/**
 * Tic-Tac-Toe — the whole game, and the SDK's smoke test. Look at how little is here: the game
 * declares nothing, wires nothing, and owns no chrome. It reads its manifest from `useGame()`
 * (the play route put it in `<GameShell>`), hands the shared `<Lobby>` its board as children, and
 * that is the entire file. The lobby owns create/join/seats/chat/start and the room subscription;
 * the board owns the rules and the drawing. If this file were long, the SDK would be wrong — that
 * is the test this game exists to run, and it passes at a dozen lines.
 *
 * `onExit` is the one prop a game gets (CLAUDE.md), passed straight through to the lobby's "back to
 * the hub". Everything else the game touches — the room, the seats, the result — is a hook the
 * board imports where it uses it, never a prop drilled from here.
 */
export default function TicTacToeGame({ onExit }: GameProps) {
  const { manifest } = useGame();
  return (
    <Lobby manifest={manifest} onExit={onExit}>
      <Board />
    </Lobby>
  );
}
