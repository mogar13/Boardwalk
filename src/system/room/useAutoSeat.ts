import { useEffect, useRef, useState } from 'react';

import { autoSeatIndex, localSeatName } from '@/system/room/seats';
import { useRoom } from '@/system/room/useRoom';
import { useSeats } from '@/system/room/useSeats';

/**
 * ARRIVING AT A TABLE SITS YOU DOWN AT IT — the effect half of `autoSeatIndex`, which is where the
 * decision actually lives. Everything here is plumbing around a pure answer.
 *
 * Rendered once by `<Lobby>`, so it covers every way into a room there is: created, joined by code,
 * picked out of the browser, or reached by a shared link. That is deliberate — the alternative is
 * each entrance seating you itself, which is four call sites and the reason `enterTable` exists as
 * one function in the first place.
 *
 * THE RETRY IS THE SUBSCRIPTION. Two people walking into the last chair is an ordinary race, and
 * the referee arbitrates it: the loser's claim comes back `{ ok: false, 'Seat taken.' }` and the
 * snapshot that made it true is already on its way. So a refusal re-asks `autoSeatIndex` against
 * the fresh seats and takes the next chair, and a success stops by construction (the predicate
 * answers `-1` once you hold a seat). No polling, no timer, no reconciliation.
 *
 * Why `attempts` is STATE and not just the ref: the effect has to re-run after a claim settles, and
 * the snapshot cannot be relied on to do it. The broadcast and the reply come back on the same
 * socket with no ordering between them, so a snapshot that lands BEFORE the reply re-runs the
 * effect while the ref still says busy, and nothing would re-ask afterwards — seatless forever, on
 * a race that is common rather than exotic. Bumping state on settle is what closes that window.
 *
 * The budget bounds the one shape that could spin: a claim that is refused for a reason retrying
 * cannot fix. Contention is self-limiting (chairs are finite and fill), a thrown claim spends the
 * whole budget at once, and exhausting it leaves you standing at a table whose `Sit` buttons all
 * still work. It is per TABLE, so walking away from a full room and into a fresh one starts over.
 */
const MAX_ATTEMPTS = 4;

export function useAutoSeat(): void {
  const { seats, status, claim, myId, roomId } = useRoom();
  const { sharedScreen } = useSeats();
  const busy = useRef(false);
  const [budget, setBudget] = useState({ roomId, spent: 0 });

  /**
   * A NEW TABLE IS A NEW BUDGET — derived, not reset. `<RoomProvider>` is reconciled by position
   * rather than keyed, so changing `?table=` swaps the room UNDER this hook without remounting it;
   * a budget that did not notice would let one full table leave a player unable to auto-sit at any
   * table for the rest of the visit. Stamping the room onto the counter and reading it back is the
   * same "derive rather than reconcile" the lobby's own `?table=` war story is about — an effect
   * that zeroed it on `roomId` would be a second source of truth for which table this count is
   * about, and would land one render late.
   */
  const spent = budget.roomId === roomId ? budget.spent : 0;

  useEffect(() => {
    if (busy.current || spent >= MAX_ATTEMPTS) return;
    const index = autoSeatIndex({ seats, myUid: myId, status });
    if (index === -1) return;

    busy.current = true;
    // The label is the hot-seat one only on a shared screen — the same call `SeatList`'s Sit makes,
    // so a chair taken automatically and a chair taken by hand are named identically.
    void claim(index, sharedScreen ? localSeatName(index) : undefined)
      .then((result) => {
        if (!result.ok) setBudget({ roomId, spent: spent + 1 });
      })
      .catch(() => {
        // Not a lost race — a broken one. Spend the budget rather than hammering the referee.
        setBudget({ roomId, spent: MAX_ATTEMPTS });
      })
      .finally(() => {
        busy.current = false;
      });
  }, [seats, status, claim, myId, roomId, sharedScreen, spent]);
}
