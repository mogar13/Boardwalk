# What's left — the ordered list

**Written 2026-07-18, when every plan in this repo finished at once.** Phases 0–6 shipped, backend
Phases A–D shipped and deployed, and the Progression Overhaul closed with P5. There is no plan
document with an open item in it. This file exists so that fact does not read as "nothing left to
do", because four real things were outstanding and three of them had a money or data consequence.

**Items 1 and 2 closed 2026-07-18** — offline banking is built, deployed and enforcing; room
crash-recovery is built and guarded. Two remain, and neither can move a chip: item 3 is a decision
and item 4 is optional forever.

**This is not a checklist and finishing it is not a goal.** Same rule as
[Scope discipline](../CLAUDE.md#scope-discipline--the-rule-most-likely-to-be-violated): work happens
because it is worth doing, not to empty a list. Item 2 is worth doing. Item 3 is a decision, not a
chore. Item 4 is optional forever.

---

## The ordering, and why it is this ordering

Ordered by **what goes wrong if you never do it**, not by effort:

| # | Item | If never done |
|---|---|---|
| 1 | ~~Offline replay-hardening~~ — **DONE, deployed + enforcing 2026-07-18** | ~~A reconnect can pay a win twice.~~ Closed. See [OFFLINE_HARDENING.md](done/OFFLINE_HARDENING.md). |
| 2 | ~~Crash-recovery for rooms~~ — **DONE 2026-07-18** | ~~A crashed host strands a table permanently.~~ Closed. See [CRASH_RECOVERY.md](done/CRASH_RECOVERY.md). |
| 3 | Close Phase C (delete RTDB rooms) — **DECIDED 2026-07-18: not yet** | Nothing breaks. Two systems stay alive instead of one. Decision + the trigger that reopens it are in [item 3](#3-close-phase-c--decided-2026-07-18-not-yet-and-here-is-the-trigger). |
| 4 | A sixth game | Nothing. This is the point. |

Two smaller items ride along with whatever you touch next; they are at the bottom under
[Ride-alongs](#ride-alongs).

---

## 1. Offline replay-hardening — DONE, deployed and enforcing

> **Closed 2026-07-18** by [OFFLINE_HARDENING.md](done/OFFLINE_HARDENING.md), which is the design, the
> answers to the five questions, and the evidence. Read that instead of what follows; the rest of
> this section is kept because its framing of the problem is still the right one, with **one
> correction found on contact with the code**, below.
>
> **The correction:** this section says "a result banked offline and re-sent on reconnect is, from
> the server's side, indistinguishable from the same result sent twice." True in principle, and it
> described a hole that did not exist yet — **there was no offline queue at all.** A failed settle
> reverted its optimistic profile, toasted, and dropped the intent. So the work was not hardening a
> live hole; it was building the banking mechanism the locked decision promised, with its bound in
> the same commit. That is a strictly better position than the one this section assumed.
>
> **The scope call the last paragraph invites — "decide how much offline play is worth supporting"
> — was answered FULL** (server-signed nonces, unbounded offline duration) by the owner. The design
> reconciles that with the batch it necessarily implies: **duration unbounded, volume bounded at 64.**
>
> **Deployed and enforcing in production 2026-07-18**, in three phases (server → client → secret),
> verified from the artifact: a live settle carried a signed ticket, a replay of it moved nothing, and
> a client-minted nonce was refused 409.

### The original framing, kept

**Status:** owed since Phase B, never built. Named in
[BACKEND_PLAN.md](done/BACKEND_PLAN.md) as a locked decision with no implementation.

The decision (2026-07-17) was that **offline wins are ranked, with sync-on-reconnect** — the owner
wants real mobile/offline play through a power or internet outage. That decision is what creates the
problem: a naive reconnect-sync is **replayable**. A result banked offline and re-sent on reconnect
is, from the server's side, indistinguishable from the same result sent twice.

**Why the existing idempotency is not already the answer.** Every mutation is idempotent on a
client-minted nonce, and that genuinely collapses a retry, a double-tap and a re-send into one
effect. But it assumes the nonce is minted **once, by an honest client, at the moment of the event**.
An offline queue breaks both halves of that assumption: results are banked while the client is the
only witness, and the client controls how many nonces it mints for what it claims is one game. The
server cannot currently tell "I won three hands on the train" from "I minted three nonces for one
hand."

**Shape of the fix (not designed yet — this is the sketch BACKEND_PLAN left):**

- A **monotonic per-device sequence** alongside the nonce, so results arrive in a provable order and
  a gap is visible.
- **Signed nonces**, or a server-issued batch of them, so a client cannot mint unbounded work
  offline.
- A **bound on how much offline play is bankable** — the honest option, and probably the cheapest.

**Why this is #1:** it is the only remaining item where being wrong costs chips, and the entire
backend exists to make chips un-forgeable. Blackjack is server-dealt precisely so a client cannot
claim a payout; an unhardened offline queue is a second road to the same place.

**Do not start by writing code.** Start by deciding how much offline play is worth supporting. If
the answer is "one session's worth," the fix is a bound and a counter, not a signing scheme.

---

## 2. Crash-recovery for rooms — DONE

> **Closed 2026-07-18** by [CRASH_RECOVERY.md](done/CRASH_RECOVERY.md), which is the design, the fork the
> owner decided, and the bound. Read that instead of what follows; the rest of this section is kept
> because its instinct — *verify the gateway before designing* — was right, and because the
> **correction it earned on contact with the code** is worth keeping.
>
> **The correction, in two directions.** This section says the server-side half "may be most of the
> way built." It was *built*: the gateway already released a crashed uid's seats (AI mid-game),
> dropped presence and GC'd the room. And the orphaned-nodes half **cannot happen on that path at
> all** — `rooms/`, `hands/` and `chat/` are three fields of one in-memory record there, not three
> nodes. So the note **overstated** the job on the live path.
>
> It also **understated** a different one. The AI branch the whole claim rests on had **zero test
> coverage** while the gateway's docblock asserted it. And the net fired too eagerly: a reconnect
> replays subscriptions and presence but never re-claims a seat, so a three-second blip handed a
> live player's seat to a bot, permanently. That was a real bug nobody had noticed, and it is the
> one a player would actually have felt.
>
> **The fork was put to the owner and answered "fix both paths"** (against a recommendation of
> gateway-only). Both are fixed for the seat — the stalled-table bug. The fallback's residual
> orphan case is named in the design doc rather than papered over.

### The original framing, kept

**Status:** known and deliberately unfixed. There is no plan document for it.

An abrupt tab-close (crash, force-quit, dead battery) reaps **presence** and nothing else. The rest
of teardown — handing a vacated seat back to an AI so the table survives, and cleaning up the
`rooms/`, `hands/` and `chat/` nodes — is **client-side** and simply does not run.

The result is a table that stalls forever waiting on a player who is gone, and orphaned nodes nobody
deletes.

**Phase C changed the economics of this fix and the note predates it.** When teardown was written,
the only authority was the client. There is now a WebSocket gateway that already:

- knows when a socket dies (it drives the `disconnect → seat-release → AI` safety net that
  `gateway.test.ts` covers), and
- is the arbiter of seats, so it can release one without racing anybody.

So the server-side half may be **most of the way built already**. Verify what the gateway does on
disconnect today before designing anything — the honest version of this item might be "wire the
existing disconnect handler to the cleanup that currently lives in the client," which is much
smaller than the original note implies.

**Caveat:** whatever is built must also work on the `VITE_WS_ROOMS=0` fallback, or it must be stated
plainly that the fallback is degraded. That is a reason to consider item 3 first.

---

## 3. Close Phase C — DECIDED 2026-07-18: not yet, and here is the trigger

**Status:** Phase C shipped and is deployed; its own **"Done when: RTDB is no longer read or written
at all" is NOT met**, and [BACKEND_PLAN.md](done/BACKEND_PLAN.md#phase-c--realtime-rooms-over-websocket)
names the four reasons.

To close it you would delete the Firebase room/chat repos, delete the `rooms/`/`hands/`/`chat/`
rules, and remove the `VITE_WS_ROOMS=0` fallback.

**The decision was taken on 2026-07-18 and the answer is no, not yet.** What follows is the original
framing with **two corrections found on contact with the code** — both of which change the trade —
and a concrete revisit trigger replacing the one that could never be met.

### Correction 1: the fallback is NOT automatic, so "degrades vs. takes down" is wrong

This section used to say a Pi outage today **degrades** rooms to RTDB. It does not.
[src/system/repo/index.ts](../src/system/repo/index.ts) gates on `import.meta.env.VITE_WS_ROOMS` — a
**build-time** constant, injected from a GitHub secret in `deploy.yml`. `api/socket.ts` has no
runtime fallback path at all. A Pi outage takes rooms **down**, and the fallback is a *recovery
procedure* (set the secret, re-run the deploy workflow), not a degradation.

So the real trade is much narrower than it read:

| | Pi outage today | Pi outage after closing |
|---|---|---|
| Rooms | Down; recoverable in ~a deploy cycle by flipping a secret | Down until the Pi is back |

Both branches are an outage. One has a manual escape hatch costing a rebuild. **That is a smaller
availability win than "degrades" implied, and it was the load-bearing argument in this item.**

### Correction 2: closing this buys less simplicity than "one room system instead of two"

`database.rules.json` is 374 lines; the `rooms`/`hands`/`chat` blocks are ~152 of them. Deleting
those leaves the rules file, `src/system/repo/firebase/`, and the hand-deploy gap all standing,
because of blocker 2 below. You retire ~460 lines of repo and ~40% of a rules file. You do **not**
retire RTDB, the second database, or the deploy-by-hand risk.

**The right unit of decision is "do we retire RTDB entirely" — rooms *and* the `VITE_API_ECONOMY=0`
profile/leaderboard fallback, together — not "do we delete the room rules."** Closing Phase C alone
pays the full availability cost for a partial simplicity win.

### The two blockers, unchanged

1. **UNO's hidden hands are still enforced by those rules** on the fallback path (host-as-dealer
   client + owner-only `hands/` reads). Confirmed fallback-path-only: the gateway enforces
   owner-only delivery itself (`gateway.ts`, "Deliver a private hand to its owner only", plus
   re-evaluation of every private subscription when seats change), so the *live* path does not lean
   on the rules. They are the enforcement on the fallback alone.
2. **RTDB is still read and written outside rooms entirely** — the Firebase profile and leaderboard
   repos remain composed on the `VITE_API_ECONOMY=0` path. Deleting the room rules does not retire
   the database; it only stops rooms using it.

### Why crash-recovery (item 2) did not tip it

Item 2 landing on both paths is a real argument *for* closing: it cost a second executor of one rule,
and the fallback's residual orphan case (host crashes, guests then leave cleanly) is closable only by
a rules change or a reaper. Both true.

But that cost is **sunk and one day old**, and it *closed* the axis on which the fallback was
degraded — so the fallback's ongoing carrying cost is **lower** now than when this item was written,
not higher. And the residual orphan case is a fallback-only defect that can only bite during a Pi
outage, which is the moment an orphaned room ranks last among your problems. Deleting working code
one day after paying for it, to avoid a defect that only manifests when the thing replacing it is
already down, is the wrong order.

### The old recommendation was unfalsifiable — replaced

This item used to say "leave it open until the Pi has a longer track record." **That condition could
never be met.** Phase C shipped 2026-07-17, one day before this decision, and prod carries 1 profile
/ 2 auth accounts, both the owner's. With no traffic, waiting generates no evidence — a year of
waiting would teach exactly what today knows. A wait condition nothing can satisfy is not caution;
it is a fallback becoming permanent by default instead of by choice.

**Revisit when EITHER:**

- **(a)** you take the RTDB-retirement question as one decision — including whether the
  `VITE_API_ECONOMY=0` economy kill switch survives — at which point rooms come along for free. This
  is the one actually reachable today, and it is the recommended path; **or**
- **(b)** you have observed one real Pi outage and know first-hand what it costs, plus a handful of
  real online sessions driven on the WS path with no fallback needed.

Until one of those, the Firebase room/chat repos and their rules stay, and they stay **maintained** —
a fallback nobody keeps working is worse than no fallback, because it reads like an option.

---

## 4. A sixth game — only if one sounds fun

There is **no game checklist and there will never be one.** The launch five were chosen for OS
coverage, and that coverage is complete: solo, hot-seat, online, betting, hidden hands, room-less,
AI-as-occupant, server-dealt.

A sixth game should be built because someone wants to play it. If it is being built to make a number
go up, read
[Scope discipline](../CLAUDE.md#scope-discipline--the-rule-most-likely-to-be-violated) and stop —
the completionist version of this project already exists at the old URL.

**Two things a new game would exercise that nothing currently does**, if you want the OS argument
rather than the fun argument:

- **A `dice` cosmetic has art staged and no reader.** It is the one cosmetic kind deliberately left
  unbuilt, waiting for a dice game. Building one would close that.
- **Non-blackjack outcomes are still self-reported.** Chess, UNO, Solitaire and Tic-Tac-Toe don't
  bet, so payout is forced to `0` and no chip is at stake — but a dishonest client can still inflate
  its level and win count. A *betting* game other than blackjack would force that question, and the
  answer is a much bigger job than projecting one hand: the server holding the match.

---

## Ride-alongs

Small, and each belongs in the next commit that touches its area rather than a project of its own.

### Deploy `database.rules.json` from CI

The standing gap, and the one most likely to bite silently. `npm run rules:deploy` is manual;
**nothing in CI does it**, so the file in this repo can stop matching production while reading like
the truth. The tests prove the file is *right*; they cannot prove it is *deployed*.

P5 was the third rules change shipped by hand. That is the argument being won three times. A CI step
with a service account is the fix.

### Drive the lazy-chunk recovery path in a browser

The stale-build fix has two halves. The entry-chunk half was verified in a real browser (it
self-heals with one reload and then settles). The `vite:preloadError` half — app running, player
opens a game whose chunk a deploy deleted — is **unit-tested against a fake host but never watched
work**. Reaching it for real needs a signed-in emulator session and a deliberately 404'd game chunk.

Worth doing the next time someone is already running the emulator browser pass.

---

## What is NOT on this list, and why

- **Porting more Game Shack games.** See item 4 and Scope discipline. The archive stays live; it is
  not a backlog.
- **A generic board-game engine.** Five games is still not enough evidence about what games share.
  The only things extracted so far had a caller the moment they were written.
- **Anything in [V1_FEATURE_GAPS.md](V1_FEATURE_GAPS.md).** That document is a *menu*, not a
  checklist — its purpose is making dropped things deliberate. Rows 5 and 11 closed as a side effect
  of the Progression Overhaul; the rest are open on purpose.
