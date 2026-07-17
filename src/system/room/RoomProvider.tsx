import { useEffect, useRef, useState, type ReactNode } from 'react';
import { repos } from '@/system/repo';
import { RoomContextProvider, type RoomIdentity } from '@/system/room/roomContext';
import { teardownPlan } from '@/system/room/lifecycle';
import type { RoomSnapshot } from '@/system/room/types';

/**
 * `<RoomProvider>` — the single owner of a room's subscription, presence, and teardown. This is
 * the component that makes `useRoom` unable to leak a listener, because a game never registers
 * one: the provider subscribes once here, and 27 v1 games' hand-rolled `listenToRoom()` (22 of
 * them leaking it) collapse into this one effect with one cleanup.
 *
 * IT OWNS THREE THINGS A GAME USED TO OWN AND FORGET:
 *
 *   1. THE SUBSCRIPTION. One `repos.room.subscribe`, torn down on unmount.
 *   2. PRESENCE. One `trackPresence`, which arms `onDisconnect` so a crashed tab is cleaned up
 *      server-side, and whose returned unsubscribe clears presence on a clean exit.
 *   3. LEAVE HYGIENE. On unmount AND on `pagehide`/`beforeunload`, it runs the pure `teardownPlan`
 *      — release my seat, drop presence, and (host only) clear chat / remove an emptied room. The
 *      plan is decided by tested logic; this just executes it, once, guarded against running twice.
 */

export interface RoomProviderProps {
  readonly identity: RoomIdentity;
  readonly children: ReactNode;
}

export function RoomProvider({ identity, children }: RoomProviderProps) {
  const { gameId, roomId, myUid } = identity;
  const [snapshot, setSnapshot] = useState<RoomSnapshot<unknown> | null>(null);

  // The latest snapshot, for the teardown path — an unmount handler cannot read React state as of
  // the moment it fires, so the plan is computed from a ref the subscribe listener keeps current.
  const snapshotRef = useRef<RoomSnapshot<unknown> | null>(null);

  useEffect(() => {
    // One handler updates the ref (for teardown) and the state (for render) together — the ref is
    // written in a callback, never during render.
    const onSnapshot = (snap: RoomSnapshot<unknown> | null) => {
      snapshotRef.current = snap;
      setSnapshot(snap);
    };
    const unsubscribe = repos.room.subscribe<unknown>(gameId, roomId, onSnapshot);
    const clearPresence = repos.room.trackPresence(gameId, roomId, myUid);

    // Runs at most once — unmount and pagehide can both fire, and releasing a seat twice or
    // removing an already-removed room is at best noise and at worst an error.
    let torn = false;
    const teardown = () => {
      if (torn) return;
      torn = true;
      clearPresence();
      const snap = snapshotRef.current;
      if (snap === null) return;
      for (const step of teardownPlan(snap, myUid)) {
        switch (step.target) {
          case 'presence':
            // Already handled by clearPresence() above — presence is the one step the provider
            // owns directly rather than through the repo, because its cleanup was armed at mount.
            break;
          case 'seat':
            // A seat freed mid-game becomes an AI so the table survives; in the lobby it opens.
            void repos.room.releaseSeat(
              gameId,
              roomId,
              step.seatIndex,
              snap.meta.status === 'playing' ? 'ai' : 'open'
            );
            break;
          case 'chat':
            void repos.chat.clear(gameId, roomId);
            break;
          case 'room':
            void repos.room.remove(gameId, roomId);
            break;
        }
      }
    };

    // `pagehide` fires on tab close and on bfcache navigation where `beforeunload` does not; both
    // are registered because v1 needed both and neither alone is enough (ARCHITECTURE.md).
    window.addEventListener('pagehide', teardown);
    window.addEventListener('beforeunload', teardown);

    return () => {
      window.removeEventListener('pagehide', teardown);
      window.removeEventListener('beforeunload', teardown);
      unsubscribe();
      teardown();
    };
  }, [gameId, roomId, myUid]);

  return <RoomContextProvider value={{ identity, snapshot }}>{children}</RoomContextProvider>;
}
