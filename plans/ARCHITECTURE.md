# The Boardwalk

**Status:** Phases 0–1 shipped 2026-07-16; Phases 2 (data layer), 3 (shell), 4 (economy + progress)
and 5 (multiplayer) shipped 2026-07-17 — live at https://mogar13.github.io/Boardwalk/. Phase 6 (the
five games) is in progress: **Tic-Tac-Toe** (the SDK's smoke test), **Blackjack** (the economy
proof) and **Chess** (the hot-seat proof) shipped 2026-07-17; UNO and Solitaire remain.
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
├── main.tsx, App.tsx, index.css      ← index.css is TWO imports; keep it that way
├── shell/           router, top bar, nav, auth gate
├── ui/              the kit ✅ — Button, Card, Input, Modal, UiRoot, useToast, useConfirm, cx
│                    (ChipRack, Seat… when a game needs them, not before)
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
└── theme/           @boardwalk/theme ✅ — the ONLY file that may name a colour
eslint-rules/        the local plugin ✅ — no-daisyui-classes, no-raw-palette
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
| `useProfile()` | name, avatar, loadout, xp (level is `levelFromXp(xp)`, derived, not stored) |
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
| 0 | ~~**Scaffold**~~ ✅ | Vite + TS strict + ESLint + Prettier + filesize ratchet + Pages deploy. An empty page that's live. |
| 1 | ~~**Theme + kit**~~ ✅ | `@boardwalk/theme`, `src/ui` core (Button, Modal, Toast, Card, Input) + `useConfirm`. The look is decided: **Boardwalk at night**, dark only. |
| 2 | ~~**Data layer**~~ ✅ | One typed Firebase singleton, repo interfaces, the `firebase/*` import lint rule. Auth + profile. Rules ported from v1 — posture unchanged, two departures, and a test that boots the emulator and proves them. |
| 3 | ~~**Shell**~~ ✅ | Router (BrowserRouter + Pages SPA fallback), top bar with bankroll + XP, hub, `registry.ts`, piers. `level` derived from `xp`. |
| 4 | ~~**Economy + progress**~~ ✅ | `useBet`, `reportResult`, stats, achievements, store (avatars), daily rewards, live leaderboard. |
| 5 | ~~**Multiplayer**~~ ✅ | `useRoom`, seats, `localSeatIds`, lobby, chat, presence, lifecycle tests, and the `rooms/`/`hands/`/`chat/` rules Phase 2 deferred. |
| 6 | **The five games** | In progress — Tic-Tac-Toe ✅. See below. |

Phases 0→5 are sequential. Phase 6 is five independent units.

### The five

Chosen for **OS coverage**, not sentiment — each proves a different capability. Swap by taste, but
keep the coverage or the OS ships untested.

| Game | v1 JS | Proves |
|---|---|---|
| **Tic-Tac-Toe** ✅ | 530 | The SDK is cheap. If this isn't ~150 lines, the SDK is wrong. |
| **Blackjack** ✅ | 966 | Betting, casino economy, `reportResult` payouts, dealer hole card. Shipped room-less — its coverage is the economy, not seats. |
| **Chess** ✅ | 1,339 | Pure unit-tested `logic/`, hot-seat, 2-seat online, zero betting. |
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

- **Is DaisyUI a component library here, or just a token system?** Phase 1 found the kit uses
  **zero** DaisyUI component classes — Button, Card, Input and Modal are built from Tailwind
  utilities and semantic tokens, because every one of them needs the glow, the rim, the strike
  easing and the desaturated disabled state that DaisyUI components do not have. So DaisyUI is
  currently earning its place on the token system alone, while shipping its whole component library:
  measured at **141kB of CSS, of which ~100kB is components** (`.menu` alone is 156 rules) that
  `no-daisyui-classes` forbids everywhere except a kit that does not want them.
  `@plugin "daisyui" { include: <matches-nothing>; }` cuts it to **41kB** with every token and
  utility intact — verified, one line, reversible.
  **Not decided in Phase 1**, deliberately: one phase of kit is not enough evidence that no future
  component (a bet slider, a lobby list) wants a DaisyUI base, and flipping it would contradict the
  `src/ui` exemption shipped in the same commit. Revisit at Phase 4/5, when there is evidence. If
  the answer is "token system", the honest follow-up is whether the ~25 lines of `@theme` that would
  replace it are worth the dependency at all.
  **Phase 4 is a data point, and it leans the same way:** the store cards, the leaderboard rows, the
  badge shelf and the daily card were all built from `src/ui` + Tailwind utilities and semantic
  tokens, with **zero** DaisyUI component classes — no component has yet wanted a DaisyUI base. Still
  not flipped, because Phase 5's lobby list is the first component that plausibly might, and that is
  the evidence worth waiting for rather than deciding without.
  **Phase 5 is that evidence, and it settles the lean:** the lobby, the seat list and the chat panel —
  the components singled out above as the ones most likely to want a DaisyUI base — were built from
  `src/ui` + tokens with **zero** DaisyUI component classes, and none wanted one. Across five phases
  of real UI, DaisyUI has earned its place on the token system alone and shipped ~100kB of components
  the ban forbids everywhere. The honest recommendation is now "token system": the one-line
  `include: <matches-nothing>` cut to 41kB, or the ~25 lines of `@theme` that would replace the
  dependency entirely. Left for a phase that is about the bundle, not bolted onto multiplayer.
- **No browser test.** See the `<dialog>` story below. Every guard in the repo is static, and the
  worst bug in Phase 1 was not one a static guard could see. Phase 3 confirmed the shell the same
  way Phase 1 confirmed the kit — a Playwright screenshot of the built page across every route,
  checking `scrollHeight === clientHeight` (the dead-scroll signature) and an empty console. That
  found nothing this time, which is the point: it is a manual pass a person has to remember to run,
  not a guard that fails the build. The bundle also crossed **500kB** at Phase 3 (react-router +
  firebase in one chunk) — not acted on, because `React.lazy` per game in Phase 6 is the code-split
  that answers it, and splitting before there is a second route worth splitting would be guesswork.
  **Phase 5 closed the half of this gap it could.** Phase 3 verified a *mocked* session because
  production refused the sign-up write; Phase 5 built the honest fix it named — `VITE_USE_EMULATOR=1`
  points the app at the local emulators, and `/_dev/lobby` (dev-only) mounts the lobby against a stub
  manifest. The whole room flow — real sign-up, create, seat, AI-fill, chat, leave — was driven
  end-to-end through the emulator with a Playwright pass (zero console errors, `scrollHeight ===
  clientHeight`), which is strictly more than any prior phase verified. It is still a manual pass, not
  a build guard, and that remains the open half.

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

## Phase 1 — what actually shipped

