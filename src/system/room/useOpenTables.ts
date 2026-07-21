import { useEffect, useMemo, useState } from 'react';
import { repos } from '@/system/repo';
import type { OpenTable } from '@/system/room/types';

/**
 * THE ROOM BROWSER'S READ HALF (V1_FEATURE_GAPS #9) — every joinable public table, live.
 *
 * One subscription per mounted reader, refcounted down to ONE server-side subscription by the
 * socket, torn down on unmount by the `Unsubscribe` the repo hands back. That last part is the
 * whole reason this is a hook and not a component's `useEffect` copy-pasted twice: v1's hub ran a
 * scanner across every online game and 22 of its 25 multiplayer games leaked a listener per lobby
 * close, and the OS owning the subscription is how that stopped being each caller's problem.
 *
 * `gameId` FILTERS, it does not narrow the subscription — the index is global on the wire (see
 * `RoomRepo.subscribeOpenTables`), so the hub's unfiltered list and a lobby's one-game list ride
 * the same frames. Filtering here rather than at the server is also what lets the hub and a lobby
 * be open at once for the price of one.
 */
export function useOpenTables(gameId?: string): readonly OpenTable[] {
  const [tables, setTables] = useState<readonly OpenTable[]>([]);

  useEffect(() => {
    // The listener is stable and the subscription is not re-created when `gameId` changes: the
    // filter below is a render-time concern, and resubscribing on it would drop and re-open a
    // live socket subscription for a question the client can already answer.
    return repos.room.subscribeOpenTables(setTables);
  }, []);

  return useMemo(
    () => (gameId === undefined ? tables : tables.filter((t) => t.gameId === gameId)),
    [tables, gameId]
  );
}
