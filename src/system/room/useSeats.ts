import { useRoomContext } from '@/system/room/roomContext';
import { isMyTurn as isMyTurnPure, localSeatIds, mySeatIndex } from '@/system/room/seats';
import type { Seat } from '@/system/room/types';

/**
 * `useSeats()` — the seat array read the one way a game is allowed to read it. This is where the
 * three modes collapse into one code path (see `@/system/room/seats`): the hook turns the single
 * mode string into `sharedScreen`, and everything it returns is mode-free. A game gets
 * `localSeatIds` and `isMyTurn` and never learns which mode it is in — which is the whole fix for
 * v1's `"local"`-vs-`"hotseat"` split and the Checkers bug that paid the losing local player.
 *
 * DELIBERATE DEVIATION FROM THE ARCHITECTURE.md SKETCH: it does NOT return a `currentSeat`.
 * ARCHITECTURE.md lists one, but whose turn it is is GAME STATE (part of `TPublic`), not room
 * infrastructure — every game tracks the turn differently and some (solitaire) have no turn at
 * all. Baking a `currentSeat` convention into the OS before a game needs it is the
 * interface-ahead-of-caller mistake this repo keeps refusing. So `isMyTurn` is a PREDICATE the
 * game calls with its own current seat, and the local-attribution logic — the actual OS value —
 * ships now. The first game to need a shared turn cursor is the design input for adding one.
 */
export interface SeatsApi {
  readonly seats: readonly Seat[];
  /** The seats a local click on THIS screen is attributed to. See `localSeatIds`. */
  readonly localSeatIds: readonly number[];
  /** My own seat index, or -1 if I hold none (a spectator). */
  readonly mySeatIndex: number;
  /** Given the game's current seat, is it one I control? `localSeatIds.includes(currentSeat)`. */
  readonly isMyTurn: (currentSeat: number) => boolean;
}

export function useSeats(): SeatsApi {
  const { identity, snapshot } = useRoomContext();
  const seats = snapshot?.seats ?? [];
  const sharedScreen = identity.mode === 'hotseat';
  const local = localSeatIds({ seats, myUid: identity.myUid, sharedScreen });

  return {
    seats,
    localSeatIds: local,
    mySeatIndex: mySeatIndex(seats, identity.myUid),
    isMyTurn: (currentSeat: number) => isMyTurnPure(local, currentSeat),
  };
}
