# The Boardwalk

A neon arcade built on **Casino OS v2** — a typed game SDK where adding a game means writing pure
logic, drawing a component, and exporting a manifest.

React 19 · TypeScript · Vite · Tailwind v4 + DaisyUI · Firebase

> **Status: design.** No code yet. The architecture is written down first, on purpose.
> Start at [plans/ARCHITECTURE.md](plans/ARCHITECTURE.md).

## What this is

The successor to [The Game Shack](https://github.com/mogar13/Game-Shack) — 31 mini-games in ~35,000
lines of vanilla HTML/CSS/JS, held together by `window.System*` globals and script load order.

The Shack **stays live at https://mogar13.github.io/Game-Shack/, forever, untouched.** It is not a
migration source. It's the archive — and it's the reason this repo gets to be a clean rewrite instead
of a port. Because the old games are still playable, The Boardwalk has no parity obligation. It ships
with five games and is *finished*.

There is deliberately no game checklist. See
[ARCHITECTURE.md](plans/ARCHITECTURE.md#the-corollary-which-is-the-most-important-line-in-this-document).

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
| [plans/ARCHITECTURE.md](plans/ARCHITECTURE.md) | The design and the *why*. Stack, SDK, data model, phases. **Read this first.** |
| [CLAUDE.md](CLAUDE.md) | The rules, and what enforces each one. Short on purpose — every rule is paid for by a specific v1 bug. |
| [plans/BACKEND_PLAN.md](plans/BACKEND_PLAN.md) | 🔒 Later. Node + SQLite, server-authoritative economy. Not scheduled. |

Two tiers, deliberately: rules live in `CLAUDE.md` in present tense and must have a guard behind them;
history lives in `ARCHITECTURE.md` in past tense, where it can't rot. *"v1 had no `off()`"* stays true
forever. *"we have no `off()`"* rots the day someone adds one.

## Develop

Nothing to run yet. Phase 0 sets up Vite + TS strict + ESLint + Prettier + the file-size ratchet +
Pages deploy, and ships a live empty page. Phases are one per conversation, each ending green and
deployed.
