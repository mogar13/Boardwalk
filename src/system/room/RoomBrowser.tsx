import { Button, Card } from '@/ui';
import { findGame, gameIconSrc } from '@/games/registry';
import { useOpenTables } from '@/system/room/useOpenTables';
import type { OpenTable } from '@/system/room/types';

/**
 * ACTIVE TABLES — the room browser (V1_FEATURE_GAPS #9), the OS's answer to "multiplayer is
 * share-a-code only, so you can only join a table somebody handed you."
 *
 * v1's hub ran a live scanner across every online game and rendered joinable rooms as one-click
 * chips, and that is the single most substantive multiplayer UX v2 was missing — it is what filled
 * casual tables there. This is the same idea with the two v1 problems designed out:
 *
 *   • v1 listed rooms BY EXISTENCE and then swept the wreckage with a stale-room GC (30-minute and
 *     6-hour passes). Here a listing requires somebody PRESENT at the table, so a ghost is never
 *     advertised in the first place; the reaper that collects an emptied room already existed for
 *     crash recovery and needed nothing added.
 *   • v1 had no notion of a private table, so every room was public whether or not its host meant
 *     it. Here `visibility` is chosen at create, and a private table is absent from the index
 *     rather than filtered out of it.
 *
 * IT RENDERS NOTHING WHEN THERE IS NOTHING TO JOIN. An empty "no open tables" panel is furniture
 * on a boardwalk this quiet, and the hub is supposed to look the same on an ordinary day as it did
 * before this shipped — the same rule `<RefillCard>` follows. It is also what makes the component
 * safe on the RTDB fallback, where the index is empty by construction (a rules fact, named in
 * `firebase/roomRepo`): the browser simply is not there, and the join-by-code form still is.
 *
 * The component knows nothing about how joining WORKS — `onJoin` is the caller's, because the two
 * callers do different things with it: the lobby is already at the right route and just enters the
 * room, while the hub has to navigate to the game first. Neither concern belongs in a list.
 */
export interface RoomBrowserProps {
  /** Show one game's tables only (a lobby). Omit for every game (the hub). */
  readonly gameId?: string;
  readonly onJoin: (gameId: string, roomId: string) => void;
  /** Heading. Defaults to the hub's wording; a lobby names the game instead. */
  readonly title?: string;
}

export function RoomBrowser({ gameId, onJoin, title = 'Active tables' }: RoomBrowserProps) {
  const tables = useOpenTables(gameId);
  if (tables.length === 0) return null;

  return (
    <Card>
      <div className="flex flex-col gap-4 p-6">
        <h2 className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
          {title}
        </h2>
        <ul className="flex flex-col gap-2">
          {tables.map((table) => (
            <TableRow
              key={`${table.gameId}/${table.roomId}`}
              table={table}
              showGame={gameId === undefined}
              onJoin={onJoin}
            />
          ))}
        </ul>
      </div>
    </Card>
  );
}

function TableRow({
  table,
  showGame,
  onJoin,
}: {
  table: OpenTable;
  showGame: boolean;
  onJoin: (gameId: string, roomId: string) => void;
}) {
  // A table whose game is not registered on THIS client is still a live table on the server — an
  // older or newer bundle, or a game removed from the registry. Naming it by its id and letting it
  // through is honest; hiding it would make the hub disagree with the server about what exists.
  const game = findGame(table.gameId);
  const icon = gameIconSrc(game?.manifest.icon);

  return (
    <li className="border-bw-line bg-base-300/40 rounded-field flex flex-wrap items-center gap-3 border px-3 py-2">
      {showGame &&
        (icon !== undefined ? (
          <img src={icon} alt="" aria-hidden className="h-8 w-8 shrink-0 object-contain" />
        ) : (
          <span aria-hidden className="text-bw-muted font-display w-8 shrink-0 text-center text-lg">
            {(game?.manifest.name ?? table.gameId).charAt(0).toUpperCase()}
          </span>
        ))}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-base-content truncate text-sm font-semibold">
          {showGame ? `${game?.manifest.name ?? table.gameId} · ` : ''}
          <span className="text-secondary font-display tracking-[0.3em]">{table.roomId}</span>
        </span>
        <span className="text-bw-muted truncate text-xs">
          {table.hostName}&apos;s table · {table.players}/{table.seatCount} seated ·{' '}
          {table.openSeats} open
        </span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          onJoin(table.gameId, table.roomId);
        }}
      >
        Join
      </Button>
    </li>
  );
}
