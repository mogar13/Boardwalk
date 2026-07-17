import { useCallback } from 'react';
import { useProfile } from '@/system/profile/useProfile';
import { repos } from '@/system/repo';
import { useRoomContext } from '@/system/room/roomContext';
import type { RoomMeta, Seat } from '@/system/room/types';
import type { RepoResult } from '@/system/repo/types';

/**
 * `useRoom<TPublic>()` — a game's window on the live room. It does NOT subscribe (that is
 * `<RoomProvider>`'s single job); it reads the shared snapshot and hands back the write paths.
 * This is the hook that replaces v1's per-game `listenToRoom()`, and the reason a game cannot leak
 * a listener is that there is nothing to register — the subscription is somebody else's, owned once.
 *
 * `state` is `TPublic | null` — the game asserts its own state shape here, the way `useRoom<T>()`
 * is written across ARCHITECTURE.md. It is `null` before the host starts and while the first
 * snapshot is in flight; a game renders a lobby/loading state for null rather than assuming `{}`.
 */
export interface RoomApi<TPublic> {
  readonly state: TPublic | null;
  readonly seats: readonly Seat[];
  readonly meta: RoomMeta | null;
  readonly status: RoomMeta['status'] | 'gone';
  readonly presence: Readonly<Record<string, true>>;
  readonly myId: string;
  /** Whether THIS client created the room — the only one allowed to start it or clear its chat. */
  readonly isHost: boolean;

  /**
   * Advance the shared state. `produce` MUST be pure — it runs inside a transaction that can retry
   * it — which is exactly the discipline `logic/` already enforces, so a game passes its reducer
   * straight through. The seq bump and ordering are the repo's; a game never touches them.
   */
  readonly patch: (produce: (prev: TPublic | null) => TPublic) => Promise<void>;
  readonly setStatus: (status: RoomMeta['status']) => Promise<void>;
  /**
   * Take a seat. `name` defaults to this account's display name — the ordinary case, one account one
   * seat. It is a parameter (not always the profile name) for the ONE case that needs it: a hot-seat
   * table, where a single account seats several LOCAL humans on one screen and each wants its own
   * label ("Player 2"). The seat's `uid` is still this account's — the rules pin it — so the SDK's
   * "a uid you write must be your own" guarantee holds; only the display label varies. Chess is the
   * first caller, the design input the Tic-Tac-Toe write-up flagged this seam waiting for.
   */
  readonly claim: (index: number, name?: string) => Promise<RepoResult<void>>;
  readonly release: (index: number, fallback: 'ai' | 'open') => Promise<void>;
  /** Host action: drop a bot into an open seat (`name`) or clear one back to open (`null`). */
  readonly setAi: (index: number, name: string | null) => Promise<void>;
}

export function useRoom<TPublic>(): RoomApi<TPublic> {
  const { identity, snapshot } = useRoomContext();
  const { gameId, roomId, myUid } = identity;
  // The name a claim seats under is the player's display name, not their uid — the seat label is
  // what everyone at the table reads. Falls back to 'Player' during a sign-out transition.
  const myName = useProfile()?.name ?? 'Player';

  const patch = useCallback(
    (produce: (prev: TPublic | null) => TPublic) =>
      repos.room.patchState<TPublic>(gameId, roomId, produce),
    [gameId, roomId]
  );
  const setStatus = useCallback(
    (status: RoomMeta['status']) => repos.room.setStatus(gameId, roomId, status),
    [gameId, roomId]
  );
  const claim = useCallback(
    (index: number, name?: string) =>
      repos.room.claimSeat(gameId, roomId, index, { uid: myUid, name: name ?? myName }),
    [gameId, roomId, myUid, myName]
  );
  const release = useCallback(
    (index: number, fallback: 'ai' | 'open') =>
      repos.room.releaseSeat(gameId, roomId, index, fallback),
    [gameId, roomId]
  );
  const setAi = useCallback(
    (index: number, name: string | null) => repos.room.setAi(gameId, roomId, index, name),
    [gameId, roomId]
  );

  return {
    state: (snapshot?.state ?? null) as TPublic | null,
    seats: snapshot?.seats ?? [],
    meta: snapshot?.meta ?? null,
    status: snapshot === null ? 'gone' : snapshot.meta.status,
    presence: snapshot?.presence ?? {},
    myId: myUid,
    isHost: snapshot?.meta.host === myUid,
    patch,
    setStatus,
    claim,
    release,
    setAi,
  };
}
