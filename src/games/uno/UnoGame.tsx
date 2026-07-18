import { Lobby } from '@/system/room/Lobby';
import { useGame } from '@/system/economy/useGame';
import type { GameProps } from '@/games/registry';
import { Board } from '@/games/uno/components/Board';

/**
 * UNO — the same dozen lines Tic-Tac-Toe and Chess took. The game is a manifest, a pure tested
 * `logic/`, and a board; the lobby, the room, seats, ordering, the private hand channel and the
 * economy are all the OS's. The board is handed to `<Lobby>` as `children`, so it mounts inside the
 * one `<RoomProvider>` the lobby owns — which is how its `useRoom`/`useSeats`/`useHand`/`useGame`
 * reach the single subscription without this game registering anything.
 */
export default function UnoGame({ onExit }: GameProps) {
  const { manifest } = useGame();
  return (
    <Lobby manifest={manifest} onExit={onExit}>
      <Board />
    </Lobby>
  );
}
