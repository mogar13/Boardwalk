# Crash-recovery for rooms — ROADMAP item 2

**Written 2026-07-18.** The design, what contact with the code changed about the problem statement,
the owner's fork decision, and the bound stated honestly.

---

## What the ROADMAP note said, and what was actually true

The note ([ROADMAP.md item 2](../ROADMAP.md#2-crash-recovery-for-rooms--the-known-unfixed-data-gap)) says an
abrupt tab-close reaps presence and nothing else, leaving both **a stalled table** and **orphaned
`rooms/`/`hands/`/`chat/` nodes**. It was written before Phase C, and it invited exactly the check it
needed: *"verify what the gateway does on disconnect today before designing anything."*

Verified. **On the WebSocket path — the default, live path — the server-side half was not "most of
the way built". It was built.** [`gateway.ts`](../../boardwalk-api/src/rooms/gateway.ts) `onClose`
already released the uid's seats (`'ai'` mid-game, `'open'` in the lobby), dropped presence, GC'd the
room once empty, and re-broadcast to everyone left.

And the orphaned-nodes half **cannot happen on that path at all**. `rooms/`, `hands/` and `chat/` are
not three nodes there; they are three fields of one `RoomRecord` in one `Map`
([`store.ts`](../../boardwalk-api/src/rooms/store.ts)). `store.remove()` takes the chat and the hidden
hands with it. That half of the note describes an RTDB layout the live path does not have.

So the note **overstated the job on the default path**. It also, less comfortably, understated a
different one.

### The three things that were actually wrong

1. **The AI safety net was prose, not a guard.** The gateway's own docblock claims it closes the
   crash-recovery gap. `gateway.test.ts` had one disconnect case, and it asserted only that a room
   with a *single* player is GC'd. The branch the claim rests on — `playing` → the seat becomes an
   AI → the table survives for everyone else — had **zero coverage**. This is the failure mode
   CLAUDE.md's Enforcement section exists to catch, landing on the room gateway.

2. **A reconnect turned a live player into a bot, permanently.** This is a live bug on the default
   path, and it is the crash net firing *too eagerly*. `socket.ts` replays subscriptions and
   presence on reconnect but **never re-claims the seat**. A three-second blip mid-game: the old
   socket closes → the server hands your seat to a bot → you reconnect, resubscribe, and watch the
   house play your hand. There was no grace period anywhere.

3. **A seat held without presence leaked.** `onClose` iterated `conn.presence` only. Presence and
   subscription happen to be coincident today because `RoomProvider` does both in one effect — but
   nothing enforced it, and a seat claimed by a socket that never declared presence survived the
   close forever.

**Finding 2 has the only cost a player feels today.** The crash case already worked.

---

## The fork, and the owner's call

The `VITE_WS_ROOMS=0` RTDB fallback genuinely could not recover: `trackPresence` armed
`onDisconnect` on the **presence leaf only**, so on a crash the seat stayed `human` forever. By
definition no client code runs to fix it.

Three options were put to the owner. The recommendation was *gateway-only, fallback stated as
degraded*. **The owner chose to fix both paths.** This document implements that, and states what
"both" bought and what remains out of reach — because part of the reason the recommendation went the
other way is that the RTDB half cannot be made whole without either a rules change or a reaper.

The grace-period question was also put, and answered as recommended: **a short grace before AI
substitution**, which fixes the crash case and the blip case with one mechanism.

---

## The design

### One rule, two executors — not two implementations

The constraint this codebase leans on hardest is that a rule lives once. Teardown already had its
rule expressed once, purely, and tested: **`teardownPlan(snapshot, myUid)`**
([`lifecycle.ts`](../../src/system/room/lifecycle.ts)) decides what leaving should clear — my presence,
my seat, and (host only, last one out) the chat and the room.

The insight this design turns on: **that plan is not only what to RUN on a clean exit. It is what to
ARM for a crash.**

- On the **RTDB path**, the client arms the plan as an `onDisconnect` and re-arms it whenever the
  snapshot changes. Firebase's servers execute it when the socket dies. Same tested function, same
  decisions.
- On the **WS path**, the gateway reaches the same decisions server-side from the same inputs
  (status, seats, presence), which is what it already did.

So there is one rule with two executors, not one rule written twice.

### The WS path: a grace period

The store stays synchronous and pure of transport; the timers live in the gateway, matching the
existing split (the store holds state, the gateway owns authorization and lifecycle).

On socket close, for every room the connection touched:

1. If **another live connection carries the same uid** in that room (a second tab), do nothing —
   presence is not dropped and no seat is released. This also fixes a pre-existing multi-tab bug
   where closing one tab dropped presence that another tab still held.
2. Drop presence. If the room is now empty of everyone, **GC immediately** — there is nobody to wait
   for, and holding a dead room open for 20 seconds serves no one.
3. Otherwise, if the uid holds seats, **schedule** a release keyed by `(roomKey, uid)`.

When the timer fires, the fallback (`'ai'` vs `'open'`) is computed **at fire time** from the
then-current status, not at schedule time — a lobby that starts during the grace window must hand the
seat to a bot, not open it.

**Declaring presence cancels a pending timer for that uid.** That is the resume path: reconnect
replays presence (`socket.ts` already does this), the timer is cancelled, and the player keeps their
own seat with the bot never having existed.

Seats are found via `store.roomsHolding(uid)` rather than the connection's presence set, which is
finding 3's fix and cannot drift the way a per-connection mirror would.

### The RTDB path: arm the plan

`RoomRepo` gains one method, `armDisconnect(gameId, roomId, steps)`:

- **Firebase** arms each step as an `onDisconnect` op — the seat to `ai`/`open`, the chat cleared,
  the room removed — cancelling and re-arming on every snapshot change so the armed plan tracks the
  live one.
- **The API repo is a documented no-op.** The gateway owns this server-side; arming anything from
  the client would be the second implementation this design exists to avoid.

The existing rules already permit every armed op — the seat `.write` at
[`database.rules.json`](../../database.rules.json) allows writing a seat you already own, and room
removal is host-gated, which is precisely who arms it. **No rules change, and therefore no manual
`rules:deploy`.**

There is no grace period on this path. Firebase's `onDisconnect` fires at the server the moment the
socket drops and cannot be conditionally delayed. A blip on the fallback costs you your seat.

---

## The bound, stated honestly

**Say the degradation plainly, the way the offline work stated "duration unbounded, volume bounded
at 64."**

| | WS path (default) | RTDB fallback (`VITE_WS_ROOMS=0`) |
|---|---|---|
| Crashed player's seat → AI mid-game | ✅ after a grace period | ✅ immediately |
| Crashed player's seat → open in lobby | ✅ after a grace period | ✅ immediately |
| Blip/reconnect keeps your own seat | ✅ the grace period is exactly this | ❌ **you lose the seat** |
| Room/chat/hands GC when everyone is gone | ✅ structurally — one record | ⚠️ **partial** — see below |

**The residual RTDB gap, named:** the room node is removed by the *host's* armed `onDisconnect`, and
only when the host is the last one connected — the same condition `teardownPlan` already applies, for
the same reason (a host who blips must not delete a game other people are still playing). So this
case orphans:

> The host crashes mid-game, the remaining guests finish and leave cleanly.

Nobody left is permitted to remove the room — the delete rule requires `meta.host === auth.uid`. The
node survives with its meta, seats, state and chat. It is small, it burns one 4-character join code
out of ~1M, and nothing reads it. **Closing it requires either a rules change (a new "no presence"
delete condition, plus its manual deploy) or a reaper process** — and for one real player, a reaper is
disproportionate. This is written down rather than fixed, which is the honest position, and it is one
more argument for [ROADMAP item 3](../ROADMAP.md#3-close-phase-c--decided-2026-07-18-not-yet-and-here-is-the-trigger).

---

## The drive, and the two bugs only the drive found

Both paths were driven against the emulator with a **real `SIGKILL`** of a second browser process —
not `page.close()`, which fires `pagehide` and would have proved nothing. Every assertion is made
against the authority, not the UI: the RTDB drive reads the room back over the emulator's REST API,
the WS drive subscribes to the room over the real wire protocol as a third party.

**RTDB fallback** — guest crashes mid-game: `seats[1]` becomes `{"kind":"ai"}`, presence reaps to the
host alone, room and board survive, **zero console errors**. Lone host crashes: the room node reads
back `null` — removed, with its hands and chat.

**WS gateway** — guest crashes mid-game, observed over the protocol:

```
before crash : [human wsh31qj9, human "Player 2" uid=Mopc…]   status=playing
+6s  (inside grace) : [human wsh31qj9, human "Player 2" uid=Mopc…]   ← seat still theirs
+28s (past grace)   : [human wsh31qj9, ai   "Player 2" uid=null ]   ← the house takes over
room still alive = true
```

**Two real bugs were caught by the drive and by nothing else** — both in code that typechecked,
linted, and passed every test in this repo:

1. **The presence regression.** `onDisconnect().cancel()` cancels queued ops at a location **and all
   its children**. Re-arming the plan cancels at the ROOT (the only common ancestor of `rooms/`,
   `hands/` and `chat/`), so every re-arm silently disarmed the presence handler `trackPresence` had
   armed at mount — breaking *the one part of crash cleanup that already worked*, with the code
   written to extend it. My own comment had named the hazard and then walked into it. Fixed by
   folding presence into the single atomic write.
2. **The ancestor-path rejection.** RTDB refuses a multi-path update carrying both a path and an
   ancestor of it, and refuses the **whole write**. So the host-alone plan — `rooms/<g>/<r>` plus
   `rooms/<g>/<r>/presence/<uid>` — armed **nothing at all**, orphaning exactly the room the step
   exists to remove. It surfaced only as a thrown `OnDisconnect.update failed` in the browser
   console. Fixed by dropping descendants of a room delete; guarded now in `crash-recovery.test.ts`.

This is the Phase 1 `<dialog>` lesson repeating: static green is not evidence.

### One pre-existing thing found next door, not fixed here

In **dev only**, a lone host creating a table on the WS path immediately sees *"This table has
closed."* React 19 StrictMode double-invokes effects, so `RoomProvider`'s cleanup runs once between
the two mounts — and for a host with nobody else present, `teardownPlan` says *remove the room*, so
it does. Confirmed pre-existing by reproducing it against the **unmodified** gateway; production has
no double-invoke, and the drive above was run with StrictMode temporarily off. It is a dev-experience
bug in teardown's neighbourhood, not crash recovery, so it is recorded rather than folded into this
change.

## What is deliberately NOT built

- **No "reconnecting…" indicator.** It would need a new field on the snapshot, a protocol change, and
  a frontend the fallback path could not populate — an asymmetry between the two paths for a cosmetic.
  During the grace window the table simply waits on that player's move, which is what it does when
  someone is thinking.
- **No reaper.** One real player. See the reality check in the task framing.
- **No new flag.** This changes no cutover behaviour and adds no env var, so the three-phase
  server → client → flag deploy the offline work needed does not apply. The Pi still goes first,
  because it always does.
