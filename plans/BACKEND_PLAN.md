# The Boardwalk — Backend Plan (Node + SQLite)

**Status:** ✅ **Phase B is DEPLOYED — server, client and backfill** (2026-07-18, from `cb42e44`).
Backups, the restore drill and the nightly timer landed first, then the migration and cutover; the
frontend merged (PR #23) and the Pages build carries the Funnel URL. The one-shot **backfill has now
run** — one `migration:v1` marker, and SQLite matches Firebase field for field. Owed steps 1–3 done.
**All five owed steps are now done**, including the live money round-trip and the full
stop/swap/start restore rehearsal — see "Verified in prod" below.

### Verified in prod (2026-07-18)

Driven against the live Pi with a real Firebase ID token, on a throwaway account since deleted
(Auth account removed, its 14 SQLite rows removed; the ledger is back to the one real player):

| Check | Result |
|---|---|
| opening stake | `500000` — the SERVER's grant, not a client claim |
| bet $10 | `499000` — exactly the price |
| **replay the same nonce** | `499000`, unchanged — and `mutations` holds ONE row for it |
| settle win $20 | `501000` |
| **hostile $1M payout** | **409** `payout with no open wager` |
| buy `cb_green5` (a P4 id) | **409** `insufficient funds` — the server KNOWS the id, which is the catalogue-drift fix live |
| buy an **earn-only** title | **409** `that item cannot be bought — it is earned` |
| daily claim | `551000` |
| daily again, fresh nonce | **409** `already claimed today` |
| **hostile `PUT /profile`** carrying `bankrollCents: 999999999` | 200, and the balance stayed `500000` |

The ledger it wrote is a clean audit trail — `signup 500000, bet -1000, settle 2000, daily 50000` —
summing to exactly the `551000` the API reported. Refused mutations still claimed their nonce and
wrote no ledger row, which is what makes a retry replay the refusal instead of re-deciding it.

**"Editing devtools changes nothing durable" is now a demonstrated claim rather than a design.**
✅ **Phase D is DEPLOYED too** (2026-07-18) — see
[The deploy delta](#the-deploy-delta-phase-d--done-and-what-it-turned-out-to-be) for what it turned
out to be, including the `npm install` trap it very nearly failed on.
Phase A shadow mode was WIRED. The launch five have shipped, so the gate is passed.
`boardwalk-api/` exists — Express + `better-sqlite3` + Firebase-Admin token verification, the schema
below (with the append-only `ledger`), profile + leaderboard endpoints, the money routes, the WS room
gateway and the blackjack dealer, 171 passing tests across 8 files — and is
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
  **→ Closed by Phase D.** The catalogue is shared, so the server can see what it could not; the two
  request fields are gone rather than validated.
- **The server's money rules are a second copy** of the frontend's pure ones (prices, ladder, XP,
  opening stake). Sharing them is Phase D's `packages/game-logic` move and was not done here on
  purpose: the API is CommonJS with `rootDir: src` and is not in the root npm workspace, so wiring a
  shared package changes the build output layout and therefore the Pi's systemd entrypoint —
  a deploy-coupled change made blind in the same commit that moves the source of truth for money.
  The copy is **guarded**: `tests/economy-parity.test.ts` imports both sides and asserts every price,
  every rung of the daily ladder, the XP table and the opening stake agree. It caught a real drift
  the first time it ran (two title ids wrong on the server).
  **→ Closed by Phase D.** The package exists, both sides import it, `PRICES_CENTS` is derived from
  the shared `CATALOG` rather than transcribed, and `tests/economy-parity.test.ts` is deleted —
  there is nothing left to compare. The entrypoint fear turned out to be answerable rather than
  merely deferrable: the API takes the package as an **ordinary resolved dependency**
  (`file:../packages/game-logic`) and reads its built CommonJS, so `rootDir`, `outDir` and
  `main: dist/server.js` never move. See Phase D.

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

**✅ CODE COMPLETE FOR BLACKJACK, NOT YET DEPLOYED (2026-07-18).** Three commits: the shared package,
the referee computing achievements, and the dealer dealing.

**One source for the rules — `packages/game-logic`.** The five rulebooks moved (each behind a subpath
`@boardwalk/game-logic/games/<game>`, because three of them export a `Card`), and so did the economy
(`bet`, `result`/`applyResult`), achievements, stats, XP, the money formatters, the store catalogue,
the daily ladder and the profile's data shapes. `Session` stayed behind in `src/system/auth/session.ts`
— it is an auth fact, not a rule the referee runs.

**The build seam is asymmetric on purpose, and it is the reason Phase B deferred this.** The
frontend reads the package's **TypeScript source**, through `paths` in `tsconfig.app.json` /
`tsconfig.test.json` and a matching `resolve.alias` in `vite.config.ts` — the same mechanism as
`@/`, so there is no build step between editing a rule and seeing it in the browser, and vitest
reads the same files. `boardwalk-api` reads the package's **built CommonJS**, through an ordinary
`"@boardwalk/game-logic": "file:../packages/game-logic"` dependency. Compiling the package as extra
*input* to the API's `tsc` would have pushed its output under a new directory and moved
`dist/server.js`; taking it as a resolved dependency instead leaves `rootDir: src`, `outDir: dist`
and `main: dist/server.js` **unchanged**, so the Pi's systemd `ExecStart` does not move. The API's
`build`, `typecheck` and `pretest` scripts each build the package first. One wrinkle worth knowing:
`boardwalk-api/tsconfig.json` needed a `paths` entry for the game subpaths, because
`moduleResolution: node` predates `exports` and cannot read the package's export map — Node resolves
those subpaths fine at runtime, so this was the worst version of the problem, code that would have
*run* correctly while failing to compile.

**The guards moved with the code**, which was the easy thing to get wrong. Both Phase-6 lint rules
are path-scoped to "the games tree"; leaving them pointed at `src/games` would have gone silent on
every line of logic in the repo *while still reporting success*. `GAMES_DIRS` now names both trees
and `tests/lint-rules.test.ts` proves each rule twice (48, up from 43), falsified by removing the
package from the list and watching exactly the three new cases go red. eslint's ignore list widened
from `dist/**` to `**/dist/**` so the package's build output is not linted as source.

**The referee computes achievements.** `/settle` no longer accepts `unlockedAchievementIds` or
`grantedItemIds` — the fields are **gone**, not validated, so there is nowhere on the request to ask
for a badge. `boardwalk-api/src/domain/achievements.ts` recomputes with the same shared
`satisfiedAchievements` the client uses, over an `AchievementView` whose every number is read back
from the server's own tables **inside the settle transaction**, after the stat bump, the XP award
and the ledger row have landed; a grant rides with its badge in that same transaction, because a
badge landing without its cosmetic is the shape of v1's `recordWin` defect. What this closed was
small in chips and total in prestige: a dishonest client could award itself the two Platinum mastery
tiers and with them `ttl_thehouse` and `ttl_grandmaster`, the titles the store deliberately refuses
to sell at any price. Only `feats` stay on the wire — filtered by the shared `recordedFeats` to rows
marked `feat: true`, so a chain id cannot be smuggled through the channel — and they stay there
until the server deals every game, because no state predicate can see a two-card 21 or a Solitaire
cleared without a recycle. `boardwalk-api/src/domain/types.ts` also stopped restating
`Profile`/`GameStat`/`DailyState`/`Equipped` and re-exports them; those being "structurally
identical" by hand is how Phase A shipped a `Profile` with no `equipped` field and silently dropped
every player's card back on every write.

**The dealer deals.** `POST /blackjack/deal {nonce, wagerCents}` and
`POST /blackjack/move {nonce, handId, move}` → `{profile, hand: HandView, replayed}`. The server
shuffles, deals, validates each move and computes the payout from its own cards with the shared
`payoutCents(result, wager)` — the same function the client used to call, run where it counts.
**Neither request has a field for a payout, an outcome, or a card.** A double-down commits its
second stake server-side in the same transaction and is refused whole if the balance cannot cover
it. `HandView` (shared, `games/blackjack/logic/view.ts`) makes the "Done when" structural rather
than diligent: it has **no `deck` field**, so the deck cannot be forwarded by accident, and it
carries **one dealer card until `phase === 'settled'`** — `slice(0, 1)`, not a placeholder, because
a fake hole card is a lie on the wire that a renderer could believe.

**And the old road is closed.** `checkSettle` now refuses `gameId: 'blackjack'` outright
(`SERVER_DEALT_GAMES` in `domain/economy.ts`). Without that, `POST /bet` + `POST /settle` at the
2.5× ceiling remains a standing bypass of the dealer and the whole phase is opt-in — the cheapest
way to defeat a cutover is to leave the path it replaced standing. The generic-settle tests moved to
a gameId the referee does not deal, which is what that route is now for.

**Frontend, all behind the seam.** A `BlackjackRepo` interface with `src/system/repo/api/blackjackRepo.ts`
(the referee) and `src/system/repo/local/blackjackRepo.ts` (the offline twin, running the same shared
reducer, so a fresh clone / the emulator / guests still get a real game with no server);
`useBlackjackTable()` is the only thing the game calls, and `Table.tsx` is now a **renderer of
`HandView`** — it draws a card back for the hole card it genuinely does not have. `useBet()` still
owns the chip rack but no longer commits: the stake leaves the bankroll inside the deal's own
transaction. Kill switch `VITE_API_BLACKJACK=0`, tied to the economy flag, because a table whose
cards the server deals but whose money it does not price is a state nobody designed.

**Two real defects found on the way**, both worth keeping in mind. A `return` out of a
`db.transaction` **commits** — only a throw rolls back — so a refused deal was leaving an orphan hand
row and a burned nonce; every refusal path now checks before it writes. And the deal route's test
asserted `START - wager`, which is wrong about one deal in twenty-one because a natural settles
inside that same response; it asserts the ledger row now. A test that is red one run in twenty is
worse than no test.

**What Phase D did NOT do — the honest residual.** Only blackjack is server-dealt. The other four
games (chess, uno, solitaire, tic-tac-toe) do not bet, so their payout is forced to `0` and no chip
is at stake — but their **outcome is still self-reported**. A dishonest client can still claim a win
it did not earn and take the XP and the stat that ride with it. Fixing that means the server holding
the match — the board, the turn order, the move validation — which is a much larger job than
projecting one hand, and it is not started. The bound today is: *a dishonest client can inflate its
level and its win count, and it can never take a chip.* UNO's hidden hands, likewise, are still
enforced by RTDB rules and a host-as-dealer client, not by this server.

**Counts:** frontend 435 across 26 files, `boardwalk-api` 171 across 8 (45 in economy, 22 in
blackjack).

**How it shipped — it rode along with Phase B's deploy and did not add a second one:**
see [The deploy delta](#the-deploy-delta-phase-d--done-and-what-it-turned-out-to-be) below.

### The deploy delta (Phase D) — DONE, and what it turned out to be

**Deployed 2026-07-18.** The question this section used to flag as UNVERIFIED — whole repo on the
Pi, or only the `boardwalk-api/` directory? — resolved to **the bad case**. `~/boardwalk-api` is a
standalone directory, not a git checkout (`fatal: not a git repository`), with no `packages/`
sibling, so `file:../packages/game-logic` could not resolve. Flagging it was worth more than
guessing it.

`ExecStart` and `WorkingDirectory` did NOT change — the entire point of the build seam, and it
held. The fix is the smallest one that makes the relative path honest: **`packages/game-logic/` is
rsync'd to `~/packages/game-logic`**, next to `~/boardwalk-api`. The deploy is two rsyncs, not one:

```bash
ssh mogar13@<pi> 'mkdir -p ~/packages/game-logic'
rsync -az --delete --exclude node_modules --exclude dist \
  packages/game-logic/ mogar13@<pi>:~/packages/game-logic/
rsync -az --delete --exclude node_modules --exclude dist --exclude .env \
  boardwalk-api/ mogar13@<pi>:~/boardwalk-api/
ssh mogar13@<pi> 'cd ~/boardwalk-api && npm install && npm run build && npm test'
ssh mogar13@<pi> 'sudo systemctl restart boardwalk-api'
```

**Do NOT pass `--omit=optional` to that install.** It completes, and the service builds and runs
fine on it — but rollup's native binary is an optional dependency, so `npm test` then dies with a
`MODULE_NOT_FOUND` inside vitest. The tests are the gate; an install flag that quietly removes the
ability to run them is worse than a slower install.

Secrets live in `~/boardwalk-secrets/boardwalk-api.env` via `EnvironmentFile=`, outside the rsync'd
tree, so the deploy cannot clobber them. 171/171 ran green **on the Pi** before the restart, the
ledger was byte-identical either side of it (1 profile, 2 rows, $5,215.00), and the journal is clean.

### The cutover order, because it is the lesson

The frontend deploys automatically on push to `main`; the Pi is deployed by hand. So merging Phase D
shipped a client calling `POST /blackjack/deal` at a Pi that had no such route, and **prod blackjack
was broken for about ten minutes**. `VITE_API_BLACKJACK=0` plus a re-run of Deploy restored it in
two, which is the kill switch doing exactly the job it was written for.

**Deploy the Pi BEFORE merging a frontend that depends on it** — or set the kill switch in the same
breath as the merge and clear it once the Pi is up. A phase whose two halves deploy by different
mechanisms has an ordering, and it is not the order the commits are in.

---

## Open questions (answer before Phase A)

- **Hosting:** pick whatever you already know and already pay for. Consistency beats novelty.
- **Do guests survive?** Today anonymous players never touch Firebase. Either guests stay purely
  local (**recommended** — keeps `localStorage` as a real offline mode) or everyone needs an account.
- **Offline play.** A server-authoritative economy is fundamentally online. Do offline wins bank chips
  on reconnect (needs a sync/conflict story), or are offline games unranked? **Recommend unranked** —
  it's honest and sidesteps a whole class of cheating.
