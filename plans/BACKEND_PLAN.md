# The Boardwalk — Backend Plan (Node + SQLite)

**Status:** ✅ **Phase B's SERVER is deployed and live** (2026-07-18, from `cb42e44`) — backups,
restore drill and the nightly timer landed first, then the migration and cutover. Owed steps 1–3 of
the five are done; **step 4 (prod round-trip verify) needs the frontend merged**, and the one-shot
**backfill has NOT been run** (`mutations` has 0 `migration:v1` markers; SQLite holds one profile). Phase A shadow mode was WIRED. The launch five have shipped, so the gate is passed.
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
week of real play before cut-over. **Neither was ever completed — Phase B went ahead without them**,
which is a real risk accepted knowingly: the shadow diff would have caught the missing `equipped`
field months earlier than the code read did. Deploy host is a Raspberry Pi on the LAN; the DB stick
is mounted at `/mnt/boardwalk-db`. **Last updated:** 2026-07-18

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

**✅ CODE COMPLETE, NOT YET DEPLOYED (2026-07-18).** The composition root now wires `api.profile`,
`api.economy` and `api.leaderboard` as primary wherever `VITE_API_BASE_URL` is set;
**`VITE_API_ECONOMY=0`** is the kill switch back to the Phase-A arrangement (Firebase
authoritative, API a shadow mirror) with a rebuild and no code change — the twin of Phase C's
`VITE_WS_ROOMS=0`, which is why `shadowProfileRepo` stays in the tree.

**Money moves as an INTENT, never as a number.** `EconomyRepo.apply(uid, intent, clientNext)` is
the one path; the four intents are `bet`, `settle`, `purchase`, `daily`, and none of them has a
field for a balance, a price, an XP amount, a stat count or a clock — a client cannot ask for money
because the request has nowhere to put the ask. The server computes each delta itself
(`boardwalk-api/src/domain/mutations.ts`, one transaction per mutation) and answers with the whole
authoritative profile, which the store swaps in over its optimistic copy. `useBet().commit()` stays
**synchronous** on purpose so no game's deal path changed: the local check decides whether the chip
leaves the rack, the server reconciles a beat later and reverts with a toast if it disagrees.

**What the server now owns:** the bankroll (`SUM(ledger.delta_cents)`, no stored column anywhere),
bet legality against that derived balance, store prices, the daily clock and streak, and XP + stats
computed from the reported outcome. `PUT /profile` shrank from a whole Profile to **three fields**
(name, avatar, equipped) — the write that used to be able to set a balance no longer has anywhere
to put one.

**Replay-hardening, the thing this phase owed.** Every intent carries a client-minted `nonce`;
`mutations(uid, nonce)` is claimed with `INSERT OR IGNORE` **inside the same transaction** as the
work, so a retry, a double-tap, or an offline result re-sent on reconnect all collapse to one
effect and replay the first answer.

**Two live bugs found and fixed on the way.** The API's `Profile` had **no `equipped` field at
all**, so Phase A's mirror silently dropped every player's card back and title on every write —
cutting over without that would have unequipped everyone. And `LeaderboardEntry` had no `played`,
so the API could never have served the Win Rate board. Both are now columns, coerced and tested;
`COLUMN_MIGRATIONS` in `db/schema.ts` brings the Pi's existing database forward (a
`CREATE TABLE IF NOT EXISTS` never adds a column, which is how a schema change passes every test
and breaks only in production).

**The honest residuals, not smuggled past:**
- **The payout AMOUNT is still the client's claim**, bounded but not verified. A settle must consume
  a real open `wagers` row and is capped at a per-game multiple of that stake (blackjack 2.5× for
  the 3:2 natural, default 3×), so "pay me a million on a $1 bet" and "pay me with no bet at all"
  are both dead — but the server cannot know whether the hand was actually won until Phase D runs
  the rules here.
- **Achievements are still computed client-side** and recorded additively, because the catalogue
  lives in the frontend. A dishonest client can award itself a badge and an earn-only cosmetic. It
  cannot award itself a chip.
- **The server's money rules are a second copy** of the frontend's pure ones (prices, ladder, XP,
  opening stake). Sharing them is Phase D's `packages/game-logic` move and was not done here on
  purpose: the API is CommonJS with `rootDir: src` and is not in the root npm workspace, so wiring a
  shared package changes the build output layout and therefore the Pi's systemd entrypoint —
  a deploy-coupled change made blind in the same commit that moves the source of truth for money.
  The copy is **guarded**: `tests/economy-parity.test.ts` imports both sides and asserts every price,
  every rung of the daily ladder, the XP table and the opening stake agree. It caught a real drift
  the first time it ran (two title ids wrong on the server).