2026-07-16. `@boardwalk/theme` (a workspace package), `src/ui` (Button, Card, Input, Modal,
`useToast`, `useConfirm`, `UiRoot`), and the two lint rules this phase owed —
`@boardwalk/no-daisyui-classes` and `@boardwalk/no-raw-palette` — with 26 fixtures asserting each
fires on the bug and stays quiet on the sanctioned pattern.

**The look: Boardwalk at night.** A dark room lit by two signs. Blue says act, cyan says here,
gold is money and nothing else. (The act colour was originally hot magenta; it was changed to
electric blue by preference. The cost, recorded because it is a real trade: act and here now share
the cool end of the wheel — ~53° apart, not the near-opposite magenta/cyan pair — so they lean on
lightness and chroma to stay distinct, which is why the cyan focus ring is guarded harder than
before.) Dark only — a casino is a dark room, and that is the whole conceit.
The restraint is the design: status colours are flat, surfaces never glow, and exactly two hues in
the palette are allowed to. Neon only reads as neon when most of the page is off.

Five things the build taught us, recorded because they cannot be re-derived from the tree:

- **The palette was generated and measured, not picked.** Every value is OKLCH, and the first draft
  was wrong in ways no eye would have caught in review: cyan at H199 was **outside sRGB** (browsers
  clamp silently — you get a duller colour on every screen and no error anywhere), five `*-content`
  darks clipped, and `accent` and `warning` came out **byte-identical gold**, which would have
  quietly destroyed "gold means money" the first time a toast fired. They now sit 24° apart. The
  final set: all 23 tokens inside sRGB, every foreground ≥4.5:1 on all three surfaces, every label
  ≥4.5:1 on its own fill. A palette is a set of relationships — nudging one hue "to taste" breaks
  the ones you weren't looking at, so re-run the checks.

- **Real neon is four optical events, not a tinted drop shadow.** A tube edge, a core that is
  *whiter* than the gas (light saturates — look at a real sign), a wide bloom at full hue, and a
  very dim atmospheric wash. The last one is the one everyone omits and the one doing the work: it
  is the sign lighting the *room* rather than being pasted onto it. Same logic in the page
  background (two off-screen signs) and in the hero, where the letters are `base-content` and every
  bit of the glow colour lives in `text-shadow`.

- **`display: grid` on a `<dialog>` silently defeats the platform.** The UA closes a dialog with
  `dialog:not([open]) { display: none }`; a bare `grid` utility beats it. Every closed modal became
  a 1280×900 absolutely-positioned transparent element — ~965px of dead scroll on every route,
  hit-testing clicks, invisible. It typechecked, it linted, it passed all 33 tests, and it rendered
  correctly when open. **Only a screenshot of the built page found it.** `open:grid` hands display
  back to the platform. This is the origin of the "no browser test" open question above.

- **An object spread does not merge ESLint visitors, it replaces them.**
  `{ ...classAttrVisitor(cb), JSXAttribute(n) {…} }` deleted the first handler, so `no-raw-palette`
  shipped enforcing nothing but inline styles — while reporting success, which is this repo's
  signature failure mode. The fixtures caught it on the first run; nothing else would have. The
  helper that made it possible was then deleted rather than documented: it saved four lines and hid
  a whole failure mode inside them.

- **A rule that bans a word must be able to say the word.** `no-daisyui-classes` scans every string
  for hyphenated component classes and promptly flagged its own error message, which explains the
  ban by quoting `btn-primary`. `eslint-rules/` and `tests/` are exempt — neither renders UI, and
  the alternative was the `eslint-disable` that would also hide the times the rule was right.

**Not built, on purpose:** no router, no icon set, no `<Select>`/`<Tooltip>`/`<ChipRack>`. The page
at the URL is a style guide, not a hub — the hub is Phase 3, and building it here would have been
four phases of decisions made in one afternoon. The kit gets its next component when something
actually needs one.

## Phase 2 — what actually shipped

2026-07-17. `src/system/repo` (the seam), one Firebase singleton, `AuthRepo` + `ProfileRepo`, Auth and
profile behind Zustand, `@boardwalk/no-firebase-imports`, and `database.rules.json` — with 61 new
tests, including 28 that boot the RTDB emulator and run the real rules file against real clients.
The Firebase project is `boardwalk-fca02`, its own, per the decision above.

### The phase description said "rules ported from v1 unchanged". Two departures, argued

The instruction is right about the thing it is protecting — v1's *posture* is the most mature part of
it and was paid for with two shipped backdoors. It is not right as a literal instruction, because v1's
rules file also contains its least mature parts.

