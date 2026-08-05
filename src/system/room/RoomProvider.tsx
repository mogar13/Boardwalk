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
 *   3. LEAVE HYGIENE. On unmount it runs the pure `teardownPlan` — release my seat, drop presence,
 *      and (host only) clear chat / remove an emptied room. The plan is decided by tested logic;
 *      this just executes it, once, guarded against running twice.
 *
 * A PAGE UNLOAD IS NOT A DEPARTURE, and this used to run the teardown on `pagehide`/`beforeunload`
 * as though it were. Those events fire when the page goes away — and a RELOAD is a page going away.
 * So refreshing mid-game made the client hand its own seat to a bot on the way out, and the tab that
 * came back two seconds later found itself a spectator at a table it had been playing at, with its
 * cards gone. F5, a phone locking, a browser restoring a session: all the same. It cost a real seat
 * in a real game before this was found, and nothing static could have seen it, because the code was
 * doing exactly what it said.
 *
 * The fix is to delete the handlers rather than to try harder inside them, because there is no
 * answer available at `pagehide` time: the page cannot know whether it is coming back. What CAN know
 * is the other end, and it already does — this is precisely what crash recovery built. On the
 * WebSocket path the gateway watches the socket die and starts `DEFAULT_GRACE_MS`, which declaring
 * presence CANCELS, so a reload lands inside the window and keeps the seat while a real leaver's
 * seat opens a few seconds later. On the RTDB fallback the `onDisconnect` armed above fires at the
 * server for the same event. Both paths already covered the case; the client handler only ever added
 * a worse answer that arrived first. What remains is the unambiguous exit — unmounting, which is
 * what "Leave table" and navigating away in the SPA both do — and that still tears down at once.
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
      // CRASH RECOVERY. Re-arm the teardown on EVERY snapshot, because the plan it derives moves
      // under us: the game starts (a freed seat must become a bot, not an open chair), the last
      // guest leaves (the host becomes the one who removes the room). An armed plan is only as
      // good as the snapshot it was armed from. A no-op on the WebSocket path, where the server
      // watches the socket itself.
      repos.room.armDisconnect(gameId, roomId, snap, myUid);
    };
    const unsubscribe = repos.room.subscribe<unknown>(gameId, roomId, onSnapshot);
    const clearPresence = repos.room.trackPresence(gameId, roomId, myUid);

    // Runs at most once — releasing a seat twice or removing an already-removed room is at best
    // noise and at worst an error.
    let torn = false;
    const teardown = () => {
      if (torn) return;
      torn = true;
      // DISARM FIRST. We are leaving deliberately and are about to run the plan ourselves; an
      // armed copy still pending on the socket would fire afterwards and re-create a `seats/<i>`
      // leaf under a room we just deleted — the resurrection hazard `teardownPlan` documents,
      // arriving by a different door.
      repos.room.armDisconnect(gameId, roomId, null, myUid);
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

    // No `pagehide`/`beforeunload` listener, deliberately — see the note above. The socket dying is
    // the signal, and the far end is the only one that can tell a reload from a goodbye.
    return () => {
      unsubscribe();
      teardown();
    };
  }, [gameId, roomId, myUid]);

  return <RoomContextProvider value={{ identity, snapshot }}>{children}</RoomContextProvider>;
}
