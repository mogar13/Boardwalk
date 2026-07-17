# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

## Read this first

**Phase 0 (scaffold) has shipped. Phases 1–6 have not.** There is a live empty page, a green
pipeline, and no Casino OS: no `src/system`, no `src/ui`, no games. Start at
[plans/ARCHITECTURE.md](plans/ARCHITECTURE.md) — it is the design, and it explains *why* for
everything below.

**Most rules below describe code that does not exist yet.** They are the contract for the phase that
builds each thing, not a description of the tree. A rule marked *"Lint-enforced"* is only enforced if
it appears in the table under [Enforcement](#enforcement) — that table is the honest list, and a rule
gets its guard in the phase that creates its subject (a lint rule aimed at a directory that does not
exist matches nothing, and a rule that matches nothing reports success).

When you build something, update this file and that table to match.

## The project

**The Boardwalk** — a React 19 + TypeScript + Vite arcade built on **Casino OS v2**, a typed game SDK.
Tailwind v4 + DaisyUI for the UI, Firebase (Auth + Realtime Database) for data, GitHub Pages for
hosting.

It is the successor to **The Game Shack** (`../Game-Room`, repo `mogar13/Game-Shack`, live at
https://mogar13.github.io/Game-Shack/) — 31 mini-games in ~35,000 lines of vanilla JS.

> **The Game Shack is an archive, not a source.** It stays live and untouched, permanently. This repo
> shares no code and no build with it, and (as of 2026-07-16) not even a Firebase project. Do not port
> from it mechanically. Read it for *reasoning* — its bugs are why half the rules below exist.

## Scope discipline — the rule most likely to be violated

**There is no game checklist and there will never be one.** Five games at launch: tic-tac-toe,
blackjack, chess, uno, solitaire — chosen for OS coverage, not sentiment. After that, games get built
because one sounds fun, never to reach a number.

The OS is ~4,700 lines; the games are ~30,000. Risk alone is 2,697. If "done" ever comes to mean "31
games," this project stalls exactly where the migration would have — and the completionist version
already exists at the old URL.

If asked to "port the rest of the games," push back and point here.

## The rules

Every rule below is paid for by a specific defect in The Game Shack, catalogued in
[ARCHITECTURE.md](plans/ARCHITECTURE.md#what-casino-os-v1-got-wrong). **Before you change or delete a
rule, read the row that bought it.** This file stays short on purpose — VS-Dashboard's CLAUDE.md is
715 lines because it earned them one bug at a time, and copying that wholesale would be cargo-culting
the output instead of the process. Rules accrete here as we hit things.

### Fix by type, not by convention

The meta-rule; the other rules are instances. **Make the wrong thing unspellable rather than
documenting "don't."** v1 documented "don't" extensively and has `validateAndCommit()` with zero
adopters, a `SystemProfile` "source of truth" no game calls, and 430 dead lines in `system_ui.js`.

A convention is only real if something red happens when it's broken. If you add a rule, add its
enforcement — a lint rule, a type, or a test — in the same commit. And **test the enforcement**: a
lint rule that matches nothing reports success.

### Money

- **`useBankroll()` returns a readonly balance. There is no setter.** Wagers go through `useBet()`,
  payouts through `reportResult({outcome, payout})`. A game must not be able to spell `money += x`.
- **`reportResult()` is one call** for bankroll + stats + XP + achievements. Do not split it back
  apart. v1's split is why `big_win` has no unlock site.
- **Money is integer cents.** v1's `setMoney` used `parseInt`, so blackjack's 3:2 natural silently
  dropped a chip.

### Games

- **A game receives `{ onExit }` and nothing else.** Everything else is a hook. A `system` prop would
  rebuild the `window.SystemUI` god-object this project exists to escape.
- **`logic/` is pure.** No DOM, no React, no `@/system`, no Firebase. Lint-enforced. This is what
  makes rules unit-testable now and server-runnable later ([BACKEND_PLAN.md](plans/BACKEND_PLAN.md)).
- **Extract logic → test logic → then draw UI.** In that order. Tests before any UI exists. This is
  the only step that catches a bad shuffle or an off-by-one score.
- **`gameId` comes from `manifest.id`.** Never a string literal. In v1, 5 of 31 games' stats silently
  never reached the hub because `texas_holdem` recorded itself as `"poker"`.
- **Nothing under `games/` imports another game's folder.** Lint-enforced. Hoist shared code to
  `system/` or `ui/` deliberately.
- **Don't build a generic board-game engine.** Five games isn't enough evidence to know what games
  share — and neither was 31. Build them, note what repeats, extract only that.

### Multiplayer

- **`useRoom<TState>()` owns the subscription.** A game never registers a listener, so it can't forget
  to tear one down. In v1, 22 of 25 games leaked a live Firebase listener per lobby close.
- **Hot-seat is not a mode.** `localSeatIds: number[]` — AI is `[1]`, online is `[myId]`, hot-seat is
  every human seat. `isMyTurn = localSeatIds.includes(currentSeat)`. **No game branches on a mode
  string.**
- **Never order by wall-clock time.** Clocks aren't comparable across machines; v1 silently dropped
  opponents' moves until UNO added a `seq`. Ordering is the OS's job now, not each game's.

### Data

- **`firebase/*` may only be imported inside `src/system/repo/firebase/`.** Lint-enforced. Everything
  else talks to repo interfaces. This is what makes a future backend a one-line wiring change instead
  of a rewrite.
- **Firebase config is not committed.** It's injected at build time. (v1 has it inline in 32 HTML
  files.)
- **The security posture is inherited from v1 unchanged — it's the most mature thing there, and it
  cost two shipped backdoors.** Firebase Auth owns credentials; never reintroduce client-side password
  comparison. Dev rights come from `admins/<uid>`, enforced by database rules — `.dev-only` and
  `profile.isDev` only *hide* UI and are not a boundary. Never gate a privilege on a hardcoded
  username. Anything the browser can read, everyone can read.
- **Rules are the enforcement boundary**, and `.validate` the exact field set on public projections.

### UI

- **Raw DaisyUI component classes are banned outside `src/ui`.** Lint rule lands in Phase 1, with
  `src/ui`. This is the whole reason VS-Dashboard looks like one product — and a neon casino needs it
  more than a dashboard does, not less. Neon without a system looks like a ransom note.
- **Semantic tokens only** (`bg-base-200`, `text-primary-content`). Never a raw palette value.
- **`alert` / `confirm` / `prompt` are `no-restricted-globals`.** ✅ Live. One `<Modal>`, one
  `useToast()` — both Phase 1; the ban came first so they are the only road when they arrive. v1 has
  four ad-hoc modal systems and toasts that lazily self-inject an inline-styled container.

### Files

- **800-line ratchet, enforced on `prebuild`.** ✅ Live — `scripts/check-file-size.mjs`. A new file at
  or over 800 lines fails; a baselined file that *grew* fails. It never fails on a file that shrank —
  it tells you to re-lock the baseline. The baseline is `{}` and the correct number of entries it will
  ever hold is zero: over in VS-Dashboard this guard arrived too late and fences nine files, one of
  them 2,586 lines. Here it is a ceiling, not a ratchet on debt. Keep it that way.
- Components are `PascalCase.tsx`; logic and hooks are `camelCase.ts`. The extension is the signal.
  (Convention only — no guard. Don't trust it to hold.)
- **Use the `@/` path alias.** ✅ Live — `../../**` is a lint error. One `../` is fine; a sibling is a
  real relationship. (VS-Dashboard has none and imports `'../../../actualLabor'` — we're not doing
  that.)

## Docs

Two tiers, and the split matters:

- **`CLAUDE.md`** (this file) — rules, present tense. **Don't state a present-tense fact unless
  something fails when it stops being true.** If a claim has no guard behind it, either give it one or
  move it to the architecture doc as history.
- **`plans/ARCHITECTURE.md`** — the design and the *why*. War stories go here in past tense, where
  they stay true forever. "v1 had no `off()`" cannot rot; "we have no `off()`" rots the day someone
  adds one.

## Enforcement

The honest list. **Left column = a rule with teeth today.** Right column = prose until its phase
builds the thing it guards.

| Live now | Guard |
|---|---|
| `alert`/`confirm`/`prompt` banned | `no-restricted-globals`, scope-aware — sees `confirm(msg)`, ignores `const { confirm } = useToast()` |
| `@/` alias, no `../../` escapes | `no-restricted-imports`, pattern `../../**` |
| 800-line ceiling + ratchet | `scripts/check-file-size.mjs` on `prebuild` |
| Types are real, not decorative | `tsc -b` strict + `recommendedTypeChecked` |
| Every guard above actually fires | `tests/lint-rules.test.ts`, `tests/file-size-guard.test.ts` |

| Not yet enforced | Lands in |
|---|---|
| Raw DaisyUI classes banned outside `src/ui` | Phase 1 (needs `src/ui`) |
| Semantic tokens only | Phase 1 |
| `firebase/*` only under `src/system/repo/firebase/` | Phase 2 |
| `logic/` is pure; no cross-game imports | Phase 6 (needs `src/games`) |
| `PascalCase.tsx` / `camelCase.ts` | unguarded — convention only |

Adding a rule means adding its guard **and a test that the guard fires**, in the same commit. Both
test files exist to be copied from. Falsify a new guard before trusting it: break the thing on
purpose, watch it go red. Phase 0 found two of its own tests were vacuous that way — one linted a
`.tsx` fixture that TypeScript had silently dropped from the program (a `.ts` and a `.tsx` sharing a
basename resolve to the same module; the `.ts` wins), which is precisely the "guard goes blind on the
file-extension axis" failure the suite was written to prevent, landing on the suite itself.

## Develop

```bash
npm install
npm run dev            # vite, http://localhost:5173/Boardwalk/
npm test               # vitest — the guard tests
npm run lint
npm run format         # prettier; docs are .prettierignore'd on purpose
npm run build          # prebuild (lint + filesize) → tsc -b → vite build
npm run guard:filesize -- --init   # re-lock the ratchet after a file SHRANK
```

Push to `main` deploys via `.github/workflows/deploy.yml` → https://mogar13.github.io/Boardwalk/.
`npm run build` runs the guards through npm's `prebuild` lifecycle, so they gate the deploy rather
than merely existing.

Phases are listed in [ARCHITECTURE.md](plans/ARCHITECTURE.md#phases) — one per conversation, each ends
green and deployed. **Next: Phase 1 (theme + kit).**
