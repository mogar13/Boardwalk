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
  /** `null` before the host starts. `unknown` already admits it — see protocol.ts. */
  readonly state: unknown;
  readonly presence: Readonly<Record<string, true>>;
}

/**
 * Whether a table appears in the public browser (V1_FEATURE_GAPS #9).
 *
 * IT EXISTS SO THE BROWSER IS NOT A SILENT CHANGE OF MEANING. Before it, a room code was the whole
 * of who could join — "share a code with a friend" was private by obscurity, and an index that
 * lists every waiting table would have retroactively opened every one of those tables to strangers
 * without anybody choosing it. So the choice is made at CREATE, by the host, and it is a field on
 * the room rather than a filter applied at list time: a private table is never in the listing at
 * all, so no future caller can accidentally read one out.
 */
export type RoomVisibility = 'public' | 'private';

/**
 * One row of the public "Active tables" index — what the hub shows about a table you have not
 * joined. Deliberately the SMALLEST answer that lets somebody decide to sit down: which game,
 * which code, who is hosting, and how full it is.
 *
 * WHAT IS NOT HERE IS THE POINT. No uids (the browser is a public surface, and the host's account
 * id is not the browser's business), no seat array (a name-by-name roster of strangers is not
 * needed to choose a table, and it would leak every occupant to everyone browsing), no state, no
 * chat. A listing is a poster, not a window.
 */
export interface RoomListing {
  readonly gameId: string;
  readonly roomId: string;
  /** The host's display name — what a chip in the hub is labelled with. */
  readonly hostName: string;
  /** Humans currently seated. The number a joiner actually cares about. */
  readonly players: number;
  /**
   * Chairs a stranger may take right now — `open` AND `ai`, because `claimSeat` lets a person
   * displace the house ("open before ai" is a preference, not a prohibition). Counting only empty
   * chairs would hide exactly the tables a browser exists to fill: the ones a host padded with
   * bots while waiting for company.
   */
  readonly openSeats: number;
  /** Total chairs at the table, so "2/4" can be rendered without a second lookup. */
  readonly seatCount: number;
  /** Epoch ms at creation, so the list can be ordered newest-first by the reader too. */
  readonly createdAt: number;
}

export interface ChatMessage {
  readonly uid: string;
  readonly name: string;
  readonly text: string;
  readonly key: string;
}
