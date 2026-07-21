/**
 * The authoritative in-memory room store (BACKEND_PLAN.md Phase C). This is the referee for
 * everything RTDB used to arbitrate by rule: seats, ordering, presence, hidden hands, chat. It holds
 * state and applies mutations; it does NOT do authorization (who may call what) — that is the
 * gateway's job, because only the gateway knows which authenticated `uid` a socket carries. Keeping
 * the split means this whole file is synchronous, pure of transport, and unit-testable in
 * milliseconds (`tests/rooms.test.ts`), the same way the frontend's `logic/` folders are.
 *
 * SERVER OWNS ORDERING. Every `patchState` bumps `seq` here (`nextSeq`), monotonic, never rewound —
 * the guarantee RTDB enforced with a `.validate` rule, now enforced by being the only writer. A
 * client cannot skip or repeat a seq because it never sets one.
 *
 * SERVER ARBITRATES SEATS. `claimSeat` applies atomically against the single seat array, so the
 * claim-then-verify race dies (BACKEND_PLAN.md). There is no optimistic write to reconcile.
 */

import { claimSeat as claimSeatPure, emptyTable, releaseSeat as releaseSeatPure } from './seats';
import type {
  ChatMessage,
  RoomListing,
  RoomSnapshot,
  RoomStatus,
  RoomVisibility,
  Seat,
  SeatOccupant,
} from './types';

/** The full record the server holds — the public snapshot plus the hidden and transient parts. */
interface RoomRecord {
  gameId: string;
  roomId: string;
  host: string;
  /**
   * The host's display name, stamped at create. It is a COPY of what `seats[0].name` said at the
   * time, deliberately: the listing must still name a host whose seat has been handed to a bot
   * during a disconnect grace window, and reading the name back out of the seat array would make
   * a table's label flicker to "CPU" on every blip.
   */
  hostName: string;
  /** Public tables appear in the browser; private ones are reachable only by their code. */
  visibility: RoomVisibility;
  status: RoomStatus;
  createdAt: number;
  seq: number;
  seats: Seat[];
  /** `null` until the host starts the game. `unknown` already admits it — see protocol.ts. */
  state: unknown;
  /** Hidden information, per seat index. Sent only to the seat's owner — the gateway enforces that. */
  privates: Map<number, unknown>;
  /** uids currently connected. A live socket adds itself; a drop removes it. Empty ⇒ GC. */
  presence: Set<string>;
  /** Send-ordered, capped. Filed by `key`, which sorts to send order. */
  chat: ChatMessage[];
}

export type ClaimOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'taken' | 'out-of-range' | 'no-room' };

/** Keep chat bounded — a room is ephemeral, and nobody scrolls a thousand messages back. */
const CHAT_CAP = 200;
/**
 * Bound the public index. The browser is a discovery surface, not a directory: past a screenful
 * nobody reads further, and an unbounded list is a frame whose size a stranger's room-creation
 * loop gets to choose.
 */
