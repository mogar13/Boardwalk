# boardwalk-api — the referee

Node + Express + SQLite. The server half of [`../plans/BACKEND_PLAN.md`](../plans/BACKEND_PLAN.md).
This is the thing a browser is not allowed to be: it verifies Firebase ID tokens and owns the
**ledger**, so the bankroll becomes a derived sum no client can overwrite.

**Status: Phase A scaffold.** Profile + leaderboard endpoints, token verification, and the
append-only ledger are live and tested. It is NOT wired into the frontend yet (see "Wiring" below)
— shadow mode and cut-over are the next phases.

## What it is not

Identity is **not** rebuilt here. Firebase Auth still owns credentials; the server verifies the ID
token with the Admin SDK and trusts the `uid`. Realtime rooms/chat are **not** here either — they
stay on Firebase RTDB until Phase C moves them to WebSockets.

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

The uid always comes from the verified token — never the body or path — so a caller can only ever
read or write its own record.

## The ledger

`profiles` has **no bankroll column**. The balance is `SUM(ledger.delta_cents)`. On save, the server
appends one row for the difference between the incoming bankroll and the current derived balance —
so `reportResult()`'s save becomes a ledger entry, exactly as the plan predicts, with no frontend
change. In Phase A the reason is `sync` (mirroring the client); in Phase B the server computes the
delta itself (`bet`/`settle`) and the client can no longer set its own money.

## Wiring (not done yet, on purpose)

The frontend's server-backed repos already exist at `../src/system/repo/api/` and implement the same
`ProfileRepo` / `LeaderboardRepo` interfaces as the Firebase ones. They are **not** in the
composition root (`../src/system/repo/index.ts`) — flipping that is Phase A shadow mode / Phase B
cut-over, which needs a deployed server and a diff proving agreement first. Building the swap before
it has earned trust would be the mistake the whole repo boundary exists to avoid.

## Deploy target

The Pi (`mogar13@192.168.100.99`). The DB lives on a mounted USB stick, off the SD card:
`DB_PATH=/mnt/boardwalk-db/data/boardwalk.db`. Reaching it from GitHub Pages (HTTPS) needs a tunnel
+ TLS (Cloudflare Tunnel / Tailscale) — mixed content blocks a plain-HTTP LAN endpoint. That is the
next Pi-track step.
