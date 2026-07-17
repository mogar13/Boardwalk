/**
 * What a ROOM is. The domain shape — not the wire shape.
 *
 * This is to multiplayer what `@/system/profile/types` is to the economy: the types
 * everything above the repo speaks, with no optionals and no Firebase in sight. The wire
 * shape (all-optional, because RTDB strips empty objects and an older record carries
 * whatever it carried) lives in `@/system/repo/firebase/roomRepo`, and `readRoom` there is
 * the one place the two meet — exactly the split `profileRepo` already makes.
 *
 * THE SEAT ARRAY IS THE UNIVERSAL MULTIPLAYER PRIMITIVE (ARCHITECTURE.md — "v1's best idea,
 * and it is nearly invisible"). One shape — an ordered array of occupants — covers a 2-seat
 * chess table and a 7-seat UNO table. There is no separate "player list" and no per-mode
 * shape; a seat is open, held by a human, or held by an AI, and every mode is a different
 * pattern of the same array. See `@/system/room/seats` for why AI is an occupant kind and
 * not a mode.
 */

/**
 * Who is in a seat.
 *
 * - `open`   — nobody; the next joiner can claim it.
 * - `human`  — a person; `uid` is who, `name` is what to show.
 * - `ai`     — the house driver; `uid` is null (no account backs it), `name` is a label.
 *
 * AI IS A KIND, NOT A MODE, and that is the whole design (ARCHITECTURE.md). v1's join claims
 * "the first replaceable seat: open OR ai", and UNO's leave hands a seat BACK to an AI so the
 * host's driver keeps the table alive — drop-in/drop-out never breaks a game because an empty
 * chair and a bot chair are the same claimable thing. A `mode: 'ai' | 'online'` field would
 * have re-created the `"local"`-vs-`"hotseat"` split this project deletes.
 */
export type SeatKind = 'open' | 'human' | 'ai';

export interface Seat {
  readonly kind: SeatKind;
  /** Display label. A human's name, an AI's label ("CPU 2"), or '' for an open seat. */
  readonly name: string;
  /** The account in the seat, or `null` for `open`/`ai` — neither is backed by a uid. */
  readonly uid: string | null;
}

/** A person taking a seat. The two facts a claim needs; everything else is derived. */
export interface SeatOccupant {
  readonly uid: string;
  readonly name: string;
}

/**
 * The room's own facts, separate from its seats and its game state because they have a
 * different owner and a different lifetime: `host` and `createdAt` are set once at creation,
 * `status` moves the room through its life, and `seq` is the ordering key every state write
 * bumps.
 */
export interface RoomMeta {
  /** The uid that created the room. The only account allowed to start it or clear its chat. */
  readonly host: string;

  /**
   * `waiting` in the lobby, `playing` once the host starts, `finished` when the game ends.
   * A game reads this to know whether to show the table or the lobby; it never writes it
   * except through `setStatus`.
   */
  readonly status: 'waiting' | 'playing' | 'finished';

  /** Epoch ms at creation. Not an ordering key — see `seq`, and never sort rooms by this. */
  readonly createdAt: number;

  /**
   * THE ORDERING KEY, and the reason UNO stopped silently dropping opponents' moves.
   *
   * v1's comment, carried into the design: "Wall-clock timestamps are NOT comparable across
   * machines (clock skew silently dropped opponents' moves)." So state is never ordered by
   * time; every write bumps this monotonic counter, a client ignores an incoming state whose
   * seq is not greater than the one it has applied (see `@/system/room/ordering`), and
   * `database.rules.json` refuses a write that does not increase it — the ordering guarantee
   * is enforced at the server, not merely observed by the client.
   */
  readonly seq: number;
}

/**
 * The whole public room, as a hook sees it. Generic over `TPublic` — the game's shared state,
 * whose shape is the game's business and not the OS's. `state` is `null` before the host
 * starts (there is no game yet), which is why it is nullable rather than a defaulted `{}`:
 * "not started" and "started with empty state" are different facts.
 *
 * `presence` is a set of uids currently connected, maintained by `onDisconnect` in the repo —
 * the value is a truthy marker, not data, so the type is `Record<uid, true>` for the same
 * reason `inventory` is (a set that round-trips through RTDB).
 *
 * PRIVATE STATE IS DELIBERATELY NOT HERE. Hidden information (`rooms/.../private/<seatIdx>`)
 * is subscribed to separately, by its owner only, because the whole point is that a bystander
 * never RECEIVES it — folding it into this snapshot would send every hand to every client and
 * make the privacy a UI trick instead of a data-layout (and now rule-enforced) guarantee.
 */
export interface RoomSnapshot<TPublic> {
  readonly meta: RoomMeta;
  readonly seats: readonly Seat[];
  readonly state: TPublic | null;
  readonly presence: Readonly<Record<string, true>>;
}
