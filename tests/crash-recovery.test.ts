/**
 * CRASH RECOVERY on the RTDB fallback (plans/done/CRASH_RECOVERY.md, ROADMAP item 2).
 *
 * The WebSocket path's half of this is `boardwalk-api/tests/gateway.test.ts`, driven over a real
 * socket that gets terminated. This file covers the fallback's half: the multi-path write a client
 * ARMS as an `onDisconnect`, so that a killed tab still frees its seat and still cleans up after
 * itself even though no client code runs.
 *
 * WHAT IS WORTH TESTING HERE, and what is not. `onDisconnect().update()` firing is Firebase's job
 * and not ours to prove. What is ours — and what would be silently wrong — is WHICH paths that
 * update carries: a seat armed to `open` mid-game stalls the table the arming exists to save, and
 * a guest who arms the room delete wipes the game out from under everyone still playing. So the
 * decision is a pure function and this is its unit test; the rules half (that these exact writes
 * are permitted for the host and REFUSED for a guest) is asserted against the real rules file and
 * a real emulator in `database-rules.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { disconnectUpdates } from '@/system/repo/firebase/roomRepo';
import type { RoomSnapshot, Seat } from '@/system/room/types';

const HOST = 'uid-host';
const GUEST = 'uid-guest';

const human = (uid: string, name: string): Seat => ({ kind: 'human', name, uid });
const open = (): Seat => ({ kind: 'open', name: '', uid: null });

function room(args: {
  seats: Seat[];
  status?: RoomSnapshot<unknown>['meta']['status'];
  presence?: Record<string, true>;
}): RoomSnapshot<unknown> {
  return {
    meta: { host: HOST, status: args.status ?? 'waiting', createdAt: 1, seq: 1 },
    seats: args.seats,
    state: null,
    presence: args.presence ?? { [HOST]: true, [GUEST]: true },
  };
}

describe('disconnectUpdates — what a crashed tab writes on its way out', () => {
  it('arms a guest seat to AI mid-game so the table survives the crash', () => {
    const snap = room({ seats: [human(HOST, 'Host'), human(GUEST, 'Guest')], status: 'playing' });
    expect(disconnectUpdates('chess', 'ABCD', snap, GUEST)).toEqual({
      'rooms/chess/ABCD/presence/uid-guest': null,
      'rooms/chess/ABCD/seats/1': { kind: 'ai', name: 'Guest' },
    });
  });

  it('arms a guest seat to OPEN in the lobby — a bot has no business in a game not started', () => {
    const snap = room({ seats: [human(HOST, 'Host'), human(GUEST, 'Guest')], status: 'waiting' });
    expect(disconnectUpdates('chess', 'ABCD', snap, GUEST)).toEqual({
      'rooms/chess/ABCD/presence/uid-guest': null,
      'rooms/chess/ABCD/seats/1': { kind: 'open', name: '' },
    });
  });

  it('a GUEST never arms the room, hands or chat delete', () => {
    // The rule v1 paid for: a guest closing their tab must not wipe the host's game. The crash
    // path has to honour it too, and it is the same `teardownPlan` decision either way.
    const snap = room({ seats: [human(HOST, 'Host'), human(GUEST, 'Guest')], status: 'playing' });
    const keys = Object.keys(disconnectUpdates('chess', 'ABCD', snap, GUEST));
    expect(keys).not.toContain('rooms/chess/ABCD');
    expect(keys).not.toContain('hands/chess/ABCD');
    expect(keys).not.toContain('chat/chess/ABCD');
  });

  it('a host alone takes the room, its hands and its chat — in ONE write', () => {
    const snap = room({
      seats: [human(HOST, 'Host'), open()],
      status: 'waiting',
      presence: { [HOST]: true },
    });
    const updates = disconnectUpdates('chess', 'ABCD', snap, HOST);
    // NO `presence` leaf, and no seat: RTDB REFUSES an update carrying both a path and an ancestor
    // of it, and it refuses the WHOLE write — so naming `rooms/chess/ABCD` alongside
    // `rooms/chess/ABCD/presence/<uid>` armed nothing at all, and a lone host's crash orphaned the
    // very room this step exists to remove. Deleting the room removes everything under it anyway.
    expect(updates).toEqual({
      'chat/chess/ABCD': null,
      'hands/chess/ABCD': null,
      'rooms/chess/ABCD': null,
    });
    for (const key of Object.keys(updates))
      expect(key.startsWith('rooms/chess/ABCD/')).toBe(false);
    // NOT the seat. Releasing a seat under a room being deleted is the resurrection hazard
    // `teardownPlan` documents — the seat write can land after the delete and re-create a
    // `seats/<i>` leaf under a room with no `meta`, which nothing is then permitted to remove.
    expect(Object.keys(updates)).not.toContain('rooms/chess/ABCD/seats/0');
  });

  it('a host with others still present frees only its own seat and clears chat', () => {
    const snap = room({ seats: [human(HOST, 'Host'), human(GUEST, 'Guest')], status: 'playing' });
    expect(disconnectUpdates('chess', 'ABCD', snap, HOST)).toEqual({
      'rooms/chess/ABCD/presence/uid-host': null,
      'rooms/chess/ABCD/seats/0': { kind: 'ai', name: 'Host' },
      'chat/chess/ABCD': null,
    });
  });

  it('arms ONLY its presence for a spectator holding no seat', () => {
    const snap = room({
      seats: [human(HOST, 'Host'), open()],
      presence: { [HOST]: true, 'uid-watcher': true },
    });
    // Presence is armed for everyone — see the note in `disconnectUpdates`: this plan re-arms at
    // the root, which cancels `trackPresence`'s own arming, so it has to carry presence itself.
    expect(disconnectUpdates('chess', 'ABCD', snap, 'uid-watcher')).toEqual({
      'rooms/chess/ABCD/presence/uid-watcher': null,
    });
  });

  it('never writes a uid — an armed seat is always vacated, never occupied', () => {
    // The seat `uid` validator pins a written uid to `auth.uid`. An armed write carrying one would
    // be refused by the rules and the seat would stall exactly as it did before this existed.
    for (const status of ['waiting', 'playing'] as const) {
      const snap = room({ seats: [human(HOST, 'Host'), human(GUEST, 'Guest')], status });
      for (const value of Object.values(disconnectUpdates('chess', 'ABCD', snap, GUEST)))
        expect(value === null || !('uid' in (value as object))).toBe(true);
    }
  });
});
