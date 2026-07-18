import { useEffect, useState } from 'react';
import { repos } from '@/system/repo';
import { useRoomContext } from '@/system/room/roomContext';

/**
 * `useHand<TPrivate>(index)` — subscribe to ONE seat's private state (`hands/<game>/<room>/<index>`),
 * the read half of the hidden-information channel. A client passes its OWN seat index; the rules
 * refuse a read of anyone else's node, so this is a data-layout-and-rule privacy guarantee, not a UI
 * trick — a bystander never even receives an opponent's cards. UNO is the first consumer: the host
 * deals every hand (`useRoom().writeHand`), and each player reads only its own here.
 *
 * Like every subscribe in this system it owns its teardown (returned by `subscribePrivate`, run on
 * unmount), so a game cannot leak this listener any more than it can leak the room one. `null` means
 * the node is absent — before the host deals, or for a spectator seat (`index < 0`, never
 * subscribed) — and a game renders an empty hand for it.
 */
export function useHand<TPrivate>(index: number): TPrivate | null {
  const { identity } = useRoomContext();
  const { gameId, roomId } = identity;
  const [data, setData] = useState<TPrivate | null>(null);

  // Drop a stale hand the instant the seat changes — the render-time "adjust state when a prop
  // changes" pattern, NOT a setState in the effect (which `react-hooks/set-state-in-effect` forbids
  // and which this is the sanctioned fix for). The subscription below then fills in the new seat's
  // value on its first fire.
  const [seenIndex, setSeenIndex] = useState(index);
  if (index !== seenIndex) {
    setSeenIndex(index);
    setData(null);
  }

  useEffect(() => {
    // A spectator (no seat) has nothing private to read; do not subscribe to `hands/.../-1`.
    if (index < 0) return;
    return repos.room.subscribePrivate<TPrivate>(gameId, roomId, index, setData);
  }, [gameId, roomId, index]);

  return data;
}
