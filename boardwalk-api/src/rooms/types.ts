/**
 * The realtime room, server-side (BACKEND_PLAN.md Phase C). These types are the AUTHORITATIVE
 * shape the referee holds in memory and the exact shape it puts on the wire — there is no
 * wire/domain split here the way `firebase/roomRepo` needs one, because the server owns the value
 * and hands back precisely what it stores.
 *
 * The frontend's `@/system/room/types` `RoomSnapshot` is the mirror image of `RoomSnapshot` below;
 * they are kept structurally identical on purpose, because the WS repo (`api/roomRepo`) deserialises
 * straight into the domain type with no translation. When one changes the other must — the gateway
 * test and the repo are the two ends that would break if they drifted.
 *
 * WHY IN-MEMORY, NOT SQLite. Rooms are ephemeral and realtime: created, played, torn down. Presence
 * and disconnect cleanup are in-memory concepts (a live socket, or not). RTDB modelled them as
 * ephemeral nodes; the server models them as a `Map` that a process restart clears — which is the
 * same "a room does not outlive the play" guarantee. The durable tables (`ledger`, `profiles`) stay
 * in SQLite; a room never touches them.
 */

export type SeatKind = 'open' | 'human' | 'ai';
export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface Seat {
  readonly kind: SeatKind;
  readonly name: string;
  readonly uid: string | null;
}

/** A person taking a seat — the two facts a claim needs, mirroring the frontend `SeatOccupant`. */
export interface SeatOccupant {
  readonly uid: string;
  readonly name: string;
}

export interface RoomMeta {
  readonly host: string;
  readonly status: RoomStatus;
  readonly createdAt: number;
  /** THE ORDERING KEY. The server owns it — every `patchState` bumps it, monotonic, never rewound. */
  readonly seq: number;
}

/** The public room, exactly as a subscriber receives it. Private hands are NOT here — owner-only. */
export interface RoomSnapshot {
  readonly meta: RoomMeta;
  readonly seats: readonly Seat[];
  readonly state: unknown | null;
  readonly presence: Readonly<Record<string, true>>;
}

export interface ChatMessage {
  readonly uid: string;
  readonly name: string;
  readonly text: string;
  readonly key: string;
}
