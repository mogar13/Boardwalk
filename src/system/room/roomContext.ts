import { createContext, useContext } from 'react';
import type { RoomSnapshot } from '@/system/room/types';

/**
 * The context `<RoomProvider>` sets and every room/chat hook reads. This is multiplayer's answer
 * to `economy/gameContext.ts`: the ONE thing a game is wrapped in so `useRoom`/`useSeats`/`useChat`
 * have something to read, and the single place the live subscription lives — so calling `useRoom`
 * from three components does NOT open three Firebase subscriptions. The provider subscribes once;
 * the hooks read the shared snapshot.
 *
 * WHY THE IDENTITY AND THE SNAPSHOT ARE TOGETHER. `identity` (which room, who am I, which mode) is
 * fixed for the life of the provider; `snapshot` ticks on every change. A hook needs both — the
 * snapshot to render, the identity to act (`patch`, `claimSeat`) — and splitting them into two
 * contexts would just mean every hook reads two.
 */

export interface RoomIdentity {
  readonly gameId: string;
  readonly roomId: string;
  /** This client's account — the uid seats are matched against and presence is written under. */
  readonly myUid: string;
  /**
   * The mode this client joined under. It exists ONLY to answer one question — is the screen
   * shared? — which it does at exactly one place (`useSeats`, via `sharedScreen`). No game reads
   * it; `localSeatIds` is what a game reads. This is the single mode-string in the whole system,
   * and it collapses to a boolean the moment it is used, which is the entire fix for v1's
   * `"local"`-vs-`"hotseat"` split across 14 games.
   */
  readonly mode: 'ai' | 'hotseat' | 'online';
}

export interface RoomContextValue {
  readonly identity: RoomIdentity;
  /** The live public room, or `null` before the first snapshot arrives / after the room is gone. */
  readonly snapshot: RoomSnapshot<unknown> | null;
}

const RoomContext = createContext<RoomContextValue | null>(null);

/** The provider — used only by `<RoomProvider>`. Exported so the component can render it. */
export const RoomContextProvider = RoomContext.Provider;

/**
 * The current room context, or a loud throw outside a `<RoomProvider>`. The throw is the same
 * guard `useGameContext` uses and for the same reason: a `null` default the hooks silently
 * tolerated would let `useRoom` run with no room id, subscribing to `rooms//` — a wiring mistake
 * that should fail at first render, not read an empty node forever.
 */
export function useRoomContext(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (ctx === null) {
    throw new Error(
      'useRoom()/useSeats()/useChat() must be called inside <RoomProvider>. The provider owns the ' +
        'single room subscription; a hook reaching this from outside one has no room to read.'
    );
  }
  return ctx;
}
