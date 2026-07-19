import {
  get,
  onDisconnect,
  onValue,
  ref,
  remove as dbRemove,
  runTransaction,
  set,
  update,
} from 'firebase/database';
import { firebaseDb } from '@/system/repo/firebase/app';
import {
  claimSeat as claimSeatPure,
  emptyTable,
  releaseSeat as releaseSeatPure,
} from '@/system/room/seats';
import { nextSeq } from '@/system/room/ordering';
import { teardownPlan } from '@/system/room/lifecycle';
import { CHAT } from '@/system/repo/firebase/chatRepo';
import type { RoomMeta, RoomSnapshot, Seat } from '@/system/room/types';
import type { RepoResult, RoomRepo, Unsubscribe } from '@/system/repo/types';

/**
 * `rooms/<gameId>/<roomId>` — the realtime room, behind the seam. The ONLY place `firebase/*`
 * is imported for multiplayer, which is what keeps BACKEND_PLAN.md's WebSocket version a rewrite
 * of THIS FILE and nothing above it (`@boardwalk/no-firebase-imports` enforces the "only place").
 *
 * WIRE LAYOUT, and the one non-obvious decision in it:
 *
 *   meta       = { host, status, createdAt }        ← seq is NOT here
 *   seats      = [ { kind, name?, uid? }, ... ]
 *   state      = { seq, data }                       ← the game's TPublic is `data`; seq rides with it
 *   private/<i>= <TPrivate>                           ← owner-only read, rule-enforced
 *   presence/<uid> = true
 *
 * WHY seq LIVES WITH state AND NOT IN meta. `patchState` bumps state and seq together and must do
 * it atomically, or two concurrent patches could write a fresh state under a stale seq. The
 * atomic tool is a transaction — but a transaction reads the node it writes, and a client CANNOT
 * read another seat's `private/<i>` (that is the whole point of the privacy rule). A transaction
 * over the whole room node would therefore read others' private state as absent and write it back
 * as deleted. So the transaction is scoped to `state` alone, and seq has to live inside that
 * scope to move atomically with it. `readRoom` lifts `state.seq` back up into `meta.seq` so the
 * domain `RoomSnapshot` still reads the way `@/system/room/types` describes.
 */

/**
 * CRASH RECOVERY (plans/CRASH_RECOVERY.md) — the multi-path write this client arms as an
 * `onDisconnect`, so the teardown it would run on a clean exit happens anyway when the tab is
 * killed. PURE and exported so it is unit-testable without a network: what to write is the part
 * that can be wrong (the seat's fallback, who may delete the room), and `onDisconnect().update()`
 * is not. This is the same split as `teardownPlan` — which it calls rather than reimplements, so
 * the crash path and the clean path cannot disagree about who clears what.
 *
 * ONE update, not several, because all three delete rules authorise against
 * `rooms/<g>/<r>/meta/host`: sequential deletes would let the first take the host check away from
 * the rest. In a single multi-path update every rule evaluates against the pre-write root.
 */