const LISTING_CAP = 60;
/** The unambiguous code alphabet — no O/0, I/1 — because a join code gets dictated aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TS_WIDTH = 15;
const COUNTER_WIDTH = 6;

export class RoomStore {
  private readonly rooms = new Map<string, RoomRecord>();
  /** Global per-server chat tiebreak. One clock here (no cross-machine skew), so a counter suffices. */
  private chatCounter = 0;

  /** `now` is injected so tests are deterministic; the server passes `Date.now`. */
  constructor(private readonly now: () => number = Date.now) {}

  private key(gameId: string, roomId: string): string {
    return `${gameId}/${roomId}`;
  }

  private get(gameId: string, roomId: string): RoomRecord | undefined {
    return this.rooms.get(this.key(gameId, roomId));
  }

  private makeCode(): string {
    let code = '';
    for (let i = 0; i < 4; i += 1)
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return code;
  }

  has(gameId: string, roomId: string): boolean {
    return this.rooms.has(this.key(gameId, roomId));
  }

  hostOf(gameId: string, roomId: string): string | null {
    return this.get(gameId, roomId)?.host ?? null;
  }

  seatsOf(gameId: string, roomId: string): readonly Seat[] {
    return this.get(gameId, roomId)?.seats ?? [];
  }

  statusOf(gameId: string, roomId: string): RoomStatus | null {
    return this.get(gameId, roomId)?.status ?? null;
  }

  /**
   * Every room where `uid` holds a seat. The disconnect path asks the STORE which seats a leaver
   * holds rather than trusting a per-connection mirror: a socket that claimed a seat and never
   * declared presence used to leak that seat forever on close, because the close path walked the
   * connection's presence set alone. A derived answer cannot drift from the seats it describes.
   */
  roomsHolding(uid: string): { gameId: string; roomId: string }[] {
    const out: { gameId: string; roomId: string }[] = [];
    for (const room of this.rooms.values())
      if (room.seats.some((s) => s.kind === 'human' && s.uid === uid))
        out.push({ gameId: room.gameId, roomId: room.roomId });
    return out;
  }

  /**
   * Create a room, seat the host at index 0, mint a unique code. Fails only if the server cannot
   * find a free code in a handful of tries (contention the lobby renders), or the host cannot be
   * seated (a non-positive seat count) — both returned as values, never thrown.
   *
   * `visibility` defaults to `'public'` for wire tolerance, not as a preference: a client that
   * predates the browser sends no such field, and the honest reading of a table created before
   * anyone could choose is the behaviour v1 had — listed. The frontend repo makes it a REQUIRED
   * argument, so nothing in this app creates a table without a decision.
   */
  create(
    gameId: string,
    host: SeatOccupant,
    seatCount: number,
    visibility: RoomVisibility = 'public'
  ): { ok: true; roomId: string } | { ok: false; error: string } {
    const claimed = claimSeatPure(emptyTable(seatCount), 0, host);
    if (!claimed.ok) return { ok: false, error: 'Could not seat the host.' };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const roomId = this.makeCode();
      if (this.rooms.has(this.key(gameId, roomId))) continue;
      this.rooms.set(this.key(gameId, roomId), {
        gameId,
        roomId,
        host: host.uid,
        hostName: host.name,
        visibility,
        status: 'waiting',
        createdAt: this.now(),
        seq: 0,
        seats: claimed.seats,
        state: null,
        privates: new Map(),
        presence: new Set(),
        chat: [],
      });
      return { ok: true, roomId };
    }
    return { ok: false, error: 'The tables are busy — try again.' };
  }

  /**
   * THE PUBLIC INDEX (V1_FEATURE_GAPS #9) — every table a stranger could walk up to and join.
   *
   * Four conditions, and each one is a table you would otherwise show somebody they cannot sit at:
   *   • `waiting` — a game in progress has no room for a newcomer, and joining one is not a thing
   *     this OS supports (there is no spectator; see the same doc).
   *   • `public` — the host chose to be listed. See `RoomVisibility`.
   *   • a claimable chair — `open` or `ai`; a full human table is a table you can only watch.
   *   • somebody actually PRESENT. A room whose last player closed the tab lives on for
   *     `EMPTY_ROOM_GRACE_MS` before the reaper takes it, and advertising a table nobody is at is
   *     the "ghost room" v1's hub was full of — its scanner listed rooms by existence, and its
   *     stale-room GC was the (partial) apology for that. Here the liveness test is presence, so
   *     a ghost is never listed in the first place rather than swept up later.
   *
   * Newest first, so a table someone just opened is the first one seen; `roomId` breaks ties, which
   * keeps the frame byte-stable between two calls that changed nothing.
   */
  listOpen(): RoomListing[] {
    const out: RoomListing[] = [];
    for (const room of this.rooms.values()) {
      if (room.status !== 'waiting' || room.visibility !== 'public') continue;
      if (room.presence.size === 0) continue;
      const openSeats = room.seats.filter((s) => s.kind === 'open' || s.kind === 'ai').length;
      if (openSeats === 0) continue;
      out.push({
        gameId: room.gameId,
        roomId: room.roomId,
        hostName: room.hostName,
        players: room.seats.filter((s) => s.kind === 'human').length,
        openSeats,
        seatCount: room.seats.length,
        createdAt: room.createdAt,
      });
    }
    out.sort((a, b) => b.createdAt - a.createdAt || a.roomId.localeCompare(b.roomId));
    return out.slice(0, LISTING_CAP);
  }

  /** The public projection a subscriber receives — never a private hand. `null` if the room is gone. */
  snapshot(gameId: string, roomId: string): RoomSnapshot | null {
    const room = this.get(gameId, roomId);
    if (room === undefined) return null;
    const presence: Record<string, true> = {};
    for (const uid of room.presence) presence[uid] = true;
    return {
      meta: { host: room.host, status: room.status, createdAt: room.createdAt, seq: room.seq },
      seats: room.seats.map((s) => ({ ...s })),
      state: room.state,
      presence,
    };
  }

  claimSeat(gameId: string, roomId: string, index: number, who: SeatOccupant): ClaimOutcome {
    const room = this.get(gameId, roomId);
    if (room === undefined) return { ok: false, error: 'no-room' };
    const claim = claimSeatPure(room.seats, index, who);
    if (!claim.ok) return { ok: false, error: claim.reason };
    room.seats = claim.seats;
    return { ok: true };
  }

  releaseSeat(gameId: string, roomId: string, index: number, fallback: 'ai' | 'open'): void {
    const room = this.get(gameId, roomId);
    if (room === undefined) return;
    room.seats = releaseSeatPure(room.seats, index, fallback);
  }

  setAi(gameId: string, roomId: string, index: number, name: string | null): void {
    const room = this.get(gameId, roomId);
    if (room === undefined) return;
    const seat = room.seats[index];
    if (seat === undefined) return;
    const next = room.seats.slice();
    next[index] = name === null ? { kind: 'open', name: '', uid: null } : { kind: 'ai', name, uid: null };
    room.seats = next;
  }

  /** Advance shared state and bump `seq` together — the atomic pair RTDB's transaction guaranteed. */
  patchState(gameId: string, roomId: string, data: unknown): void {
    const room = this.get(gameId, roomId);
    if (room === undefined) return;
    room.seq += 1;
    room.state = data;
  }

  setStatus(gameId: string, roomId: string, status: RoomStatus): void {
    const room = this.get(gameId, roomId);
    if (room === undefined) return;
    room.status = status;
  }

  writePrivate(gameId: string, roomId: string, index: number, data: unknown): void {
    const room = this.get(gameId, roomId);
    if (room === undefined) return;
    room.privates.set(index, data);
  }

  /** `null` when the seat holds no hand — one of the values `unknown` already covers. */
  getPrivate(gameId: string, roomId: string, index: number): unknown {
    return this.get(gameId, roomId)?.privates.get(index) ?? null;
  }

  addPresence(gameId: string, roomId: string, uid: string): void {
    this.get(gameId, roomId)?.presence.add(uid);
  }

  /** Drop a uid's presence. Returns whether the room now has NOBODY present — the GC signal. */
  removePresence(gameId: string, roomId: string, uid: string): boolean {
    const room = this.get(gameId, roomId);
    if (room === undefined) return false;
    room.presence.delete(uid);
    return room.presence.size === 0;
  }

  /**
   * How many uids are present. Read by the empty-room reaper at FIRE time — an armed timer is not
   * the authority on whether a room is still empty, this is.
   */
  presenceCount(gameId: string, roomId: string): number {
    return this.get(gameId, roomId)?.presence.size ?? 0;
  }

  /** Stamp, append (capped), and return a chat message. The server's single clock orders it. */
  chatSend(
    gameId: string,
    roomId: string,
    message: { uid: string; name: string; text: string }
  ): ChatMessage | null {
    const room = this.get(gameId, roomId);
    if (room === undefined) return null;
    const key = this.messageKey();
    const stamped: ChatMessage = { uid: message.uid, name: message.name, text: message.text, key };
    room.chat.push(stamped);
    if (room.chat.length > CHAT_CAP) room.chat.splice(0, room.chat.length - CHAT_CAP);
    return stamped;
  }

  chatMessages(gameId: string, roomId: string, limit: number): readonly ChatMessage[] {
    const room = this.get(gameId, roomId);
    if (room === undefined) return [];
    const n = Math.max(0, Math.floor(limit));
    return room.chat.slice(Math.max(0, room.chat.length - n));
  }

  chatClear(gameId: string, roomId: string): void {
    const room = this.get(gameId, roomId);
    if (room !== undefined) room.chat = [];
  }

  remove(gameId: string, roomId: string): void {
    this.rooms.delete(this.key(gameId, roomId));
  }

  /** ASCII-sortable send-order key, matching the frontend's `messageKey` widths exactly. */
  private messageKey(): string {
    const ts = Math.max(0, Math.floor(this.now()));
    const c = this.chatCounter % 10 ** COUNTER_WIDTH;
    this.chatCounter += 1;
    return String(ts).padStart(TS_WIDTH, '0') + String(c).padStart(COUNTER_WIDTH, '0');
  }
}
