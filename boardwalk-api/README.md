# boardwalk-api — the referee

Node + Express + SQLite. The server half of [`../plans/BACKEND_PLAN.md`](../plans/BACKEND_PLAN.md).
This is the thing a browser is not allowed to be: it verifies Firebase ID tokens and owns the
**ledger**, so the bankroll becomes a derived sum no client can overwrite.

**Status: Phases B and D — the referee is real, and neither phase is deployed.** The four money
routes (`/bet`, `/settle`, `/purchase`, `/daily`) compute every delta server-side against the
append-only ledger, `PUT /profile` accepts only cosmetics, and every mutation is idempotent on a
client-minted nonce. Phase D added the parts a ceiling could never cover: the server **deals
blackjack** (`/blackjack/deal`, `/blackjack/move` — it shuffles, validates each move and computes
the payout from its own cards, and the request has nowhere to name one), and it **computes
achievements itself** from its own tables instead of recording what a client reported, so a chain
badge and the earn-only cosmetic it grants can no longer be forged. Both read the same rules the
browser plays, from `@boardwalk/game-logic` — see [Where the rules live](#where-the-rules-live).
The frontend is wired to it as primary. **The Pi is still running the Phase-A build** — deploying,
running the restore drill there, and verifying in prod are the owed steps in
[`../plans/BACKEND_PLAN.md`](../plans/BACKEND_PLAN.md#phase-b--cut-over-profile-economy-stats), and
Phase D rides along with that same trip (see [Deploy target](#deploy-target) — **one item there must
be checked before you deploy**).

## What it is not

Identity is **not** rebuilt here. Firebase Auth still owns credentials; the server verifies the ID
token with the Admin SDK and trusts the `uid`. Realtime rooms and chat **are** here now (Phase C's
WebSocket gateway shares this process and port), so the RTDB fallback is a kill switch, not the
road.

It is **not** server-authoritative for every game. Blackjack is dealt here; chess, uno, solitaire
and tic-tac-toe are not. Those four do not bet — their payout is forced to `0` and no chip is at
stake — but their **outcome is still self-reported**, so a dishonest client can still take XP and a
win stat it did not earn. Making them authoritative means this server holding the match itself, and
that is not started.

## Where the rules live

Neither side owns the rulebook: `../packages/game-logic` does, and both import it. The prices, the
daily ladder, the XP table, the achievement catalogue, `validateBet`, `payoutCents` and the five
games' logic are all one copy — `PRICES_CENTS` here is *derived* from the shared `CATALOG`, not
transcribed from it. This package is consumed as an ordinary dependency
(`"@boardwalk/game-logic": "file:../packages/game-logic"`) and read as **built CommonJS**, which is
what keeps `rootDir: src`, `outDir: dist` and `main: dist/server.js` unchanged — and therefore the
Pi's systemd `ExecStart`. `build`, `typecheck` and `pretest` each build the package first.

## Run it

```bash
npm install
cp .env.example .env     # fill FIREBASE_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS for real auth
npm run dev              # tsx watch, http://localhost:8787
npm test                 # vitest — domain round-trips + route/auth tests (in-memory sqlite)
npm run typecheck
npm run build && npm start   # compile to dist/ and run on node (this is what the Pi runs)
```

### Drive it locally without real tokens

`insecure-dev` mode trusts an `x-debug-uid` header and verifies nothing — for exercising the API
against the local emulator. It **refuses to boot** unless you also opt in, so it can never be the
accidental prod default:

```bash
AUTH_MODE=insecure-dev ALLOW_INSECURE_AUTH=1 npm run dev
curl -s localhost:8787/health
curl -s -X PUT -H 'x-debug-uid: alice' -H 'content-type: application/json' \
  -d '{"name":"Alice","avatar":"🦊","bankrollCents":500000,"xp":0,"stats":{},"achievements":{},"inventory":{},"daily":{"lastClaimDay":0,"streak":0}}' \
  localhost:8787/profile
curl -s -H 'x-debug-uid: alice' localhost:8787/profile
curl -s -H 'x-debug-uid: alice' 'localhost:8787/leaderboard?limit=5'
```

To verify **emulator-minted** tokens for real (not the bypass), set
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and keep `AUTH_MODE=firebase`.

## Endpoints

| Method | Path                    | Auth  | Purpose |
|--------|-------------------------|-------|---------|
| GET    | `/health`               | none  | Liveness + DB probe |
| GET    | `/profile`              | token | The caller's own profile (`404` → frontend maps to `null`) |
| PUT    | `/profile`              | token | Upsert the caller's own profile (create AND save) |
| GET    | `/leaderboard?limit=N`  | token | Server-computed standings, ranked by wins |
| POST   | `/bet`                  | token | `{nonce, gameId, amountCents}` — deduct a legal, affordable wager |
| POST   | `/settle`               | token | `{nonce, gameId, outcome, payoutCents?, feats?}` — credit a bounded payout, bump stats + XP, and **recompute** achievements. Refuses `gameId: 'blackjack'` outright |
| POST   | `/purchase`             | token | `{nonce, itemId}` — buy at the **server's** price |
| POST   | `/daily`                | token | `{nonce}` — claim against the **server's** clock |
| POST   | `/blackjack/deal`       | token | `{nonce, wagerCents}` — the **server** shuffles and deals; stakes the wager in the same transaction |
| POST   | `/blackjack/move`       | token | `{nonce, handId, move}` — `hit`/`stand`/`double`, validated and settled from the server's own cards |

The two blackjack routes answer `{profile, hand: HandView, replayed}`. **Neither request has a field
for a card, an outcome or a payout** — absent, not validated — and `HandView` has no `deck` and
carries one dealer card until `phase === 'settled'`, so the hole card cannot be leaked by forgetting
to strip it. `/settle` lost its `unlockedAchievementIds` and `grantedItemIds`: the server recomputes
badges from its own tables, and only `feats` (a two-card 21, a Solitaire cleared without a recycle —
things no state predicate can see) still come from the client, filtered to rows the catalogue marks
`feat: true`.

Every money route answers with the whole authoritative profile, returns **409** for a refusal
("insufficient funds", "already claimed today" — game state, not a malformed request) and **400**
only for a body it cannot parse. A repeated `nonce` is a no-op that replays the first answer.

The uid always comes from the verified token — never the body or path — so a caller can only ever
read or write its own record.

## The ledger

`profiles` has **no bankroll column**. The balance is `SUM(ledger.delta_cents)`. On save, the server
appends one row for the difference between the incoming bankroll and the current derived balance —
so `reportResult()`'s save becomes a ledger entry, exactly as the plan predicts, with no frontend
change. In Phase A the reason is `sync` (mirroring the client); in Phase B the server computes the
delta itself (`bet`/`settle`) and the client can no longer set its own money.

## Wiring

`../src/system/repo/index.ts` now uses `api.profile`, `api.economy` and `api.leaderboard` as
primary wherever `VITE_API_BASE_URL` is set. **`VITE_API_ECONOMY=0`** forces the whole economy back
to Firebase-authoritative with a rebuild and no code change — the kill switch for a Pi outage, the
twin of Phase C's `VITE_WS_ROOMS=0`. Rooms and chat ride the WebSocket gateway in this same service.

No game, hook or component was touched by the cutover. That is the repo boundary paying out:
`useBet`, `reportResult`, the store and the daily card all call one new store method, and the games
below them cannot see far enough to be affected.

## Deploy target

The Pi (`mogar13@192.168.100.99`). The DB lives on a mounted USB stick, off the SD card:
`DB_PATH=/mnt/boardwalk-db/data/boardwalk.db`. Reaching it from GitHub Pages (HTTPS) needs a tunnel
+ TLS (Cloudflare Tunnel / Tailscale) — mixed content blocks a plain-HTTP LAN endpoint.

### The Phase-D deploy delta — read before deploying

Phase B is also still undeployed, so both phases go up in one trip. This adds **no new deploy**, but
it does add a precondition.

1. **`ExecStart` and `WorkingDirectory` do NOT change.** That was the entire point of taking the
   shared package as a `file:` dependency instead of compiling it into this `tsc`. Still
   `node dist/server.js`.
2. **`../packages/game-logic/` must be present next to this directory** — the dependency is a
   relative path out of it.
3. **Re-run `npm install` here** so the symlink lands in `node_modules`, then build (`npm run build`
   compiles the shared package first, so this is covered by a normal build).
4. ⚠️ **UNVERIFIED — check this first: does the Pi have the whole repo checked out, or only
   `boardwalk-api/`?** Nobody SSH'd to it during this work. **If it has only this directory, the
   `file:../packages/game-logic` dependency will not resolve and the deploy fails at
   `npm install`.** Widen the checkout or copy the package across before doing anything else.