export function disconnectUpdates(
  gameId: string,
  roomId: string,
  snapshot: RoomSnapshot<unknown>,
  myUid: string
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const step of teardownPlan(snapshot, myUid)) {
    switch (step.target) {
      case 'presence':
        // ARMED HERE TOO, and it has to be. `trackPresence` arms its own `onDisconnect` on the
        // presence leaf at mount — but `onDisconnect().cancel()` cancels the queued ops at a
        // location AND ALL ITS CHILDREN, and re-arming this plan cancels at the ROOT (the only
        // common ancestor of rooms/, hands/ and chat/). So every re-arm was silently disarming
        // presence, and a crashed player stayed "connected" forever — the one part of crash
        // cleanup that already worked, broken by the code meant to extend it. Caught by driving a
        // real SIGKILL against the emulator, not by any test here. Folding presence into this one
        // atomic write makes the cancel-and-re-arm self-consistent.
        updates[`${ROOM(gameId, roomId)}/presence/${myUid}`] = null;
        break;
      case 'seat': {
        // The same ai-in-a-game / open-in-the-lobby split the clean path takes, from the same pure
        // function. Re-armed on every snapshot, so a game that STARTS after this was armed re-arms
        // it to 'ai' — the fallback tracks the status instead of freezing at mount.
        const next = releaseSeatPure(
          snapshot.seats,
          step.seatIndex,
          snapshot.meta.status === 'playing' ? 'ai' : 'open'
        )[step.seatIndex];
        if (next !== undefined)
          updates[`${ROOM(gameId, roomId)}/seats/${String(step.seatIndex)}`] = {
            kind: next.kind,
            name: next.name,
          };
        break;
      }
      case 'chat':
        updates[CHAT(gameId, roomId)] = null;
        break;
      case 'room':
        // Hands go WITH the room, in this one write, for the ordering reason above.
        updates[HANDS(gameId, roomId)] = null;
        updates[ROOM(gameId, roomId)] = null;
        break;
    }
  }

  // A multi-path update may not contain a path AND an ancestor of it — RTDB rejects the whole
  // write, which means an arming that names both the room delete and this client's presence leaf
  // under it arms NOTHING, and a lone host's crash orphans the room it was supposed to remove.
  // Deleting the room already removes everything beneath it, so drop the redundant descendants.
  // (Found by driving a real crash; the SDK reports it as a thrown `OnDisconnect.update failed`,
  // which no test here was listening for.)
  const roomPath = ROOM(gameId, roomId);
  if (roomPath in updates)
    for (const key of Object.keys(updates))
      if (key.startsWith(`${roomPath}/`)) delete updates[key];

  return updates;
}

const ROOM = (g: string, r: string) => `rooms/${g}/${r}`;
// Hidden information lives OUTSIDE the room node — a room is signed-in-readable and read access
// cascades, so a private hand under it would be readable by everyone. `hands/` has no permissive
// ancestor, so its owner-only read rule actually holds. See database.rules.json.
const HAND = (g: string, r: string, i: number) => `hands/${g}/${r}/${String(i)}`;
const HANDS = (g: string, r: string) => `hands/${g}/${r}`;

// ── the wire shape (all-optional; RTDB strips empty/null, older records carry what they carried)

interface StateWire {
  seq?: unknown;
  data?: unknown;
}
interface RoomWire {
  meta?: { host?: unknown; status?: unknown; createdAt?: unknown };
  seats?: unknown;
  state?: StateWire;
  presence?: unknown;
}

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v !== '' ? v : fallback;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** RTDB hands seats back as an array (contiguous keys) or an object; normalise both, in order. */
function readSeats(wire: unknown): Seat[] {
  const entries = Array.isArray(wire)
    ? wire.map((v, i) => [String(i), v] as const)
    : Object.entries(asRecord(wire)).sort(([a], [b]) => Number(a) - Number(b));
  return entries.map(([, raw]) => {
    const s = asRecord(raw);
    const kind = s.kind === 'human' || s.kind === 'ai' ? s.kind : 'open';
    // An open seat round-trips as `{ kind: 'open' }` — name '' and uid null are both stripped by
    // RTDB — so name and uid are always defaulted here, never trusted to be present.
    return { kind, name: str(s.name, ''), uid: typeof s.uid === 'string' ? s.uid : null };
  });
}

function readPresence(wire: unknown): Record<string, true> {
  const out: Record<string, true> = {};
  for (const [uid, v] of Object.entries(asRecord(wire))) if (v === true) out[uid] = true;
  return out;
}

function readMeta(wire: RoomWire): RoomMeta {
  const m = wire.meta ?? {};
  const status = m.status === 'playing' || m.status === 'finished' ? m.status : 'waiting';
  return {
    host: str(m.host, ''),
    status,
    createdAt: num(m.createdAt),
    // Lifted from the state wrapper — see the header on why it is stored there.
    seq: num(wire.state?.seq),
  };
}

/** The one place the wire becomes the domain — same role `readProfile` plays in profileRepo. */
function readRoom<TPublic>(wire: RoomWire): RoomSnapshot<TPublic> {
  return {
    meta: readMeta(wire),
    seats: readSeats(wire.seats),
    state: (wire.state?.data ?? null) as TPublic | null,
    presence: readPresence(wire.presence),
  };
}

