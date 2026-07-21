# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

## Read this first

**Phases 0–6 have shipped. All five launch games are live: Tic-Tac-Toe, Blackjack, Chess, UNO and
Solitaire.**
**A sixth game shipped after the launch set: Liar's Dice, and it is the first game the referee
DEALS for a table.** It was built because someone wanted to play it (the only sanctioned reason —
see Scope discipline), and it happens to answer both things [ROADMAP item 4](plans/ROADMAP.md) left
open: the `dice` cosmetic, declared in P2 and withheld for want of a reader, and a BETTING game that
is not Blackjack. That second one forced the question the roadmap raised and deferred — who holds a
multiplayer match — and the answer is the gateway, not a client. Every human antes, the last player
standing takes the pot, and no client names a number at any point: `ldStart`/`ldAction` have no
field for a die, an outcome or a payout, and `liars-dice` joined `SERVER_DEALT_GAMES` in the same
commit that taught the referee to deal it, because the cheapest way to defeat a cutover is to leave
the road it replaced standing. UNO's host-as-dealer was unavailable here for a reason worth stating:
a host who can see every cup is a player who cannot lose. So the match lives in SQLite
(`liars_dice_matches`/`liars_dice_players`, authority by MEMBERSHIP rather than ownership — a match
has no owner), the gateway holds the dice, and the client is a renderer. It needed **two new
client→server frames and zero new server→client ones**: the projection rides the existing `room`
broadcast and each cup rides the existing owner-only `private` channel, so the board is thinner than
UNO's rather than thicker. Design and evidence: [plans/LIARS_DICE.md](plans/LIARS_DICE.md).

The registry carries six real games and a `React.lazy` component loader (`RegisteredGame` =
`{ manifest, Component }`), the play route mounts a game inside `<GameShell>` + `<Suspense>`, the
`<Lobby>` renders a game's board as `children` once play starts (Tic-Tac-Toe, Chess, UNO), or a solo
game renders its board straight into the shell with no room at all (Blackjack, Solitaire). Every
game's rules are pure unit-tested `logic/` — and since Phase D that `logic/` lives in
**`packages/game-logic`**, a real npm workspace package, not under `src/games/`. A game's folder is
now glue and pixels; its rulebook is `@boardwalk/game-logic/games/<game>`, imported by the browser
*and* by `boardwalk-api`, because a rule the referee enforces and a rule the client plays must be
the same lines of code or they will drift (they did — see the Money section). The two Phase-6 lint
rules this phase owed — `@boardwalk/no-impure-logic` (a game's `logic/` imports nothing impure) and
`@boardwalk/no-cross-game-imports` (no game reaches into a sibling) — are live, govern **both**
games trees, and their guards fire in `tests/lint-rules.test.ts`. **Phase 6 is complete — the launch
set is done, and there is no game checklist beyond it (see Scope discipline). Liar's Dice is a sixth
game, not a sixth item: it exists because it sounded fun.**

**UNO is the hidden-hands proof, and the first (and only) consumer of the private `hands/` channel.**
Its coverage is the multiplayer-hard half: **private hands** (each player sees only their own cards —
a data-layout-and-rule guarantee, not a UI trick), **seq ordering** (the OS's `patchState`, so no game
re-derives v1's clock-skew fix), **AI-as-occupant** (a leaving player's hand is driven on by the host
so the table never stalls), and a table that seats up to **seven**. The model is **host-as-dealer**:
because the rules refuse a read of anyone else's `hands/` node (even the host's), no client can hold the
whole game the way Chess's every client holds the board — so the host alone holds the complete
`UnoGame` (every hand + the draw pile) in memory, runs the pure `@boardwalk/game-logic/games/uno` reducer,
and each transition **projects** a public view (`toPublic` → top card, counts, whose turn — never a
hidden card) to `state/data` and **deals** each changed hand to its owner's private node. The deck
therefore never touches the wire at all — strictly more private than v1, whose deck was public. Non-hosts
render the projection plus their own hand (`useHand`) and submit a move as a nonce'd intent the host
acks; the host's own moves take that same path, so there is one code path for "a human moved". The
rulebook — 108-card deck, legal-play matching, skip/reverse/draw2/wild4, the UNO-call +2 penalty,
reshuffle-on-empty, win detection — is all pure and in `tests/uno.test.ts` (30), with the art resolved
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
(`@boardwalk/game-logic/games/solitaire`): the deal (seven columns, only the top of each face up),
the tableau build (down in rank, alternating colour; only a King opens an empty column), the
foundation build (up by suit, Ace→King), the stock draw-and-**recycle** (draw 1 or 3; an empty stock
flips the waste back face-down so the draw order repeats), multi-card run lifts (`isValidRun`),
win detection and a guarded `autoComplete` for the trivial all-face-up endgame — all in
`tests/solitaire.test.ts` (34). The board (`components/Board.tsx` + `CardView.tsx`) is click-to-move,
not drag: click a face-up card to pick up its run, click a destination to drop, double-click to send
a top card home; selection is local UI state the reducer never sees. `pier: 'arcade'` — quick hits,
one player, one screen, `icon: 'solitaire.png'` like the other four (every manifest icon is resolved
to disk by `tests/game-icons.test.ts`). Driven end-to-end in a real browser against the emulator: a fresh account dealt a
full board (all 52 cards resolved to art on disk, zero broken images), the draw incremented the move
counter, and there were **zero console errors** and no invisible-element dead-scroll (the ~49px the
board runs past the fold is the visible tableau, and it collapses to zero when no cards are dealt).
**`modes: ['solo']` — NOT multiplayer: opting out of rooms entirely is the whole coverage.**

**Chess is the hot-seat proof, and the SDK's biggest pure `logic/` yet.** Its coverage is a full
rulebook, **hot-seat** (two humans, one screen — the first game to need it), and a 2-seat online
table with **zero betting** (no `betting` in its manifest → `reportResult` moves XP + stats, never
the bankroll). No AI: a chess engine is a whole other thing, and the house is Tic-Tac-Toe's
coverage. `@boardwalk/game-logic/games/chess` is a pure, wire-safe rulebook — FEN as the shared state
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

**Blackjack is the economy proof, a room-LESS game, and since Phase D the one game the client does
not deal.** It opts out of multiplayer (its coverage is betting/payouts, not seats — those are UNO's
and Solitaire's): `modes: ['solo']`, no lobby, no subscription. The rulebook —
deck, ace-soft `handValue`, the settle matrix, and the **integer-safe 3:2 payout** (`floor(wager*3/2)`,
the exact chip v1 dropped through `parseInt`) — is the shared
`@boardwalk/game-logic/games/blackjack`, in `tests/blackjack.test.ts` (26), and BOTH sides import it.
**The hand comes from behind the repo seam** (`BlackjackRepo` → `POST /blackjack/deal|move`): the
referee shuffles, deals, and settles from its own cards, so the deck and the hole card are never
sent and `payoutCents` stopped being a thing the client says. `src/games/blackjack/components/Table.tsx`
is now a RENDERER of `HandView` — it draws with `cardSrc`, draws a card BACK for the hole card it
genuinely does not have, dispatches hit/stand/double through `useBlackjackTable()`, and voices the
settle with `useAudio`. `useBet()` still owns the chip rack but **no longer commits**: the stake
leaves the bankroll inside the deal's own transaction, and committing here too would deduct it
twice. `'solo'` is a `GameManifest` mode (Blackjack, Solitaire); a solo-only game never mounts
`<Lobby>` — and it no longer implies the client owns the game.

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
logic. **Since Phase C those two repos are served by the WebSocket referee, not RTDB** — the gateway
in `boardwalk-api/src/rooms/` arbitrates seat claims (killing the claim-then-verify race), and
`src/system/repo/api/socket.ts` is the one multiplexed connection under them, with reconnect +
subscription replay. It is on by default wherever `VITE_API_BASE_URL` is set; `VITE_WS_ROOMS=0`
rebuilds back onto RTDB, which is why the Firebase room/chat repos are still in the tree.
`database.rules.json` still governs `rooms/`, `hands/` (owner-only hidden information) and
`chat/`, all emulator-tested — dead weight on the WS path and the live boundary the instant the kill
switch flips, so it is maintained, not deleted. Money moves ONLY through `useBet`/`reportResult`/a store purchase or pack
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
make. Those five rulebooks now sit in **`packages/game-logic`** alongside the economy, achievements,
stats, XP, the money formatters, the store catalogue, the daily ladder and the profile's data
shapes — everything both the browser and the referee have to agree about. The build seam is
deliberately asymmetric: the frontend reads the package's **TypeScript source** (a `paths` entry in
`tsconfig.app.json`/`tsconfig.test.json` and a matching `resolve.alias` in `vite.config.ts` — the
same mechanism as `@/`, so there is no build step between editing a rule and seeing it in the
browser), while `boardwalk-api` reads the package's **built CommonJS** through an ordinary
`file:../packages/game-logic` dependency. That asymmetry is the point: it leaves the API's
`rootDir: src`, `outDir: dist` and `main: dist/server.js` untouched, so the Pi's systemd `ExecStart`
does not move. `Session` stayed behind in `src/system/auth/session.ts` — it is an auth fact, not a
rule the referee runs. **The launch set of five is complete — see Scope discipline for why there is no sixth by
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
  pack open, the daily claim and the bankrupt top-up, all go through `applyEconomy` — `mutateProfile` is left holding
  only the non-money writes (name, avatar, equip). A
  game cannot spell `money += x`: `useBankroll` is a `number`, and no setter hook is exported.
