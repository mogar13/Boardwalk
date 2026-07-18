# The Boardwalk

A neon arcade built on **Casino OS v2** — a typed game SDK where adding a game means writing pure
logic, drawing a component, and exporting a manifest.

React 19 · TypeScript · Vite · Tailwind v4 + DaisyUI · Firebase

> **Status: Phases 0–5 shipped** — live at https://mogar13.github.io/Boardwalk/. There is a scaffold
> and a green pipeline (0), a theme and a UI kit (1), a data layer — Firebase Auth, profiles, repo
> interfaces and tested security rules (2), the shell — router, auth gate, top bar, hub (3), the
> economy — one-way money through `useBet`/`reportResult`, XP, stats, achievements, store, daily
> reward (4), and multiplayer — rooms, seats, presence, chat, and hidden information that is a rule
> not a layout (5). Still to come: **the five games** (6). The architecture was written down first,
> on purpose. Start at [plans/done/ARCHITECTURE.md](plans/done/ARCHITECTURE.md).

## What this is

The successor to [The Game Shack](https://github.com/mogar13/Game-Shack) — 31 mini-games in ~35,000
lines of vanilla HTML/CSS/JS, held together by `window.System*` globals and script load order.

The Shack **stays live at https://mogar13.github.io/Game-Shack/, forever, untouched.** It is not a
migration source. It's the archive — and it's the reason this repo gets to be a clean rewrite instead
of a port. Because the old games are still playable, The Boardwalk has no parity obligation. It ships
with five games and is *finished*.

There is deliberately no game checklist. See
[ARCHITECTURE.md](plans/done/ARCHITECTURE.md#the-corollary-which-is-the-most-important-line-in-this-document).

## Casino OS v2

The Shack's system layer had good bones and bad joints. v2 keeps the ideas — seats as the universal
multiplayer primitive, AI seats being joinable so a table never dies, privacy by data layout — and
fixes the three things that generated most of its bugs:

- **`localSeatIds: number[]`** — hot-seat is a seat list, not a mode. AI is `[1]`, online is `[myId]`,
  hot-seat is every human seat, and `isMyTurn` is one expression. No game branches on a mode string.
- **`reportResult({outcome, payout})`** — one call moves money, records stats, grants XP, and fires
  achievements. `useBankroll()` is readonly, so a game *cannot* spell `money += x`.
- **`useRoom<TState>()`** — owns the subscription, not just the lobby. No game registers a listener,
  so no game can forget to tear one down.

The theme running through all three: **fix it by type, not by convention.** Make the wrong thing
unspellable rather than documenting "don't."

## Docs

| Doc | What |
|---|---|
| [plans/done/ARCHITECTURE.md](plans/done/ARCHITECTURE.md) | The design and the *why*. Stack, SDK, data model, phases. **Read this first.** |
| [CLAUDE.md](CLAUDE.md) | The rules, and what enforces each one. Short on purpose — every rule is paid for by a specific v1 bug. |
| [plans/BACKEND_PLAN.md](plans/BACKEND_PLAN.md) | 🔒 Later. Node + SQLite, server-authoritative economy. Not scheduled. |

Two tiers, deliberately: rules live in `CLAUDE.md` in present tense and must have a guard behind them;
history lives in `ARCHITECTURE.md` in past tense, where it can't rot. *"v1 had no `off()`"* stays true
forever. *"we have no `off()`"* rots the day someone adds one.

## Develop

```bash
npm install
cp .env.example .env.local   # fill from the Firebase console — dev works without it
npm run dev      # http://localhost:5173/Boardwalk/
npm test         # the guards, proving they still fire (boots the RTDB emulator — needs Java)
npm run build    # prebuild (lint + file-size ratchet) → tsc -b → vite build
```

Routes: `/` (hub) · `/play/:gameId` · `/store` · `/leaderboard` · `/profile` · `/_dev/lobby`
(DEV-only multiplayer harness, tree-shaken from prod). To drive the room flow against the emulators:

```bash
npx firebase emulators:start --only auth,database
VITE_USE_EMULATOR=1 npm run dev    # then open /Boardwalk/_dev/lobby
```

`npm run dev` works on a fresh clone with no credentials: the page renders a panel naming the missing
variables rather than a form. `npm run build` does not — a production build with no Firebase config
**fails**, rather than deploying a site whose only feature is that panel.

Push to `main` deploys to Pages. `npm run build` runs the guards via npm's `prebuild` lifecycle, so
they gate the deploy rather than merely existing — a linter nobody runs is a convention, not a rule.

### The security rules

`database.rules.json` is the enforcement boundary — not the client, and not any `isDev` flag. It is
the one file here that no static tool can check: ESLint can't see it, `tsc` can't see it, and a
mistake in it reports success by doing nothing. So it has a real test.

```bash
npm run rules:test     # runs the REAL rules file against the RTDB emulator
npm run rules:deploy   # push them to Firebase. NOTHING IN CI DOES THIS — do it in the same breath.
```

**Next: Phase 6 — the five games** (Tic-Tac-Toe first, the SDK's smoke test). Phases are one per
conversation, each ending green and deployed; see [ARCHITECTURE.md](plans/done/ARCHITECTURE.md#phases).