**✅ CUT OVER 2026-07-18.** Merged (PR #23), deployed, and the frontend economy is live against the
referee — verified in the shipped bundle, not inferred: `apiEconomyOn` folds to `!0`, so profile,
economy and leaderboard all resolve to the API.

1. ✅ **Deployed to the Pi.** (`~/boardwalk-api` is NOT a git clone — code arrives by rsync.)
2. ✅ **Restore drill run on the real Pi**, for the first time: `integrity_check ok`, 8 tables,
   balances recomputed from the restored ledger, `restore drill PASSED`. An off-box copy was pulled
   and re-verified on another machine.
3. ✅ **The Firebase→SQLite backfill has been RUN** — `1 migrated, reconcile OK`, and a re-run
   reports `0 migrated, 1 already migrated`, so the idempotency marker is confirmed against real
   production data rather than only in tests. See [BACKFILL_RUNBOOK.md](BACKFILL_RUNBOOK.md).
4. ⬜ **Install the backup timer and confirm the off-box copy lands** — still owed. Backups are
   currently taken by hand.
5. ⬜ **Verify in prod** that a bet/settle/purchase/claim round-trips end-to-end in a browser, and
   that devtools cannot move the bankroll. Until that is driven, "editing devtools changes nothing
   durable" is a design, not a claim.

**What the cutover actually found, recorded because the plan's premise was wrong.** This phase was
written expecting a population of real players whose accounts had to survive the migration. There
are none: RTDB holds **one** `users/` node and Firebase Auth holds **two** accounts — the owner's,
and one `@boardwalk.invalid` throwaway from a browser-verification run. The one real profile was
already mirrored into SQLite with a matching balance, so the backfill moved **$0.00** and wrote no
ledger row. The migration tooling is therefore insurance for a future that has not arrived, not a
rescue of data that was at risk. **Check the row count before treating a data migration here as
urgent** — it is one query and it dissolved a whole incident.

**Two real defects surfaced on the way, both worth more than the migration:**
- **Neither kill switch had ever worked in prod.** `VITE_API_ECONOMY` and `VITE_WS_ROOMS` were
  documented in CLAUDE.md and here, read by the composition root, and injected by
  `.github/workflows/deploy.yml` — never. Vite only embeds a `VITE_*` present in the build
  environment, so setting the secret did nothing while the deploy went green. Fixed, and guarded by
  `tests/deploy-env.test.ts`, which requires every `import.meta.env.VITE_*` the source reads to be
  injected by the workflow.
- **The backfill CLI hung after succeeding** — firebase-admin's RTDB socket keeps the event loop
  alive. It printed `reconcile OK` and never exited, which invites the Ctrl-C-and-re-run that the
  idempotency marker exists to survive. Fixed with `closeFirebase()`.

### Phase C — Realtime rooms over WebSocket
Retire the RTDB *database* (Auth stays). Biggest phase — budget accordingly.

- The WS server owns rooms: create, join, **server-arbitrated seat assignment** (the claim-then-verify
  race dies here), presence, disconnect cleanup.
- Rewrite `RoomRepo` / `ChatRepo` against it. **`useRoom` / `useChat` signatures do not change** —
  that's the entire point of the boundary.

**Done when:** RTDB is no longer read or written at all.

**✅ LIVE — rooms + chat run over the WS referee by default (2026-07-17).** The gateway
(`boardwalk-api/src/rooms/`) is attached to the Express HTTP server in `server.ts` at `/rooms`, sharing
the port, the Tailscale Funnel, and one Firebase-verifier — an upgrade authenticates the exact same ID
token a REST call does. The Chrome PNA header is echoed onto the WS **handshake** too (a WebSocket
can't preflight, so Chrome folds the check into the upgrade), the twin of the HTTP middleware, for
tailnet devices. `tests/gateway.test.ts` (7) drives it over a real socket. **Deployed to the Pi and
soaked end-to-end** against the live Funnel with two real anonymous-disabled → email/password Firebase
tokens: handshake, create, seat arbitration + forged-uid refusal, host-only gating, monotonic seq,
owner-only hidden hands (a bystander never receives the card), author-pinned chat, and the
disconnect→seat-release→AI safety net — 16/16 green.

The client half is behind the seam: `src/system/repo/api/socket.ts` is the ONE multiplexed
`wss://…/rooms` connection — request/reply correlation, push fan-out, immediate-cache replay to a late
subscriber, **reconnect with backoff + subscription replay**, and **backpressure** (a bounded, drop-oldest
outbox that respects `bufferedAmount`); `api/roomRepo.ts` + `api/chatRepo.ts` implement the unchanged
`RoomRepo`/`ChatRepo` over it (`tests/socket.test.ts`, 8, drives the state machine against a fake socket).
The composition root now uses these **by default** wherever `VITE_API_BASE_URL` is set (prod already has
it); **`VITE_WS_ROOMS=0`** is the kill switch back to RTDB (rebuild, no code change) for a Pi outage. The
Firebase room/chat repos stay in the tree as that fallback.

**Remaining:** watch a stretch of real prod play (any console/connection errors, PNA on a tailnet
browser), then **delete the Firebase room/chat repos** so RTDB is no longer read or written at all —
that is the literal "Done when." The Phase-B replay-hardening story for offline-banked results is still
owed before offline wins are trusted.

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