- **Money moves as an INTENT, and the server prices it.** ✅ Live (BACKEND_PLAN.md Phase B, code
  complete, **deployed and LIVE in prod since 2026-07-18**). The six money paths call `authStore.applyEconomy(intent,
  optimistic)` → `repos.economy.apply`, where an intent is `bet` / `settle` / `purchase` / `daily` /
  `refill` / `pack`.
  **None of those types has a field for a balance, a price, an XP amount, a stat count, a clock, a
  seed or an item** — the wrong thing is unspellable rather than validated. The server computes each delta from the
  ledger and answers with the whole authoritative profile, which replaces the optimistic one. With
  no `VITE_API_BASE_URL` (fresh clone, emulator) `firebaseEconomyRepo` persists the client's own
  arithmetic instead — the pre-Phase-B economy, unchanged, and the kill switch is
  `VITE_API_ECONOMY=0`.
- **A bankrupt player has a way back, and the way back cannot be a faucet.** ✅ **Live and DEPLOYED to the Pi 2026-07-21** (verified from the artifact, not the exit code — see the deploy row below).
  V1_FEATURE_GAPS.md #10 called the missing
  refill "the most-missed" of v1's meta surfaces, and v1's own version is the argument for how to
  build it: a `↺ REFILL` button whose whole implementation was `setMoney(1000)` in the browser.
  Here it is a **top-up TO a floor, not a grant OF an amount** (`refillGrantFor` in
  `packages/game-logic`, shared) — so the balance after a top-up is always exactly
  `REFILL_FLOOR_CENTS` and no arrangement of them leaves anyone richer, where a flat `+$200` would
  net a player $199 across a $1 bet. The `refill` intent is `{nonce}` and **nothing else**: no
  amount, because the grant is a function of the LEDGER'S balance; no clock, because the
  once-a-day limit is `COUNT`ed off the ledger's own rows. **The limit is derived, not stored** —
  there is no `lastRefillDay` field, which means no rules change, no SQLite column, and no second
  record that can drift from the money. The eligibility window is `created_at >= startOfToday`
  with **no upper bound**, deliberately: bounding it would hand a rewound clock a second grant.
  The one degraded path is named rather than hidden — `firebaseEconomyRepo` has no ledger, so the
  daily limit is unenforced there, which is strictly less than what that client-authoritative
  fallback already permits.
- **The bankroll is a SUM, not a column.** ✅ Live — `SUM(ledger.delta_cents)` in
  `boardwalk-api`; `profiles` has no bankroll column, on purpose, because a stored number is one
  something will eventually write. `PUT /profile` accepts exactly three fields (name, avatar,
  equipped): the write that could once set a balance has nowhere to put one.
- **Every money mutation carries a `nonce` and is idempotent.** ✅ Live — `mutations(uid, nonce)`
  claimed with `INSERT OR IGNORE` inside the same transaction as the work, so a retry, a double-tap
  or an offline result re-sent on reconnect all collapse to one effect and replay the first answer.
  A browser retries; an economy that is not replay-safe is one flaky connection from a duplicate
  payout.
- **There is no server copy of the money rules — both sides import the same module.** ✅ Live
  (Phase D). Prices, the daily ladder, the XP table, the opening stake, `validateBet` and the
  achievement catalogue all live once, in `packages/game-logic`, and `boardwalk-api` depends on it.
  `PRICES_CENTS` in `boardwalk-api/src/domain/economy.ts` is **derived** from the shared `CATALOG`
  (`Object.fromEntries(CATALOG.map(…))`) rather than transcribed from it, so "priced on one side and
  not the other" stopped being a state the system can be in. What remains server-side is what has no
  client counterpart: the payout ceiling and the four `check*` functions that phrase a rule as a
  decision about a request. **Add a money rule in one place, because there is only one place.**
  This replaced `tests/economy-parity.test.ts`, which imported both sides and asserted every
  constant agreed — a real guard that caught real drift more than once (P4's card backs landed on
  the client alone, which would have made the server refuse a purchase the store was offering).
  Deleting a guard is normally the wrong move, and it was right exactly once here, for the one
  reason that makes it right: **there is nothing left to compare.** A parity test over a single
  module is a test that a thing equals itself. Do not reintroduce the duplication in order to have
  something to guard.
- **A pack's ROLL happens on the server, and a replay re-serves it verbatim.** ✅ Live. The `pack`
  intent carries `{nonce, packId}` and nothing else, so a client cannot pick its own legendary;
  `applyPack` rolls, charges and grants in one transaction, against the SHARED `PACKS` table the
  store card publishes — one odds table, so the advertised rate cannot stop being the real rate.
  Packs are the one RANDOM mutation, so the plain "replay = do nothing and re-read the profile"
  path is WRONG for them: it would answer a retry with no pull, or re-roll and pay a second item,
  making a flaky connection a way to turn a common into a legendary. The outcome is persisted to
  `pack_opens` keyed by the same `(uid, nonce)` and replayed exactly. (Before this, `openPack`
  computed the whole profile client-side and saved it through `PUT /profile`, which reads
  name/avatar/equipped only — so in production the reveal animated and the server dropped both the
  charge and the grant.)
- **The one game that can win money does not deal its own cards.** ✅ Live (Phase D, deployed 2026-07-18). `BlackjackRepo` (`deal`/`move`) is the seam; `src/system/repo/api/blackjackRepo.ts`
  is the referee, `src/system/repo/local/blackjackRepo.ts` the offline twin, and `useBlackjackTable()`
  the only thing a game calls. **Neither request has a field for a card, an outcome or a payout** —
  absent, not validated — and `HandView` has no `deck` and carries ONE dealer card until the hand
  settles. A ceiling could bound "blackjack, pay me 2.5×"; it could never stop it, because "did this
  player actually win" is not a question you can ask about a number. The kill switch is
  `VITE_API_BLACKJACK=0`, which puts the table back on the local reducer with ordinary `bet`/`settle`
  intents — the Phase-B economy exactly, by rebuild. And **the old road is closed**: `checkSettle`
  refuses `gameId: 'blackjack'` outright (`SERVER_DEALT_GAMES`), because leaving `POST /bet` +
  `POST /settle` open at the 2.5× ceiling would make the whole dealer opt-in, and the cheapest way
  to defeat a cutover is to leave the path it replaced standing.
- **A badge is computed by the referee, never reported.** ✅ Live (Phase D, deployed 2026-07-18). `/settle` has no `unlockedAchievementIds` and no `grantedItemIds` — the fields
  are *gone*, not validated. `boardwalk-api/src/domain/achievements.ts` recomputes with the SAME
  shared `satisfiedAchievements` the client uses, over an `AchievementView` whose every number is
  read back from the server's own tables **inside the settle transaction**, after the stat bump, the
  XP award and the ledger row have landed; a grant rides with its badge in that transaction, because
  a badge landing without its cosmetic is v1's `recordWin` defect wearing a hat. This matters beyond
  chips: the two Platinum mastery tiers grant `ttl_thehouse` and `ttl_grandmaster`, titles the store
  refuses to sell at **any** price so that wearing one means you earned it. Only `feats` still cross
  the wire — filtered by the shared `recordedFeats` to rows marked `feat: true`, so a chain id
  cannot be smuggled through the channel — and they stay there because no state predicate can see a
  two-card 21 or a Solitaire cleared without a recycle.
- **An offline result is banked against a SERVER-SIGNED nonce, and the batch is the bound.** ✅ Live
  and **DEPLOYED since 2026-07-18** — this line said "not yet deployed" for three days after it was,
  which is the drift this file's own Docs rule exists to catch; `/health` answering `tickets: "on"`
  is the artifact saying the secret is set, and the Enforcement row below carries the prod evidence.
  The locked Phase-B decision — offline
  wins are ranked, syncing on reconnect — was never built: a failed settle used to revert its
  optimistic profile, toast, and DROP the intent, nonce and all. So there was no replay hole, because
  there was no banking; building the queue is what would have opened one, and the bound arrives in the
  same commit. A **ticket** is an HMAC over `(uid, deviceId, seq)` that the client spends in the
  `nonce` field — so **`EconomyIntent` did not change by one field**, and the property that no intent
  has a place to put a balance, a price, an XP amount, a stat count, a clock, a seed or an item is
  untouched. Spend-once is still `mutations(uid, nonce)`; a ticket is simply a nonce the client could
  not have made up. **Say the bound honestly: offline DURATION is unbounded (a ticket never expires),
  offline VOLUME is not — it is `TICKET_BATCH`, and it is 64.** Any scheme where the server issues the
  right to bank issues a finite number in advance; "unbounded offline play" unqualified is false.
  The cap is **per-uid, across every device**, because the device id is a random string the client
  invents with no attestation — a per-device cap would multiply with fabricated devices instead of
  bounding anything, which is v1's forgeable `isDev` wearing a new hat. The gate is on **`/settle`
  alone**: tickets are the offline budget, and an online `/purchase` spending one would starve the
  reserve it was sized for. A missing `TICKET_SECRET` **fails OPEN** (client-minted nonces, exactly
  as before) — deliberate, because the Pi deploys by hand and this control protects the leaderboard,
  not the bankroll; `/health` reports `tickets: on|off` so the state is readable from the artifact.
  Design and the drive evidence: [plans/done/OFFLINE_HARDENING.md](plans/done/OFFLINE_HARDENING.md).
