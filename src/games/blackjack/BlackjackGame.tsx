import { useSearchParams } from 'react-router-dom';
import type { GameProps } from '@/games/registry';
import { Lobby } from '@/system/room/Lobby';
import { useGame } from '@/system/economy/useGame';
import { roomModesOf } from '@/system/room/modes';
import { Table } from '@/games/blackjack/components/Table';
import { TableBoard } from '@/games/blackjack/components/TableBoard';

/**
 * Blackjack — the SDK's economy proof, and since slice 3 of plans/BLACKJACK_DEPTH.md the only game
 * with TWO containers for one rulebook.
 *
 * `'solo'` is the room-less game it has always been: no lobby, no seats, no subscription, the table
 * straight into the `<GameShell>` the play route already wrapped it in. `'ai'`/`'online'` are a real
 * table — `<Lobby>` owns create/join/seats/chat/start and the one `<RoomProvider>` subscription, and
 * `<TableBoard>` renders inside it as `children` once play starts, which is how its `useRoom`/
 * `useSeats` reach that subscription without this game registering a listener.
 *
 * WHICH ONE IS DECIDED BY THE URL, and that is not a routing preference — it is the same rule
 * `<Lobby>` states about `?table=`: which table you are at lives in the URL and only there. The
 * launch modal writes `?mode=` when a room mode is picked and writes none for solo, so a shared
 * table link and a fresh click land on the same branch by construction. `?table=` alone is enough
 * too, because a link somebody pasted has a room in it whether or not it kept the mode.
 *
 * THE DEFAULT IS SOLO, deliberately: `/play/blackjack` typed directly, an old bookmark, or a hub
 * card clicked before this slice existed all mean the game that was already there. A default of
 * "online" would answer "I want to play blackjack" with a create-a-table form, which is the exact
 * friction the launch modal was built to remove.
 */
export default function BlackjackGame({ onExit }: GameProps) {
  const { manifest } = useGame();
  const [params] = useSearchParams();
  const mode = params.get('mode');
  const atTable = params.get('table');
  const roomModes = roomModesOf(manifest.modes);
  const wantsRoom = (atTable !== null && atTable !== '') || roomModes.some((m) => m === mode);

  if (!wantsRoom) return <Table onExit={onExit} />;
  return (
    <Lobby manifest={manifest} onExit={onExit}>
      <TableBoard />
    </Lobby>
  );
}
