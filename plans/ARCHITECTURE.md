# The Boardwalk

**Status:** Phase 0 shipped 2026-07-16 — scaffold live at https://mogar13.github.io/Boardwalk/.
Phases 1–6 are design.
**Started:** 2026-07-16

A React 19 + TypeScript arcade built on **Casino OS v2** — a typed game SDK where adding a game
means writing pure logic, drawing a component, and exporting a manifest.

The Game Shack (`../Game-Room`, live at https://mogar13.github.io/Game-Shack/) **stays up, forever,
untouched.** It is not a migration source. It is the archive, and it is the reason this project is
allowed to be greenfield.

---

## Why this is a rewrite and not a migration

The Game Shack has a migration plan (`../Game-Room/plans/MIGRATION_PLAN.md`). It is a good plan and
it is being abandoned deliberately. Two reasons.

**1. Its schema freeze made the real fixes illegal.** Because legacy and ported games had to share
one Firebase project and one `localStorage`, the plan froze the data shape until Phase 7 — after all
31 ports landed. So the actual defects (below) would have been faithfully carried into TypeScript and
only allowed to be fixed once the hardest work was already done. Full rewrite cost, same mistakes,
now with types.

**2. Keeping v1 live deletes the parity obligation.** The migration's own risk register leads with
"migration stalls half-done; repo has two of everything forever" — which is why it needed all 31
games. The Boardwalk needs none of them. It ships with five and is *finished*, because the other 26
are still playable at the old URL. That is what makes greenfield safe here rather than reckless.

### The corollary, which is the most important line in this document

**There is no game checklist. There will never be a game checklist.**

The OS is ~4,700 lines. The games are ~30,000. Risk alone is 2,697 lines of JS; Risk + Clue +
Trivial Pursuit + Scrabble are ~8,600. Rebuilding the OS is a couple of weekends and it's the
enjoyable part. Rebuilding Risk is neither. If "done" ever means "31 games," this project stalls in
exactly the place the migration would have.

Five games at launch. After that, games get built because one sounds fun on a given weekend. The
Game Shack is the completionist version and it already exists.

---

## What Casino OS v1 got right

Port these ideas — not the code. Each one was learned from a real bug and the reasoning is worth more
than the implementation.

- **The seat array is the universal multiplayer primitive.** `seats: [{type, name}]`, host at index
  0, `status: waiting → playing`. One shape covers 2-player Chess and 6-player Monopoly.
- **AI seats are joinable.** v1's join claims "the first replaceable seat: open *or* ai," and UNO's
  leave path hands a seat *back* to an AI so the host's driver keeps the table alive. AI as a
  fallback occupant rather than a separate mode means drop-in/drop-out never breaks a game. This is
  the best idea in v1 and it is nearly invisible.
- **Claim-then-verify seat acquisition.** No transactions, so: write, re-read, confirm
  `claimed.name === myName`, else `SEAT TAKEN`. Pragmatic and correct.
- **Privacy by data layout.** UNO writes hands to a separate node and subscribes only to its own
  indices, so bystanders never *receive* opponents' cards. Not a UI trick — a data-layout guarantee.
- **Ordering keys that survive distributed clients.** UNO's `stateSeq`, with the comment: *"Wall-clock
  timestamps are NOT comparable across machines (clock skew silently dropped opponents' moves)."*
  Chat's `ts.padStart(15) + counter.padStart(6)` so ASCII sort equals send order.
- **Room-lifecycle hygiene.** `beforeunload` **and** `pagehide`; synchronous teardown before exit;
  `dbRemove` → `dbSet(null)` fallback; only the host clears remote chat. Every one is a scar. These
  become tests, not comments.
- **Declarative game config.** `SystemUI.init({gameName, rules, hudDropdowns})` — the game *declares*
  its chrome instead of building it. That's already React props; make it the typed manifest.
- **The security posture.** Firebase Auth owns credentials. `leaderboard/<uid>` is a rule-validated
  public projection because `users/` isn't readable. `admins/<uid>` is the real boundary; `.dev-only`
  only hides UI. Real emails never enter the public `usernames/` index. **Carry this over unchanged.**
  It is the most mature part of v1 and it was paid for with two shipped backdoors.

## What Casino OS v1 got wrong

The pattern behind every one: **an abstraction was added without removing what it replaced.**

| Defect | Evidence |
|---|---|
| `SystemMatch` abstracted the lobby but not the room subscription | The same 20-line `listenToRoom()` is copy-pasted in **27 games** |
| 22 of 25 games ignore `SystemMatch.setListener` | So `cleanup()`'s listener detach is a no-op — they leak a live Firebase subscription per lobby close |
| `recordWin(gameId)` takes one arg | **40+ call sites pass a payout** it silently discards, then separately do `SystemUI.money += x` |
| `big_win` achievement ("win $1,000+ in one bet") | **Zero unlock sites** — nothing ever knew the payout. Direct consequence of the row above |
| Hot-seat is a dropdown string, not a concept | 14 games hand-roll it; **7 say `"local"`, 7 say `"hotseat"`**. Checkers pays the local player when *either* side wins |
| `validateAndCommit()`, written to end hand-rolled bet math | **Zero adopters.** All 6 betting games still double-clamp by hand |
| `SystemProfile` is "the source of truth" | **Zero games call it** for money. `SystemUI.money` — documented as legacy back-compat — is the only path |
| `SystemStats`/`SystemUI` wrapper methods | `SystemUI.recordWin`/`recordLoss`/`recordTie` — **0 call sites in 31 games** |
| `gameId` drifts from `games.json` ids | `texas_holdem`→`"poker"`, `domino`→`"dominoes"`, `c4`→`"connect4"`, `family-feud`→`"feud"`, `trivial-pursuit`→`"trivia"`. **5 of 31 games' stats silently never reach the hub** |
| Cosmetics have two parallel schemas | `loadout.color` is written by the hub and **read by nothing**; chat reads `profile.chatColor` |
| ~430 of `system_ui.js`'s 1,095 lines are dead | A 258-line fossil copy of `system_lobby.js` and a 131-line divergent copy of `system_chat.js`, both overwritten at load |
| Five `if (window.SystemUI)` compat blocks | All dead — `SystemUI` doesn't exist yet when they run. `wireSystemModules()` was written to fix this and didn't delete them |
| `setMoney` does `parseInt` | Blackjack's `money += bet * 2.5` on a 3:2 natural **silently drops the fractional chip** |
| Firebase config inline in **32** HTML files | Each game then polls `setInterval(() => window.db, 50)` to find out when it's ready |
| `SystemUI.on()` has no `off()` | Listeners accumulate for the page's lifetime |
| `category` field | **30 of 31 games are `"board"`** — including Slots, 8-Ball Pool, and Bowman. The hub groups by it and renders one bucket |

**The design lesson, taken from VS-Dashboard:** every one of these is a case of documenting "don't"
instead of making the wrong thing unspellable. v2 fixes them by *type*, not by convention.

---

## Stack

Mirrors VS-Dashboard, which is the proven-in-anger reference.

| Concern | Choice | Note |
|---|---|---|
| Build | **Vite 8** | Was written as "Vite 6" mirroring VS-Dashboard; 8 was current at Phase 0 and greenfield had no reason to start two majors back |
| Language | **TypeScript 6, `strict: true`** | Not 7: `typescript-eslint` peers `<6.1.0`, so TS 7 buys the native compiler by turning the lint config off. Revisit when it supports 7 |
| UI | **React 19** | |
| Routing | **react-router-dom 7** | `React.lazy` + `<Suspense>` per game |
| Styling | **Tailwind v4 + DaisyUI 5** | Configured in CSS, no `tailwind.config.js` |
| Theme | **`@boardwalk/theme`** package | Semantic tokens only |
| UI kit | **`src/ui`** — our own | DaisyUI raw classes are banned; see below |
| State | **Zustand** for profile/auth/audio; `useReducer` for game state | Context would thrash on a ticking bankroll |
| Data | **Firebase** (Auth + RTDB), one typed singleton, behind repos | |
| Lint | **ESLint 10 flat** + local rules, fails the build | |
| Tests | **Vitest** on pure logic | Shuffles, scoring, bet math, win checks |
| Deploy | **GitHub Pages** via Actions | `.nojekyll`, lowercase `index.html` |

**Departures from VS-Dashboard, deliberate:**
- **Path aliases.** VS-Dashboard has none and imports `'../../../actualLabor'`. We take `@/` on day one.
- **No 715-line CLAUDE.md.** Every rule in theirs is a bug that already shipped; they earned them one
  at a time. Starting greenfield with all of them is cargo-culting the output instead of the process.
  We start with the rules this document's defect table *already paid for*, and accrete the rest.
- **Prettier.** They have none. We take it; it's free uniformity.

**Not copied from VS-Dashboard: its backend.** Express + SQLite is right for a dashboard and wrong
here — realtime sync is the one thing this app genuinely needs and the one thing SQLite doesn't give
you without hand-building websocket transport. Firebase RTDB stays. The repo boundary (below) is what
keeps a server-authoritative economy possible later without touching a single game.

### Uniformity is enforced, not requested

The thing that makes VS-Dashboard look like one product is that **raw DaisyUI classes are banned** and
everything routes through `src/ui`. Their trap is instructive: `btn-primary` is *blue*, and they
reserve blue for information and never for action — so the raw class is a lint error and `<Button
variant="primary">` is orange.

A neon casino theme needs this discipline more than a dashboard does, not less. Neon without a system
looks like a ransom note. Rules from commit one:

- Semantic tokens only (`bg-base-200`, `text-primary-content`). Never a raw palette value.
- `src/ui` is the only place that may spell a DaisyUI component class. Lint-enforced.
- Variants are lookup records, not conditionals:
  ```ts
  const VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-primary-content hover:bg-primary/90 …',
    ghost:   'bg-transparent border border-bw-line …',
  }
  ```
- **`alert`/`confirm`/`prompt` are `no-restricted-globals`.** v1 has four ad-hoc modal systems and
  toasts that lazily self-inject a container with inline styles. One `<Modal>`, one `useToast()`.

### File size is a ratchet

Copy `../VS-Dashboard/scripts/check-file-size.mjs` + its baseline JSON, run on `prebuild`:
a **new file over 800 lines fails the build**, and any baselined file that *grew* fails. It never
fails on a file that shrank — it tells you to re-lock the ratchet. This is the mechanism that answers
"keep files under 800 lines" with something other than good intentions.

Corollary that actually does the work: **pure logic lives in hookless, I/O-free modules.** Not for
tidiness — pure logic welded to I/O is untestable logic, and untested game rules is how you ship a
bad shuffle.

---

## Repo layout

```
src/
├── main.tsx, App.tsx, index.css
├── shell/           router, top bar, nav, auth gate
├── ui/              the kit — Button, Modal, Toast, Card, ChipRack, Seat…
├── system/          Casino OS v2
│   ├── profile/     bankroll, xp, level, loadout
│   ├── economy/     bet math, payouts, the guard
│   ├── room/        useRoom, seats, lobby, presence
│   ├── chat/
│   ├── audio/
│   ├── progress/    stats, achievements, rewards
│   ├── store/       catalog, purchase
│   └── repo/
│       ├── types.ts         ← ProfileRepo, RoomRepo, ChatRepo interfaces
│       └── firebase/        ← THE ONLY PLACE `firebase/*` MAY BE IMPORTED (lint-enforced)
├── games/
│   ├── registry.ts          ← replaces games.json; typed; derives gameId
│   └── blackjack/
│       ├── manifest.ts
│       ├── BlackjackGame.tsx   ← default export, lazy-loaded
│       ├── logic/             ← PURE TS. no DOM, no React, no imports from system/. unit-tested.
│       └── components/
packages/
└── theme/           @boardwalk/theme — Tailwind + DaisyUI theme
```

Routes: `/` · `/play/:gameId` · `/store` · `/profile` · `/leaderboard`

**Rules:** nothing under `games/` may import from another game's folder. `logic/` may not import from
`system/` — that's what lets the same rules run on a server later. Both lint-enforced.

---

## Casino OS v2 — the SDK

### A game is a manifest plus a component

```ts
// games/blackjack/manifest.ts
export const manifest = {
  id: 'blackjack',              // ← the ONLY gameId. Stats/rooms/achievements all derive from it.
  name: 'Blackjack',
  pier: 'casino',
  seats: { min: 1, max: 5 },
  modes: ['ai', 'hotseat', 'online'],
  betting: { min: 2, max: 500 },
} as const satisfies GameManifest
```

`registry.ts` derives every key from `manifest.id`. The `texas_holdem` → `"poker"` drift becomes
unspellable rather than discouraged.

### The three fixes the whole OS is built around

**1. `localSeatIds: number[]` — hot-seat is a seat list, not a mode.**

v1's Monopoly found this the hard way and nobody generalized it:

> *"In hotseat there are several humans sharing one screen, so an un-attributed local click belongs to
> whoever's turn it is — not always the first human in the list."*

AI mode is `[1]`. Online is `[myId]`. Hot-seat is every human seat. Then:

```ts
const isMyTurn = localSeatIds.includes(currentSeat)
```

All three modes collapse into one code path. **No game ever branches on a mode string again.** This
deletes the `"local"`-vs-`"hotseat"` split across 14 games and the class of bug that pays Checkers'
loser.

**2. `reportResult()` — one call, and the only way money moves.**

```ts
const { reportResult } = useGame()
reportResult({ outcome: 'win', payout: 250 })
```

This is what 40+ v1 call sites were already trying to say when they passed a payout to a function
that took one argument. One call updates bankroll, stats, XP, and achievements together — which is
also what finally makes `big_win` implementable.

Enforced by type, not by rule: **`useBankroll()` returns a readonly balance.** Wagers go through
`useBet()`, payouts through `reportResult()`. There is no setter. A game *cannot* spell
`money += x`. Money is integer cents, so blackjack's 3:2 natural stops losing a chip to `parseInt`.

**3. `useRoom<TState>()` owns the subscription, not just the lobby.**

```ts
const { state, seats, myId, isHost, status, patch } = useRoom<BlackjackState>()
```

This is the largest real duplication in v1 — the same `listenToRoom()` in 27 games, 22 of them
leaking the listener. The hook owns subscribe, seq-ordered writes (UNO's `stateSeq` fix, for
everyone), teardown on unmount, and `beforeunload`/`pagehide`. A game cannot forget to clean up
because a game never registers anything.

Hidden information is first-class, not a per-game trick:

```ts
type Room<TPublic, TPrivate> = {
  status: 'waiting' | 'playing' | 'finished'
  seats: Seat[]; host: string; createdAt: number; seq: number
  state: TPublic                      // rooms/<game>/<id>/state       — everyone subscribes
  // private: rooms/<game>/<id>/private/<seatIdx> — only that seat subscribes, rule-enforced
}
```

### Hook surface

| Hook | Gives you |
|---|---|
| `useProfile()` | name, avatar, loadout, level, xp |
| `useBankroll()` | **readonly** balance |
| `useBet()` | chip rack state, `validate()`, `commit()` |
| `useRoom<T>()` | room state, seats, patch, status |
| `useSeats()` | `seats`, `localSeatIds`, `currentSeat`, `isMyTurn` |
| `useGame()` | `reportResult()`, manifest, mode |
| `useChat()`, `useAudio()`, `useToast()` | |

`<GameShell>` provides the context and owns the top bar and modals — v1's HUD, but injected once by
the shell instead of by each of 31 games calling `SystemUI.init()`.

The top bar also finally shows level/XP. v1 defines `#xp-bar-fill` in `system_ui.css`, which the hub
does not link — so XP is invisible in-game and re-declared in `hub-style.css`.

### A game receives almost no props

```ts
export interface GameProps {
  onExit: () => void      // that's it
}
```

Everything else is imported as a hook. This is deliberate: **props-drilling a `system` object would
rebuild the `window.SystemUI` god-object we're escaping.** Hooks plus Zustand selectors mean a game
imports exactly what it uses and re-renders only on what it reads.

### Build order within a game — the order is the point

1. **Extract logic first**, into pure `logic/` functions. No DOM, no React, no `@/system`.
2. **Test the logic before any UI exists.** Deck composition, shuffle fairness, legal-move
   generation, win/draw detection, score math, AI selection. This is where the subtle bugs are and
   it's the only step that catches them.
3. **Then** draw the components against the tested logic.

If a shuffle, a scoring rule, or a win check lives inside a component, the game is wrong. Lint
enforces the import boundary; the ordering is on you.

### Resist building a generic board-game engine

Five games is not enough evidence to know what games share, and neither was 31. Build five, note what
actually repeats, extract only that. A premature abstraction here would fight every game that
follows — which is, precisely, how v1 ended up with `validateAndCommit()` and zero adopters.

---

## Phases

One phase per conversation. Each ends green and deployed.

| # | Phase | Ships |
|---|---|---|
| 0 | **Scaffold** | Vite + TS strict + ESLint + Prettier + filesize ratchet + Pages deploy. An empty page that's live. |
| 1 | **Theme + kit** | `@boardwalk/theme`, `src/ui` core (Button, Modal, Toast, Card, Input). The look is decided here. |
| 2 | **Data layer** | One typed Firebase singleton, repo interfaces, the `firebase/*` import lint rule. Auth + profile. Rules ported from v1 **unchanged**. |
| 3 | **Shell** | Router, top bar with bankroll + XP, hub, `registry.ts`, piers. |
| 4 | **Economy + progress** | `useBet`, `reportResult`, stats, achievements, store, daily rewards. |
| 5 | **Multiplayer** | `useRoom`, seats, `localSeatIds`, lobby, chat, presence, lifecycle tests. |
| 6 | **The five games** | See below. |

Phases 0→5 are sequential. Phase 6 is five independent units.

### The five

Chosen for **OS coverage**, not sentiment — each proves a different capability. Swap by taste, but
keep the coverage or the OS ships untested.

| Game | v1 JS | Proves |
|---|---|---|
| **Tic-Tac-Toe** | 530 | The SDK is cheap. If this isn't ~150 lines, the SDK is wrong. |
| **Blackjack** | 966 | Betting, casino economy, `reportResult` payouts, dealer hole card. |
| **Chess** | 1,339 | Pure unit-tested `logic/`, hot-seat, 2-seat online, zero betting. |
| **UNO** | 1,079 | Private hands, seq ordering, AI-as-occupant, 7 seats. *It already solved the hard problems — port the reasoning.* |
| **Solitaire** | 547 | A game can opt out of rooms entirely. Cheap, and it keeps multiplayer from becoming mandatory. |

Build **Tic-Tac-Toe first**, immediately after Phase 5 — it's the SDK's smoke test, and it's better to
find the SDK is wrong on a 150-line game than on Blackjack.

---

## Non-goals

- **Not porting 31 games.** See above. That's what The Game Shack is.
- **Not touching The Game Shack.** It stays live at its URL. No shared code, no shared build.
- **Not a backend.** Static site + Firebase. The repo boundary keeps that door open; Phase 6 doesn't
  walk through it.
- **Not visual parity with v1.** This one *is* a redesign — that's the point of the theme.

## Decisions

**Its own Firebase project.** Decided 2026-07-16. Free-tier quotas are *per project*, so Boardwalk
gets its own 1GB RTDB / 10GB monthly egress / 100 concurrent connections and doesn't eat the Shack's.
The deciding argument is `database.rules.json`: rules are per-database, not per-node. A shared project
would mean one rules file governing both apps — deployed from which repo? Either the Shack's file goes
stale and wrong, or Boardwalk edits the archive every time it adds a node. Separate projects means the
Shack's rules stay true forever.

The accepted cost: **separate Auth, so Shack accounts don't log into Boardwalk.** New account, fresh
$5,000. That's a feature — not inheriting v1's shape was the whole argument for greenfield, and
inheriting it through the database would undo that at the last step.

**Deploy target: project Pages at `mogar13.github.io/Boardwalk/`.** Decided 2026-07-16, alongside the
Shack. `base: '/Boardwalk/'` in `vite.config.ts`. A custom domain stays a one-line `base` change plus
a CNAME, so this was not worth blocking Phase 0 on.

## Open questions

- None currently blocking. Phase 1 decides the look, which is the next real fork.

## Phase 0 — what actually shipped

2026-07-16. Vite 8 + React 19 + TS 6 strict, ESLint 10 flat (type-aware), Prettier, the file-size
ratchet, and a Pages deploy on push to `main`. The page is deliberately unstyled — the look is Phase
1's decision and anything designed here would be that decision made in the wrong phase, in the
hardest place to reverse it: already on screen.

Three things the build taught us, recorded because they cannot be re-derived from the tree:

- **`strict: true` is not the whole story.** `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` are off under `strict`, and they are exactly the ones that matter for a
  seat array — without the first, `seats[9].name` on a 2-seat table typechecks fine. Both are on.
- **Tests are a separate TS project** (`tsconfig.test.json`). They are Node code — they spawn `git`,
  read the filesystem, run ESLint's API. Folding them into the app's project meant either denying
  `node:fs` to the guard tests or handing `node:child_process` to the game code, and the second is how
  `logic/` quietly stops being portable to a server.
- **Prettier does not touch `*.md`.** Run on the docs it rewrites `*emphasis*` to `_emphasis_` and
  reflows every table — 176 lines of churn here, no reader better off. This document is an argument,
  not output.