- **The second game the referee deals is the first MULTIPLAYER one, and its board does not report a
  result at all.** ✅ **Live and DEPLOYED to the Pi 2026-07-21** (verified from the artifact, not the exit code — see the deploy row below). Liar's Dice
  antes every human seat inside `ldStart`'s own transaction and pays the pot inside the settling
  action, so `recordOutcome` has already banked the stat, the XP and the achievements before any
  client learns the match ended. A board that also called `reportResult` would be claiming a result
  the server had recorded — `checkSettle` refuses `liars-dice`, so it could not double-count, but it
  toasted "settled by the dealer, not by a claim" at every player at the end of every match until a
  browser pass found it. What the client DOES need is the authoritative profile, at the two moments
  money moves: the DEAL (only the host sends it, but everyone antes) and the SETTLE (which a BOT's
  challenge can trigger, so no client made a request at all). **Betting needs two humans** — one
  human's pot is their own ante handed back, and a betting UI that cannot move a chip is worse than
  none.
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
- **`logic/` is pure, and it lives in `packages/game-logic/src/games/<game>/logic/`.** No DOM, no
  React, no `@/system`, no Firebase. ✅ Lint-enforced — `@boardwalk/no-impure-logic` (bans React and
  any resolved import into `src/system`/`src/ui`, four import syntaxes, relative escapes included),
  and its `GAMES_DIRS` names **both** trees: `src/games` and `packages/game-logic/src/games`. That
  second entry is the whole guard now — leaving the rule pointed at `src/games` after Phase D moved
  the rulebooks would have gone silent on every line of logic in the repo *while still reporting
  success*, which is the exact failure mode this file's Enforcement section exists to prevent. This
  is what made rules unit-testable then and server-runnable now: `boardwalk-api` runs these files
  ([BACKEND_PLAN.md](plans/done/BACKEND_PLAN.md) Phase D).
- **Extract logic → test logic → then draw UI.** In that order. Tests before any UI exists. This is
  the only step that catches a bad shuffle or an off-by-one score. (Tic-Tac-Toe: `logic/ticTacToe.ts`
  + `tests/ticTacToe.test.ts` existed and were green before `Board.tsx` was drawn.)
- **`gameId` comes from `manifest.id`.** Never a string literal. In v1, 5 of 31 games' stats silently
  never reached the hub because `texas_holdem` recorded itself as `"poker"`. ✅ Live — the registry
  keys on `manifest.id` (frozen `as const`), and stats/room-path/route all derive from it.
- **Nothing under `games/` imports another game's folder — in either games tree.** ✅ Lint-enforced —
  `@boardwalk/no-cross-game-imports` (resolves the specifier, so a single-`../` sibling escape fires
  too; the registry, which names every game, is deliberately exempt), with the same two-entry
  `GAMES_DIRS`. Hoist shared code to `system/`, `ui/`, or — if the referee needs it too —
  `packages/game-logic`, deliberately.
- **A game attaches to its component via a lazy `Component` on its registry entry.** ✅ Live —
  `RegisteredGame` is `{ manifest, Component }`, `Component = lazy(() => import(...))` built once at
  module load so each game is its own chunk. Never `lazy()` in render (it remounts and drops the room
  subscription); the registry is the module that runs once and already names every game.
- **A multiplayer game renders `<Lobby manifest onExit>` and passes its board as `children`.** ✅ Live.
  The lobby owns create/join/seats/chat/start and the one `<RoomProvider>` subscription; the board
  renders inside it once `status === 'playing'`, which is how the board's `useRoom`/`useSeats` reach
  the subscription without the game registering a listener.
- **A pre-game option is manifest DATA, and the OS draws the control.** ✅ Live —
  `manifest.options` (a `GameOptionsSpec`), `<GameOptions>` renders it, `useGameOptions()` reads it
  back, and `<GameShell>` holds the values. A game never draws its own picker and never learns what
  a control looks like; what it does own is what a value MEANS (`solitaireDrawCount('3') → 3`,
  next to the reducer it feeds, pure). Solitaire's draw-1/draw-3 was the first caller — it
  had already hand-rolled the picker into its header, which is the shape v1 repeated across ~20
  games — and AI difficulty (below) is the second and third, which is what closed the seam's one
  gap: `<GameOptions>` had never been rendered by the LOBBY, because every option-declaring game
  was solo. Only `type: 'select'` exists: v1's colour swatch has no caller here, and a control type
  with no caller is `loadout.color`. Values are resolved against the spec
  (`resolveOptionValues`), so a game reading an option never has to handle a value it does not
  offer, and **an option change is a new game, not a mutation of one in flight** (v1's Chess
  deferred a difficulty change to the next game for the same reason; Solitaire re-deals).
