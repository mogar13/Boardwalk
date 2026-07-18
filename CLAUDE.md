# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

## Read this first

**Phases 0–6 have shipped. All five launch games are live: Tic-Tac-Toe, Blackjack, Chess, UNO and
Solitaire.**
The registry carries five real games and a `React.lazy` component loader (`RegisteredGame` =
`{ manifest, Component }`), the play route mounts a game inside `<GameShell>` + `<Suspense>`, the
`<Lobby>` renders a game's board as `children` once play starts (Tic-Tac-Toe, Chess, UNO), or a solo
game renders its board straight into the shell with no room at all (Blackjack, Solitaire). Every
game's rules are pure unit-tested `logic/`. The two Phase-6 lint rules this phase owed —
`@boardwalk/no-impure-logic` (a game's `logic/` imports nothing impure) and
`@boardwalk/no-cross-game-imports` (no game reaches into a sibling) — are live and their guards
fire in `tests/lint-rules.test.ts`. **Phase 6 is complete — the launch set is done, and there is no
game checklist beyond it (see Scope discipline).**

**UNO is the hidden-hands proof, and the first (and only) consumer of the private `hands/` channel.**
Its coverage is the multiplayer-hard half: **private hands** (each player sees only their own cards —
a data-layout-and-rule guarantee, not a UI trick), **seq ordering** (the OS's `patchState`, so no game
re-derives v1's clock-skew fix), **AI-as-occupant** (a leaving player's hand is driven on by the host
so the table never stalls), and a table that seats up to **seven**. The model is **host-as-dealer**:
because the rules refuse a read of anyone else's `hands/` node (even the host's), no client can hold the
whole game the way Chess's every client holds the board — so the host alone holds the complete
`UnoGame` (every hand + the draw pile) in memory, runs the pure `src/games/uno/logic/uno.ts` reducer,
and each transition **projects** a public view (`toPublic` → top card, counts, whose turn — never a
hidden card) to `state/data` and **deals** each changed hand to its owner's private node. The deck
therefore never touches the wire at all — strictly more private than v1, whose deck was public. Non-hosts
render the projection plus their own hand (`useHand`) and submit a move as a nonce'd intent the host
acks; the host's own moves take that same path, so there is one code path for "a human moved". The
rulebook — 108-card deck, legal-play matching, skip/reverse/draw2/wild4, the UNO-call +2 penalty,
reshuffle-on-empty, win detection — is all pure and in `tests/uno.test.ts` (24), with the art resolved
to disk in `tests/uno-art.test.ts` (4). UNO shipped the two SDK seams Phase 5 built with no caller:
`useRoom().writeHand`/`useHand(index)` (the private channel's write/read halves), and it closed one OS
gap — the lobby's `canStart` gated on `humanCount >= seats.min`, which **conflated "min players" with
"min humans"** and wrongly refused a legitimately bot-filled AI table; it now gates on a full table with
**at least one human** to host/deal (the AI-as-occupant sibling of Chess's `allowAi`). Both modes were
driven end-to-end in a real browser against the emulator: a 7-seat AI table dealt, played, and a bot won
with zero console errors; two accounts on one online table each saw **only their own faces** (zero
opponent-face leaks on both pages) and moved in both directions. **`modes: ['ai', 'online']` — NOT
hot-seat: hidden hands and one shared screen are contradictory.**

**Solitaire is the room-less proof, the fifth and last launch game — a real, correct game that
touches neither a seat nor the bankroll.** Blackjack was the first caller of the room-less seam
(`modes: ['solo']`, board straight into `<GameShell>`, a local `useReducer`); Solitaire confirms the
same seam carries a game with no economy either, so it reports only `{ outcome: 'win' }` — XP + the
win stat, no payout — the same report shape Chess uses, and it has **no `betting`** in its manifest
(absence is the signal, not a `betting: false`). The rules are a pure, unit-tested Klondike engine
(`src/games/solitaire/logic/solitaire.ts`): the deal (seven columns, only the top of each face up),
the tableau build (down in rank, alternating colour; only a King opens an empty column), the
foundation build (up by suit, Ace→King), the stock draw-and-**recycle** (draw 1 or 3; an empty stock
flips the waste back face-down so the draw order repeats), multi-card run lifts (`isValidRun`),
win detection and a guarded `autoComplete` for the trivial all-face-up endgame — all in
`tests/solitaire.test.ts` (33). The board (`components/Board.tsx` + `CardView.tsx`) is click-to-move,
not drag: click a face-up card to pick up its run, click a destination to drop, double-click to send
a top card home; selection is local UI state the reducer never sees. `pier: 'arcade'` — quick hits,
one player, one screen. No `icon` yet (the hub draws its placeholder, the honest state Chess and UNO
also register in). Driven end-to-end in a real browser against the emulator: a fresh account dealt a
full board (all 52 cards resolved to art on disk, zero broken images), the draw incremented the move
counter, and there were **zero console errors** and no invisible-element dead-scroll (the ~49px the
board runs past the fold is the visible tableau, and it collapses to zero when no cards are dealt).
**`modes: ['solo']` — NOT multiplayer: opting out of rooms entirely is the whole coverage.**

**Chess is the hot-seat proof, and the SDK's biggest pure `logic/` yet.** Its coverage is a full
rulebook, **hot-seat** (two humans, one screen — the first game to need it), and a 2-seat online
table with **zero betting** (no `betting` in its manifest → `reportResult` moves XP + stats, never
the bankroll). No AI: a chess engine is a whole other thing, and the house is Tic-Tac-Toe's
coverage. `src/games/chess/logic/chess.ts` is a pure, wire-safe rulebook — FEN as the shared state
(a string round-trips through RTDB where a piece array's empty squares would hit Tic-Tac-Toe's
null-drop bug), legal-move generation with check/pins, castling (incl. through-check), en passant,
promotion, and checkmate/stalemate/fifty-move/insufficient-material — all in `tests/chess.test.ts`
(40). Hot-seat forced the one SDK gap the Tic-Tac-Toe write-up flagged: one account seating **two
local humans**. The fix is small and stays in the OS — `useRoom().claim(index, name?)` takes a
display label, `useSeats()` exposes the collapsed `sharedScreen` boolean, and `SeatList` lifts its
one-seat gate on a shared screen (each extra local player auto-named "Player N"). A game still reads
only `localSeatIds`/`isMyTurn` and never a mode; hot-seat and online are the *same* board code.
Chess also closed a second seat gap: the lobby's "Add CPU" now gates on `SeatList`'s `allowAi`
(`manifest.modes.includes('ai')`), so a game with no AI driver — Chess — cannot seat a bot whose
turn never comes and stalls the table. Both modes were driven end-to-end in a real browser against
the emulator (hot-seat played fool's mate from one screen; two accounts played one side each with
the guest's board flipped), the manual pass the memory recipe calls for at every game.

**Blackjack is the economy proof, and a room-LESS game.** It opts out of multiplayer (its coverage
is betting/payouts, not seats — those are UNO's and Solitaire's): `modes: ['solo']`, no lobby, no
subscription, a local `useReducer`. `src/games/blackjack/logic/blackjack.ts` is the pure heart —
deck, ace-soft `handValue`, the settle matrix, and the **integer-safe 3:2 payout** (`floor(wager*3/2)`,
the exact chip v1 dropped through `parseInt`), all in `tests/blackjack.test.ts` (26). The table
draws cards with `cardSrc`, deducts the wager through `useBet().commit()` (twice, on a double-down),
credits the gross back through `reportResult({payoutCents})`, and voices it with `useAudio`. Money
still moves in exactly two events and there is still no setter a game can reach. `'solo'` is a new
`GameManifest` mode (Blackjack now, Solitaire later); a solo-only game never mounts `<Lobby>`.

**Blackjack prep shipped: the Audio OS and the shared card art the SDK still owed.** `useAudio()`
was a promise in the hook table through five phases; it is now real — `src/system/audio`
(`sounds.ts` a pure role→file registry, `audioStore.ts` a Zustand mute flag persisted + cross-tab
synced, `engine.ts` the guarded `HTMLAudioElement` cache with browser-unlock-on-first-gesture, and
`useAudio` the game-facing hook), plus a mute toggle in the top bar. A game names a **role**
(`play('deal')`), never a filename. Card art is staged under `public/cards/` (a standard 52-deck +
backs, the UNO set) and chips under `public/chips/`, all **CC0** (`public/audio/CREDITS.md`); the
curated casino SFX are under `public/audio/`. `src/system/cards/cards.ts` maps a card to its image
(`cardSrc`), and both registries have a test that resolves every entry to a file **actually on
disk** — the `loadout.color` guard pointed at assets. Deck/shuffle/scoring logic is NOT here: it
stays in a game's `logic/` until a second card game repeats it. Blackjack now consumes all this.

There is a live routed app, a green pipeline,
`@boardwalk/theme`, `src/ui` (Button, Card, Input, Modal, `useToast`, `useConfirm`), `src/system` —
repo interfaces, one Firebase singleton, Auth, profile, `database.rules.json` with a test that boots
the emulator and proves it — `src/shell` (router, auth gate, top bar with bankroll + XP, the hub and
its piers), `src/games/registry.ts` (the typed catalogue — Tic-Tac-Toe + Blackjack + Chess + UNO + Solitaire registered, the launch set complete), the **economy**
(`src/system/economy` — `useBet`, `reportResult`, `GameShell` over pure bet/payout logic —
`src/system/progress`, `src/system/store`, `src/system/rewards`), and now **multiplayer**:
`src/system/room` (`useRoom`, `useSeats`, seats as the universal primitive, `localSeatIds`,
seq-ordered state, the lobby, presence, lifecycle teardown) and `src/system/chat` (`useChat`,
uid-pinned messages), over `RoomRepo`/`ChatRepo` and pure, unit-tested seat/ordering/lifecycle/key
logic. `database.rules.json` now governs `rooms/`, `hands/` (owner-only hidden information) and
`chat/`, all emulator-tested. Money moves ONLY through `useBet`/`reportResult`/a store purchase or pack
open/a daily claim via a single internal `mutateProfile` writer — no bankroll setter anywhere; `level` is
derived from `xp`, `wins` from `stats`, neither stored. `src/system/room` also now carries the private
hand channel's two game-facing hooks — `useRoom().writeHand(index, data)` (host deals) and
`useHand<T>(index)` (owner subscribes to its own seat only) — the first callers of the `RoomRepo`
`writePrivate`/`subscribePrivate` methods Phase 5 shipped unused. There are now **five games** —
Tic-Tac-Toe (how the SDK first got exercised end-to-end, and where RTDB's drop-null-children bug was
found — the `-1` sentinel), Blackjack (the economy proof: betting, the 3:2 natural, `reportResult`
payouts, a room-less solo game), Chess (the hot-seat proof: a full wire-safe rulebook, two humans on
one screen, a 2-seat online table, zero betting), UNO (the hidden-hands proof: host-as-dealer,
private per-seat hands, AI-as-occupant, a 7-seat table, zero betting), and Solitaire (the room-less
proof: a full Klondike engine, no seats, no bankroll, `reportResult({ outcome: 'win' })` only) —
each ~1 file of glue plus a pure, unit-tested `logic/`, which is the whole claim the SDK exists to
make. **The launch set of five is complete — see Scope discipline for why there is no sixth by
default.** Start at
[plans/done/ARCHITECTURE.md](plans/done/ARCHITECTURE.md) — it is the design, and it explains *why* for
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
[ARCHITECTURE.md](plans/done/ARCHITECTURE.md#what-casino-os-v1-got-wrong). **Before you change or delete a
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

- **`useBankroll()` returns a readonly balance. There is no setter.** ✅ Live. Wagers go through
  `useBet()`, payouts through `reportResult({outcome, payout})`; those two, plus a store purchase, a
  pack open (`openPack` — spends the price, credits dust on a duplicate) and the daily claim, are
  the *only* callers of the one internal writer (`authStore.mutateProfile`). A
  game cannot spell `money += x`: `useBankroll` is a `number`, and no setter hook is exported.
- **`reportResult()` is one call** for bankroll + stats + XP + achievements. ✅ Live —
  `src/system/economy/result.ts` (`applyResult`), tested in `tests/economy.test.ts`. Do not split it
  back apart. v1's split is why `big_win` had no unlock site; it has one now, and a test proves it fires.
- **Money is integer cents.** ✅ Live — `applyResult`/`applyPurchase`/`claimDaily` are all integer-cent,
  and `bet.ts` *refuses* a fractional bet rather than rounding it. v1's `setMoney` used `parseInt`, so
  blackjack's 3:2 natural silently dropped a chip.

### Games

- **A game receives `{ onExit }` and nothing else.** ✅ Live — `GameProps` in `src/games/registry.ts`,
  and the play route (`src/shell/pages/Play.tsx`) passes only `onExit`. Everything else is a hook. A
  `system` prop would rebuild the `window.SystemUI` god-object this project exists to escape.
- **`logic/` is pure.** No DOM, no React, no `@/system`, no Firebase. ✅ Lint-enforced —
  `@boardwalk/no-impure-logic` (bans React and any resolved import into `src/system`/`src/ui`, four
  import syntaxes, relative escapes included). This is what makes rules unit-testable now and
  server-runnable later ([BACKEND_PLAN.md](plans/BACKEND_PLAN.md)).
- **Extract logic → test logic → then draw UI.** In that order. Tests before any UI exists. This is
  the only step that catches a bad shuffle or an off-by-one score. (Tic-Tac-Toe: `logic/ticTacToe.ts`
  + `tests/ticTacToe.test.ts` existed and were green before `Board.tsx` was drawn.)
- **`gameId` comes from `manifest.id`.** Never a string literal. In v1, 5 of 31 games' stats silently
  never reached the hub because `texas_holdem` recorded itself as `"poker"`. ✅ Live — the registry
  keys on `manifest.id` (frozen `as const`), and stats/room-path/route all derive from it.
- **Nothing under `games/` imports another game's folder.** ✅ Lint-enforced —
  `@boardwalk/no-cross-game-imports` (resolves the specifier, so a single-`../` sibling escape fires
  too; the registry, which names every game, is deliberately exempt). Hoist shared code to `system/`
  or `ui/` deliberately.
- **A game attaches to its component via a lazy `Component` on its registry entry.** ✅ Live —
  `RegisteredGame` is `{ manifest, Component }`, `Component = lazy(() => import(...))` built once at
  module load so each game is its own chunk. Never `lazy()` in render (it remounts and drops the room
  subscription); the registry is the module that runs once and already names every game.
- **A multiplayer game renders `<Lobby manifest onExit>` and passes its board as `children`.** ✅ Live.
  The lobby owns create/join/seats/chat/start and the one `<RoomProvider>` subscription; the board
  renders inside it once `status === 'playing'`, which is how the board's `useRoom`/`useSeats` reach
  the subscription without the game registering a listener.
- **Don't build a generic board-game engine.** Five games isn't enough evidence to know what games
  share — and neither was 31. Build them, note what repeats, extract only that. (Tic-Tac-Toe added no
  shared abstraction beyond the loader and the `<Lobby>` `children` seam — both of which had a caller
  the moment they were written.)

### Multiplayer

- **`useRoom<TState>()` owns the subscription.** ✅ Live — `src/system/room`. A game never registers
  a listener; `<RoomProvider>` holds the one subscription and runs teardown on unmount and on
  `pagehide`/`beforeunload`. In v1, 22 of 25 games leaked a live Firebase listener per lobby close.
- **Hot-seat is not a mode.** ✅ Live — `localSeatIds({seats, myUid, sharedScreen})` in
  `src/system/room/seats.ts`. Online → `[mySeat]`, hot-seat → every human seat, AI/solo → `[mySeat]`;
  the mode string collapses to `sharedScreen` at one call site (`useSeats`) and a game reads only
  `localSeatIds`/`isMyTurn`. AI-driving is `aiSeatsToDrive` (host-only), a separate concern from local
  attribution. **No game branches on a mode string.** (`useSeats` deliberately does NOT invent a
  `currentSeat` — turn-tracking is game state; `isMyTurn` is a predicate the game calls.)
- **Never order by wall-clock time.** ✅ Live — room state carries a monotonic `seq`
  (`src/system/room/ordering.ts`), enforced **in the rules** (`state/seq` must strictly increase), and
  chat carries an ASCII-sortable `messageKey`. v1 silently dropped opponents' moves until UNO added a
  `seq`. Ordering is the OS's job now, not each game's.
- **AI is an occupant kind, not a mode.** ✅ Live — a leaving human's seat can be handed *back* to an
  AI (`releaseSeat(…, 'ai')`) so the table stays alive, v1's best drop-in/drop-out idea.

### Data

- **`firebase/*` may only be imported inside `src/system/repo/firebase/`.** ✅ Live —
  `@boardwalk/no-firebase-imports`. It bans **two** things, because one alone is theatre: the SDK
  (`firebase/*`, `@firebase/*`) outside that directory, and the concrete repos
  (`@/system/repo/firebase/*`) outside `src/system/repo/` — a game that can't spell `onValue` but
  can spell `firebaseProfileRepo` is welded to Firebase through a nicer-looking door. `src/system/repo/index.ts`
  is the composition root and the only file that names an implementation.
- **Firebase config is not committed.** It's injected at build time, and `npm run build` **fails** if
  it's absent. Be precise about why, because the usual reason is wrong: a Firebase web config is *not*
  a secret — it ships in the bundle and has to. `database.rules.json` is what stops a stranger reading
  your data. Injection buys one home per environment instead of a checked-in copy. (v1 had it inline
  in 32 HTML files, each free to drift.)
- **The security posture is inherited from v1 unchanged — it's the most mature thing there, and it
  cost two shipped backdoors.** Firebase Auth owns credentials; never reintroduce client-side password
  comparison. Dev rights come from `admins/<uid>`, enforced by database rules — `.dev-only` only
  *hides* UI and is not a boundary. Never gate a privilege on a hardcoded username. Anything the
  browser can read, everyone can read.
- **There is no `isDev` field.** v2 doesn't store one. v1's was self-writable and granted nothing —
  and was *still* live, because chat trusted a client-asserted `isDev` and anyone could mint a dev
  badge. A forgeable field that grants nothing is a thing the next feature will believe. `Session.isAdmin`
  is a cache of `admins/<uid>`, it hides UI, and the server is the only judge.
- **Rules are the enforcement boundary**, and `.validate` the exact field set on public projections
  (`$other: false`) — `usernames/` and `leaderboard/` both. ✅ Live — `tests/database-rules.test.ts`
  runs the real file against the emulator. **A rules file is prose that looks like enforcement:** no
  compiler on this machine reads it, and a mistake in it reports success by doing nothing. It is the
  one thing here where being wrong is most expensive and static guards are blindest.
- **A username is an email address, and nobody is told which one.** `usernames/` must be world-readable
  (sign-in resolves a name before anyone is authenticated), so accounts without an email get a
  synthetic `@boardwalk.invalid` address — RFC 2606, unroutable *by construction*. The index stores
  `viaEmail: boolean`, **never** an address.
- **`auth/email-already-in-use` is the uniqueness guarantee.** The `usernames/` pre-check races; Auth
  refusing a second account on one address does not. For a username sign-up that code *means* "username
  taken". Don't tidy it away.
- **Money is integer cents, and the field is named `bankrollCents`.** The name carries the unit
  because RTDB's `isNumber()` can't say "integer".
- **`level` is not stored. It is `levelFromXp(xp)`.** ✅ Live — `$other: false` in
  `database.rules.json` refuses a write that includes a `level`, and `tests/database-rules.test.ts`
  asserts the refusal. A stored `level` is a second source of truth for a fact `xp` already
  determines, and the award site that writes one but not the other is the `recordWin` defect
  reborn. The curve lives in one pure module, `src/system/profile/xp.ts` — the badge and the bar
  both read the same `xpProgress(xp)`, so they cannot disagree.
- **`wins` on the leaderboard is `totalWins(stats)`, derived — the same rule as `level`.** ✅ Live.
  The private per-game `stats` are the source; the public projection carries one summed number
  (`profileRepo.publicProjection`), so the ranking cannot drift from the record it ranks. The four
  Phase 4 profile fields — `stats`, `achievements`, `inventory`, `daily` — are each pinned by
  `.validate` (with `$other: false` on `stats` and `daily`), and `tests/database-rules.test.ts`
  asserts a stray field in any of them, or a `wins` beyond the leaderboard's pinned set, is refused.
- **Rooms are signed-in-readable, never world-readable; a chat message's author cannot be forged; a
  private hand is readable only by its seat's owner.** ✅ Live — Phase 5's `rooms/`, `hands/` and
  `chat/` nodes, emulator-tested. The room-level write is **delete-only** on purpose: a broad room
  `.write` would CASCADE (RTDB grants a descendant write if any ancestor does), making every tight
  child rule a dead letter — so create is a multi-path *leaf* write and each field is authorised by
  its own rule. For the same cascade reason, hidden information lives in a **separate top-level
  `hands/`** node, not under the readable room: read access cascades down un-revokably, so a private
  node under a signed-in-readable room would be readable by everyone. `chat` pins `uid === auth.uid`
  (v1 trusted a client-asserted author, and the dev badge riding with it); `state/seq` must strictly
  increase (UNO's clock-skew fix, at the server).

### UI

- **Raw DaisyUI component classes are banned outside `src/ui`.** ✅ Live —
  `@boardwalk/no-daisyui-classes`. This is the whole reason VS-Dashboard looks like one product — and
  a neon casino needs it more than a dashboard does, not less. Neon without a system looks like a
  ransom note.
- **Semantic tokens only** (`bg-base-200`, `text-primary-content`). ✅ Live —
  `@boardwalk/no-raw-palette`, and it has **no `src/ui` exemption**: the kit may spell `btn`, never
  `#ff2c86`. `packages/theme/theme.css` is the only file in the repo that may name a colour, which is
  what makes the look changeable in one place instead of drifting the way v1's `loadout.color` and
  `profile.chatColor` did. Need a colour the theme lacks? Add a token, don't inline one.
- **The glow budget is fixed, and it is nearly spent.** Blue = act, cyan = here, gold = money,
  and that's the lot. (Act and here are both cool now — blue sits ~53° from cyan, told apart by
  depth and brightness, not hue — so keeping the focus ring exclusively cyan matters more, not less.) Status colours (info/success/warning/error) are flat on purpose — a neon
  success toast is a slot machine telling you your form saved. If everything glows, nothing does.
- **`alert` / `confirm` / `prompt` are `no-restricted-globals`.** ✅ Live, and they now have a
  destination: one `<Modal>` (native `<dialog>`), one `useToast()`, and `useConfirm()` for the
  one-liner. v1 has four ad-hoc modal systems and toasts that lazily self-inject an inline-styled
  container.
- **`confirmLabel` cannot be "OK".** Type-enforced — `ActionLabel` resolves to `never` for `ok`,
  `yes`, `confirm`, `continue`… A button that says OK next to a question you didn't read is why
  people click through destructive dialogs. Name what it destroys: `'Forfeit $250'`.
- **`<UiRoot />` mounts once at the app root.** Toasts and `confirm()` are dead without it (it says
  so, loudly, rather than hanging the caller on a promise that never settles).

### Audio & assets

- **A game plays a role, never a filename.** ✅ Live — `useAudio().play('deal')`. `sounds.ts` is a
  pure role→file registry (`'deal'` → a pool of card-slide takes); the engine picks a random take so
  a fast deal does not machine-gun, and a misspelled role is a compile error, not v1's silent
  `play('cardz')`. Add a role in the commit that first plays it — a role with no caller is
  `loadout.color`.
- **The audio registry resolves to real files, or it is a dead reference.** ✅ Lint-of-assets —
  `tests/audio.test.ts` checks every file `sounds.ts` names exists in `public/audio/`. A filename is
  a string and typechecks however wrong it is; only a disk check catches an un-staged sound. Same for
  card art: `tests/cards.test.ts` resolves all 52 `cardSrc` paths — and every `CARD_BACKS` id and
  every `cardback` store cosmetic — against `public/cards/standard/`.
- **Mute is the OS's, and it is global.** ✅ Live — `audioStore.ts` (Zustand, persisted to
  `localStorage`, cross-tab `storage`-synced), a top-bar toggle shown signed-out too. The engine
  unlocks the browser's autoplay gate on the first gesture (v1's primer). A game never touches an
  `HTMLAudioElement` or a storage key, the same way it never touches a Firebase listener.
- **Assets are curated into the repo, not dumped.** ✅ `public/cards/` (standard 52 + backs, UNO
  set), `public/chips/`, `public/audio/` — the in-use subset of the CC0 Game-Shack trove, not the
  whole thing. A staged asset with no reader is the asset form of the game checklist; bring next
  game's art when that game is built. Licence note lives in `public/audio/CREDITS.md` (all CC0).
- **The card *art* is shared; the card *logic* is not.** ✅ `src/system/cards/cards.ts` owns
  `cardSrc`/`cardBackSrc` and the `Suit`/`Rank`/`Card` types the mapping needs — nothing more. Deck
  construction, shuffling and a game's scoring stay in that game's `logic/` and get hoisted only when
  a second card game repeats them. The art is what repeats now; the rules do not yet.
- **A `cardback` is an equipped cosmetic with a real reader (P2).** ✅ `cardBackSrc(backId)` is
  equipped-aware — `cards.ts` owns the id→file map (`CARD_BACKS`, the free-starter default
  `cb_blue1`) and knows NOTHING of the profile; the GAME reads `useEquippedCardBack()` and passes
  the id in. Blackjack (hole card) and Solitaire (stock/tableau backs) draw the player's equipped
  back — the standard-deck games only. **UNO is deliberately NOT wired**: it uses a separate deck
  with one UNO-specific back and no variants, so it waits for UNO-back art the way `dice` waits for
  a dice game (owner decision). A `cardback` cosmetic is now the thing an avatar was in Phase 4 — a
  cosmetic that passes the reader test — not `loadout.color`.

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
- **`BrowserRouter`, and `dist/404.html` is a byte-copy of `index.html`.** ✅ Live —
  `scripts/spa-fallback.mjs` (a Vite build plugin) writes it and **throws** if it is missing or
  differs, and `tests/spa-fallback.test.ts` proves both. GitHub Pages has no server-side rewrite, so
  a deep link typed directly (`/Boardwalk/play/...`) is a Pages 404 without this fallback booting the
  app. Don't switch to `HashRouter` to avoid it — Phase 5's shared room links would carry the `#`
  forever. `basename` comes from `import.meta.env.BASE_URL`, never a hardcoded `/Boardwalk`.

## Docs

Two tiers, and the split matters:

- **`CLAUDE.md`** (this file) — rules, present tense. **Don't state a present-tense fact unless
  something fails when it stops being true.** If a claim has no guard behind it, either give it one or
  move it to the architecture doc as history.
- **`plans/done/ARCHITECTURE.md`** — the design and the *why*. War stories go here in past tense, where
  they stay true forever. "v1 had no `off()`" cannot rot; "we have no `off()`" rots the day someone
  adds one.

## Enforcement

The honest list. **Left column = a rule with teeth today.** Right column = prose until its phase
builds the thing it guards.

| Live now | Guard |
|---|---|
| `alert`/`confirm`/`prompt` banned | `no-restricted-globals`, scope-aware — sees `confirm(msg)`, ignores `const { confirm } = useConfirm()` |
| `@/` alias, no `../../` escapes | `no-restricted-imports`, pattern `../../**` |
| Raw DaisyUI classes banned outside `src/ui` | `@boardwalk/no-daisyui-classes` — hyphenated forms anywhere, bare words in `className` only |
| Semantic tokens only, **`src/ui` included** | `@boardwalk/no-raw-palette` — scale, white/black, arbitrary values, and `style={{color}}` |
| Vague confirm labels ("OK", "Yes") | `ActionLabel<S>` → `never`; fails at the call site |
| 800-line ceiling + ratchet | `scripts/check-file-size.mjs` on `prebuild` (now covers `eslint-rules/` too) |
| Types are real, not decorative | `tsc -b` strict + `recommendedTypeChecked` |
| `firebase/*` only under `src/system/repo/firebase/`; concrete repos only from `src/system/repo/` | `@boardwalk/no-firebase-imports` — SDK + `@firebase/*`, `export…from`, dynamic `import()`, and resolved relative escapes |
| A game's `logic/` imports nothing impure (React, `@/system`, `@/ui`) | `@boardwalk/no-impure-logic` — path-scoped to `**/logic/**` under `src/games`, resolves specifiers so relative escapes fire |
| No game imports a sibling game's folder | `@boardwalk/no-cross-game-imports` — resolves specifiers (a single-`../` escape fires); the registry is exempt |
| Tic-Tac-Toe's rules are correct | `tests/ticTacToe.test.ts` (18) — every win line, draw-vs-win, `play` immutability + illegal-move no-op, and the house: takes a win, blocks a loss, opens centre, perfect-vs-perfect draws |
| Blackjack's rules + casino payout are correct | `tests/blackjack.test.ts` (26) — ace-soft `handValue`, natural-vs-3-card-21, dealer stands-on-all-17s at the boundary, the full settle matrix, the **integer-safe 3:2 payout on an odd wager** (the v1 `parseInt` chip), and the pure reducer (deal/hit-bust/stand/double/no-op) |
| Chess's rules are correct | `tests/chess.test.ts` (40) — FEN round-trip, 20 opening moves, piece movement + blocking, check/pin/out-of-check, castling (both sides, out-of/through-check, blocked, rights bookkeeping incl. captured-rook), en passant (set/capture/expiry), promotion (four pieces, chosen + default), fool's/scholar's mate + winner seat, stalemate-not-mate, insufficient-material + fifty-move draws, and `playMove` totality (illegal/finished → unchanged) + input immutability |
| UNO's rules + wire projection are correct | `tests/uno.test.ts` (24) — 108-card deck composition, deterministic shuffle, colour/value/action-of-any-colour matching, `deal` (7 each, opens on a number), the action cards (skip→+2 seats, reverse flips/heads-up-skips, draw2/wild4 deal+skip the victim), a wild refused without a chosen colour, the UNO-call +2 penalty vs declared, the win (turn stops), reshuffle-on-empty, `chooseAiMove` (legal play / draw-when-stuck / most-held wild colour / declares UNO), `applyMove` totality (off-turn / no-such-card / unplayable / finished → unchanged) + input immutability + structural sharing of untouched hands, and `toPublic` hiding every card behind sentinels |
| Every UNO card maps to art on disk | `tests/uno-art.test.ts` (4) — all 108 `unoCardSrc` paths resolve in `public/cards/uno/`, the action-kind→filename map (`skip`→`block`, `reverse`→`inverse`, `draw2`→`2plus`), both colourless wilds, and the back |
| Solitaire's Klondike rules are correct | `tests/solitaire.test.ts` (33) — a 52-card face-down deck, deterministic shuffle (permutation, input untouched), the deal (column sizes 1–7, only the top face up, 24 to stock), `canStackTableau`/`canStackFoundation` (King-on-empty, alternating descending, Ace-on-empty, up-by-suit), `isValidRun`, `liftable` (waste/foundation tops, a tableau run, never the stock, refuses a face-down start), the draw (1 and 3, waste→stock **recycle** re-serves the order and bumps the `recycles` counter the Clean Sheet feat reads, no-op when empty), moves (waste→foundation, a run move that flips the exposed card, King-only-on-empty, illegal no-ops, one-card-to-foundation), `auto`, win detection, `canAutoComplete`/`autoComplete`, a won game frozen but re-dealable, and input immutability |
| The security rules do what they say | `tests/database-rules.test.ts` (57) — boots the RTDB emulator, loads the **real** `database.rules.json`; the refusal of a stored `level`, the shape of every Phase 4 field, `wins`+`played` allowed but nothing beyond it, the P2 `equipped` map (card back + title accepted, a stray `frame`/`avatar` key and a wrong-type/over-long id refused), and Phase 5's rooms/hands/chat: owner-only hand reads, forged-author refusal, monotonic `seq`, self-only presence, no-evict seat claims, host-only room removal and host-only hands cleanup |
| Every leaderboard board ranks the way its name says | `tests/boards.test.ts` (16) — the four boards (wins/richest/level/win-rate), each board's order + tiebreak chain on a hand-built set, the win-rate min-games floor (a 1/1 player filtered off the skill board), `boardById` fallback, and `rankFor` non-mutation |
| A production build without Firebase config | `vite.config.ts` fails `build`, naming every missing var |
| `dist/404.html` is a byte-copy of `index.html` (Pages SPA fallback) | `scripts/spa-fallback.mjs` throws on missing/mismatch during `build`; `tests/spa-fallback.test.ts` (4) |
| The level curve is exact at every boundary | `tests/xp.test.ts` (13) — every threshold and its neighbours, plus a brute-force oracle |
| The economy is correct — limits, payouts, XP, unlocks | `tests/economy.test.ts` — `validateBet`/`clampBet`, and `applyResult` proving `big_win` fires on *net* not gross and never twice, money floored, input unmutated |
| Stats count right; achievements fire at the boundary | `tests/progress.test.ts` (10) — `bumpStats` immutability + per-game keys, and `satisfiedAchievements` at the exact threshold for the standalone badges (`first_win`, `big_win`, `high_roller`, `table_regular`) and the level/bankroll chain rungs |
| Achievements 2.0 — chains, grant, feats, hidden, completion % | `tests/achievements.test.ts` (24) — every chain tier at its boundary and one below (wins 10/50/100/500, bankroll $10k–$1M, level 5/10/25/50, per-game chess & blackjack 1/10/50/100), the mastery chains read the right game's wins, the earn-only grant lands in `inventory` on the completing tier only, not early, and exactly once; `recordedFeats` filtered to `FEAT_IDS` + de-duped; a game **cannot** forge a chain badge (or its grant) through the feats channel; feats fire once and carry no `test`; `completionPct` derivation; and catalogue integrity (unique ids, four ordered tiers per chain, only the two mastery Platinums grant, `feat`⇔no-`test`) |
| Packs pull at the published rate, and can never drop what money must not buy | `tests/packs.test.ts` (29) — odds sum to 1 and the empirical distribution matches them over 20k seeds (the card's table IS the roll), every weighted rarity has a non-empty bucket, the pool excludes **every earn-only cosmetic and every free starter** (asserted over the catalogue AND exhaustively over the roll; the earn-only half is additionally unspellable — `PackPull.item` is a `PackableCosmetic` reachable only via `isPackable`), a seeded roll is deterministic, a fresh pull spends exactly the price and grants the id, a duplicate refunds **completion-scaled** dust and grants nothing, dust is monotonic in completion and never exceeds the price at any completion (incl. clamped nonsense input), the roll pays the same number the shelf quoted, `completion` is derived per-pool and ignores foreign inventory, `canOpen` refuses a short bankroll and a completed pool, every pool item is reachable, bankroll floored at 0, input unmutated |
| Daily streak and store math | `tests/rewards.test.ts` (streak/gap/clock-rewind/cap), `tests/store.test.ts` (21 — afford/own/buy/equip across all three kinds, unique ids + avatar-only unique emoji, every rarity present, earn-only unbuyable at any bankroll + has an unlock line, card back/title equip into the `equipped` map without dropping the other, `equippedTitle`) |
| Money has no setter a game can reach | Type — `useBankroll(): number`; the one writer (`mutateProfile`) is on no game-facing surface, and `useBet`/`reportResult` are the only sanctioned paths |
| The Phase-A shadow diff + mirror are correct | `tests/shadow.test.ts` (13) — `diffProfiles` (clean round-trip empty, null read-back as one whole-profile diff, scalar/nested-stat/daily mismatch, a field present on only one side), and `shadowProfileRepo`/`mirrorProfile` (reads through the primary alone, mirrors on save, a throwing mirror never rejects the write — Firebase stays authoritative) |
| Seats/ordering/lifecycle are correct | `tests/room.test.ts` — claim (open-before-ai, no-evict), `releaseSeat` fallback, `localSeatIds` ×3 modes, `aiSeatsToDrive` host-only, `seq` strictly-fresh + shuffled-delivery, `teardownPlan` (host clears chat/room, guest doesn't) |
| Chat orders by key, not clock | `tests/chat.test.ts` — `messageKey` fixed-width ASCII sort = send order, counter tiebreak/rollover, `sanitizeMessage` |
| Every sound role names a file that is staged | `tests/audio.test.ts` (4) — every `sounds.ts` file exists in `public/audio/`, every role non-empty, variation pools distinct, `click` primer single-file |
| Every card + every card back maps to art that is on disk | `tests/cards.test.ts` (8) — all 52 `cardSrc` paths resolve in `public/cards/standard/`, suit-casing + `10`, every `CARD_BACKS` id resolves, an unknown/absent back id falls back to the default (never a 404), a known id maps to its own file, **every `cardback` store cosmetic resolves to art + the default back is a free starter**, `isRed` |
| Every game icon a manifest names is on disk | `tests/game-icons.test.ts` (2) — every `manifest.icon` resolves in `public/games/`, and `gameIconSrc` is base-path-aware + undefined-safe |
| Every guard above actually fires | `tests/lint-rules.test.ts` (43 — incl. the two Phase-6 rules, falsified with the rule off), `tests/file-size-guard.test.ts` (7), `tests/credentials.test.ts` (21), `tests/firebase-config.test.ts` (12) |

| Not yet enforced | Lands in |
|---|---|
| Rules deployed from CI (`npm run rules:deploy` is manual) | unguarded — **see below** |
| `PascalCase.tsx` / `camelCase.ts` | unguarded — convention only |
| The kit/lobby renders correctly in a real browser | unguarded, but Phase 5 added the surface: `VITE_USE_EMULATOR=1` + `/_dev/lobby` drives the whole room flow against the emulator (a manual Playwright pass, not a build guard) |

**The gap Phase 1 leaves, named rather than papered over.** Most guards above are static. The worst
bug in Phase 1 was not: a bare `grid` on `<dialog>` overrode the UA's `dialog:not([open]){display:none}`,
so every closed modal was a 1280×900 invisible element adding ~965px of scroll and hit-testing clicks
on every route. It typechecked, it linted, it passed all 33 tests, and it rendered correctly when
*open*. Only screenshotting the built page in Chrome found it. There is no browser test here yet —
so **when you touch the kit, look at it in a browser**, and if that starts costing more than it saves,
that is the argument for adding one. (Phase 2's rules test is that argument being won once, for the
place it was most expensive to lose: `database.rules.json` had exactly the same shape of problem —
prose that looks like enforcement, unreadable to every static tool here — and it now has a real test
that boots a real emulator and runs the real file.)

**The gap Phase 2 leaves.** `database.rules.json` is deployed by hand (`npm run rules:deploy`).
Nothing in CI does it, so **the file in this repo can silently stop matching production** — which is
worse than having no file, because it reads like the truth. The tests prove the file is right; they
cannot prove it is *deployed*. If you change the rules, deploy them in the same breath, and if that
ever gets forgotten once, that is the argument for a CI step with a service account.

Adding a rule means adding its guard **and a test that the guard fires**, in the same commit. Both
test files exist to be copied from. Falsify a new guard before trusting it: break the thing on
purpose, watch it go red. Phase 0 found two of its own tests were vacuous that way — one linted a
`.tsx` fixture that TypeScript had silently dropped from the program (a `.ts` and a `.tsx` sharing a
basename resolve to the same module; the `.ts` wins), which is precisely the "guard goes blind on the
file-extension axis" failure the suite was written to prevent, landing on the suite itself.

## Develop

```bash
npm install
cp .env.example .env.local   # then fill it from the Firebase console — dev works without it
npm run dev            # vite, http://localhost:5173/Boardwalk/
npm test               # vitest — the guard tests (boots the RTDB emulator; needs Java)
npm run lint
npm run format         # prettier; docs and database.rules.json are .prettierignore'd on purpose
npm run build          # prebuild (lint + filesize) → tsc -b → vite build. FAILS without Firebase config.
npm run guard:filesize -- --init   # re-lock the ratchet after a file SHRANK
npm run rules:test     # just the security rules, against the emulator
npm run rules:deploy   # push database.rules.json to Firebase. NOTHING IN CI DOES THIS.
```

`npm run dev` works on a fresh clone with no credentials — the page renders a panel naming the
missing variables instead of a form. `npm run build` does not: a production build with no config
fails rather than deploying a site whose only feature is that panel.

Push to `main` deploys via `.github/workflows/deploy.yml` → https://mogar13.github.io/Boardwalk/.
`npm run build` runs the guards through npm's `prebuild` lifecycle, so they gate the deploy rather
than merely existing. The five `VITE_FIREBASE_*` values are GitHub Actions secrets.

Routes: `/` (hub) · `/play/:gameId` · `/store` · `/leaderboard` · `/profile` · `/_dev/lobby`
(**DEV only** — the Phase 5 multiplayer harness; tree-shaken from prod). The shell (`src/shell`) owns
the router, the auth gate and the top bar; the game hub reads `src/games/registry.ts`, which holds
all five games (`/play/tic-tac-toe`, `/play/blackjack`, `/play/chess`, `/play/uno`,
`/play/solitaire`).

To drive the room flow locally: `npx firebase emulators:start --only auth,database`, then
`VITE_USE_EMULATOR=1 npm run dev`, and open `/Boardwalk/_dev/lobby` (or `/Boardwalk/play/tic-tac-toe`
to play a real game against the emulator). The flag is dev-only and points the app at the emulators
instead of production.

Phases are listed in [ARCHITECTURE.md](plans/done/ARCHITECTURE.md#phases) — one per conversation, each ends
green and deployed. **Phase 6 is complete: Tic-Tac-Toe, Blackjack, Chess, UNO and Solitaire all
shipped. The launch set of five is done — the next game is built only because one sounds fun, never
to reach a number (see Scope discipline).**