**1. v1's `chat`, `global_chat` and `$room` rules are not here.** All three are `".write": true`, and
the `$room` wildcard (`/(_rooms|_hands|_hand_incoming)$/`) is world-readable and world-writable
besides. Porting them "unchanged" would have shipped three open subtrees guarding nodes this app does
not have. A permissive rule for a node nothing writes is not neutral — it is an open door with nothing
behind it yet. They land in Phase 5, with rooms and chat, and get tightened on the way in. This is the
principle `eslint.config.mjs` already follows (a rule lands in the phase that creates its subject),
applied to the file where getting it wrong is most expensive. The root's `".read": false, ".write":
false` is what makes "not written yet" and "locked" the same state, and there is now a test that says
so rather than a comment.

**2. `usernames/` is pinned to its exact field set.** v1 pins `leaderboard` with `$other: false` and
does not pin this node — its `.validate` only requires `uid` to exist, so a client could write a real
email address into a world-readable index and nothing would refuse it. The synthetic-address design
exists precisely to keep addresses out of there. CLAUDE.md already said to validate the exact field
set on public projections; `usernames/` is one, and v1 not pinning it is an inconsistency in v1
rather than a decision. Pinning it is what makes "real emails never enter the public index" a
guarantee instead of a habit.

Both departures are strictly *more* closed than v1. Neither touches the posture: Auth owns
credentials, `admins/<uid>` is the only privilege, `leaderboard/` is a rule-validated public
projection of an unreadable private record, and no client-side password comparison exists to
reintroduce.

### Five things the build taught us, recorded because they cannot be re-derived from the tree

- **A rules file is this repo's signature failure mode with a lock on it.** It is prose that looks
  like enforcement. No compiler on this machine reads it, ESLint cannot see it, `tsc` cannot see it,
  and a mistake in it reports success *by doing nothing*. It is simultaneously the one file where
  being wrong is most expensive and the one where every existing guard is blind. So it got the
  emulator test, loading the real file — and the test earned itself immediately: removing
  `leaderboard`'s `$other: false` turns exactly two tests red, which is the falsification that makes
  the other 26 worth believing. v1 has no test like this and shipped two backdoors.

- **The `firebase/*` ban looked like four lines of `no-restricted-imports` and is a trap.** That rule
  is already configured for the `../../**` alias ban, and ESLint replaces a rule's options wholesale
  rather than merging them — so the directory exemption the boundary needs
  (`{files: ['src/system/repo/firebase/**'], rules: {'no-restricted-imports': 'off'}}`) would have
  silently switched the alias ban off in the directory doing the most import plumbing. That is Phase
  1's "a spread replaces, it does not merge" defect wearing a config file as a costume. A local rule
  cannot collide with another rule's options and carries its own exemption path, so there is no knob
  to get wrong.

- **Banning the SDK alone would have been theatre.** A game that cannot spell `onValue` can still
  spell `firebaseProfileRepo` and be welded to Firebase just as hard, through a nicer-looking door.
  So the rule bans two things, and the second needs real path resolution rather than a string match:
  from `src/system/`, the escape is `../repo/firebase/profileRepo` — which contains no
  `system/repo/firebase` substring and is *deliberately allowed* by the `../../**` ban, because one
  `../` is a sibling and a sibling is a real relationship. A regex reads that as clean.

- **`profile.isDev` is not a field v2 has.** v1's was self-writable and granted nothing, which reads
  like "harmless" and was not: chat trusted a client-asserted `isDev` on every message, so anyone
  could mint themselves a dev badge. A forgeable field that grants nothing is a thing the next
  feature believes. Deleting the field — rather than documenting "don't trust it" — is what makes
  that unspellable, and `$other: false` on the profile node means the server refuses one now.

- **v1's worst rough edge cost three lines to fix, and the fix is a read.** Sign-up is four writes
  (Auth user, `usernames/`, `users/`, `leaderboard/`) with no transaction spanning them, because none
  is possible — RTDB rules cannot reach an Auth user, so a failure after step one cannot be rolled
  back. v1's answer is an honest error and an account that stays broken forever. Ours heals: the
  store recreates a missing record on the next sign-in. It is safe for exactly one reason, and it is
  worth stating because it is the reason not to "simplify" it — `ProfileRepo.load` returns `null`
  **only** on an authoritative "the node is not there". A network failure throws. A `null` that also
  meant "offline" would overwrite a real account with a fresh $5,000 every time someone's wifi
  dropped.

**Not built, on purpose:** no `RoomRepo`, no `ChatRepo`. The repo-layout sketch above lists all three
and writing the other two would have taken ten minutes. That is exactly v1's `validateAndCommit()` —
an interface designed before a caller existed, still sitting there with zero adopters while all six
betting games double-clamp by hand. `RoomRepo` gets designed by `useRoom` needing it in Phase 5,
which is the only design input that has ever worked. Also absent: `stats`, `achievements`, `rewards`,
`loadout`, `chatColor`. Each lands with its consumer and its `.validate` line in the same commit.

**The gap Phase 2 leaves, named rather than papered over.** `database.rules.json` is deployed by hand.
Nothing in CI does it, so the file in this repo can silently stop matching production — and a rules
file that does not match production is worse than none, because it reads like the truth. The tests
prove the file is *right*; they cannot prove it is *deployed*. Fixing it needs a service account in
CI, which is a real secret (unlike the web config), and that was not worth blocking the phase on. If
it is ever forgotten once, that is the argument.

## Phase 3 — what actually shipped

2026-07-17. The shell: `react-router-dom` 7 (`BrowserRouter`), `src/shell` (the frame, the auth
gate, the top bar, and the routed pages — hub, store, leaderboard, profile, play, not-found),
`src/games/registry.ts` (the typed catalogue and the pier map), the Pages SPA fallback, and the
deletion of the stored `level` field in favour of a derived one — with 17 new tests. App.tsx, the
Phase 1–2 style guide, is retired to a route table; the kit it demonstrated now dresses the shell.

### `level` was a stored field, and Phase 3 was the first code to read it — so it was deleted

Phase 2 shipped `xp` **and** `level` on the profile, and the top bar is the first thing that renders
either. Rendering them side by side is what made the redundancy obvious: `level` is a pure function
of `xp`, so storing both is two sources of truth for one fact — the exact shape of half the v1 defect
table (`loadout.color` written by the hub and read by nothing; `gameId` drifting from `games.json`).
The concrete failure was Phase 4's, waiting to happen: every XP-award site would have had to write
both fields, and the first one that wrote `xp` but forgot `level` mints an account whose badge and
whose progress bar disagree forever. The fix is not "remember to write both" — it is that there is
nothing to forget, because `level` is `levelFromXp(xp)` computed in one pure, unit-tested module and
stored nowhere. `$other: false` in `database.rules.json` now *refuses* a write that includes a
`level`, so the deletion is enforced at the server, not merely done — and the rules test asserts that
refusal, because removing two lines from a rules file otherwise looks like a no-op.

### BrowserRouter on a static host needs a 404.html, and the copy is where it goes wrong

GitHub Pages has no server-side rewrite, so `/Boardwalk/play/blackjack` typed directly asks Pages for
a file that does not exist and gets Pages' own 404. The fix is the standard Pages-SPA trick —
`dist/404.html` is a byte-for-byte copy of `index.html`, which Pages serves for any unmatched path,
booting the app so react-router can resolve the route. The alternative, `HashRouter`, would put a `#`
in every URL forever, and Phase 5's shared room-code links are the ones that make that cost real. The
copy itself is `copyFileSync` (byte-identical by construction); the failure mode is the *silent* one
this repo dreads — the copy not running, or `index.html` not where the plugin looked, leaving a green
build and broken deep links discovered by a user. So `scripts/spa-fallback.mjs` is a pure function
with two callers that cannot see each other (the Vite plugin and its test, exactly like `config.ts`),
and it reads both files back and **throws** if they differ or are missing, so the build goes red
rather than the deploy going quietly half-broken.

### The hub is empty on purpose, and that was the hardest call in the phase

The registry ships with **zero games**, and the hub renders each pier with an honest "opening soon"
rather than five "coming soon" cards. Five stub cards would have made the hub demonstrable — but a
rendered list of five promised games is a game checklist whether it is called one or not, and the
most important line in this document forbids exactly that. So the registry is the typed *structure*
(the `GameManifest` and `Pier` types, the derive-from-`id` guarantee, the three piers as the
boardwalk's map) and none of the *content*; a game appears in the same commit that builds it, Phase 6,
and the hub reads the registry rather than hardcoding a catalogue, so it needs no change when one
lands. Also deliberately absent: any `React.lazy`/`Suspense` loader — a lazy import with no component
to load is `validateAndCommit()` again, an abstraction built before its caller. How a manifest
attaches to its component gets decided by the first game needing it.

**Not built, on purpose:** the store and leaderboard are honest placeholders naming their phase, not
features. The `leaderboard/` node is world-readable and live *today*, so a leaderboard is genuinely
buildable now — and it is held for Phase 4 because it ranks by `wins`, a stat that arrives with its
writer then, and a leaderboard that can only rank by bankroll would be built to be rebuilt. Profile
editing is deferred the same way: the page is the display, and it says so.

**The gap Phase 3 leaves, named rather than papered over.** The verification of the signed-in shell
(top bar, hub, profile meter) was done against a *mocked* session, because the deployed
`boardwalk-fca02` project refused the sign-up write with `permission_denied` — the hand-deployed
rules (or auth config) on production, not this repo's code, and the same "deployed by hand, nothing
in CI" gap Phase 2 named. So the screenshots prove the shell renders a session *correctly*; they do
not prove production will *grant* one. Wiring the app to the local emulator behind a dev-only env
flag would let the whole flow be driven without touching production — that is the honest next step,
and it was not worth blocking the shell on.

## Phase 4 — what actually shipped

2026-07-17. The economy and progress: `src/system/economy` (`useBet`, `reportResult`, `GameShell`
over pure `bet.ts`/`result.ts`), `src/system/progress` (`stats`, `achievements`, the leaderboard
reader), `src/system/store` (avatars), `src/system/rewards` (daily), a `mutateProfile` writer on the
auth store and a `save` on `ProfileRepo`, four new pinned profile fields plus `wins` on the
leaderboard, and the four pages that were placeholders — with 67 new tests (180 total).

### The scope call, made explicitly: build the game-facing economy now, or defer it with the games?

`useBet` and `reportResult` have no runtime caller until the Phase 6 games, and this repo's whole
temperament is against an interface built before its caller — it is why `RoomRepo` was kept out of
Phase 2. The counter-argument won: Phase 4 is the *assigned* economy phase (Phase 5 multiplayer and
Phase 6 games both sit on top of it), so building it here is on-schedule, not speculative — the
`RoomRepo` case was *pulling future work early*, which is a different thing. The mistake to avoid is
`validateAndCommit()`: shipping an unadopted interface. So the mitigation is structural, not a
promise. **The correctness lives in pure, exhaustively-tested logic** (`applyResult`, `validateBet`,
`bumpStats`, the achievement predicates, `claimDaily`, `applyPurchase`) — the part that is provably
right without a game. **The write path gets real adopters in this very phase**: store purchases,
the daily claim, and name edits all go through the same `mutateProfile` the game hooks use, so the
writer is exercised by three shipped features, not zero. The hooks (`useBet`/`reportResult`) are thin
wrappers over the tested logic, which is where the repo already puts correctness — pure modules,
hookless.

The one thing deliberately *not* pre-decided, held to Phase 6: how a manifest attaches to its
component (`React.lazy`). `GameShell` provides the economy *context* from a manifest — which
ARCHITECTURE.md already specified — but the play route still mounts "no such game", because the
component *loader* is the abstraction whose caller does not exist yet. Context and loader are
separable, and only the loader waits.

### `reportResult` is one function you cannot split — the whole OS pointed at one bug

v1's failure was structural: `recordWin(gameId)` took one argument, bankroll was a plain
`SystemUI.money` setter, so 40+ sites did the money by hand and *then* recorded a win, and the payout
handed to the record function fell on the floor. `applyResult` is the fix as a single return value:
it computes the next bankroll, XP, stats and achievements together and hands them back as one object,
and `mutateProfile` persists that object in one write. There is no intermediate state where three of
the four moved. `big_win` — "win $1,000+ in one bet", which shipped in v1 with *zero* unlock
sites because nothing ever knew a payout — has a real predicate and a test proving it fires on the
$1,000th cent and, critically, on **net not gross**: a $600 payout on a $500 bet is a $100 win, and
the test asserts it does *not* fire. That distinction is the exact thing v1 could not represent.

Five things the build taught us, recorded because they cannot be re-derived from the tree:

- **A cosmetic has to have a reader, or it is `loadout.color`.** The store sells avatars and nothing
  else, because an equipped avatar is read *today* by the top bar and the profile card, while a card
  back or a felt has no reader until a game draws one. Selling card backs now would rebuild the exact
  dead cosmetic the v1 defect table catalogues — a field written by the store and read by nothing.
  They land with the game that renders them. This is the same "reader with no reader is
  `validateAndCommit()`" test the leaderboard passed and `RoomRepo` failed, pointed at cosmetics.

- **The two-call money model needs the wager in both calls, and that is not redundancy.** `useBet`'s
  `commit()` deducts the stake; `reportResult` credits the gross payout. So the net for `big_win` is
  `payout − wager`, and `reportResult` is *told* the wager rather than inferring it from a coupling to
  `useBet` — two explicit parameters, no hidden channel between the hooks. A non-betting game
  (`{ outcome: 'win' }`) passes neither and still earns XP, a stat, and a non-money badge, which is
  why it is `reportResult` and not `recordPayout`.

- **`Date.now()` cannot run during render, and a `useState` initializer is the escape.** The new
  `react-hooks` rules are strict: an impure call in the render body is an error, and so is a
  synchronous `setState` in an effect. The daily card needs the current day to decide "claimable";
  the clean answer was `useState(() => Date.now())` — a once-at-mount snapshot the linter accepts —
  not an effect that sets state (which the *other* new rule forbids). Two rules that look like they
  box you in actually point at the one correct pattern.

- **A fire-and-forget action wants a `void` API, not a `Promise` one.** `useStore().buy` opens a
  confirm and writes — genuinely async — but a click is not a thing a caller awaits, and typing it
  `=> Promise<void>` made `no-misused-promises` fire the moment it was passed to `onClick`. Wrapping
  the async work in an inner IIFE and returning `void` is not hiding the promise; it is stating that
  the *public contract* is fire-and-forget, with every failure toasted so nothing is lost by not
  returning one.

- **`formatMoney` was mis-housed, and the economy's error messages found it.** It lived in
  `useProfile.ts`, which imports the Zustand store — so pure `bet.ts` could not say "Table max is
  $500" without dragging the store into a unit test. It never needed the store; it is arithmetic and
  `toLocaleString`. Moving it to a pure `money.ts` (re-exported from `useProfile` so no caller
  changed) is the same "pure logic lives in hookless modules" rule, discovered from the other end: a
  formatter that a pure function wants to call is, by that fact, pure.

**Client-authoritative money, and what the rules actually guarantee.** `mutateProfile` is optimistic
— it sets the store, persists, and reverts on rejection — and the money is client-authoritative
exactly as v1's was; the repo boundary is what keeps BACKEND_PLAN.md's server-authoritative version a
change to `./firebase/*` rather than a rewrite. So the Phase 4 rules pin the *shape* of every new
field (a stat is a whole non-negative number, an inventory entry is exactly `true`, `daily` has two
keys and no third) but **not the amounts** — a determined client can still write itself a bigger
bankroll, the same as v1. That is named here rather than papered over: the rules make a *malformed*
economy record impossible; only the backend makes a *dishonest* one impossible, and that is a later
phase. Phase 2's `REFUSES-A-SIXTH-FIELD` test predicted this moment — it asserted `wins` was refused
*because it was not yet a field* — and Phase 4 flips that assertion in the same commit that adds the
rule, which is the test staying honest about the node's real shape.

**Not built, on purpose:** `useSeats`, `localSeatIds`, any `mode` branching — all Phase 5, and
`GameShell`'s context carries the manifest and pointedly not an empty `seats: []`, which would be the
interface-ahead-of-caller mistake in miniature. No card-back or felt cosmetics (no reader yet). No XP
that scales with the wager — flat by outcome, so the casino is not the only source of levels and the
no-stakes games are not second-class. The leaderboard reads the whole node and sorts client-side
rather than an `orderByChild` server query, because the ranking has a tiebreak a single-child query
cannot express; at this scale that is correct, and the honest note is that a large board wants an
`.indexOn` and a server ordering — a change behind `LeaderboardRepo`, touching nothing else.

**The gap Phase 4 leaves.** The same one Phases 2 and 3 named, now with more riding on it:
`database.rules.json` is deployed by hand, and Phase 4 changed it — four new field validators and
`wins`. The tests prove the file is *right*; they cannot prove it is *deployed*, and an economy
governed by stale production rules is worse than one governed by none. Deploy the rules
(`npm run rules:deploy`) in the same breath as shipping this, and if that is forgotten once, the
CI-with-a-service-account step is the fix Phase 2 already argued for.

## Phase 5 — what actually shipped

2026-07-17. Multiplayer: `src/system/room` (`useRoom`, `useSeats`, `<RoomProvider>`, the lobby, and
the pure `seats`/`ordering`/`lifecycle` logic), `src/system/chat` (`useChat`, `messageKey`), the
`RoomRepo`/`ChatRepo` interfaces and their Firebase implementations, the `rooms/`/`hands/`/`chat/`
security rules Phase 2 deferred, an emulator-in-dev flag, and a dev-only lobby harness — with 56 new
tests (236 total), all of which ran green, plus a real end-to-end browser pass against the emulator.

### The interface-ahead-of-caller tension, resolved the Phase 4 way

Multiplayer is built a phase before any game consumes it, which is exactly the shape this repo keeps
refusing (`validateAndCommit()`, `RoomRepo`-in-Phase-2). It is allowed here for the same reason Phase
4's economy was: this is the *assigned* phase, not work pulled early. The mitigation is structural,
not a promise — **the correctness lives in pure, exhaustively-tested logic** (`claimSeat`,
`releaseSeat`, `localSeatIds`, `aiSeatsToDrive`, the seq reconcile, `teardownPlan`, `messageKey`),
the part provably right without a game — and **every repo method has a caller in this same commit**:
the lobby creates, seats, chats, starts and leaves, so `RoomRepo`/`ChatRepo` were designed by the
hooks that needed them, the only design input that has ever worked here.

### Five things the build taught us, recorded because they cannot be re-derived from the tree

- **RTDB rule cascade is the trap that shaped the whole node layout.** The first-draft rules put
  hidden hands under `rooms/.../private/<seat>` with an owner-only `.read`, and a broad `.write` at
  the room for the host. Both were wrong for the same reason, and the emulator test caught both:
  **read and write access CASCADE downward and cannot be revoked deeper.** A room is
  signed-in-readable so participants can see the board — which means a private node *under* it is
  readable by every signed-in user, owner-only `.read` or not. And a host with a broad room `.write`
  can write every seat and every presence marker, turning the tight child rules into dead letters. So
  hidden information moved to a **separate top-level `hands/`** node with no permissive ancestor, and
  the room-level write became **delete-only** (`!newData.exists()`) — it authorises exactly one thing,
  the host removing an emptied room, and grants nothing that leaves data behind. Create became a
  multi-path *leaf* write, each field authorised by its own rule. Two tests went red on the first run
  ("expected to fail, but it succeeded"), which is the cascade being discovered the only way a static
  tool here could not have shown it.

- **`seq` had to move atomically with the state it orders, and that decided where it lives.**
  `patchState` bumps state and seq together, and the only atomic tool is a transaction — but a
  transaction reads the node it writes, and a client CANNOT read another seat's private data. A
  transaction over the whole room would read others' hidden state as absent and write it back as
  deleted. So the transaction is scoped to `state`, and seq lives *inside* that scope (`state = { seq,
  data }`) rather than in `meta`, so it can move with the data. `readRoom` lifts it back into
  `meta.seq` so the domain type still reads the way the OS describes it. The rules then validate
  `state/seq` strictly-increasing, so UNO's clock-skew fix is enforced at the server, not just
  observed by the client.

- **Defense in depth hid a falsification.** Breaking the chat `uid` `.validate` did not turn the
  forged-author test red — because the `$msgId` `.write` *also* pins `uid === auth.uid`, so the write
  is refused before validation runs. That is the right design (two independent gates on the one thing
  that must not be forgeable), but it means "falsify the guard" needs both broken. The single-gated
  `seq` monotonic rule was the honest falsification target, and breaking it turned exactly its test
  red.

- **`useSeats` does not invent `currentSeat`, and that is the interface-ahead-of-caller rule applied
  to our own SDK.** ARCHITECTURE.md's hook sketch lists `currentSeat`, but whose turn it is is GAME
  state (`TPublic`) — every game tracks it differently and some have no turn at all. So `useSeats`
  ships the local-attribution logic (the actual OS value) and exposes `isMyTurn` as a PREDICATE the
  game calls with its own current seat, rather than baking a turn-cursor convention into room infra
  before a game needs one. The first game to want a shared cursor is the design input for adding it.

- **The emulator-in-dev flag is the honest fix Phase 3 named, and it verified more than any phase
  before.** Phase 3 could only screenshot a *mocked* session because production refused the sign-up.
  `VITE_USE_EMULATOR=1` + `/_dev/lobby` let the whole flow run against a real emulated backend — real
  auth, real rule-checked create/seat/chat, real presence and teardown — driven with Playwright to
  zero console errors and no dead-scroll. The lobby also settled the DaisyUI open question: the
  component most likely to want a DaisyUI base used none.

**Not built, on purpose:** no game (Phase 6), and no generic board-game engine — five games is still
not enough evidence to know what they share, and here there are zero. No server-arbitrated seats or
server-authoritative state: money and rooms stay client-authoritative, the claim-then-verify race is
detected not arbitrated, and BACKEND_PLAN.md's Phase C is where that changes — a rewrite of
`./firebase/*`, touching no hook. The dev harness's stub manifest is a fixture, not a registry entry:
the registry stays empty until a real game lands.

**The gap Phase 5 leaves.** The same hand-deploy gap Phases 2–4 named, now with the most riding on it
yet: `database.rules.json` grew three whole subtrees (`rooms/`, `hands/`, `chat/`), and a room whose
rules are stale in production is a hidden-information leak, not just a malformed record. Deploy the
rules (`npm run rules:deploy`) in the same breath as shipping this. And the browser verification,
though it now runs against a real backend, is still a manual pass a person must remember — a real
browser/integration guard in CI remains unbuilt.

## Phase 6 — Tic-Tac-Toe (the first of five)

2026-07-17. The SDK's smoke test, and it passed: `src/games/tic-tac-toe` (manifest, pure
`logic/ticTacToe.ts`, `Board.tsx`), the component loader the registry deferred through five phases,
the `<Lobby>` `children` seam, and the two lint rules Phase 6 owed — `@boardwalk/no-impure-logic`
and `@boardwalk/no-cross-game-imports` — with 18 game-logic tests and 7 new lint-guard assertions
(262 total, all green). The game is a manifest, a pure rules module, and a board that reads three hooks; the
lobby, the room, the seats, the ordering and the economy are all the OS's. ARCHITECTURE.md's bet —
"if this isn't ~150 lines, the SDK is wrong" — held: the two glue files (`TicTacToeGame.tsx`,
`Board.tsx`) are ~130 lines together, and every hard thing is in the OS or in tested pure logic.

### The loader question, answered by its first caller

Phases 0–5 all refused to build the component loader (`registry.ts`, `Play.tsx`, `GameShell` and
`useSeats` each say so): a `React.lazy` with no component to load is `validateAndCommit()` in
miniature. Tic-Tac-Toe is that caller, and the answer is the smallest thing that works. A
`RegisteredGame` is `{ manifest, Component }` where `Component = lazy(() => import('./…Game'))` is
built ONCE at module load — the manifest imported eagerly (the hub needs every name and pier before
any component fetches), the component lazily (its own chunk: `TicTacToeGame-*.js`, 4.5kB, the
per-game code-split Phase 3's 500kB note wanted). `lazy` lives in the registry, not the play route,
because `react-hooks/static-components` forbids minting a lazy wrapper in render — a per-render
wrapper is a new component type each tick, which remounts and tears down the room subscription. The
registry is the module that already runs once and already names every game.

The composition is then three layers, each owed to every game and no more: `Play.tsx` wraps the
lazy component in `<GameShell manifest>` (the economy context) and `<Suspense>`, passing only
`onExit`; a multiplayer game renders `<Lobby manifest onExit>` and hands its board in as `children`,
which the lobby swaps in for the seat list once `status === 'playing'`. The board is thus mounted
inside the lobby's single `<RoomProvider>`, so its `useRoom`/`useSeats`/`useGame` reach the one
subscription without the game registering anything — the reason no game can leak a listener is still
structural, now proven by a game.

### The bug only a browser found — and it was exactly the kind the docs promised

Every static guard was green — `tsc`, ESLint, 18 logic tests, the production build — and the game
was broken. The board never rendered: `PAGEERROR: Cannot read properties of undefined (reading
'map')`, caught only by driving the built app against the emulator with a headless Chrome (real
sign-up, AI table, seat, start, play), the same manual browser pass Phases 1/3/5 used and the same
class of bug Phase 1's `<dialog>` scroll was.

The cause is a RTDB fact no type system encodes: **RTDB drops null children.** The board was
`Cell = Player | null` with empty = `null`, so the host's opening state wrote `board: [null × 9]` —
an all-null array is an empty node, which RTDB deletes — and every client read `state.board` back as
`undefined` and crashed on `.map` before a single cell drew. It typechecked (the wire type and the
domain type were the same `Cell[]`), it unit-tested (the pure logic never round-trips through a
database), and it built. The fix is a wire-safe empty sentinel: `EMPTY = -1`, which `0` (a real
seat) is not, so the board is a fixed-length array of numbers that survives the round trip. The
lesson is the one already in this document, paid for again in a new place: the wire shape and the
domain shape are not automatically the same, and the gap between them is invisible to every tool here
except a real backend. (This is also the argument, made once more, for the browser/integration guard
in CI that Phase 5 left unbuilt — it would have caught this without a person remembering to look.)

### The house is perfect on purpose

`bestMove` is minimax, not a heuristic — Tic-Tac-Toe is a solved draw, so the house never loses and
a human can at best tie it. Two reasons over a heuristic: it is the honest result for the oldest
table on the boardwalk, and (the load-bearing one) it is exactly specifiable, so the tests assert it
*takes* an open win, *blocks* a forced loss, opens centre, and draws against itself — rather than
eyeballing "plays alright". Ties among equal-value moves break by a centre→corner→edge rank, which
changes no outcome but makes play deterministic (so the tests can pin "empty board → 4") and
natural-looking. The house drives its seat through `aiSeatsToDrive` (host-only), the Phase-5 seam
for AI-as-occupant — an online guest never computes the bot's move, so no human is ever prompted to
play the computer's hand (v1's bug).

**Not built, on purpose:** hot-seat for Tic-Tac-Toe. The manifest offers `ai` and `online` only;
hot-seat (one screen, two humans) is Chess's assigned coverage, and adding it here would test the
same `sharedScreen` path twice while leaving this game's question — "is the SDK cheap?" — no better
answered. It also surfaced a real open question for whoever builds it: the `SeatList` "Sit" button
gates on `mySeatIndex === -1`, so one account cannot claim two seats — hot-seat needs a way to seat
a second local human that does not yet exist, and Chess is the design input for it. No generic
board-game engine, and no shared game code hoisted (there is nothing to hoist from one game).

**The gap Phase 6 (so far) leaves.** The browser pass that found the null-board bug is still a manual
one — the CI browser guard Phases 1/3/5 all named remains the honest missing piece, and it is now the
guard that would have caught a shipped-broken game rather than a cosmetic. And the hand-deploy rules
gap persists, though Phase 6 did not touch `database.rules.json` (Tic-Tac-Toe adds no new node — it
lives under the existing `rooms/`/`state/` rules), so nothing new needs deploying for this game.

### Phase 6 — Assets + Audio OS (Blackjack prep)

2026-07-17. Before the first *betting* game, the two things the SDK still owed a card-and-chips
casino: **sound**, and **card art**. `useAudio()` had been a promise in the hook table since the
sketch; it is now `src/system/audio` — `sounds.ts` (a pure role→file registry), `audioStore.ts`
(a Zustand mute flag, `localStorage`-persisted and cross-tab `storage`-synced), `engine.ts` (a
guarded `HTMLAudioElement` cache with browser-unlock-on-first-gesture), and the `useAudio` hook —
plus a top-bar mute toggle and `src/system/cards/cards.ts` (`cardSrc`). The card decks, chips and
curated SFX were staged into `public/` from the CC0 Game-Shack trove. 271 tests (9 new); Blackjack
is the caller that consumes it.

Three things worth recording:

- **A sound role is v1's `tracks` map made typed, and the win is the same as `gameId`.** v1's
  `SystemUI.playSound('cardz')` failed silently — the string named nothing and nothing happened.
  Here a game names a `SoundName`, so a typo is a compile error, and the filename is an asset detail
  behind the role (a random take from a pool per play, which is what stops a rapid deal sounding
  like a machine gun — v1 discovered that too, and arrayed `card`/`chipStack` for exactly it). The
  registry being pure data is what lets `tests/audio.test.ts` prove every role resolves to a file
  **on disk** — the `loadout.color` failure (a manifest entry read by, or pointing at, nothing)
  caught for assets, which no type system sees because a filename is a string however wrong.

- **A pure module that reads `import.meta.env` splits the two tsconfigs, and that is the tension in
  miniature.** `cardSrc` builds a base-path-aware URL from `import.meta.env.BASE_URL`, so it is
  browser-coupled — fine for system UI infra (it is *not* a game's `logic/`, which the impure-import
  lint still fences). But a test importing it pulls it into `tsconfig.test.json`, the Node project,
  which does not include `src/vite-env.d.ts` and so typed `import.meta.env` as absent — a phantom
  error on code the app project checks clean. The fix is one line (`types: ['node', 'vite/client']`
  on the test project), and the lesson is the repo's own `config.ts`-takes-`env` rule seen from the
  other side: the moment a shared module reaches a build-time global, the Node test lane has to be
  told the global's type, because vitest supplies its *value* at runtime but not its shape to `tsc`.

- **Curated, not dumped — the checklist rule applied to assets.** The Game-Shack trove is ~18MB of
  cards, chips, piece sprites, jingles and dice; committing it wholesale would be the asset form of
  "port the rest of the games". Only the in-use subset is staged (a standard deck + backs, the UNO
  set for its later game, chips, ~12 SFX), and next game's art arrives with next game. Everything is
  CC0; `public/audio/CREDITS.md` records the provenance because credit is appreciated, not required.

**The gap this step leaves.** Playback itself is not browser-verified end-to-end here — the tests
prove the files exist and resolve, and a dev-server pass confirmed Vite serves every asset at the
`/Boardwalk/` base with the right content-type and the top bar renders the toggle, but *hearing* a
sound fire on a real gesture lands when Blackjack drives `play('deal')`. That is the browser pass
the memory recipe calls for, owed at the game, not the infra.

## Phase 6 — Blackjack (the economy proof, and the first room-less game)

2026-07-17. `src/games/blackjack` — a manifest, a pure `logic/blackjack.ts` (deck, ace-soft
`handValue`, the dealer's fixed strategy, the settle matrix, the integer-safe 3:2 payout, and a pure
reducer), a `Hand` that draws cards through `system/cards`, and a `Table` that runs the betting loop
over `useBet`/`reportResult`/`useAudio` — with 26 logic tests (297 total). The economy was driven
end-to-end in a real browser against the emulator: 14 hands, every bankroll delta matching the shown
result to the cent, wagers deducted and payouts credited, all card art loaded, zero console errors.

### The scope call: Blackjack is single-player and opts out of rooms

The ARCHITECTURE sketch drew Blackjack with `seats: { min: 1, max: 5 }` and `modes:
['ai','hotseat','online']` — a multi-seat table. It shipped instead as `modes: ['solo']`, one seat,
no room. The reasoning is the coverage matrix, which is the authoritative scoping doc over the
hook/manifest sketches (the hook table already deviated once — `useSeats` has no `currentSeat`).
Blackjack's assigned coverage is **the casino economy**: betting, the 3:2 natural, `reportResult`
payouts, the dealer hole card. None of that needs multiplayer — you play the house, not other
players, and the dealer is the bank, not a seat. Multiplayer with private hands is UNO's coverage,
and opting out of rooms is Solitaire's; building a 5-seat shared-shoe table here would have
duplicated both and dragged in the hidden-shoe problem (a visible public deck leaks the next card)
for no coverage gain. So Blackjack is the first caller of the room-less seam `Play.tsx` always
described ("a solo game just renders") — it mounts its board straight into `<GameShell>`, drives a
local `useReducer`, and the dealer's hole card is hidden the honest simple way: a face-down card in
local state, revealed on stand, not a networked-privacy trick. Solitaire will confirm the same seam.

### `'solo'` became a real manifest mode, and the lobby had to be told it is not one of its own

Adding `'solo'` to `GameManifest['modes']` is the kind of shared-type change this repo is wary of,
but it has two real callers (Blackjack now, Solitaire later) and it is the honest name for "no room",
so it is a mode and not a per-game string. The tension it exposed: `RoomIdentity.mode` is the three
*multiplayer* modes (`'ai'|'hotseat'|'online'`), and the lobby's mode state was typed off
`manifest.modes[number]` — which now includes `'solo'`, a mode the lobby cannot honour. The fix
states the boundary that was always true: the lobby filters `'solo'` out (`roomModes`), so its mode
type stays the three room modes and a mixed-mode game never renders a "solo" button in a lobby. A
solo-*only* game never reaches that code at all — it has no lobby — so the filter is belt-and-braces
for a future game that offers both.

### The browser pass verified the thing static tests structurally cannot: that money moves

Tic-Tac-Toe's browser pass found a wire bug; Blackjack's had a different job. The payout math is
unit-tested to the cent, but "does `commit()` actually deduct and `reportResult` actually credit,
against a real profile write" is a claim only a running app and a real backend can settle — the same
reason the economy is client-authoritative-but-rule-shaped rather than provable in a unit test. So
the driver played 14 hands and asserted each full-hand bankroll delta equalled the result's expected
net (`-wager` on a loss, `+wager` on a win, `0` on a push, and the wager off then the payout on),
watching 4 wins and 2 pushes credit correctly. A dealt natural never came up in 14 hands (~4.8% a
hand), so the 3:2 *credit* path is proven only by unit test and the even-money credit by browser —
noted honestly rather than claimed. The `parseInt`-drop bug that names this game in the v1 table is
killed at the type level (integer cents throughout) and at the unit level (`payoutCents('blackjack',
505)` is asserted to be an exact integer).

**Not built, on purpose:** splits and insurance (the two most complex blackjack branches, and neither
adds economy coverage the base loop and double-down do not — double-down already exercises the
second `commit()`); a card-counting shoe (a fresh 52 is shuffled each hand, which removes the
deck-runs-low edge case entirely and costs nothing a friendly game misses); per-card dealer-draw
animation (the dealer resolves in one reducer step; the reveal is instant, which is a polish gap, not
a correctness one); and any multiplayer, per the scope call above.

**The gap Blackjack leaves.** The same manual-browser-pass gap every game inherits — the CI
browser/integration guard Phases 1/3/5/6 all named is still unbuilt, and it is now the guard that
would prove the *economy* keeps working without a person remembering to deal 14 hands. Blackjack adds
no new node to `database.rules.json` (it writes only the existing profile, through the existing
`mutateProfile`), so nothing new needs deploying for it.

## Phase 6 — Chess (the hot-seat proof, and the SDK's biggest pure rulebook)

2026-07-17. `src/games/chess` — a manifest, a pure `logic/chess.ts` (a full rulebook: legal-move
generation, check, pins, castling, en passant, promotion, and the terminal states), a `Board` that
draws it with Unicode glyphs, and a `ChessGame` that is the same dozen lines Tic-Tac-Toe took — with
40 logic tests (337 total). Both modes were driven end-to-end in a real browser against the emulator:
hot-seat played fool's mate from one screen, and two accounts played one side each with the guest's
board correctly flipped, moves propagating both directions, zero console errors.

### Chess's coverage was the seat ideas Phase 5 built and no game had spent

Tic-Tac-Toe proved the SDK is cheap; Blackjack proved money moves; Chess's assigned job was the rest
of the seat design — **hot-seat** (two humans, one screen, the first game to need it) and a **2-seat
online** table — both with **zero betting**. The last is a real coverage point, not an omission: a
game with no `betting` in its manifest reports `{ outcome }` and `reportResult` moves XP and a stat
but never the bankroll, so the no-stakes path is exercised for the first time by a full game. There
is deliberately **no AI**: perfect chess is a whole engine, and the house is Tic-Tac-Toe's coverage,
so `modes` is `['hotseat', 'online']` and the board never computes a move for anyone.

### The wire shape is a FEN string, because the null-drop bug is a rule now, not a surprise

Tic-Tac-Toe found that RTDB drops null children and paid for it with a crash; Chess treated that as a
known constraint from the first line. A chess position has empty squares, and a board serialized as an
array of `Piece | null` would round-trip its empties to `undefined` — the exact bug, one game later.
So the shared state (`ChessState`, the `TPublic` `useRoom` carries) is a **FEN string** plus a tiny
envelope: `fen` is a non-empty string, `outcome` a non-empty object, and `lastFrom`/`lastTo` use the
`-1` sentinel Tic-Tac-Toe's `EMPTY` established rather than `null`. FEN is chess's standard
serialization and already carries placement, side to move, castling rights, the en-passant target and
the halfmove clock — so the whole game state is one wire-safe string, and the rich 64-cell `Position`
the move logic reasons over never touches the wire (`positionOf`/`toFen` are the one seam, the same
domain/wire split `roomRepo` and `profileRepo` make). The browser pass confirmed it: the board
rendered 32 pieces and every move round-tripped, where the null shape would have crashed on the first
render exactly as Tic-Tac-Toe did.

### Hot-seat forced the one seat gap the Tic-Tac-Toe write-up predicted — and it stayed in the OS

Tic-Tac-Toe's notes flagged it precisely: the `SeatList` "Sit" button gates on `mySeatIndex === -1`,
so one account cannot claim two seats, and "Chess is the design input" for seating a second local
human. The fix is small and, deliberately, lives in the SDK rather than in the game — a per-game
work-around would be v1's hot-seat-in-14-games all over again. `useRoom().claim(index, name?)` takes
an optional display label (the seat's `uid` is still the writer's own, rule-pinned; only the label
varies); `useSeats()` exposes the collapsed `sharedScreen` boolean; and `SeatList`, at that one call
site, lifts the one-seat gate on a shared screen and auto-labels each extra local player "Player N".
The board is untouched by all of it: it reads `localSeatIds`/`isMyTurn` and never learns the mode, so
"both sides are local" (hot-seat) and "only my side" (online) are the *same* `localSeatIds` read — the
whole point of Phase 5's collapse, finally exercised by a game. `mySeatIndex` returning the first
owned seat means a hot-seat account records its White result once per game, the uniform per-seat rule
with no special case. Teardown also just works: the lone hot-seat client is the host and the last one
present, so leaving removes the whole room rather than orphaning a seat.

### Chess found a second seat gap the same way — a bot no one drives

The lobby's "Add CPU" offered a bot on any open chair, which is right for Tic-Tac-Toe and wrong for
Chess: a CPU seat with no driver is an occupant whose turn never comes, and the table stalls at the
first move that is "the computer's". The fix is the manifest telling the truth — `SeatList` takes an
`allowAi` prop (`manifest.modes.includes('ai')`), so the CPU control appears only for a game that
declares an `'ai'` mode and therefore ships a driver. It is the same shape as the lobby already
filtering `'solo'` out of its mode buttons: the manifest's mode list is the authority on what a lobby
may offer, and a control with no backing behaviour does not render. The browser pass asserted it —
zero "Add CPU" buttons on the Chess lobby.

### The house is absent on purpose, and so are the hardest chess corners

`bestMove`/minimax is Tic-Tac-Toe's; Chess ships no engine, because a real one is a project of its own
and adds no *seat* coverage the hot-seat/online table does not already give. Also not built, and
noted rather than hidden: **threefold repetition** (it needs move history the wire FEN does not carry;
the fifty-move rule still terminates a dead game, and a friendly game does without the rest), and a
move-list/PGN or a clock (neither is coverage — they are a richer chess app, not a test of the SDK).
Promotion defaults to a queen with a picker for the other three; castling is generated only when fully
legal (the through-check squares are tested at generation, since the general legal filter only checks
the landing square) — all of it pinned in `tests/chess.test.ts`.

**The gap Chess leaves.** The same manual-browser-pass gap every game inherits — the CI
browser/integration guard is still unbuilt, and Chess widened what it would protect (a wire-shape
regression here is an illegal or unrenderable board, not a cosmetic). Chess adds no new node to
`database.rules.json`: it lives under the existing `rooms/`/`state/` rules with a monotonic `seq`, so
nothing new needs deploying for it. The hot-seat seat extensions (`claim` label, `sharedScreen`,
`allowAi`) are verified by the browser pass and typecheck, not by a unit test — they are UI-level
seams over the already-tested pure `seats.ts`, so the correctness that *could* be a unit test already
is one, and what is new is wiring a browser proves.