- **An AI difficulty tier is an OPTION, not a mechanism — and its meaning lives in `logic/`.** ✅
  Live. V1_FEATURE_GAPS #1 was the headline gap: 22 of v1's 31 games had a difficulty selector, and
  the tier mapped to real engine behaviour (search depth, a dealer's stand value, a blunder rate) —
  the right instinct wired into a HUD dropdown where no test could reach it. Here a tier is a
  `select` on `manifest.options` (the seam Solitaire's draw count already built — **nothing was
  added to `src/system/options` for this**) plus a level the game's own pure chooser takes:
  `chooseAiMove(state, seat, level, rng)`. The rng is injected so a random tier is a VALUE in a
  test. Two callers, which is the bar V1_FEATURE_GAPS set before abstracting anything —
  Tic-Tac-Toe (`casual`/`sharp`/`perfect`) and UNO (`casual`/`sharp`) — and they deliberately do
  **not share a vocabulary**: `perfect` is meaningless in a game of hidden hands, and v1's own
  drift (easy/normal/hard vs easy/medium/hard vs normal/hard across 22 games) is why the SDK
  hard-codes no tier enum. Each game's **default is the level it already shipped**, guarded, so
  adding the option retuned nothing. The lobby renders `<GameOptions>` for the **host only**, in
  the waiting branch only — the values live in `<GameShell>`, which is per-client, and today's
  only room-game option is read exclusively by the host (`aiSeatsToDrive` is host-only); the day a
  guest must read one, it belongs in room state, and that is a real change rather than a nuance.
  Rendering it only before the deal is also what makes a mid-game retune unspellable — v1's Chess
  reached the same place by queueing a difficulty change to the next game.
- **A bot's move must be one the reducer ACCEPTS, at every tier.** ✅ Guarded in both games by
  playing whole games out and asserting the state CHANGED. An illegal bot move is not a crash: it
  is a no-op inside `patch`, on a turn only the bot can take, so the table hangs forever. The
  first draft of UNO's `casual` failed a subtler version of this and shipped nothing — it never
  called UNO (a difficulty made of the game's own rules, which was the appeal), and the +2 penalty
  for going to one card undeclared makes a hand that can never reach zero. Four casual bots ran
  3,000 turns with no winner. **A tier that makes a game unwinnable is v1's `[5,5,5,5]` Liar's
  Dice literal wearing a hat**, and only a test that plays to a WINNER — not to a legal move —
  sees it.
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
- **A rematch is asked for by everyone, and the OS owns the asking.** ✅ Live —
  `<Rematch restart={…}>` over the pure `rematchTally`/`castVotes`/`haveVoted` in
  `src/system/room/rematch.ts`. A game renders one component and passes ONE thing (how to start the
  next round); it never draws a play-again button, never decides who agrees, and never resets the
  board on its own click. **Every human seat must ask; an AI seat agrees by construction** — a bot
  never sulks, which is also what stops the handshake becoming a stall, because a player who leaves
  is handed to a bot and their vote requirement leaves with them. The tally recomputes `needed` from
  the CURRENT seats every time, so a departed player's ghost vote can never satisfy it, and an
  all-bot table never agrees (`every` over an empty list is `true` — the trap that would restart an
  empty room on a loop). `restart` fires on the HOST only, once per round, which is de-duplication
  rather than privilege: every client sees the same agreed tally at the same `seq`. This is
  V1_FEATURE_GAPS #4's first shared in-game service, and it replaced three different answers to one
  question — Tic-Tac-Toe and Chess let ANY seated player wipe the result out from under the winner
  still reading it, while UNO gave the guests no say at all, only a line telling them to wait for
  the host. **The votes ride in the game's own state under one reserved key** (`rematch`, beside the
  `round` every room game already carries), so they go through `patchState` — already seq-ordered,
  transactional and authorised — and cost **no rules change, no gateway change and no Pi deploy**.
  A `rematch` node on `RoomSnapshot` was the more obvious design and would have cost all three.
  Clearing the votes is by construction, not a cleanup step: the next round is a fresh state object
  from the game's own `initialState`/`toPublic`, which has never heard of `rematch`.
- **A crashed tab is cleaned up by someone who is not the crashed tab, and one plan decides what.**
  ✅ Live, and **verified in production 2026-07-18** — a real socket carrying a real Firebase token
  through the Funnel, the guest a separate OS process SIGKILL'd, every assertion read off the wire
  protocol: seat still human at +6s, `{"kind":"ai","uid":null}` at +28s, room alive throughout, the
  surviving host pushed to without asking. 8/8
  (ROADMAP item 2, [plans/done/CRASH_RECOVERY.md](plans/done/CRASH_RECOVERY.md)). `teardownPlan` is no
  longer only what to RUN on a clean exit — it is also what to ARM for a crash, which is what keeps
  this from becoming a second implementation of the leave rule. Two executors, one rule: on the WS
  path the **gateway** watches the socket die and releases seats itself; on the RTDB fallback the
  client arms the same plan as an `onDisconnect` (`RoomRepo.armDisconnect`, re-armed on every
  snapshot because who is last out and whether the game has started both move under you), and the
  API repo's `armDisconnect` is a deliberate **no-op** because the server already owns it there.
  **A seat is not released ON disconnect — it is SCHEDULED.** The safety net used to fire so eagerly
  that a three-second blip handed your seat to a bot and the reconnect (which replays subscriptions
  and presence, and has never re-claimed a seat) left you watching the house play your hand. So a
  drop arms a `DEFAULT_GRACE_MS` timer that declaring presence cancels; `'ai'` vs `'open'` is decided
  when it FIRES, not when it is armed, because a lobby that starts during the window must hand the
  seat to a bot. **The fallback is degraded and the degradation is named, not papered over:** RTDB's
  `onDisconnect` fires at the server the instant the socket drops and cannot be delayed, so there is
  no grace there, and a room orphans in the one case nobody left is permitted to delete it (the host
  crashed, the guests then left cleanly). Closing that needs a rules change or a reaper — one more
  argument for [ROADMAP item 3](plans/ROADMAP.md).

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
- **A level's NAME is derived too, one rung further up the same argument.** ✅ Live —
  `rankForLevel(level)` over a frozen ascending ladder in `packages/game-logic/src/profile/ranks.ts`
  (v1's names, Newcomer → Casino Legend; thresholds retuned to THIS xp curve, not v1's). Nothing
  stores a rank, for exactly the reason nothing stores a `level`: it would be a third copy of one
  fact, and the award site that bumps xp but forgets the rank leaves an account reading Gold
  forever. It rides for free on the leaderboard because it is a function of `xp`, which is already
  in the public projection — **a stored rank would have needed a fifth pinned field and a hand-run
  rules deploy**, which is the derivation rule paying for itself in the same commit that adds it.
  A rank is NOT the equipped `title` cosmetic: one is reached, the other is bought or earned, and
  the profile card renders them side by side so a reader can tell which is which.
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
- **Assets are curated into the repo, not dumped.** ✅ `public/felts/` (three tables, P5), `public/cards/` (standard 52 + backs, UNO
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
- **A `felt` is the table, and all five boards read it (P5).** ✅ Same split as the card back, one
  step further: `src/system/felt/felts.ts` owns the id→file map and knows nothing of the profile,
  `useEquippedFelt()` resolves it to a URL, and `<Card felt={…}>` in `src/ui` draws it as a muted
  `object-cover` layer behind the content. The kit takes a URL and never a cosmetic id — a Card
  cannot ask who is signed in. **There is no default felt**: `feltSrc(undefined)` is `null`, which
  is the plain `bg-base-200` table every board has drawn since Phase 6, so the kind is purely
  additive on a live app and an account that buys nothing looks unchanged. It is drawn at
  `opacity-80` over the base surface deliberately — every contrast pair in the theme is computed
  against the base surfaces, and a felt at full strength would quietly become a background colour
  nothing had checked text against.
- **A `frame` is a ring around your avatar, and it has no art and no new colour (P5).** ✅ The asset
  sweep found essentially no ring art, and the answer was theme tokens rather than sourcing — but
  the tokens are P2's **rarity** ladder, not new ones. So a frame's colour IS its rarity (a free
  status signal), and the kind adds **zero hues** to a glow budget this file calls nearly spent.
  `src/system/frame/frames.ts` maps id→tone, `RARITY_RING` maps tone→a flat `border-rarity-*`
  class shared with the store card, and `<Avatar emoji size frame>` (`src/system/profile/`) is the
  one component the top bar, the leaderboard row and the profile card all render — three copies of
  a bare `<span>` collapsed into one in the commit that first needed them to agree. With no frame
  it collapses to exactly that bare span, so nobody's top bar moves. **The frame is your own only**:
  the leaderboard passes none, because projecting another player's frame means a fourth pinned
  `$other: false` node and its own hand-run deploy (owner decision). `<Avatar>` takes it as a prop
  precisely so that later change is one prop, not component surgery.
- **A celebration is its own role, not a borrowed payout (P5).** ✅ `unlock` (an achievement fired)
  and `fanfare` (a pack revealed) are real roles with staged CC0 files. `win`/`jackpot` answer
  "this hand went your way" many times an hour; these answer "you got something you keep", and P4's
  pack reveal borrowing `jackpot`/`win` as a stated placeholder made an unlock sound like a payout.
  Both are single-file, not variation pools: pools exist for `deal`/`chip`-style bursts that
  machine-gun, and a celebration is punctuation. Both play sites fire **once per batch**, not per
  badge — a chain tier can unlock several at once.

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
| Formatting is Prettier's, not opinion | `format:check` on `prebuild`. The script existed from Phase 0 with **zero callers** — v1's `validateAndCommit()` defect, in this repo, on this file's own advice — so 15 files had quietly drifted before anything went red |
| Types are real, not decorative | `tsc -b` strict + `recommendedTypeChecked` |
| `firebase/*` only under `src/system/repo/firebase/`; concrete repos only from `src/system/repo/` | `@boardwalk/no-firebase-imports` — SDK + `@firebase/*`, `export…from`, dynamic `import()`, and resolved relative escapes |
| A game's `logic/` imports nothing impure (React, `@/system`, `@/ui`) | `@boardwalk/no-impure-logic` — path-scoped to `**/logic/**` under **both** games trees (`GAMES_DIRS` = `src/games` + `packages/game-logic/src/games`), resolves specifiers so relative escapes fire |
| No game imports a sibling game's folder | `@boardwalk/no-cross-game-imports` — same two-tree `GAMES_DIRS`; resolves specifiers (a single-`../` escape fires); the registry is exempt |
| Tic-Tac-Toe's rules are correct | `tests/ticTacToe.test.ts` (27) — every win line, draw-vs-win, `play` immutability + illegal-move no-op, the house (takes a win, blocks a loss, opens centre, perfect-vs-perfect draws), and the DIFFICULTY TIERS: `perfect` still exactly `bestMove` (the default, so the shipped house must not have moved), `sharp` preferring a win to a block and losing to a fork (a middle tier, not a second `perfect`), `casual` reaching every legal cell and no other, a broken rng (NaN/1/-1) clamped rather than indexing off the board, `perfect` never losing to `casual`, and — the one that matters most — every level × every level played to the end with each move asserted `canPlay` and each `play` asserted to CHANGE the state, because a bot move the reducer refuses is a no-op on a bot's turn and stalls the table forever |
| Blackjack's rules + casino payout are correct | `tests/blackjack.test.ts` (26) — ace-soft `handValue`, natural-vs-3-card-21, dealer stands-on-all-17s at the boundary, the full settle matrix, the **integer-safe 3:2 payout on an odd wager** (the v1 `parseInt` chip), and the pure reducer (deal/hit-bust/stand/double/no-op) |
| Chess's rules are correct | `tests/chess.test.ts` (40) — FEN round-trip, 20 opening moves, piece movement + blocking, check/pin/out-of-check, castling (both sides, out-of/through-check, blocked, rights bookkeeping incl. captured-rook), en passant (set/capture/expiry), promotion (four pieces, chosen + default), fool's/scholar's mate + winner seat, stalemate-not-mate, insufficient-material + fifty-move draws, and `playMove` totality (illegal/finished → unchanged) + input immutability |
| UNO's rules + wire projection are correct | `tests/uno.test.ts` (30) — 108-card deck composition, deterministic shuffle, colour/value/action-of-any-colour matching, `deal` (7 each, opens on a number), the action cards (skip→+2 seats, reverse flips/heads-up-skips, draw2/wild4 deal+skip the victim), a wild refused without a chosen colour, the UNO-call +2 penalty vs declared, the win (turn stops), reshuffle-on-empty, `chooseAiMove` (legal play / draw-when-stuck / most-held wild colour / declares UNO) and its TIERS (`sharp` the default so the shipped bots are unchanged, `casual` reaching every playable card and no unplayable one, `casual` always naming a colour for a wild — a wild without one is refused — and **`casual` still calling UNO, because a bot that does not can never win**: a hand reaches zero only through one, and going to one undeclared is what the +2 punishes, so an undeclaring bot bounces off one card back to three and a four-casual table ran 3,000 turns with no winner; whole dealt games are played to a WINNER at both levels with every move asserted to change the state), `applyMove` totality (off-turn / no-such-card / unplayable / finished → unchanged) + input immutability + structural sharing of untouched hands, and `toPublic` hiding every card behind sentinels |
| Every UNO card maps to art on disk | `tests/uno-art.test.ts` (4) — all 108 `unoCardSrc` paths resolve in `public/cards/uno/`, the action-kind→filename map (`skip`→`block`, `reverse`→`inverse`, `draw2`→`2plus`), both colourless wilds, and the back |
| Solitaire's Klondike rules are correct | `tests/solitaire.test.ts` (34) — a 52-card face-down deck, deterministic shuffle (permutation, input untouched), the deal (column sizes 1–7, only the top face up, 24 to stock), `canStackTableau`/`canStackFoundation` (King-on-empty, alternating descending, Ace-on-empty, up-by-suit), `isValidRun`, `liftable` (waste/foundation tops, a tableau run, never the stock, refuses a face-down start), the draw (1 and 3, waste→stock **recycle** re-serves the order and bumps the `recycles` counter the Clean Sheet feat reads, no-op when empty), moves (waste→foundation, a run move that flips the exposed card, King-only-on-empty, illegal no-ops, one-card-to-foundation), `auto`, win detection, `canAutoComplete`/`autoComplete`, a won game frozen but re-dealable, and input immutability |
| The security rules do what they say | `tests/database-rules.test.ts` (64) — boots the RTDB emulator, loads the **real** `database.rules.json`; the refusal of a stored `level`, the shape of every Phase 4 field, `wins`+`played` allowed but nothing beyond it, the P2 `equipped` map (card back + title accepted, a stray `frame`/`avatar` key and a wrong-type/over-long id refused), and Phase 5's rooms/hands/chat: owner-only hand reads, forged-author refusal, monotonic `seq`, self-only presence, no-evict seat claims, host-only room removal and host-only hands cleanup. Phase E added `dice` as the fifth `equipped` key (accepted whole and alone, wrong-type and over-long refused per-key), and moved the STRAY-key example to `chip` — the kind `catalog.ts` still withholds for want of a reader, which is what `dice` used to be |
| Every leaderboard board ranks the way its name says | `tests/boards.test.ts` (16) — the four boards (wins/richest/level/win-rate), each board's order + tiebreak chain on a hand-built set, the win-rate min-games floor (a 1/1 player filtered off the skill board), `boardById` fallback, and `rankFor` non-mutation |
| A production build without Firebase config | `vite.config.ts` fails `build`, naming every missing var |
| `dist/404.html` is a byte-copy of `index.html` (Pages SPA fallback) | `scripts/spa-fallback.mjs` throws on missing/mismatch during `build`; `tests/spa-fallback.test.ts` (4) |
| A cached page whose chunks a deploy deleted reloads itself ONCE — and never loops | `tests/stale-build.test.ts` (11) — the pure `shouldReloadForStaleBuild` (cooldown boundary, garbage in the key never *blocking* recovery, a future timestamp treated as stale so a clock rewind can't disable it), the handler (reloads once, declines the second and lets the error surface, survives a throwing `sessionStorage`), and the inline boot-guard in `index.html` — present, ordered before the module entry, capture-phase, and pinned to the SAME key/cooldown as the module it cannot import |
| The deploy workflow injects every env var the source reads | `tests/deploy-env.test.ts` (4) — `.github/workflows/deploy.yml` vs the `import.meta.env` names in `src/` (`VITE_API_ECONOMY`/`VITE_WS_ROOMS` were once kill switches nobody wired) |
| The WS transport survives a reconnect without losing a subscription | `tests/socket.test.ts` (8) — handshake gate, request/reply correlation, immediate-cache replay to a late subscriber, resubscribe-on-reconnect |
| The level curve is exact at every boundary | `tests/xp.test.ts` (13) — every threshold and its neighbours, plus a brute-force oracle |
| A level's RANK NAME cannot drift from the ladder | `tests/ranks.test.ts` (11) — the ladder's own invariants (starts at level 1 so every level has a rank, strictly ascending `minLevel`, unique ids/names — the properties `rankForLevel`'s backwards walk silently depends on), every rung AT its `minLevel` and the level below it at the previous rung, the top rank held forever above the last rung, garbage floored rather than thrown, `nextRankAfterLevel` null at the top and agreeing with `rankForLevel` about every boundary, and the ladder read against the REAL xp curve (a fresh account is a Newcomer; Bronze is 15 wins away; the top rung lines up with the Platinum tiers at level 50). Falsified by re-ordering one rung: a ladder out of order does not throw, it returns the wrong name forever |
| The economy is correct — limits, payouts, XP, unlocks | `tests/economy.test.ts` — `validateBet`/`clampBet`, and `applyResult` proving `big_win` fires on *net* not gross and never twice, money floored, input unmutated |
| Stats count right; achievements fire at the boundary | `tests/progress.test.ts` (10) — `bumpStats` immutability + per-game keys, and `satisfiedAchievements` at the exact threshold for the standalone badges (`first_win`, `big_win`, `high_roller`, `table_regular`) and the level/bankroll chain rungs |
| Achievements 2.0 — chains, grant, feats, hidden, completion % | `tests/achievements.test.ts` (24) — every chain tier at its boundary and one below (wins 10/50/100/500, bankroll $10k–$1M, level 5/10/25/50, per-game chess & blackjack 1/10/50/100), the mastery chains read the right game's wins, the earn-only grant lands in `inventory` on the completing tier only, not early, and exactly once; `recordedFeats` filtered to `FEAT_IDS` + de-duped; a game **cannot** forge a chain badge (or its grant) through the feats channel; feats fire once and carry no `test`; `completionPct` derivation; and catalogue integrity (unique ids, four ordered tiers per chain, only the two mastery Platinums grant, `feat`⇔no-`test`) |
| Packs pull at the published rate, and can never drop what money must not buy | `tests/packs.test.ts` (29) — odds sum to 1 and the empirical distribution matches them over 20k seeds (the card's table IS the roll), every weighted rarity has a non-empty bucket, the pool excludes **every earn-only cosmetic and every free starter** (asserted over the catalogue AND exhaustively over the roll; the earn-only half is additionally unspellable — `PackPull.item` is a `PackableCosmetic` reachable only via `isPackable`), a seeded roll is deterministic, a fresh pull spends exactly the price and grants the id, a duplicate refunds **completion-scaled** dust and grants nothing, dust is monotonic in completion and never exceeds the price at any completion (incl. clamped nonsense input), the roll pays the same number the shelf quoted, `completion` is derived per-pool and ignores foreign inventory, `canOpen` refuses a short bankroll and a completed pool, every pool item is reachable, bankroll floored at 0, input unmutated |
| A bankrupt top-up is a lifeline and not a faucet | `tests/refill.test.ts` (7 — the shared rule: a top-up reaches EXACTLY the floor from any balance below it, refuses at the floor and above, `null` and not `0` when ineligible so a caller cannot bank an empty grant, integer cents from a fractional balance, and the anti-faucet property stated directly — **no sequence of refills, interleaved with losses, leaves anyone above the floor**, which a flat `+N` grant would fail) + `boardwalk-api/tests/refill.test.ts` (14 — everything that needed the referee's own state: eligibility judged against the LEDGER balance, the once-a-day limit counted off the ledger's own rows and refusing a SECOND top-up with a fresh nonce, the allowance resetting the next UTC day, a **wound-back clock unable to re-open it** (the window is `>= startOfToday` with no upper bound, on purpose), a refusal costing neither the nonce nor the day, a replay paying once, money moving and **nothing else** — no XP, no stat, no badge — and 100 days of maximal grinding never once passing the floor). Falsified by removing the daily limit: four go red |
| Daily streak and store math | `tests/rewards.test.ts` (streak/gap/clock-rewind/cap), `tests/store.test.ts` (21 — afford/own/buy/equip across all three kinds, unique ids + avatar-only unique emoji, every rarity present, earn-only unbuyable at any bankroll + has an unlock line, card back/title equip into the `equipped` map without dropping the other, `equippedTitle`) |
| Money has no setter a game can reach | Type — `useBankroll(): number`; the one writer (`mutateProfile`) is on no game-facing surface, and `useBet`/`reportResult` are the only sanctioned paths |
| The client cannot move its own money, nor mint its own badge | `boardwalk-api/tests/economy.test.ts` (62) — bet refused past the LEDGER balance, a settle with no open wager refused, a payout over the per-game ceiling refused with the wager left OPEN, one wager pays out once, open wagers consumed oldest-first, an earn-only cosmetic unbuyable at any balance, a purchase charged at the SERVER price, the daily clock refusing a wound-back claim, every mutation replay-safe (a repeated nonce moves nothing and does not double a stat), and Phase D: **`checkSettle` refuses `gameId: 'blackjack'` outright** (the dealer settles that game), XP and stat counts come from the OUTCOME and never from the wire, the server **awards `first_win` itself on a real win with nobody reporting it** and does not award it on a loss, unlocks once and never revokes, a replayed settle re-awards and re-grants nothing, and **a forged badge, a forged grant, and a chain id smuggled through `feats` all change nothing** — while a real feat, which no state predicate could have seen, is recorded |
| Blackjack's dealer is the server, and it never sends what it should not | `boardwalk-api/tests/blackjack.test.ts` (22) — `dealHand` deducts from the LEDGER balance and opens a wager row, refuses a stake the balance cannot cover **and deals nothing**, gives the nonce back on a refusal so the same nonce deals once affordable (the `return`-out-of-a-transaction COMMITS bug, which was leaving an orphan hand and a burned nonce), settles a dealt natural immediately at an integer 2.5× on an odd wager, and leaves a live hand's stake open; `playMove` hit-to-bust pays nothing, stand plays the dealer out and pays exactly what the shared rulebook says, a double takes a SECOND wager and settles against the doubled stake and is refused whole if the balance cannot cover it, a move on a settled hand and a hand id belonging to another account both refused; replay safety on both routes (no second hand, no second card, no doubled payout); and the projection — the hole card and the deck absent while live, the dealer revealed once settled, `viewOf` carrying no deck at any phase — plus the routes answering `{profile, hand, replayed}`, **ignoring a hostile body carrying `payoutCents`, `outcome`, `result` and cards**, 400 on an unparseable body, 409 on a refusal, 401 without a token |
| `PUT /profile` cannot set a balance, XP, stats, achievements or inventory | `boardwalk-api/tests/api.test.ts` (21) — a hostile body carrying all five is accepted and changes none of them; the opening stake is the server's `signup` grant and fires exactly once per uid; 409 (not 400) for a refusal, 400 for a missing nonce |
| The dealt-hand seam plays the shared rulebook and hides the hole card | `tests/blackjack-seam.test.ts` (10) — the LOCAL implementation driven against the shared reducer as an oracle (deal/hit/stand/double card-for-card, the stake taken once, a double staking twice and settling over the doubled wager, a dealt natural settling inside `deal` with the odd-wager 3:2 exact), the refusals (an unaffordable stake writes NO intent, a repeated nonce replays instead of dealing again, an unknown hand refused), and the projection: a live hand carries one dealer card with the hole card and the deck absent from the serialised payload, a settled one reveals — asserted against the **shared** `viewOf` (`@boardwalk/game-logic/games/blackjack`), which all three call sites now import, so the test asks whether what the repo hands out *is* the sanctioned projection rather than whether two copies of it resemble each other |
| The Firebase→SQLite backfill cannot lose an account or mint one | `boardwalk-api/tests/backfill.test.ts` (34) — the RTDB wire coerced (stripped-empty objects, hostile types, a missing bankroll defaulting to the opening stake rather than $0, a legacy `level` ignored); one `migration` ledger row sized to LAND on the Firebase balance; the `migration:v1` marker making a re-run a total no-op (ten runs, and a re-run that must NOT refund a loss the player has since taken); **a backfilled player signing in afterwards is refused a second signup stake**; per-uid transactions so one malformed record does not roll back the batch; a dry run that writes nothing and does not burn the marker; and `reconcile` catching two swapped balances that a matching grand total would hide |
| The room referee arbitrates seats, and a forged uid cannot claim one | `boardwalk-api/tests/rooms.test.ts` (19, the store/seat logic) + `gateway.test.ts` (18, driven over a REAL socket) — handshake auth, host-only gating, monotonic `seq`, owner-only private hands, author-pinned chat, disconnect→seat-release |
| A crashed player does not strand a table, and a blip does not cost a live player their seat | `boardwalk-api/tests/gateway.test.ts` crash-recovery block (7, over a real socket **terminated** rather than closed) — a kill mid-game hands the seat to an AI *after* the grace window and the room survives with the other player told without asking; a reconnect inside the window **keeps** the seat; `'ai'`/`'open'` decided at FIRE time (a lobby that starts during the window still yields a bot); a lobby drop opens the chair; a seat claimed by a socket that **never declared presence** is still released; a second tab of one account is **not** a departure; and a crash that empties the room GCs it at once, taking its chat and hidden hands with it — the whole of "no orphaned rooms/hands/chat" on this path, since they are one record. **The mid-game AI branch had ZERO coverage before this** while the gateway's docblock claimed it |
| The RTDB fallback arms a teardown a crashed tab cannot run — and the rules permit it | `tests/crash-recovery.test.ts` (7) — the pure `disconnectUpdates`: a guest seat armed to AI mid-game and OPEN in the lobby, a guest arming **neither** room/hands/chat, a host-alone taking all three in ONE write and **not** its own seat (the resurrection hazard `teardownPlan` documents), a seat-less spectator arming nothing, and no armed write ever carrying a `uid` (the seat validator would refuse it and the table would stall exactly as before). Plus the enforcement half in `tests/database-rules.test.ts` (4, real emulator, real rules file) — the host's atomic three-path delete **succeeds** (all three rules authorise against `meta/host`, so sequential deletes would de-authorise each other; falsified by dropping the hands delete rule), the same write from a guest is refused, a guest may arm its own seat to AI, and no-evict still refuses arming someone else's |
| A client cannot bank more offline results than it was issued tickets for, and a replay pays once | `boardwalk-api/tests/tickets.test.ts` (37) — sign/verify round-trip, a tampered ticket, one account's ticket refused for another (the uid is in the MAC, not the string), a short signature refused rather than THROWN (`timingSafeEqual`'s length trap), non-canonical sequences (`01`/`1e0` are not second spellings of `1`), the rotation window (previous key verifies, a key rotated all the way out is refused and flagged `retired`, and selection is by `kid` — proved by a ticket that must ALSO fail on a server holding only the other key), **20 fabricated devices yielding exactly `TICKET_BATCH` between them**, a sequence never issued refused (the key-leak bound), the gate refusing a client-minted nonce while enforcement is on and ACCEPTING one while it is off, `/bet`+`/daily` untouched by the gate, spend accounting not doubling on a replay, and **the attack itself: bank a settle, re-send it five times, assert one ledger row, `played` 1, `won` 1** |
| The offline queue's rules | `tests/offline-queue.test.ts` (19) — spend order, **`takeTicket` returning null rather than minting when exhausted**, top-up at the low-water mark, "unknown server" still asking (a `null` treated as `false` would send the first settle self-minted into a 409), cap = batch, drop-oldest, re-stamp swapping only the coupon, and persistence: garbage degrades to empty instead of throwing at boot, a hostile `localStorage` cannot smuggle a `purchase` or `daily` into the outbox |
| The flush loop's orchestration | `tests/offline-store.test.ts` (15) — drain order, STOP at the first network failure (never burn the queue against a dead connection), a retry replaying the ORIGINAL nonce, adopt-only-when-empty (mid-drain would roll back XP for a result still queued), a genuine refusal dropped **without burning a spare ticket** (the case a first draft passed for the wrong reason — see the falsification note in the plan), a retired ticket re-stamped exactly once, and no two concurrent drains |
| The profile the server hands back is the one it stores | `boardwalk-api/tests/profile.test.ts` (9) |
| A backup restores, and the drill says so | `boardwalk-api/tests/backup.test.ts` (16) — online-backup API (not a file copy), `PRAGMA integrity_check` on the RESULT, balances recomputed from the restored ledger, and a corrupt/unopenable file reported red rather than thrown |
| The Phase-A shadow diff + mirror are correct | `tests/shadow.test.ts` (13) — `diffProfiles` (clean round-trip empty, null read-back as one whole-profile diff, scalar/nested-stat/daily mismatch, a field present on only one side), and `shadowProfileRepo`/`mirrorProfile` (reads through the primary alone, mirrors on save, a throwing mirror never rejects the write — Firebase stays authoritative) |
| A rematch needs everyone, and cannot be satisfied by a ghost | `tests/rematch.test.ts` (13) — `castVotes` (idempotent, additive, votes every local seat at once for a hot-seat screen, input untouched), and the tally: only HUMAN seats are asked, one human at a table of bots restarts on a single click, a departed player's stale vote is ignored because `needed` is recomputed from the current seats, and **an all-bot/empty table never agrees** (the `every`-over-an-empty-list trap that would restart a dead room forever). Falsified by dropping the `needed.length > 0` clause and by counting raw vote keys instead of the needed subset — one test each |
| Seats/ordering/lifecycle are correct | `tests/room.test.ts` — claim (open-before-ai, no-evict), `releaseSeat` fallback, `localSeatIds` ×3 modes, `aiSeatsToDrive` host-only, `seq` strictly-fresh + shuffled-delivery, `teardownPlan` (host clears chat/room, guest doesn't) |
| Chat orders by key, not clock | `tests/chat.test.ts` — `messageKey` fixed-width ASCII sort = send order, counter tiebreak/rollover, `sanitizeMessage` |
| Every sound role names a file that is staged | `tests/audio.test.ts` (4) — every `sounds.ts` file exists in `public/audio/`, every role non-empty, variation pools distinct, `click` primer single-file. Covers P5's `unlock`/`fanfare` by construction (the test walks the registry, so a role added without its file is red) |
| Every card + every card back maps to art that is on disk | `tests/cards.test.ts` (8) — all 52 `cardSrc` paths resolve in `public/cards/standard/`, suit-casing + `10`, every `CARD_BACKS` id resolves, an unknown/absent back id falls back to the default (never a 404), a known id maps to its own file, **every `cardback` store cosmetic resolves to art + the default back is a free starter**, `isRed` |
| Every felt maps to art that is on disk, and the store sells no felt without it | `tests/felts.test.ts` (7) — every `FELTS` id resolves in `public/felts/`, each id maps to its OWN file (two ids sharing one image is the store selling a felt twice), `null` for nothing-equipped AND for an unknown id (a retired felt degrades to a bare table, never a 404), base-path awareness, plus the catalogue half: every `felt` cosmetic resolves to art, none is a free starter (the default is NO felt), none is earn-only (no chain grants one) |
| A frame's ring colour cannot drift from its rarity | `tests/frames.test.ts` (6) — every catalogue frame is registered and every registered id is real (both directions, so a tone for an unbuyable frame is dead data too), **each frame's tone EQUALS its catalogue rarity** (the one that would actually rot: re-tier a frame and its ring keeps the old colour, which no disk check and no compiler can see), every tone resolves to a **flat** `border-rarity-*` class carrying no shadow/glow — the guard that keeps this kind off the glow budget — and `null` for nothing-equipped/unknown |
| A new column reaches the database that already EXISTS, not just a fresh one | `boardwalk-api/tests/migrations.test.ts` (6) — builds the pre-P5 `profiles` table by hand, proves `migrateColumns` adds `equipped_felt`/`equipped_frame` and leaves the old columns alone, that ten re-runs are a no-op, that every `COLUMN_MIGRATIONS` entry names a column the fresh DDL also creates (the two halves diverging is how one path silently misses it), and that a migrated database round-trips a felt and a frame. **`migrateColumns` carried a comment claiming this test since Phase B; it did not exist.** Falsified by dropping the two P5 entries: these go red while the rest of the API suite stays green, which is exactly the prod-only blindness the file exists for |
| All four equipped slots survive the server round-trip | `boardwalk-api/tests/api.test.ts` (21) — a `PUT /profile` carrying cardback+title+felt+frame reads back with all four, asserted on a FRESH `GET` and not merely the write's own echo (a write can echo its input while the columns never held it), and un-equipping a felt CLEARS the column rather than leaving the old id |
| A declared pre-game option is well-formed, and resolves to a value the game offers | `tests/game-options.test.ts` (11) — `resolveOptionValues` turning nothing/partial/unoffered/wrong-typed/foreign-keyed input into a complete valid set, `setOptionValue` refusing an unknown id or unoffered value **by identity** (a no-op that does not re-render), and the DECLARATION half over the real registry: unique option ids, unique choice values, and **the default is one of the choices** — the failure that typechecks, throws nothing, and renders a control with nothing selected (falsified by re-defaulting Solitaire's `draw` to `'2'`); plus the AI-difficulty declarations as a BIJECTION — every declared choice maps to a level of its own and each game's default is still the level it shipped, the rot being a fourth choice added to a manifest that the mapper silently collapses into an existing tier while the control renders perfectly (falsified by adding a `brutal` choice to Tic-Tac-Toe) |
| Every game icon a manifest names is on disk | `tests/game-icons.test.ts` (2) — every `manifest.icon` resolves in `public/games/`, and `gameIconSrc` is base-path-aware + undefined-safe |
| `boardwalk-api/` is linted, typechecked, tested and built in CI | `boardwalk-api/eslint.config.mjs` (flat, type-aware over `tsconfig.test.json` so **src, tests and `vitest.config.ts`** are all in the program — the build config includes only `src`, and the usual cure for the resulting "not in project" noise is to stop linting tests) + `.github/workflows/api.yml` on push **and pull_request**, `paths`-filtered to the package *and the workflow file*, so a change disabling the guard is checked by it |
| Liar's Dice's rules are correct | `tests/liars-dice.test.ts` (44) — the deal clamped to 2..6 seats (v1's `[5,5,5,5]` literal made a 2- or 3-player match UNWINNABLE), wilds counted once and never twice on a bid of 1s, the **wild-ones conversion** (halve into 1s, double-plus-one out), opening refused on wilds but allowed in palifico where they are not wild, palifico's locked face, spot-on both directions (everyone-else vs the caller alone), elimination + a 2-player match that CAN be won, turn authority, `applyAction` totality + immutability, the projection asserted STRUCTURALLY (`'dice' in view === false` + a `JSON.stringify` scan), the reveal opening every cup and only at a reveal, and the house — never returning an action the reducer would refuse (an illegal bot action is a no-op, and a no-op on a bot's turn stalls the table forever) |
| The referee deals Liar's Dice, and the money is its own | `boardwalk-api/tests/liarsDice.test.ts` (25) — antes taken through the LEDGER with a wager naming the match, NO betting below two humans (the pot would be your own ante handed back), an unaffordable ante refusing the WHOLE start and writing nothing, the nonce given back on refusal, authority by MEMBERSHIP (another account's match is a refusal, not a read), off-turn and illegal actions refused, the pot paid to the seat the RULES say won with wagers closed by match id, `recordOutcome` once per human, replay safety on both routes, and the boot sweep — a restart voids and REFUNDS every live match, because the room is in memory and the antes are not |
| A dealt table never sends a cup to anyone but its owner | `boardwalk-api/tests/ldGateway.test.ts` (10, over a REAL socket) — each player sent their own five and `null` for every other seat on every frame, the public state carrying counts and no dice anywhere in the serialised payload, the antes taken and the pot paid with no client naming a number, a non-seated socket and an off-turn action both refused, a bot driven by the REFEREE with its cup written nowhere, and `parseAction` refusing (not coercing) anything that is not one of the three actions, extra hostile fields dropped |
| `patchState` cannot be called by a stranger who knows a room code | `boardwalk-api/tests/gateway.test.ts` patchState block (2) — a socket holding no seat and not hosting is refused; a seated player and the host (who may hold no seat — UNO's dealer does not) are permitted. The handler's comment claimed this authorisation for two phases while checking only that the room existed |
| A room survives a remount instead of being collected between two effects | `boardwalk-api/tests/gateway.test.ts` reap block (2) — an `unpresence`/`presence` pair leaves the room alive, and an `unpresence` nobody returns from still collects it. React StrictMode sends a real `unpresence`, so before this NO WS room game could be developed locally: the table died the moment it was created |
| Every dice set maps to six faces on disk, and the store sells none without art | `tests/dice.test.ts` (10) — all six faces of every registered set resolve in `public/dice/`, each set has six DISTINCT files (a set missing only its 6 looks fine until somebody rolls well), each id maps to its own art, an unknown id falls back to the free STARTER rather than 404ing (a die must always draw — the card-back rule, not the felt's `null`), a known id gets its own art and not the fallback, every catalogue set is registered, exactly one free starter, and no earn-only set with no grant site |
| Every test count quoted in this table is the real one | `tests/claude-md-counts.test.ts` (2) + `boardwalk-api/tests/claude-md-counts.test.ts` (3) — each reads the counts out of `vitest list` (the COLLECTOR, so no emulator boots and nothing runs) and diffs them against every `` `path` (N) `` this file claims, reporting **all** drift at once rather than one failed run at a time. Split in two because `boardwalk-api` is outside the workspace with its own `npm ci` and its own CI job, and a single guard would have to *skip* the half it could not install — a guard that skips reports success by doing nothing. A bare mention with no number is ignored on purpose (the table names files without counts, and `tests/economy-parity.test.ts` is discussed in the past tense as deliberately deleted). The API half also pins the suite total in Develop. **The spawn lives inside the `it`, never the `describe`** — a `describe` body runs during collection, so the first draft re-entered itself through `vitest list` and hung until it was killed |
| Every guard above actually fires | `tests/lint-rules.test.ts` (48 — the two Phase-6 rules proved **twice**, once per games tree, falsified by dropping `packages/game-logic/src/games` from `GAMES_DIRS` and watching exactly the three new cases go red), `tests/file-size-guard.test.ts` (7), `tests/credentials.test.ts` (25), `tests/firebase-config.test.ts` (8) |

| Not yet enforced | Lands in |
|---|---|
| Rules deployed from CI (`npm run rules:deploy` is manual) | unguarded — **see below** |
| **Offline hardening is DEPLOYED and ENFORCING** | ✅ 2026-07-18, all three phases, verified in prod from the artifact: `/health` on the Funnel returns `tickets: "on"`, a live tic-tac-toe win settled with a **signed ticket** (`v1.<kid>.<device>.<seq>.<sig>`, 200), the book went 64→63, that ticket re-sent **3×** answered `replayed=true` with xp and bankroll unmoved, and a client-minted nonce was refused **409 `not a ticket`**. `ticket_devices` accounting matched the client exactly (issued 64 / spent 1 / outstanding 63). The real player's row was untouched throughout (xp 700, $5,215.00) and the throwaway account was deleted from SQLite **and** Firebase Auth. **The secret is the cutover and goes LAST** — setting it before the client shipped 409'd every settle from the deployed frontend, which happened for ~2 minutes with no impact; rollback is renaming the env key and restarting, no rebuild. Three-phase procedure: [plans/done/OFFLINE_HARDENING.md](plans/done/OFFLINE_HARDENING.md#deploy-order--three-phases-and-the-secret-goes-last) |
| **P5 is DEPLOYED — both surfaces, both verified from the artifact** | ✅ **DONE 2026-07-18, and the frontend merge is unblocked.** (1) **Rules**: `GET /.settings/rules.json` on `boardwalk-fca02-default-rtdb` returns an `equipped` block carrying `cardback`, `title`, `felt`, `frame` and `$other: false`. **Deployed once from the wrong tree first** — the command ran in the primary checkout, which sits on `main` and does not carry the branch, so Firebase released the OLD four-key-less file and printed the identical green `Deploy complete!`. A rules deploy is only meaningful from a tree that HAS the change, and only provable by reading the rules back. (2) **Pi**: two rsyncs (`packages/game-logic` as a sibling, then `boardwalk-api`), `npm install && npm run build && npm test` ON the device — **194/194 green** — then restart. `PRAGMA table_info(profiles)` now lists `equipped_felt` and `equipped_frame` (COLUMN_MIGRATIONS ran on open), `dist/db/schema.js` carries both, and the ledger is byte-identical either side of the restart (1 profile, 2 rows, $5,215.00, `integrity_check` ok). The Pi's `package.json` was found **stale**, not hand-patched — still the Phase-D `--prefix` scripts that `54f8a98` replaced with `build:shared` — so the Pi can drift behind `main` between deploys, and a deploy is the thing that reconciles it |
| Phase B is DEPLOYED and the backfill has RUN | unguarded — both done by hand 2026-07-18 and both **verified on the box, not inferred**. Server: deployed from `cb42e44`, `dist/domain/economy.js` present, `mutations` + `wagers` migrated in, 143/143 API tests green ON the Pi, deployed hashes match the commit. Client: `VITE_API_BASE_URL` is baked into the prod bundle (the `gameContext` chunk names the Funnel URL) and the Pi's CORS returns 204 for the Pages origin. Backfill: **1 `migration:v1` marker** present (it was 0), and SQLite matches Firebase field for field — `bankrollCents` 521500, `xp` 700, `played` 19, `wins` 5. **Nothing in this repo can prove any of it**, and a health check is NOT evidence: `/health` answers identically under Phase A and Phase B, which is exactly how this row twice claimed something it could not see. Check the marker and the parity, or check nothing. **Verified in prod 2026-07-18** — bet/settle/purchase/daily round-tripped against the live Pi on a throwaway account (since deleted): a replayed nonce moved nothing, a $1M payout with no open wager was refused 409, an earn-only title was refused, and a hostile `PUT /profile` carrying `bankrollCents: 999999999` left the balance at the server's own `500000`. See BACKEND_PLAN.md |
| **The Pi is CURRENT with `main` (2026-07-21)** | unguarded — done by hand and **verified from the artifact, because the exit code proves nothing**. Deployed from a clean detached worktree at `b13f9c6`, never the shared checkout (a concurrent session's edits once beat an rsync by seconds). Two rsyncs — `packages/game-logic` to `~/packages/game-logic` as a sibling first, since `refillGrantFor` is new shared code the API imports — then `npm install && npm run build && npm test` ON the device: **293/296**, the 3 failures being the expected `claude-md-counts` `ENOENT` on a `../CLAUDE.md` that does not exist beside a standalone directory. It cleared **two** owed deploys at once: Liar's Dice's server half and the bankrupt refill. **The obvious liveness check was inconclusive and is written down so nobody repeats it**: `POST /refill` → 401 looks like proof the route exists, but `POST /bogusroute` → 401 too, because auth runs before routing. What actually proves it: `dist/routes/economy.js` carries `/refill`, `dist/domain/mutations.js` carries `applyRefill`, and the running PID started **541 seconds after** every one of those files was written, with `cwd` in the rsync'd tree. Ledger byte-identical either side of the restart (2 profiles, 7 rows, $8,935.00, `integrity_check` ok, 0 refill rows) |
| Phase D is deployed to the Pi | **DONE 2026-07-18.** The unverified half resolved to the bad case — the Pi is a standalone `~/boardwalk-api` directory, not a git checkout — so `packages/game-logic/` is now rsync'd to `~/packages/game-logic` beside it and the relative `file:` dependency resolves. `ExecStart` never moved. Procedure + the `--omit=optional` trap are in [BACKEND_PLAN.md](plans/done/BACKEND_PLAN.md#the-deploy-delta-phase-d--done-and-what-it-turned-out-to-be). **The Pi deploys by hand while the frontend deploys on push, so the Pi goes FIRST** — merging Phase D before it broke prod blackjack for ten minutes |
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
npm run build          # prebuild (lint + format:check + filesize) → tsc -b → vite build. FAILS without Firebase config.
npm run guard:filesize -- --init   # re-lock the ratchet after a file SHRANK
npm run rules:test     # just the security rules, against the emulator
npm run rules:deploy   # push database.rules.json to Firebase. NOTHING IN CI DOES THIS.
```

`boardwalk-api/` is a **separate package** — not in the npm workspace, its own lockfile, its own
tooling. The root's `lint`/`test`/`build` do not reach it and are not supposed to; it has its own,
gated by `.github/workflows/api.yml` (push + PR, `paths`-filtered):

```bash
cd boardwalk-api && npm ci
npm run lint        # eslint . — src, tests AND scripts/*.mjs. Type-aware over tsconfig.test.json
npm run typecheck   # tsc -p tsconfig.test.json — the only thing that typechecks the tests
npm test            # vitest — 296
npm run build       # tsc -p tsconfig.json → dist/server.js
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

The tree has three parts, not two. `src/` is the app; `packages/game-logic/` is the shared rulebook
(an npm workspace — `workspaces: ["packages/*"]`, so the root `npm install` covers it) that both the
app and the referee import; `boardwalk-api/` is the referee, and it is **outside** the workspace on
purpose, depending on the package by `file:` path so it consumes the built CommonJS. Editing a rule
needs no build step for the browser (Vite aliases the source), but `boardwalk-api`'s `build`,
`typecheck` and `pretest` scripts each build the package first, because the server reads `dist/`.
Its tests are separate: `cd boardwalk-api && npm test`.

To drive the room flow locally: `npx firebase emulators:start --only auth,database`, then
`VITE_USE_EMULATOR=1 npm run dev`, and open `/Boardwalk/_dev/lobby` (or `/Boardwalk/play/tic-tac-toe`
to play a real game against the emulator). The flag is dev-only and points the app at the emulators
instead of production.

Phases are listed in [ARCHITECTURE.md](plans/done/ARCHITECTURE.md#phases) — one per conversation, each ends
green and deployed. **Phase 6 is complete: Tic-Tac-Toe, Blackjack, Chess, UNO and Solitaire all
shipped. The launch set of five is done — the next game is built only because one sounds fun, never
to reach a number (see Scope discipline).**

**Every plan in this repo is now closed** — Phases 0–6, backend Phases A–D, and the Progression
Overhaul P1–P5. What outlived them is in [plans/ROADMAP.md](plans/ROADMAP.md), ordered by what goes
wrong if it is never done — and **both items that could still cost data or chips are now closed**:
offline replay-hardening (deployed and enforcing) and room crash-recovery (built and guarded), each
with its design doc in `plans/done/`. What remains cannot move a chip: the *decision* of whether to
close Phase C by deleting the RTDB rooms fallback — **taken 2026-07-18, and the answer was "not
yet"**, with a concrete trigger recorded in place of the un-meetable "longer track record" — and a
sixth game, which is optional forever. That file is explicitly **not** a checklist.