/**
 * A short join code a human can read aloud. Unambiguous alphabet — no O/0, I/1 — because this
 * code gets typed from one screen into another, and a code you cannot dictate is a code nobody
 * shares. `Math.random` is fine here (this is a repo, not a replayable workflow script); a
 * collision is caught by the existence check in `create` and retried.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(): string {
  let code = '';
  for (let i = 0; i < 4; i += 1)
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

export const firebaseRoomRepo: RoomRepo = {
  async create(gameId, init): Promise<RepoResult<string>> {
    const db = firebaseDb();
    // Seat the host at index 0, the rest open. `emptyTable` then a pure claim keeps this using the
    // same seat logic every other path does, rather than hand-building the array here.
    const claimed = claimSeatPure(emptyTable(init.seatCount), 0, init.host);
    if (!claimed.ok) return { ok: false, error: 'Could not seat the host.' };

    // Try a few codes; a collision is contention, not an error, until we run out of tries.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const roomId = makeCode();
      if ((await get(ref(db, ROOM(gameId, roomId)))).exists()) continue;

      // A multi-path update writing each LEAF, not a `set` of the whole room node — the room-level
      // `.write` is delete-only (it would otherwise cascade write access to every child), so create
      // is authorised leaf by leaf: `meta/*` by the meta rule, each `seats/i` by the seat rule.
      const updates: Record<string, unknown> = {
        [`${ROOM(gameId, roomId)}/meta/host`]: init.host.uid,
        [`${ROOM(gameId, roomId)}/meta/status`]: 'waiting',
        [`${ROOM(gameId, roomId)}/meta/createdAt`]: Date.now(),
      };
      claimed.seats.forEach((s, i) => {
        // Strip the fields RTDB would strip anyway (uid null, name '') so the wire is clean.
        updates[`${ROOM(gameId, roomId)}/seats/${String(i)}`] =
          s.uid !== null ? { kind: s.kind, name: s.name, uid: s.uid } : { kind: s.kind };
      });
      // No `state` (game not started) and no `presence` — trackPresence is the single writer of
      // presence, armed when the hook mounts, so it also gets the onDisconnect cleanup.
      await update(ref(db), updates);
      return { ok: true, value: roomId };
    }
    return { ok: false, error: 'The tables are busy — try again.' };
  },

  subscribe<TPublic>(
    gameId: string,
    roomId: string,
    listener: (snapshot: RoomSnapshot<TPublic> | null) => void
  ): Unsubscribe {
    const roomRef = ref(firebaseDb(), ROOM(gameId, roomId));
    // onValue returns its own unsubscribe — handed straight back, so the caller's teardown is the
    // one-liner repo/types.ts insists every subscribe here be.
    return onValue(roomRef, (snap) => {
      listener(snap.exists() ? readRoom<TPublic>(snap.val() as RoomWire) : null);
    });
  },

  async claimSeat(gameId, roomId, index, who): Promise<RepoResult<void>> {
    const db = firebaseDb();
    const seatsRef = ref(db, `${ROOM(gameId, roomId)}/seats`);
    const seats = readSeats((await get(seatsRef)).val());

    // Decide legality against the seat array with the pure function, so "open before ai" and
    // "never another human's seat" are the tested logic, not re-hand-rolled over the wire.
    const claim = claimSeatPure(seats, index, who);
    if (!claim.ok)
      return { ok: false, error: claim.reason === 'taken' ? 'Seat taken.' : 'No such seat.' };

    // Claim-then-verify (ARCHITECTURE.md): write, re-read, confirm it is mine.
    const seatRef = ref(db, `${ROOM(gameId, roomId)}/seats/${String(index)}`);
    try {
      await set(seatRef, { kind: 'human', name: who.name, uid: who.uid });
    } catch {
      // The seats `.write` rule refuses overwriting another human's seat, so a lost race for an
      // open chair (both clients read it open, both write) REJECTS here for the loser rather than
      // reaching the verify below. Map it to the same "taken" the pure check returns — a values-
      // not-exceptions method must not throw its user-facing failure.
      return { ok: false, error: 'Seat taken.' };
    }
    const confirmed = readSeats([(await get(seatRef)).val()])[0];
    if (confirmed?.uid !== who.uid) return { ok: false, error: 'Seat taken.' };
    return { ok: true, value: undefined };
  },

  async releaseSeat(gameId, roomId, index, fallback): Promise<void> {
    const db = firebaseDb();
    const seatsRef = ref(db, `${ROOM(gameId, roomId)}/seats`);
    const next = releaseSeatPure(readSeats((await get(seatsRef)).val()), index, fallback);
    const seat = next[index];
    if (seat === undefined) return;
    await set(ref(db, `${ROOM(gameId, roomId)}/seats/${String(index)}`), {
      kind: seat.kind,
      name: seat.name,
    });
  },

  async setAi(gameId, roomId, index, name): Promise<void> {
    const seatRef = ref(firebaseDb(), `${ROOM(gameId, roomId)}/seats/${String(index)}`);
    await set(seatRef, name === null ? { kind: 'open' } : { kind: 'ai', name });
  },

  async patchState<TPublic>(
    gameId: string,
    roomId: string,
    produce: (prev: TPublic | null) => TPublic
  ): Promise<void> {
    // Scoped to `state` — see the header. The transaction serialises concurrent patches and the
    // seq it writes is validated monotonic by the rules, so ordering cannot skip or repeat.
    const stateRef = ref(firebaseDb(), `${ROOM(gameId, roomId)}/state`);
    await runTransaction(stateRef, (current: StateWire | null) => ({
      seq: nextSeq(num(current?.seq)),
      data: produce((current?.data ?? null) as TPublic | null),
    }));
  },

  async setStatus(gameId, roomId, status): Promise<void> {
    await set(ref(firebaseDb(), `${ROOM(gameId, roomId)}/meta/status`), status);
  },

  async writePrivate<TPrivate>(
    gameId: string,
    roomId: string,
    index: number,
    data: TPrivate
  ): Promise<void> {
    await set(ref(firebaseDb(), HAND(gameId, roomId, index)), data);
  },

  subscribePrivate<TPrivate>(
    gameId: string,
    roomId: string,
    index: number,
    listener: (data: TPrivate | null) => void
  ): Unsubscribe {
    const privRef = ref(firebaseDb(), HAND(gameId, roomId, index));
    return onValue(privRef, (snap) => {
      listener(snap.exists() ? (snap.val() as TPrivate) : null);
    });
  },

  trackPresence(gameId, roomId, uid): Unsubscribe {
    const presRef = ref(firebaseDb(), `${ROOM(gameId, roomId)}/presence/${uid}`);
    void set(presRef, true);
    // The whole reason presence is trustworthy: the server clears it if this client vanishes,
    // without the client running any code. v1 leaked presence because nothing armed this.
    void onDisconnect(presRef).remove();
    return () => {
      void onDisconnect(presRef).cancel();
      void dbRemove(presRef);
    };
  },

  armDisconnect(gameId, roomId, snapshot, myUid): void {
    // One registration, at the ROOT, so re-arming is a single cancel and the ops it holds land
    // atomically (see CHAT's note in chatRepo — three sequential deletes de-authorise each other).
    // Cancelling first leaves a sliver of a window where a crash does nothing; that is strictly
    // better than an armed plan that has gone stale, which is what a snapshot change makes it.
    const rootRef = ref(firebaseDb());
    void onDisconnect(rootRef).cancel();
    if (snapshot === null) return;
    const updates = disconnectUpdates(gameId, roomId, snapshot, myUid);
    if (Object.keys(updates).length > 0) void onDisconnect(rootRef).update(updates);
  },

  async remove(gameId, roomId): Promise<void> {
    const db = firebaseDb();
    // Clear the room's hands FIRST, while `rooms/<g>/<r>/meta/host` still exists — the hands
    // room-level delete rule reads it to authorise the host. Delete them after the room and the
    // host check has nothing to read, so the rule refuses and the subtree orphans forever.
    const handsRef = ref(db, HANDS(gameId, roomId));
    await dbRemove(handsRef).catch(() => set(handsRef, null).catch(() => undefined));
    const roomRef = ref(db, ROOM(gameId, roomId));
    // The v1 fallback: a plain remove refused mid-teardown falls back to writing null, which is
    // the same delete by another door and survives a rule that only allows `set`.
    await dbRemove(roomRef).catch(() => set(roomRef, null));
  },
};
