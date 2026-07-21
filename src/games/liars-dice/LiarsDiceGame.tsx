import { Lobby } from '@/system/room/Lobby';
import { useGame } from '@/system/economy/useGame';
import type { GameProps } from '@/games/registry';
import { Board } from '@/games/liars-dice/components/Board';

/**
 * Liar's Dice — the same dozen lines every other room game takes, and the point of the SDK.
 *
 * The game is a manifest, a pure tested rulebook and a board. The lobby, the room, seats, the
 * private channel and the economy are the OS's; the DEALER is the referee's. What this file proves
 * is that moving the dealer to the server cost the game's own code nothing — there is no host
 * engine here, and the board is thinner than UNO's rather than thicker.
 */
export default function LiarsDiceGame({ onExit }: GameProps) {
  const { manifest } = useGame();
  return (
    <Lobby manifest={manifest} onExit={onExit}>
      <Board />
    </Lobby>
  );
}
