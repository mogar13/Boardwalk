# The Boardwalk — Backend Plan (Node + SQLite)

**Status:** 🚧 Phase A shadow mode is WIRED. The launch five have shipped, so the gate is passed.
`boardwalk-api/` exists — Express + `better-sqlite3` + Firebase-Admin token verification, the schema
below (with the append-only `ledger`), profile + leaderboard endpoints, 15 passing tests — and is
**deployed live** on the Pi at `https://boardwalk-pi.tail1bed2f.ts.net` (Tailscale Funnel). The
frontend's server-backed repos at `src/system/repo/api/` are now **wired into the composition root in
shadow mode**: when `VITE_API_BASE_URL` is set, `src/system/repo/index.ts` keeps Firebase as the
source of truth and mirrors every profile write to the API via `src/system/repo/shadow/`
(`shadowProfileRepo` + the pure `diffProfiles`), logging any read-back disagreement — the primary
write is never blocked or failed by the mirror. It is gated off under the emulator (whose
`demo-boardwalk` tokens the Pi's `boardwalk-fca02` verifier rejects). **Still owed to close Phase A:**
end-to-end verification on the deployed site (a real token against the live Pi — CORS `ALLOWED_ORIGIN`
is `https://mogar13.github.io`, so this runs in prod, not localhost), and an empty shadow diff for a
week of real play before cut-over. Deploy host is a Raspberry Pi on the LAN; the DB stick is mounted
at `/mnt/boardwalk-db`. **Last updated:** 2026-07-17

**Phase-B decisions (locked 2026-07-17):** guests stay **local-only** (localStorage remains a real
offline mode; only accounts sync to SQLite). Offline wins are **ranked with sync-on-reconnect** —
the user wants real mobile/offline play (power or internet outage) — which means Phase B owes a
**replay-hardening story** for offline-banked results (server-side idempotency / signed nonces /
monotonic per-device sequence, TBD) since a naïve reconnect-sync is replayable.

Adapted from The Game Shack's `BACKEND_PLAN.md`, which was written for a migration that no longer
exists. The security analysis carried over unchanged, because **Boardwalk inherits the same gap**:
Firebase rules protect *identity*, and nothing protects *the truth of the numbers*.

> **Firebase Authentication stays.** Passwords are never stored or readable by us, and the rules lock
> `users/<uid>` to its owner. That is good, working code. **Do not rip it out to hand-roll JWTs.** The
> server verifies the Firebase ID token with the Admin SDK and trusts the `uid`. You get a referee
> without rebuilding identity.

---

## Why this is worth doing, and why not now

Rules can say *who* may write. Only a server can say *what is true.* Four holes, one cause:

- **A player can set their own bankroll.** `users/<uid>` is writable by its owner — correct for a
  rules-only system, and useless as anti-cheat. Devtools → 10,000,000 chips.
- **The leaderboard is self-reported.** It's publicly readable and written by the player it describes.
  The rules validate that `bankroll` is *a number*, not that it's *the truth*.
- **Hidden information isn't hidden.** Room nodes are world-readable. Boardwalk's
  `private/<seatIdx>` layout narrows this — a bystander isn't *sent* opponents' cards — but a
  determined player can still read the node directly. **The data layout is privacy, not security.**
- **Two clients can race for the same seat.** Claim-then-verify detects it; nothing arbitrates it.

**A server fixes all four and improves nothing about the frontend** — which is exactly why it's a
separate project. Costs, stated honestly:

| Cost | Detail |
|---|---|
| 💵 Hosting | Free tier → a paid app host with a persistent disk. Small, but no longer $0. |
| 🔌 Realtime | RTDB gives sync for free. You'd replace it with WebSockets and own reconnects, presence, and backpressure. **This is the bulk of the work.** |
| 🧰 Ops | A database you can lose. Streaming backups, migrations, and a restore drill you actually run. |

The frontend stays on GitHub Pages — static SPA, cross-origin calls with a token.

### Casino OS v2 pays for this in advance

Two rules in `ARCHITECTURE.md` exist for this phase. Don't squander them:

1. **The repository boundary** — `firebase/*` may only be imported inside `src/system/repo/firebase/`,
   lint-enforced. Swapping the data layer means writing `src/system/repo/api/` and changing one wiring
   line. **No game is touched.**
2. **Pure `logic/` folders** — no DOM, no React, no `@/system`. So the server can import and run **the
   exact same rules the client runs**. The referee and the player agree by construction, because
   they're executing the same code. This only works if the purity rule was actually enforced.

---

## Architecture

```
                    Firebase Auth  ← identity stays here. Not rebuilt.
                          │ ID token
GitHub Pages (static)     ▼          App host (paid)
┌──────────────────────┐            ┌──────────────────────────────────┐
│  React SPA           │  HTTPS +   │  boardwalk-api (Node/Express)    │
│  src/system/repo/api │ ─ token ─► │    verifies token (Admin SDK)    │
│                      │            │    SQLite (better-sqlite3)       │
│  useRoom / useChat   │ ◄── WSS ──►│  rooms (WebSocket, authoritative)│
└──────────────────────┘            └──────────────────────────────────┘
              │
              └──► packages/game-logic  ← the SAME pure TS rules run on both sides
```

**One service, not six.** One app, one data model. Splitting it buys nothing but latency and ops.

### Schema sketch

```sql
-- No password_hash column: Firebase Auth owns credentials. `uid` is the Firebase uid.
users(uid PK, username UNIQUE, created_at, is_admin)
profiles(uid PK, xp, level, loadout_json, updated_at)   -- note: no bankroll column
stats(user_id, game_id, wins, losses, wagered, PRIMARY KEY(user_id, game_id))
achievements(user_id, achievement_id, unlocked_at)
purchases(user_id, item_id, purchased_at)
ledger(id, user_id, game_id, delta, reason, created_at)   -- every chip movement, append-only
matches(id, game_id, status, created_at, ended_at)
match_seats(match_id, seat_no, user_id)
```

**`ledger` is the one table worth insisting on.** The bankroll becomes a *derived value* — a sum —
not a stored number anyone overwrites. That buys audit, anti-cheat forensics, and "why did I lose 500
chips" answers for free. It's also why `profiles` has no `bankroll` column: if the number is stored,
something will eventually write it.

This is the natural end state of `reportResult()`. That call already is a ledger entry — it just
currently writes a balance instead of appending a row.

---

## Phases

Same discipline: one phase per conversation, never break `main`.

### Phase A — The API + read-only shadow
Stand it up and prove it agrees with Firebase, without trusting it yet.

- `boardwalk-api/`: Express + `better-sqlite3`, the schema above. **Auth = verify the Firebase ID
  token** with the Admin SDK. Do not build a login system.
- Implement `src/system/repo/api/` against the existing interfaces.
- **Shadow mode:** the client keeps writing Firebase as the source of truth *and* mirrors every write
  to the API. A script diffs the two nightly.
- Ships nothing user-visible. The deliverable is "the API produces identical results."

**Done when:** the shadow diff is empty for a week of real play.

### Phase B — Cut over profile, economy, stats
SQLite becomes the source of truth for everything that isn't realtime.

- Flip the repo wiring: `api` becomes primary, Firebase becomes the mirror.
- Bankroll mutations move server-side: `POST /bet`, `POST /settle`. The server validates against the
  ledger and returns the new balance. **The client can no longer set its own bankroll.**
- Real leaderboards, from data the server owns.
- Streaming off-box backups **and a restore drill you have actually run** — a backup you haven't
  restored is a rumor.

**Done when:** editing devtools changes nothing durable, and the leaderboard is server-computed.

### Phase C — Realtime rooms over WebSocket
Retire the RTDB *database* (Auth stays). Biggest phase — budget accordingly.

- The WS server owns rooms: create, join, **server-arbitrated seat assignment** (the claim-then-verify
  race dies here), presence, disconnect cleanup.
- Rewrite `RoomRepo` / `ChatRepo` against it. **`useRoom` / `useChat` signatures do not change** —
  that's the entire point of the boundary.

**Done when:** RTDB is no longer read or written at all.

**🚧 WIRED (branch `phase-c`), off by default.** The referee half is live and wired: the WS gateway
(`boardwalk-api/src/rooms/`) is attached to the Express HTTP server in `server.ts` at `/rooms`, sharing
the port, the Tailscale Funnel, and one Firebase-verifier — an upgrade authenticates the exact same ID
token a REST call does. The Chrome PNA header is echoed onto the WS **handshake** too (a WebSocket
can't preflight, so Chrome folds the check into the upgrade), the twin of the HTTP middleware, for
tailnet devices. `tests/gateway.test.ts` (7) drives it over a real socket: handshake gate, forged-author
refusal on create/claim/chat, owner-only private hands, host-only guards, and the disconnect safety net.

The client half is built behind the seam: `src/system/repo/api/socket.ts` is the ONE multiplexed
`wss://…/rooms` connection — request/reply correlation, push fan-out, immediate-cache replay to a late
subscriber, **reconnect with backoff + subscription replay**, and **backpressure** (a bounded, drop-oldest
outbox that respects `bufferedAmount`); `api/roomRepo.ts` + `api/chatRepo.ts` implement the unchanged
`RoomRepo`/`ChatRepo` over it (`tests/socket.test.ts`, 8, drives the state machine against a fake socket).
The composition root swaps them in behind `VITE_WS_ROOMS=1` (needs `VITE_API_BASE_URL`, inert under the
emulator) — **off by default**: the realtime path is opt-in until the gateway has soaked against a real
two-account table (the browser-verification recipe). **Remaining:** that browser soak, then make the flag
the default and delete the Firebase room/chat repos so RTDB is no longer read or written at all. The
Phase-B replay-hardening story for offline-banked results is still owed before offline wins are trusted.

### Phase D — Server-authoritative game state
Only worth doing for games where it matters.

- Move `logic/` into a shared `packages/game-logic` workspace imported by both sides.
- The server validates every move against the same rules the client used, and **owns hidden state**:
  hole cards and hands are sent only to the seat that owns them. Client stays optimistic for feel;
  server confirms or rejects.

**Done when:** a player with devtools open cannot see an opponent's hand — because the server never
sent it.

---

## Open questions (answer before Phase A)

- **Hosting:** pick whatever you already know and already pay for. Consistency beats novelty.
- **Do guests survive?** Today anonymous players never touch Firebase. Either guests stay purely
  local (**recommended** — keeps `localStorage` as a real offline mode) or everyone needs an account.
- **Offline play.** A server-authoritative economy is fundamentally online. Do offline wins bank chips
  on reconnect (needs a sync/conflict story), or are offline games unranked? **Recommend unranked** —
  it's honest and sidesteps a whole class of cheating.
