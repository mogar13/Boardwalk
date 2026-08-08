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
a host who can see every cup is a player who cannot lose. (That same sentence later came for UNO
itself, the moment its pot made it true there too — see the Money section.) So the match lives in SQLite
(`liars_dice_matches`/`liars_dice_players`, authority by MEMBERSHIP rather than ownership — a match
has no owner), the gateway holds the dice, and the client is a renderer. It needed **two new
client→server frames and zero new server→client ones**: the projection rides the existing `room`
broadcast and each cup rides the existing owner-only `private` channel, so the board is thinner than
UNO's rather than thicker. Design and evidence: [plans/done/LIARS_DICE.md](plans/done/LIARS_DICE.md).

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
so the table never stalls), and a table that seats up to **seven**. **The model WAS host-as-dealer and
is now the REFEREE** — UNO's pot moved the cards along with the money (see the Money section), so the
one client that legitimately held every hand no longer does. The gateway holds the complete `UnoGame`
(every hand + the draw pile), runs the pure `@boardwalk/game-logic/games/uno` reducer, and each
transition **projects** a public view (`toPublic` → top card, counts, whose turn, the pot — never a
hidden card) to room state and **deals** each hand to its owner's private node. The deck therefore
never touches the wire at all — strictly more private than v1, whose deck was public — and now neither
does anyone else's hand, the host's own socket included. Every seated human sends a move as a nonce'd
message (`unoMove`) and reads the result off the ordinary room subscription, the host included, so
there is one code path for "a human moved" and no local-apply path to diverge. Two client→server
frames, **zero** new server→client ones. The
rulebook — 108-card deck, legal-play matching, skip/reverse/draw2/wild4, the UNO-call +2 penalty,
reshuffle-on-empty, win detection — is all pure and in `tests/uno.test.ts` (40), with the art resolved
to disk in `tests/uno-art.test.ts` (4).

**A move the rulebook leaves no choice about is one the board takes for you.** A hand with nothing
playable can do exactly one thing — `applyMove` refuses every play from it, and drawing ENDS the turn
here (there is no play-what-you-drew) — so the click was mandatory, and the table sat there until the
player worked out that a fan of dimmed cards meant "go and press the deck". `mustDraw(hand, top,
color)` is the rulebook's own predicate for that position, and BOTH the line under the fan and the
timer that draws read it, so they cannot come to different conclusions about the same hand. **An
empty hand is `false`, not `true`** — that is the whole reason it is a function rather than an inline
`!hand.some(…)`, since a hand is `[]` both when a player has won and while their private node is
still loading, and drawing for a player who has not been dealt in is the one way this could take a
turn that was not owed. The timer is armed by a KEY (`round:eventSeq`), never a boolean: a boolean
re-arms on every republish — including the echo of the player's own pending intent — so a table that
republished faster than the beat would never draw at all, and a dry deck (which returns the game
UNCHANGED, so the seq does not move) would spin instead of stopping. The pile stays live throughout,
so the beat is skippable by clicking it.

**UNO's BOARD is v1's table, rebuilt — the one place this repo went back to The Game Shack for a
design rather than a war story.** The first version wrapped every opponent into a row above the piles,
which is a scoreboard: correct, and silent. v1 seated them around the felt, and in a game where every
hand is face down the SHAPE of the table is most of the information — who plays next, who is nearly
out, which way it is going. So opponents now sit at fixed compass positions (`opponentSlots`, a pure
lookup, `tests/uno-layout.test.ts` (11)), you are at the bottom, and play runs bottom → left → top →
right, so reading the table clockwise is reading the order of play. With it came the rest of what made
that board legible: fanned face-down hands that grow and shrink, a draw pile that is a stack with a
count, the orbiting **direction ring** (reverse is the one action card whose effect is otherwise
invisible), the active-colour pill, the "★ YOUR TURN" cue, and the **move log** — which is not
decoration in a hidden-hand game, because it is the only place the table ever says that a bot drew four
and lost its turn. The log's one design decision: v1 pushed a formatted SENTENCE over the wire
(`lastLogSync`, carrying English, the sender's copy of everyone's names, and a wall-clock timestamp for
de-duplication). Here the host publishes FACTS — one `UnoEvent` derived by DIFFING the game either
side of a move (`describeMove`, so it cannot drift from the rules and a refused move is silent for
free), ordered by its own `seq` — and each client renders its own prose from its own seat names. Rules
facts and copy are tested together in `tests/uno-log.test.ts` (18), every case driven through the real
reducer. The **whole layer is `TPublic`-only**: one new field on the projection, no new node, no rules
change, and nothing hidden crosses the wire that did not before.

**A SEAT IS A HAND ON A TABLE, NOT A ROW IN A PANEL** — the board rebuild fixed the layout and then
reintroduced the thing it fixed, one level down. Opponents were seated correctly and each one was
then drawn as a bordered, tinted box holding 44px thumbnails and the words "7 cards", which is a
scoreboard row that happens to contain pictures. v1 drew an opponent's cards at the same size as
your own with no container at all, and that is why its table read as a table. So the panel is gone,
the fan is 4.5rem a card, and the ACTIVE CUE moved from a glow on the container to the name — cyan,
neon, starred, which is v1's own answer (it glowed the `<h3>`) and one fewer lit rectangle on a
board that already has a lit draw pile, a lit playable card and a turn cue. Three things the
screenshots decided rather than the arithmetic: the step is **not** uniform across the table
(geometrically one figure fans both axes identically, and at that value the far side renders as
vertical stripes, so the flanks take v1's 29% and the top row v1's 44% — the asymmetry in the
original is the correction, not sloppiness); the art ratio is **0.643**, measured off the files, where
the constant said 0.54 and quietly squeezed the top row alone; and an EMPTY hand drops the fan box
entirely, because a badge pinned to the corner of a fan that is not there leaves a glowing pill
floating on bare felt over the name of the player who just **won**. That badge — Boardwalk's own
addition, since v1 never said how many cards anyone held — is the draw pile's deck-count treatment
reused, and it shouts UNO! at exactly one card AND only once they have called it: `calledUno`
survives the winning play, so keying on it alone left the seat that had gone out still shouting with
an empty hand. **AND THE SEATS RING THE PILES AT A DISTANCE THE TABLE CHOOSES, not at the width of
whatever screen it is drawn on** — the flanks were `w-full justify-between`, which is not a distance
at all: on a desktop it threw the side players ~600px out to the edges of the card while the far
seat sat a dozen pixels off the deck, so one table read as three unrelated groups. A shape that
changes with the viewport carries none of the information the shape is there to carry. The row is
content-width and centred with a deliberate gap; the direction ring shrank to 14rem and is centred
on the PILES rather than on the column that also holds the colour pill, which is why its top arrow
used to land in the far player's hand. *Convention only — no guard. `tests/uno-layout.test.ts` pins
who sits where, and nothing static can see how far apart they are, which is exactly why it shipped
that way: only a screenshot shows it.*

UNO shipped the two SDK seams Phase 5 built with no caller:
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
`@boardwalk/game-logic/games/blackjack`, in `tests/blackjack.test.ts` (38), and BOTH sides import it.
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
the emulator and proves it — `src/shell` (router, auth gate, top bar with the bankroll, the hub and
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
one screen, a 2-seat online table, zero betting), UNO (the hidden-hands proof: refereed-dealer,
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
- **THE DEALER PEEKS, AND INSURANCE IS THE BET THAT THE PEEK IS ABOUT TO HAPPEN.** ✅ Live
  (slice 1 of [plans/BLACKJACK_DEPTH.md](plans/BLACKJACK_DEPTH.md)). Two rules that are one rule,
  and the first half was a defect rather than a feature: `deal` settled a dealt PLAYER natural and
  never asked about the dealer's, so a hand against a dealer natural played on — and since
  `canDouble` is true on the opening two cards, **a second stake could go down on a hand that was
  already over, and `settle` took both.** A real table ends the hand before anyone acts and takes
  one. It was invisible because `settle` is right about a dealer natural and asserted so; nothing
  ASKED it at the moment it mattered, which is the shape of bug every existing case passes through.
  The peek lives in ONE place (`peek`, called by the deal and by the exit from the offer) — the
  alternative, letting the first `hit`/`stand`/`double` implicitly decline, puts it in four
  branches and breaks the double's stake ordering, because `playMove` commits a second wager around
  a reducer call that would sometimes settle instead of double. So `'insurance'` is a real PHASE:
  `hit`/`stand`/`double` stay legal only in `'player'`, and `'player'` is only reachable once the
  peek has happened. **An ACE UP suspends the peek**, because peeking there would end the hand
  before the offer could be made and insurance would be unreachable forever. The whole feature
  costs **zero new routes and zero new request fields** — `insure` and `decline` are `Move`s, so
  the body still carries a nonce, a hand id and a decision and still has no field for a card, an
  outcome or a payout. v1 got all three of this feature's parts wrong in eleven lines
  (`bj_app.js:489`) and each one is answered here by something that already existed: it decided the
  payout in the browser from `calculateScore(dealerHand)` — reading the hole card its own renderer
  was hiding two hundred lines away — where `HandView.dealer` carries one card and `viewOf` is the
  only road to the wire; it staked `bet / 2` in floats, where `insuranceStake` floors integer cents
  (the `parseInt` 3:2 chip with the sign flipped); and it called `recordWin` on a paying side bet,
  inflating the win count and the mastery chain that reads it **for a hand the player had just
  lost**, where `recordOutcome` fires once per HAND out of `settleHand` and insurance never touches
  it. **`canInsure` is a function of the PHASE, and the phase was decided by the up-card** — that
  is the security property, since the boolean is sent to a client while `dealer[1]` is withheld, so
  an offer that asked what the dealer TOTALS would hand over the bit the player is paying for and
  nothing on screen would look wrong. What insurance *does* legitimately reveal is one bit about
  the hole card, and that is correct: it is what was bought. The two achievements downstream want
  different numbers and `recordOutcome` takes them separately (`sideNetCents`) — folding a side bet
  into `lastWagerCents` fires `high_roller` on a $400 hand, and leaving it out of `lastNetCents`
  credits a 2:1 win with no cost against it.
- **A badge is computed by the referee, never reported.** ✅ Live (Phase D, deployed 2026-07-18). `/settle` has no `unlockedAchievementIds` and no `grantedItemIds` — the fields
  are *gone*, not validated. `boardwalk-api/src/domain/achievements.ts` recomputes with the SAME
  shared `satisfiedAchievements` the client uses, over an `AchievementView` whose every number is
  read back from the server's own tables **inside the settle transaction**, after the stat bump, the
  XP award and the ledger row have landed; a grant rides with its badge in that transaction, because
  a badge landing without its cosmetic is v1's `recordWin` defect wearing a hat. This matters beyond
  chips: **every** game's Platinum mastery tier grants a title the store refuses to sell at **any**
  price, so that wearing one means you earned it. Only `feats` still cross
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
- **UNO's pot moved the CARDS as well as the money, and a client cannot name its own stake.** ✅ Live
  (plans/done/UNO_POT.md). Every human seat antes at the deal and the winner takes the pot — v1's ante;
  raise/call/fold is a deliberate second slice, because that half changes UNO's turn rules (a folded
  seat leaves the rotation) while ante-only touches the rulebook not at all. Declaring `betting`
  is what forced the deal onto the referee, for **two** independent reasons: a 4-seat $25 table pays
  **4×** a player's stake and a 7-seat one **7×**, where `DEFAULT_PAYOUT_MULTIPLE` is **3×** — so the
  honest game already exceeded the ceiling, and raising it would have raised it for every game
  sharing the constant — and UNO was **host-as-dealer**, so a host who can see every hand and also
  moves the money is Liar's Dice's "a host who can see every cup" with one word changed.
  `useUnoHost.ts` was **deleted**, not kept as a fallback, and `PendingMove`/`submitMove` went with
  it: the intent/ack lane existed only because a guest could not apply its own move, and leaving it
  open is "the road it replaced standing". **The stake is a property of the TABLE, not of whoever
  presses Deal** — chosen at create, stamped on `RoomMeta.anteCents`, visible to a guest before they
  take a chair, and read by the referee from there, so **`unoStart` has no field for a stake at all**
  (`ldStart` still carries one; that is a follow-up). A client that could name its own would play a
  perfectly FAIR game at a price nobody consented to, which validation cannot fix because there is no
  wrong number to reject. **The house does not ante for bots** — v1 did, and on a 4-seat table that
  is a $25 stake winning $100, a $75 grant on a coin flip, which is exactly the faucet
  `refillGrantFor` exists to make impossible. So a pot made of PLAYERS' money needs two humans (the
  house banks a lone one instead — see the next rule), `uno` joined `SERVER_DEALT_GAMES` in the same
  commit, and the board stopped calling `reportResult`. **The cost,
  named: UNO no longer works on the RTDB fallback**, exactly as Liar's Dice never did — the only
  client-side dealer available is one player's browser holding everybody's hand. During a Pi outage
  there is no ledger either, so a betting UNO could not have paid anyone anyway.
- **The house will bank a lone player, and the difference from v1's faucet is one inequality.** ✅
  Live (slice 5 of [plans/done/UNO_HOUSE_RULES.md](plans/done/UNO_HOUSE_RULES.md)). One human against bots
  antes like anybody else and a win returns `ante × seats × HOUSE_RETURN` out of the house's own
  money. v1's version paid **fair** odds — an N× return at N equal seats is EV-neutral against an
  equal opponent and EV-POSITIVE against a bot, which is a faucet with extra steps — and this one
  pays `2/3` of fair, so the money flows the way it does at every other table in the building.
  **The number is MEASURED and the measurement is the safety**: `tests/uno-house-odds.test.ts`
  played the real reducer and the real bots at every declared table size under both rule sets, and
  an attentive-human proxy lifted at worst **1.230** against a break-even of `1 / HOUSE_RETURN` =
  1.50. That harness now IMPORTS the constant rather than restating it, so the bound it asserts is
  the bound the ledger pays at — §4.2 deliberately left the number in the test until it had a
  reader, because a constant landing before its caller is `loadout.color`. **Everything measured is
  a POLICY rather than a person**, so every figure is a lower bound on human skill and the margin
  past 3/4 is not timidity, it is the only protection against the player a harness cannot play:
  anyone who retunes `sharp` must go back and re-read that table. Three consequences.
  **The tier is PINNED to `HOUSE_TABLE_LEVEL` by the referee**, in the transaction that takes the
  ante — `StoredMatch.level` argued that a difficulty "cannot move a chip", which was true of every
  UNO table until the house started paying the bill, and `casual` at a `sharp` price is the feature
  paying out on demand rather than an exploit to find later. **A house pot pays FIRST PLACE and
  nothing else** (`rankedPayees`), because with one payer the ordinary "paying seats that placed"
  filter is that player at every placement — under `playToLast` it would hand them the whole pot for
  finishing fourth of five, and first place is the only event the odds were priced against. And the
  payout gets a **per-match ceiling computed from the match's own ante and seat count**
  (`maxRoundPayout`), because `DEFAULT_PAYOUT_MULTIPLE`'s 3× could never bound a 7-seat pot that
  honestly pays 7×; it never binds on an honest round, which is the point — it is what stops a
  mistake in the pot arithmetic minting money, and it CLAMPS rather than throwing, since a settle
  that threw would roll itself back and strand the antes in a round nobody can finish. The house's
  share is modelled as a **STAKE**, so the file's one invariant survives intact — the pot is the
  literal sum of what everyone put in, with the house as one of "everyone" — and `potSplit`,
  `voidMatch` and every downstream reader acquire no case at all.
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
- **Every registered game has a mastery chain, and a chain's id IS the game id it counts.** ✅ Live
  (V1_FEATURE_GAPS #11) — four Bronze→Platinum rungs over `winsByGame[gameId]` at 1/10/50/100, the
  Platinum granting an earn-only title. Test-enforced, both directions: `tests/achievements.test.ts`
  asserts the mastery chain ids equal the real `registry`'s `manifest.id`s **as a set**, so game #7
  cannot ship without one and a chain cannot outlive its game. P3 gave chains to chess and blackjack
  because they were the two games that existed; four games later that read as "these two are the real
  ones", which is what a rule fixes and a list does not. **One ladder for all of them** — a mastery
  tier that means 10 wins in one game and 40 in another is v1's difficulty-vocabulary drift in a
  different costume. Adding a chain is a catalogue change and NOT a server one (the referee builds
  `winsByGame` from all its `stats` rows) — but the badges only FIRE once the Pi carries the new
  catalogue, so **deploy before believing the shelf**: an unwinnable badge rendering locked forever
  is precisely the `big_win` defect this OS exists to have fixed.
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
- **EVERY GAME IS ENTERED THROUGH ONE MODAL, AND THE CARD THAT OPENS IT IS STILL A LINK.** ✅ Live
  ([plans/done/GAME_LAUNCH_MODAL.md](plans/done/GAME_LAUNCH_MODAL.md)). Clicking a game used to
  navigate to `/play/:id`, which mounts the game, which mounts `<Lobby>`, whose no-table branch is a
  full PAGE of create/join panels — so three of the six games answered "I want to play UNO" with a
  form, and the form arrived behind a route change and a lazy chunk. The entrance is v1's
  `openLaunchPanel` rebuilt on the kit: the hub card opens `<GameLaunchModal>`, the modal offers the
  game's ways in, and a room mode swaps to the setup step. It is instant because the manifest is a
  static import on the hub, where at `/play/uno` it would arrive only after the chunk did — **an
  entrance that makes you wait is not an entrance.** Four things are rules rather than decoration.
  The ways in ARE `manifest.modes`, labelled once in `src/system/room/modes.ts` and read by BOTH the
  modal and the lobby (the lobby rendered the raw union member for five phases, so the screen said
  "ai"); **every registered game gets one**, single-mode games included, because the modal is the
  entrance to a game and not a picker — a game with one way in shows one way in, and Blackjack's
  depth landing later is a manifest change this draws for free. The panel behind it is `<TableSetup>`
  and there is exactly ONE of it, mounted by the modal and by `<Lobby>`'s no-table branch (which
  `/play/uno` typed directly and a dead table link both still reach); it takes
  `{ manifest, mode, onEntered }` and never learns which home it is in, because the version that
  would rot is the one nobody reaches by clicking. And **the hub card stays an `<a>`** — the modal
  intercepts the plain click only (`isPlainClick`), so ctrl/cmd-click, middle-click and "open in new
  tab" still belong to the browser; a `<button>` takes all of that away silently and nobody files a
  bug, they just stop doing it.
- **A pre-game option is manifest DATA, and the OS draws the control.** ✅ Live —
  `manifest.options` (a `GameOptionsSpec`), `<GameOptions>` renders it, `useGameOptions()` reads it
  back, and **the values live in the URL** (`?o.<id>=`, `optionParams.ts`) with `<GameShell>` holding
  no copy at all — `readOptionValues(spec, params)` IS the value and `writeOptionValues` is the
  write. It used to be state in the shell, seeded from nowhere, and the launch modal is what made
  that untenable: a tier is picked on the HUB and the game that reads it mounts one route later. A
  seed plus state plus a sync is two sources of truth for one fact, which is `<Lobby>`'s own
  `roomId ?? linkedTable` war story, and deriving is the same fix. It also closed a live bug for
  free — a mid-lobby refresh used to reset the tier to its default while the host believed they had
  picked one. A game never draws its own picker and never learns what
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
  the waiting branch only — the values live in the URL, which is per-client, and today's
  only room-game option is read exclusively by the host (`aiSeatsToDrive` is host-only); the day a
  guest must read one, it belongs in room state, and that is a real change rather than a nuance.
  (A shared table link now carries the host's `?o.` keys to whoever opens it, which is harmless for
  exactly that reason and would stop being harmless the moment a guest read one.)
  Rendering it only before the deal is also what makes a mid-game retune unspellable — v1's Chess
  reached the same place by queueing a difficulty change to the next game.
- **A HOUSE RULE THAT CHANGES THE LEGAL SET CHANGES THE SIGNATURE THAT COMPUTES IT.** ✅ Live —
  UNO's stacking (slice 2). `canPlay(card, top, color)` and `mustDraw(hand, top, color)` are now
  `canPlay(card, table)` / `mustDraw(hand, table)` over a `UnoTable` — `{top, color, pendingDraw,
  houseRules}` — and the churn at every call site **is** the feature: a live stack suspends colour
  and value matching entirely, so a call that could still pass two of the four facts would be one
  silently meaning "and no stack", which is a client greying out the +2 the referee would have
  accepted. `UnoState` **extends** `UnoTable`, so a board hands its own projection straight in and
  the feel check is literally the call the dealer made. Two rules follow from having one predicate:
  `mustDraw` needed no stacking logic (the auto-draw takes the stack for free), and **neither AI
  tier needed a line** — `playable` is already the set of answers, so "nothing playable → draw" is
  "cannot answer → take it". `pendingDraw` is never read directly: `drawDebt(table)` is the one
  reader, because the raw field lies in two directions — a debt without the rule (the flags are the
  authority), and a referee that predates the field, which is the deploy order reaching real
  players. **The dry deck is the trap**: with nothing owed a draw that yields nothing is a genuine
  no-op (the board's auto-draw key depends on it), and with a debt outstanding the same return
  hangs the table forever, because the legal set has collapsed and the victim has no other move.
  So the debt clears on any take, including one the deck came up short on.
- **"WHO WON" AND "IS IT OVER" ARE TWO QUESTIONS, and a game that can end in stages has to ask
  them separately.** ✅ Live — UNO's ranked places (slice 3). `UnoGame.winner` is **gone**, replaced
  by `finished: readonly number[]` — the seats in the order they went out — with `winnerOf` and
  `roundOver` as the two readers. They are the same answer in the ordinary game and come apart the
  moment `playToLast` is on: first place is decided several moves before the round is, so a
  mechanical `winner !== -1` → `finished.length > 0` substitution pays the pot out with two players
  still holding cards. The seat rotation moves with it — `seatAfterLive` REPLACED the modular
  `seatAfter` rather than joining it (identical when nobody is out, so no rule changed meaning and
  no call site can pick the wrong one), and **a reverse acts as a skip at two LIVE players, not two
  seated ones**, which is the exact surgery UNO_POT deferred raise/call/fold for. `finished` is read
  through `placesOf` and never directly, for `drawDebt`'s two reasons: the deploy order (an old
  referee sends no list, and `undefined.length` takes the board down) and a legacy `uno_matches` row,
  whose `winner` field `winnerOf` still reads because it is the only record of who opens the next
  round. **`UnoState.winner` stays on the wire** as a derived field — that is not a second source of
  truth, it is the projection deriving like `counts` does, and it is what lets an old client keep
  rendering a result panel in the window between the Pi's deploy and the frontend's.
- **A RANKED POT SPLITS AMONG THE SEATS THAT PAID AND PLACED, and the split conserves by
  construction.** ✅ Live — `potSplit(potCents, places)` in `packages/game-logic`, imported by the
  referee. Every place below first is floored and the REMAINDER rides with first, so the shares sum
  to exactly the pot at every table size and every stake; a percentage split that rounds each share
  independently either mints a cent or loses one on every single hand, and a ledger cannot absorb
  that. `places` is the paying seats **in placement order**, never the chair count and never the
  human count — a bot is absent from the ladder rather than allocated a share that would have to go
  somewhere. One sentence covers both modes: the ordinary game places one seat, so a human winner
  takes the whole pot unchanged and a bot winner means nobody placed and the pot goes to nobody
  (what this game already did). The ladder is **the top half, weighted `k, k-1, … 1`**, which makes
  two and three payers winner-takes-all — so turning places on does not silently re-price a small
  table, the seat-count rule's argument applied to money. The BOARD quotes no per-place figure: it
  would have to guess which seats anted, and a seat that changed hands after the deal makes the
  guess wrong.
- **A bot's move must be one the reducer ACCEPTS, at every tier.** ✅ Guarded in both games by
  playing whole games out and asserting the state CHANGED. An illegal bot move is not a crash: it
  is a no-op inside `patch`, on a turn only the bot can take, so the table hangs forever. The
  first draft of UNO's `casual` failed a subtler version of this and shipped nothing — it never
  called UNO (a difficulty made of the game's own rules, which was the appeal), and the +2 penalty
  for going to one card undeclared makes a hand that can never reach zero. Four casual bots ran
  3,000 turns with no winner. **A tier that makes a game unwinnable is v1's `[5,5,5,5]` Liar's
  Dice literal wearing a hat**, and only a test that plays to a WINNER — not to a legal move —
  sees it.
- **A GAME DOES NOT DRAW ITS OWN END-OF-ROUND PANEL. It says what happened; the OS says where.** ✅
  Live — `<GameResult over title tone detail>{actions}</GameResult>` (`src/system/game/GameResult.tsx`),
  and all six games render it. Every one of them had independently put its result and its
  play-again button at the BOTTOM of the board — under UNO's move log, under Liar's Dice's bid box,
  under Solitaire's tableau — which is the one place they must not be: below the fold, so the answer
  to "did I win, and can I go again" was a scroll at the exact moment a player is certain to want a
  control. Six copies is six chances to get that wrong and a seventh game inheriting it by reading
  the sixth, which is the same argument `<Rematch>` already won one level up: that component took
  WHO HAS TO AGREE away from the games because three of them had answered it three ways, and this
  takes WHERE THE ANSWER APPEARS. The surface is the kit's one `<Modal>`, so it is a native
  `<dialog>` in the top layer and cannot be clipped by a board's `overflow-hidden` felt or lose a
  z-index fight — the property no in-flow panel can have without a game knowing how tall it is. It
  is DISMISSIBLE (a panel over the final position is useless in chess), and the way back is a pill
  which is **portalled to `document.body`**: a `<Card felt>` carries `isolate`, so a `fixed` child of
  it paints inside that stacking context and could be occluded — a control that vanishes for exactly
  the players who bought a felt. **The ACTIONS are rendered once and never move between containers**:
  `<Rematch>` fires the host's restart from an effect and `restartGate` re-arms on the agreement
  being LOST, so a hidden-but-mounted Rematch keeps working while a remount would re-arm the gate
  against an already-agreed tally and deal a second round — at a betting table, a second ante off
  everybody. A closed `<dialog>` is `display: none` with its children still mounted, which is what
  makes that free.
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
- **The host picks how many chairs, and the manifest's `seats` range is what they may pick from.** ✅
  Live — `tableSizeChoices({min,max})` (pure, in `src/system/room/seats.ts`) and a picker the lobby
  draws next to public/private. Before this the lobby created EVERY table at `seats.max` and `canStart`
  demands a full one, so `seats.min` was decoration: a game declaring 2–7 had exactly one real table
  size, and sitting down to UNO meant filling six CPU chairs whether you wanted them or not. v1 asked
  "PLAYERS: 2 / 3 / 4" before anything else, and it was right. The choice is at CREATE time because
  `seatCount` is a create parameter — a table cannot grow a chair under someone who has already joined
  by code — and a range holding ONE size (Chess) draws no control at all, so the seam is invisible to
  every game that does not want it. **The default is `seats.min`, the SMALLEST table.** It shipped as
  `seats.max` for one afternoon on the "default is whatever already shipped" rule that AI difficulty
  follows, and that was wrong: **that rule is about not silently RETUNING a game under someone, and a
  seat count is not a tuning knob.** Defaulting to the biggest table reproduces the exact friction the
  control exists to remove for everyone who does not notice the control — you still had to add six CPUs
  before Start would light up, which is the complaint that prompted the picker. The smallest table is
  the one a player opening a game alone can actually start; a full house is one tap away. This is the
  variable-table-size seam [plans/done/LIARS_DICE.md](plans/done/LIARS_DICE.md) recorded as open, and it is one
  pure function plus a button row because the count was already plumbed end to end (`create` →
  protocol → gateway → store).
- **A TABLE COMES UP SEATED, AND THE PREVIEW IS THE PLAN — not a drawing of it.** ✅ Live (slice 3
  of [plans/done/GAME_LAUNCH_MODAL.md](plans/done/GAME_LAUNCH_MODAL.md)). An AI table used to mean claiming a
  chair and then pressing "Add CPU" once per remaining seat before Start would light — six clicks on
  a 7-seat UNO table, to play alone — and Chess hot-seat had the same shape one level over: you sat
  yourself down twice. Now one pure `plannedSeats({seatCount, host, fill})` says what the chairs
  hold, the lobby DRAWS that array above the Create button, and the create path PRODUCES it. That is
  the whole property: a preview that disagrees with what gets created is worse than no preview,
  because it is a promise. v1 had it for free by calling one `buildSeats(count)` from both places;
  here the two executions genuinely differ, which is why it is a guard rather than a comment.
  **Two fills, two mechanisms, and the asymmetry is the design.** `fillAi` is a create FIELD the
  referee applies inside its own construction, so the table is seated atomically and there is no
  window in which a 7-seat AI table exists half-filled and a stranger walks into a chair the host is
  about to fill — and the seat array stays the referee's, which is what every other seat rule rests
  on. The `local` fill (hot-seat) is a loop of ordinary claims from the host's own client, because a
  seat carrying a uid must be written by the account that owns it: the one seat rule the server
  cannot keep on somebody's behalf. A `fillLocal` wire field would be more surface than Chess's two
  chairs deserve. **An ONLINE table stays open**, deliberately — a public table that comes up full
  starts before anyone can walk up to it, which is the wrong default for the one mode whose entire
  point is other people. The escape hatch is `SeatList`'s host-only **"Fill with CPUs"**, gated on
  the same `manifest.modes.includes('ai')` the per-seat control is, which is what makes that decline
  cheap rather than a limitation. **A chair is named in ONE place** (`aiSeatName`/`localSeatName`),
  because four writers of one label — the preview, "Add CPU", "Fill with CPUs" and the hot-seat loop
  — is four chances for the preview to promise "CPU 2" and the table to seat "AI 2". The referee's
  `fillWithAi` writes the same string from its own copy; nothing static spans the two packages, so
  each side pins the literal in its own suite and a comment is the join.
- **A HOUSE RULE IS A CREATE-TIME ROOM PARAMETER, not a `manifest.option`.** ✅ Live (slices 1–3 of
  [plans/done/UNO_HOUSE_RULES.md](plans/done/UNO_HOUSE_RULES.md)) — **every rule still ships defaulted OFF, so
  a table nobody configures is the table that already exists.** Slice 1 was the seam and changed
  nothing observable; **slice 2 (STACKING) is the first rule the reducer enforces**, and **slice 3
  (RANKED PLACES) is the first that reaches the MONEY**. All three ride the same seam. The options seam is the declared home for a pre-game choice and is the wrong one
  here, for the reason this file already states as its one limit: option values live in the
  URL, which is per-CLIENT — fine for an AI tier only the host reads, wrong for a rule the
  REFEREE enforces and every guest's `canPlay` has to agree with. A guest running a different
  rulebook from the dealer greys out a card the referee would have accepted and offers clicks it
  refuses; nothing crashes and the table is unplayable for one seat. So a house rule rides **exactly
  where `anteCents` rides** — `RoomRepo.create` → the WS `create` frame → the server's `Room` →
  `RoomMeta` → the open-table listing — and **`unoStart` still has no field for one**, which is the
  property UNO's pot bought and this did not spend. The OS carries an opaque **bag of booleans**
  (`TableRules`, `src/system/room/houseRules.ts`) and the GAME narrows it through its own pure
  resolver (`resolveHouseRules` in `packages/game-logic`, garbage in → defaults out, never throws,
  the `resolveOptionValues` discipline); `src/system/room` never imports a rulebook and the server
  never learns what a rule means — it bounds the SHAPE at create (`sanitizeRules`, the one place a
  wire value is made safe, beside the ante's floor) and nothing else. The toggles are manifest DATA
  (`manifest.houseRules`, the `manifest.betting` precedent — a game declares, the OS draws), at
  create only, and **write-once thereafter**: nobody may change what game a table is playing under
  somebody who already sat down, which is the ante's rule with the money removed and the fairness
  left in. The rules are stamped onto `UnoGame` by `deal`, so they live in `uno_matches.state_json`,
  survive a restart, and a round is played under what it was DEALT with rather than what the room
  says now (a room is in memory; a match is not). `toPublic` carries them so every client's feel
  check reads the booleans the referee enforced. **No `database.rules.json` change and no Firebase
  deploy**: the RTDB repo answers `{}`, which is honest rather than degraded — UNO does not run on
  that path at all, so no table there is played under a house rule.
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
  **It reaches a REFEREE-DEALT game for the same reason and at the same price** — Liar's Dice was
  the one shipped game with no rematch at all, and closing it needed no server change, no wire
  field and no Pi deploy, because `patchState` authorises by MEMBERSHIP and a dealt table's state
  stops being written the moment the match ends. Votes cast after the result are the last word
  until the next deal REPLACES the whole projection, which is the same by-construction clearing one
  level out. **The once-per-handshake gate is `restartGate`, and it may not key on `round`** — that
  is what it used to do, and it silently assumed a round number never repeats across restarts.
  True of a game that restarts by patching its own state (Tic-Tac-Toe and Chess pass
  `initialState(round + 1)`, UNO deals round n+1); FALSE of a dealt match, where "again" is a new
  row whose rulebook starts at `round: 0`. Two Liar's Dice matches ending on the same round number
  — which matches of the same size do, often — would have made the second rematch a silent no-op:
  everyone presses Ready ✓, the tally agrees, and nothing deals. The gate re-arms on the agreement
  being LOST instead, so it needs no notion of a round.
- **Which table you are at lives in the URL, and that is the ONLY place it lives.** ✅ Live.
  `<Lobby>` read `?table=` AND held a `roomId` state, reconciled as `roomId ?? linkedTable` — two
  sources of truth for one fact, and it failed the way the derivation rule always predicts it will.
  Only the room BROWSER navigated, so only a table joined from the browser survived a page load;
  Create and join-by-code set the state alone, and a refresh dropped you back on the create/join
  screen with the code gone and the game still running without you. Now every way in
  (`enterTable`) writes the URL and there is nothing to reconcile — which also means the address bar
  is a shareable table link by construction rather than as a second feature. `mode` rides along for
  the same reason and not a different one: it is what tells `useSeats` whether this is a shared
  screen, so a hot-seat table restored without it would come back missing its second local player.
  This is one half of surviving a refresh; the other is the `pagehide` rule below, and **neither is
  sufficient alone** — the URL brings the page back to a table it has already resigned its seat at.
- **A public table is DISCOVERABLE, and a table is public only because its host said so.** ✅ Live —
  the room browser (V1_FEATURE_GAPS #9), the last of that doc's "most substantive missing
  multiplayer UX". Multiplayer was share-a-code only, which means you could only play with people
  you already knew; v1's hub scanned every online game and rendered joinable rooms as one-click
  chips, and that is what filled its casual tables. The index is a `browse` SUBSCRIPTION on the
  existing socket — not a poll and not a request — because a list of joinable tables that is a few
  seconds stale sends people at seats already taken, which is exactly what v1's polling hub did. It
  is **global on the wire and filtered by the reader**: the hub shows every game, a lobby shows one,
  and both ride the same frames, so a player watching the hub holds one subscription rather than
  one per game. Two v1 problems are designed out rather than patched. **A listing requires somebody
  PRESENT**, so a ghost room is never advertised in the first place — v1 listed rooms by existence
  and apologised afterwards with 30-minute and 6-hour stale-room sweeps, where the reaper here
  already existed for crash recovery and needed nothing added. And **`visibility` is chosen at
  create**, because before the browser a four-character code was the whole of who could join: an
  index of every waiting table would have retroactively opened every code-shared table to strangers
  without anyone choosing it. A private table is ABSENT from the index rather than filtered out of
  it, and an unrecognised visibility reads as private, because the two failure modes are not
  symmetric. `OpenTable` carries **no uid, no seat roster and no game state** — a listing is a
  poster, not a window. The hub's Join is a NAVIGATION (`/play/<id>?table=<code>`) that `<Lobby>`
  reads back off the URL, so a shared link and a click are one code path, and the play route still
  hands a game `{ onExit }` and nothing else. **The RTDB fallback has no browser, and the
  degradation is named**: `.read` sits on `rooms/$gameId/$roomId`, one node deep, so a signed-in
  player may read a table they hold the code for and may not enumerate the parent — which is the
  deliberate posture and exactly what an index must do. Listing there needs either a rules change
  widening that read or a second denormalised index node that can drift, both hand-deployed, for a
  path that exists to be flipped on during a Pi outage. So it answers an empty list, the browser
  renders nothing, and join-by-code — all that path ever had — still works.
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
  **A PAGE UNLOAD IS NOT A DEPARTURE, and the client no longer pretends it can tell.**
  `<RoomProvider>` used to run the whole `teardownPlan` on `pagehide`/`beforeunload` as well as on
  unmount — and a RELOAD is a page unloading, so refreshing mid-game made the client hand its own
  seat to a bot on the way out; the tab that came back two seconds later was a spectator at a table
  it had been playing at, with its cards gone. F5, a phone locking, a session restore: all the same,
  and all of it invisible to every static guard because the code did exactly what it said. The
  handlers are DELETED rather than made cleverer, because no answer is available at `pagehide` time:
  a page cannot know whether it is coming back. The far end can, and already did — this grace window
  IS that mechanism, and a returning presence cancels it, so a reload lands inside and keeps the
  seat while a real leaver's opens a few seconds later. The RTDB fallback's armed `onDisconnect`
  covers the same event at the server. Both paths had it; the client handler only ever supplied a
  worse answer that arrived first. What is left is the unambiguous exit — an UNMOUNT, which is what
  "Leave table" and navigating away both do — and that still tears down at once.
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
- **The KIT has exactly one entrance animation; a GAME's motion is a different category.** `rise` is
  still the only way anything in `src/ui` may arrive — a kit with five entrances is a kit where every
  component author picked one. But a card being dealt is the game happening, not a component
  appearing, so `--animate-deal` / `pitch` / `cue` / `lastcard` sit in `packages/theme/theme.css`
  beside `--color-uno-*`, for the same reason those do: game content lives in the theme because the
  theme is the one file that may name a colour, and (for motion) because keyframes cannot be spelled
  from JSX — Tailwind generates `animate-*` only from an `--animate-*` token, so the alternative is a
  second stylesheet, which is how a look drifts. Same bar as a sound role or a cosmetic kind: **add
  one in the commit that first plays it.** A motion token with no reader is `loadout.color`.
- **The top bar carries what you SPEND; the hub carries what you have EARNED.** The bar holds the
  bankroll, your name and the way out; the level, the rank and the XP meter live in the hub's
  header. This is not tidying — it is the fix for a duplication that had shipped twice over. The
  hub printed "THE BOARDWALK" under a bar already carrying the wordmark, and the moment that
  heading was replaced with anything about the PLAYER it would have printed the level under a bar
  already carrying the level. Picking one of the two copies is not the answer; the two facts are
  different kinds. A bankroll must be readable AT THE TABLE, because that is where it is spent and
  a wager you cannot afford is a decision made with the number in view. XP is never spent — it is
  only reviewed, and the place you review it is the place you choose what to play next. The room
  is what the move buys: a 64px sliver could only say "you are progressing" (its own comment
  conceded the rank rode in a `title` tooltip because "Casino Legend" would not fit), where the
  header says the rank and the next rung, which is what `ranks.ts` argues turns a rank from a
  sticker into a reason to play another hand. *Convention only — no guard. Nothing static can see
  one page restating another, which is exactly why it shipped.*
- **`alert` / `confirm` / `prompt` are `no-restricted-globals`.** ✅ Live, and they now have a
  destination: one `<Modal>` (native `<dialog>`), one `useToast()`, and `useConfirm()` for the
  one-liner. v1 has four ad-hoc modal systems and toasts that lazily self-inject an inline-styled
  container.
- **There is ONE modal, and only `src/ui` may spell a `<dialog>`.** ✅ Lint-enforced —
  `@boardwalk/no-raw-dialog`. v1 has four modal systems, and not because anyone chose four: each
  one looked, in the change that added it, like a perfectly reasonable twenty lines. The second is
  indistinguishable from the first at review time, which is exactly the shape of thing a rule
  fixes and a convention does not. It is not only a look, either — `<Modal>` carries `open:grid`
  (a bare `grid` beats the UA's `dialog:not([open]){display:none}` and leaves an invisible
  full-viewport element hit-testing every click; that shipped once), guarded `showModal`/`close`,
  Esc routed through `onClose`, a required accessible name, and focus restored on unmount. A
  modal hand-rolled from a `<div>` and a portal is **not** caught, stated rather than pretended
  away: it is the `no-daisyui-classes` bare-word trade, and `<dialog>` is what the second person
  to want a modal actually reaches for.
- **A modal's WIDTH is one of three rungs, and the body flexes rather than clamping.** ✅ Live —
  `size?: 'sm' | 'md' | 'lg'` → `max-w-md` / `max-w-lg` (the default, so nothing that shipped
  moved) / `max-w-3xl`, named once in `MODAL_WIDTH`. Three rungs and not a free `className` width
  for the reason the kit exists: a per-caller width is how five modals end up five sizes. The body
  was `max-h-[60vh]`, which is wrong in both directions at once — a panel scrolled on a desktop
  with room to spare, and on a short viewport header + 60vh + footer still overflowed the screen.
  The **box** is bounded instead (`max-h-full`, which is the dialog's own `h-full p-4` content
  box) and the body takes what is left (`min-h-0 flex-1`), so content scrolls only when the
  viewport genuinely cannot hold it. `min-h-0` is load-bearing, not decoration: a flex item's
  default `min-height: auto` refuses to shrink below its content, so without it the body ignores
  its own `overflow-y-auto` and pushes the footer out of the box.
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
| A second modal system, at the moment it is still one reasonable-looking element | `@boardwalk/no-raw-dialog` — a JSX `<dialog>` outside `src/ui`. The element name ONLY: `HTMLDialogElement` and the word `'dialog'` are ordinary and a rule that fired on them would be a grep, which is a rule somebody disables. Proved on both sides of the boundary with byte-identical fixtures, and falsified twice — the exemption removed, and the rule pointed at an element name nothing uses (the failure that reports success) |
| Semantic tokens only, **`src/ui` included** | `@boardwalk/no-raw-palette` — scale, white/black, arbitrary values, and `style={{color}}` |
| Vague confirm labels ("OK", "Yes") | `ActionLabel<S>` → `never`; fails at the call site |
| 800-line ceiling + ratchet | `scripts/check-file-size.mjs` on `prebuild` (now covers `eslint-rules/` too) |
| Formatting is Prettier's, not opinion | `format:check` on `prebuild`. The script existed from Phase 0 with **zero callers** — v1's `validateAndCommit()` defect, in this repo, on this file's own advice — so 15 files had quietly drifted before anything went red |
| Types are real, not decorative | `tsc -b` strict + `recommendedTypeChecked` |
| `firebase/*` only under `src/system/repo/firebase/`; concrete repos only from `src/system/repo/` | `@boardwalk/no-firebase-imports` — SDK + `@firebase/*`, `export…from`, dynamic `import()`, and resolved relative escapes |
| A game's `logic/` imports nothing impure (React, `@/system`, `@/ui`) | `@boardwalk/no-impure-logic` — path-scoped to `**/logic/**` under **both** games trees (`GAMES_DIRS` = `src/games` + `packages/game-logic/src/games`), resolves specifiers so relative escapes fire |
| No game imports a sibling game's folder | `@boardwalk/no-cross-game-imports` — same two-tree `GAMES_DIRS`; resolves specifiers (a single-`../` escape fires); the registry is exempt |
| Tic-Tac-Toe's rules are correct | `tests/ticTacToe.test.ts` (27) — every win line, draw-vs-win, `play` immutability + illegal-move no-op, the house (takes a win, blocks a loss, opens centre, perfect-vs-perfect draws), and the DIFFICULTY TIERS: `perfect` still exactly `bestMove` (the default, so the shipped house must not have moved), `sharp` preferring a win to a block and losing to a fork (a middle tier, not a second `perfect`), `casual` reaching every legal cell and no other, a broken rng (NaN/1/-1) clamped rather than indexing off the board, `perfect` never losing to `casual`, and — the one that matters most — every level × every level played to the end with each move asserted `canPlay` and each `play` asserted to CHANGE the state, because a bot move the reducer refuses is a no-op on a bot's turn and stalls the table forever |
| Blackjack's rules + casino payout are correct | `tests/blackjack.test.ts` (38) — ace-soft `handValue`, natural-vs-3-card-21, dealer stands-on-all-17s at the boundary, the full settle matrix, the **integer-safe 3:2 payout on an odd wager** (the v1 `parseInt` chip), and the pure reducer (deal/hit-bust/stand/double/no-op). Plus THE PEEK and INSURANCE, which are one rule: a dealt DEALER natural settles at the deal with `canDouble` false and the double a no-op (before this the hand played on and a second stake could go down on a hand already lost — `settle` was asserted correct in isolation and nothing asked it at deal time, so every case here passed while the house took a stake it was not owed), an ACE UP suspending that peek because peeking would make insurance unreachable, an ordinary hand untouched (additivity), and a player natural still settling rather than stranding in the offer. Then the side bet: `floor(wager/2)` on an ODD stake (v1's `/ 2` half-chip, the `parseInt` bug with the sign flipped), 2:1 PLUS the stake back, the HAND still lost when it pays (`settle` is never told about it), declining staking nothing and peeking anyway, insured and uninsured hands settling identically, both no-op directions (insure outside the phase, hit/stand/double inside it, insure twice), and immutability. **The one that is the security property**: `canInsure` is asserted IDENTICAL across two states differing only in `dealer[1]` — it is sent to a client while that card is withheld, so an offer that consulted the dealer's TOTAL would hand over the bit the player is paying for and nothing on screen would look wrong. Falsified three ways — the peek removed from `deal`, `canInsure` consulting the hole card, and `insuranceStake` un-floored — each landing on its own case |
| Chess's rules are correct | `tests/chess.test.ts` (40) — FEN round-trip, 20 opening moves, piece movement + blocking, check/pin/out-of-check, castling (both sides, out-of/through-check, blocked, rights bookkeeping incl. captured-rook), en passant (set/capture/expiry), promotion (four pieces, chosen + default), fool's/scholar's mate + winner seat, stalemate-not-mate, insufficient-material + fifty-move draws, and `playMove` totality (illegal/finished → unchanged) + input immutability |
| UNO's rules + wire projection are correct | `tests/uno.test.ts` (40) — 108-card deck composition, deterministic shuffle, colour/value/action-of-any-colour matching, `deal` (7 each, opens on a number), the action cards (skip→+2 seats, reverse flips/heads-up-skips, draw2/wild4 deal+skip the victim), a wild refused without a chosen colour, the UNO-call +2 penalty vs declared, the win (turn stops), reshuffle-on-empty, `chooseAiMove` (legal play / draw-when-stuck / most-held wild colour / declares UNO) and its TIERS (`sharp` the default so the shipped bots are unchanged, `casual` reaching every playable card and no unplayable one, `casual` always naming a colour for a wild — a wild without one is refused — and **`casual` still calling UNO, because a bot that does not can never win**: a hand reaches zero only through one, and going to one undeclared is what the +2 punishes, so an undeclaring bot bounces off one card back to three and a four-casual table ran 3,000 turns with no winner; whole dealt games are played to a WINNER at both levels with every move asserted to change the state), `applyMove` totality (off-turn / no-such-card / unplayable / finished → unchanged) + input immutability + structural sharing of untouched hands, `toPublic` hiding every card behind sentinels, `mustDraw` — the auto-draw position — read against the ACTIVE colour rather than the top card, **false for an empty hand** (a won hand and a hand whose private node has not arrived look identical, and only one of them may be drawn for — falsified by dropping the length guard), and agreeing with the REDUCER in both directions (from a stuck hand every play is refused and only `draw` changes the state; from a playable one it is false and the play lands), because asserting a predicate against a second copy of the matching rule proves only that one hand can subtract, and WHO OPENS A ROUND — `deal` taking the leader as an argument, an out-of-range/fractional/NaN one floored to seat 0 rather than thrown (it is fed by a live `winner`, so it is only wrong when something already went wrong, and a deal that throws takes the table down while a deal on the wrong seat merely opens on the wrong seat), the shuffle unchanged by who leads, and `dealEvent` carrying `leads` only from the second round on |
| UNO's table seats everyone, once, in turn order | `tests/uno-layout.test.ts` (11) — over every table size 2–7 and every seat at it: each opponent placed exactly ONCE, never yourself, always in range (a seat rendered twice, or nowhere, still LOOKS like a table — only counting them catches it); v1's three fixed arrangements reproduced exactly (heads-up opposite, three-handed flanking, four-handed left/top/right); the order running bottom → left → top → right so reading clockwise is reading turn order, including the part that is easy to get backwards — a two-deep column fans BOTTOM-first, because the next player up sits nearest you and a flex column renders top-down (falsified by dropping the `.reverse()`); the arrangement being relative to MY seat rather than absolute; both flanks always equal depth (the lopsided five-seat table that killed the "even distribution" formula and is why this is a lookup); a spectator and an off-the-end seat degrading instead of throwing; and the hand fan's overlap staying inside its bounds at EVERY hand size, however silly, since a hand can be drawn up past twenty and a fan that keeps tightening becomes a row of stripes |
| UNO's move log says what happened, and never says what did not | `tests/uno-log.test.ts` (18) — the facts (`describeMove`) and the sentences (`linesFor`), every case driven through the REAL reducer rather than a hand-built "after" state, because a diff of two states written by the same hand only proves it can subtract. A play, a draw, a draw-two and a wild-four read off the RESULT (victim, count, skip) so a change to who a draw-two hits needs no edit here; a wild carrying the CHOSEN colour, which the card's face cannot say; a reverse, the one action whose effect is otherwise invisible; the UNO call and the +2 penalty distinguished (the penalty is a PLAY whose hand grew); the winner; and — the one that matters — **a refused move producing no line at all**, both illegal-card and off-turn, since `applyMove` is total and a log written at the call site claims moves that never happened (falsified by removing the unchanged-state guard: two go red). Plus the copy: one draw-four expanding to its four real consequences with unique React keys, a skip NOT announced twice when the victim already drew, a blank or missing seat name falling back rather than rendering an empty subject, and the ONE line a deal says — "X won the last round and leads", present from round two and absent on the opening deal, never on a move, driven through the real `dealEvent` so a deal that stops carrying its leader fails here rather than quietly printing nothing |
| Every UNO card maps to art on disk | `tests/uno-art.test.ts` (4) — all 108 `unoCardSrc` paths resolve in `public/cards/uno/`, the action-kind→filename map (`skip`→`block`, `reverse`→`inverse`, `draw2`→`2plus`), both colourless wilds, and the back |
| Solitaire's Klondike rules are correct | `tests/solitaire.test.ts` (34) — a 52-card face-down deck, deterministic shuffle (permutation, input untouched), the deal (column sizes 1–7, only the top face up, 24 to stock), `canStackTableau`/`canStackFoundation` (King-on-empty, alternating descending, Ace-on-empty, up-by-suit), `isValidRun`, `liftable` (waste/foundation tops, a tableau run, never the stock, refuses a face-down start), the draw (1 and 3, waste→stock **recycle** re-serves the order and bumps the `recycles` counter the Clean Sheet feat reads, no-op when empty), moves (waste→foundation, a run move that flips the exposed card, King-only-on-empty, illegal no-ops, one-card-to-foundation), `auto`, win detection, `canAutoComplete`/`autoComplete`, a won game frozen but re-dealable, and input immutability |
| The security rules do what they say | `tests/database-rules.test.ts` (67) — boots the RTDB emulator, loads the **real** `database.rules.json`; the refusal of a stored `level`, the shape of every Phase 4 field, `wins`+`played` allowed but nothing beyond it, the P2 `equipped` map (card back + title accepted, a stray `frame`/`avatar` key and a wrong-type/over-long id refused), and Phase 5's rooms/hands/chat: owner-only hand reads, forged-author refusal, monotonic `seq`, self-only presence, no-evict seat claims, host-only room removal and host-only hands cleanup. Phase E added `dice` as the fifth `equipped` key (accepted whole and alone, wrong-type and over-long refused per-key), and moved the STRAY-key example to `chip` — the kind `catalog.ts` still withholds for want of a reader, which is what `dice` used to be. The launch modal's slice 3 added the one shape these rules had never been asked for: **an `ai` chair, carrying a name, written at CREATE** — the fallback path builds its own seated table, and what authorises it is subtle enough to be worth pinning, because the seat rule's host clause is FALSE during a create (it reads `root`, which is the tree BEFORE the write, so the host this same update is writing does not exist yet) and the write is carried entirely by "the chair being written is not currently a human". Being wrong about that refuses the whole create on the one path that exists to be flipped on during a Pi outage. Falsified by putting a uid on the bot chair |
| Every leaderboard board ranks the way its name says | `tests/boards.test.ts` (16) — the four boards (wins/richest/level/win-rate), each board's order + tiebreak chain on a hand-built set, the win-rate min-games floor (a 1/1 player filtered off the skill board), `boardById` fallback, and `rankFor` non-mutation |
| The REFEREE ranks by the same boards the page draws | `boardwalk-api/tests/profile.test.ts` (15) — the four boards asserted over a fixture built so they genuinely DISAGREE about who is first (a grinder, a whale, a leveller and a sharp), because a set where one player tops everything proves nothing and is what let this ship: `leaderboard()` took no `board` argument at all and ended in `ORDER BY wins DESC`, so Richest/Level/Win-Rate were the wins board wearing a different column header. Plus the win-rate floor applying server-side (a 1/1 `fluke` off the skill board and present on every board without one), **filter-and-sort BEFORE slice** (`limit: 1` on Richest must still find the whale, who is 4th by wins — the old query sliced in wins order first, so it could only ever return the grinder), an unknown/empty/absent board id falling back to wins in ONE place, and a filtering board returning FEWER rows than the limit rather than padding. The fixture has a guard of its own: the first draft seeded through `blackjack`, which `checkSettle` refuses as server-dealt, so it seeded an empty database and the wins assertion still passed on a five-way tie at zero |
| The standings load SIGNED OUT, on both composed paths | `boardwalk-api/tests/api.test.ts` (24) — a `GET /leaderboard` with **no Authorization header at all** answers 200, and a rubbish token is ignored rather than refused (a public route must not be worse than no route for a stale session). `leaderboardRouter` sat below `authMiddleware` from the Phase B cutover, so every logged-out visitor got 401 and `useLeaderboard`'s error branch permanently, while its own docblock promised it "works signed out" — true of the world-readable Firebase node it was written for, silently false of the API that replaced it. Invisible to a signed-in developer, so the guard asserts the ABSENCE of a header. Plus `?board=` reaching the ranker (a filtering board comes back empty where wins does not) and a repeated param degrading to the default rather than matching a `String()`-joined non-id. Falsified by moving the mount back below the middleware: three go red |
| A production build without Firebase config | `vite.config.ts` fails `build`, naming every missing var |
| `dist/404.html` is a byte-copy of `index.html` (Pages SPA fallback) | `scripts/spa-fallback.mjs` throws on missing/mismatch during `build`; `tests/spa-fallback.test.ts` (4) |
| A cached page whose chunks a deploy deleted reloads itself ONCE — and never loops | `tests/stale-build.test.ts` (11) — the pure `shouldReloadForStaleBuild` (cooldown boundary, garbage in the key never *blocking* recovery, a future timestamp treated as stale so a clock rewind can't disable it), the handler (reloads once, declines the second and lets the error surface, survives a throwing `sessionStorage`), and the inline boot-guard in `index.html` — present, ordered before the module entry, capture-phase, and pinned to the SAME key/cooldown as the module it cannot import |
| The deploy workflow injects every env var the source reads | `tests/deploy-env.test.ts` (4) — `.github/workflows/deploy.yml` vs the `import.meta.env` names in `src/` (`VITE_API_ECONOMY`/`VITE_WS_ROOMS` were once kill switches nobody wired) |
| The WS transport survives a reconnect without losing a subscription | `tests/socket.test.ts` (10) — handshake gate, request/reply correlation, immediate-cache replay to a late subscriber, resubscribe-on-reconnect, and the open-table index sharing ONE server subscription across every mounted browser (a late one gets the cached list, `unbrowse` only on the last one out) |
| The level curve is exact at every boundary | `tests/xp.test.ts` (13) — every threshold and its neighbours, plus a brute-force oracle |
| A level's RANK NAME cannot drift from the ladder | `tests/ranks.test.ts` (11) — the ladder's own invariants (starts at level 1 so every level has a rank, strictly ascending `minLevel`, unique ids/names — the properties `rankForLevel`'s backwards walk silently depends on), every rung AT its `minLevel` and the level below it at the previous rung, the top rank held forever above the last rung, garbage floored rather than thrown, `nextRankAfterLevel` null at the top and agreeing with `rankForLevel` about every boundary, and the ladder read against the REAL xp curve (a fresh account is a Newcomer; Bronze is 15 wins away; the top rung lines up with the Platinum tiers at level 50). Falsified by re-ordering one rung: a ladder out of order does not throw, it returns the wrong name forever |
| The hub does not tell a brand-new player "welcome back" | `tests/greeting.test.ts` (4) — the branch a developer cannot reach by clicking. Every account on this machine has played something, so the returning wording renders on every reload and the first-run wording is text only a new player ever sees — the same blindness that left `GET /leaderboard` behind auth for weeks, invisible to anyone holding a session. So `played: 0` is asked for BY NAME. Plus a blank or whitespace name dropping its clause rather than trailing a comma on an empty subject (a profile can land a tick after the session, and the name is user-supplied), and a NaN/negative `played` — reachable, since it is a sum over stats off the wire — landing on the FIRST-RUN side, because a returning player reading one odd sentence is the harmless direction and "welcome back" to someone who has never been here is a claim about a visit that did not happen. Falsified by collapsing the branch to a constant: three go red |
| The economy is correct — limits, payouts, XP, unlocks | `tests/economy.test.ts` — `validateBet`/`clampBet`, and `applyResult` proving `big_win` fires on *net* not gross and never twice, money floored, input unmutated |
| Stats count right; achievements fire at the boundary | `tests/progress.test.ts` (10) — `bumpStats` immutability + per-game keys, and `satisfiedAchievements` at the exact threshold for the standalone badges (`first_win`, `big_win`, `high_roller`, `table_regular`) and the level/bankroll chain rungs |
| Achievements 2.0 — chains, grant, feats, hidden, completion % | `tests/achievements.test.ts` (29) — every chain tier at its boundary and one below (wins 10/50/100/500, bankroll $10k–$1M, level 5/10/25/50, every game's mastery chain 1/10/50/100), the earn-only grant lands in `inventory` on the completing tier only, not early, and exactly once — including for a chain added AFTER P3, driven through `applyResult` rather than the predicate alone; `recordedFeats` filtered to `FEAT_IDS` + de-duped; a game **cannot** forge a chain badge (or its grant) through the feats channel; feats fire once and carry no `test`; `completionPct` derivation; and catalogue integrity (unique ids, four ordered tiers per chain, `feat`⇔no-`test`, every chain carries a distinct non-empty heading). **The row that makes per-game mastery a rule instead of a list**: the mastery chain ids are asserted equal as a SET to the real `registry`'s `manifest.id`s, so a seventh game cannot ship without a chain and a chain cannot outlive its game — falsified by deleting the UNO chain (two go red). Plus: no chain is cross-wired (100 wins of one game earns nothing on another), and every mastery Platinum grants exactly ONE DISTINCT title (two chains granting `ttl_thehouse` typechecks, passes the earn-only check, and makes a title unreachable by its own chain forever — falsified, one goes red) |
| Packs pull at the published rate, and can never drop what money must not buy | `tests/packs.test.ts` (29) — odds sum to 1 and the empirical distribution matches them over 20k seeds (the card's table IS the roll), every weighted rarity has a non-empty bucket, the pool excludes **every earn-only cosmetic and every free starter** (asserted over the catalogue AND exhaustively over the roll; the earn-only half is additionally unspellable — `PackPull.item` is a `PackableCosmetic` reachable only via `isPackable`), a seeded roll is deterministic, a fresh pull spends exactly the price and grants the id, a duplicate refunds **completion-scaled** dust and grants nothing, dust is monotonic in completion and never exceeds the price at any completion (incl. clamped nonsense input), the roll pays the same number the shelf quoted, `completion` is derived per-pool and ignores foreign inventory, `canOpen` refuses a short bankroll and a completed pool, every pool item is reachable, bankroll floored at 0, input unmutated |
| A bankrupt top-up is a lifeline and not a faucet | `tests/refill.test.ts` (7 — the shared rule: a top-up reaches EXACTLY the floor from any balance below it, refuses at the floor and above, `null` and not `0` when ineligible so a caller cannot bank an empty grant, integer cents from a fractional balance, and the anti-faucet property stated directly — **no sequence of refills, interleaved with losses, leaves anyone above the floor**, which a flat `+N` grant would fail) + `boardwalk-api/tests/refill.test.ts` (14 — everything that needed the referee's own state: eligibility judged against the LEDGER balance, the once-a-day limit counted off the ledger's own rows and refusing a SECOND top-up with a fresh nonce, the allowance resetting the next UTC day, a **wound-back clock unable to re-open it** (the window is `>= startOfToday` with no upper bound, on purpose), a refusal costing neither the nonce nor the day, a replay paying once, money moving and **nothing else** — no XP, no stat, no badge — and 100 days of maximal grinding never once passing the floor). Falsified by removing the daily limit: four go red |
| Daily streak and store math | `tests/rewards.test.ts` (streak/gap/clock-rewind/cap), `tests/store.test.ts` (21 — afford/own/buy/equip across all three kinds, unique ids + avatar-only unique emoji, every rarity present, earn-only unbuyable at any bankroll + has an unlock line, card back/title equip into the `equipped` map without dropping the other, `equippedTitle`) |
| Money has no setter a game can reach | Type — `useBankroll(): number`; the one writer (`mutateProfile`) is on no game-facing surface, and `useBet`/`reportResult` are the only sanctioned paths |
| The client cannot move its own money, nor mint its own badge | `boardwalk-api/tests/economy.test.ts` (62) — bet refused past the LEDGER balance, a settle with no open wager refused, a payout over the per-game ceiling refused with the wager left OPEN, one wager pays out once, open wagers consumed oldest-first, an earn-only cosmetic unbuyable at any balance, a purchase charged at the SERVER price, the daily clock refusing a wound-back claim, every mutation replay-safe (a repeated nonce moves nothing and does not double a stat), and Phase D: **`checkSettle` refuses `gameId: 'blackjack'` outright** (the dealer settles that game), XP and stat counts come from the OUTCOME and never from the wire, the server **awards `first_win` itself on a real win with nobody reporting it** and does not award it on a loss, unlocks once and never revokes, a replayed settle re-awards and re-grants nothing, and **a forged badge, a forged grant, and a chain id smuggled through `feats` all change nothing** — while a real feat, which no state predicate could have seen, is recorded |
| Blackjack's dealer is the server, and it never sends what it should not | `boardwalk-api/tests/blackjack.test.ts` (30) — `dealHand` deducts from the LEDGER balance and opens a wager row, refuses a stake the balance cannot cover **and deals nothing**, gives the nonce back on a refusal so the same nonce deals once affordable (the `return`-out-of-a-transaction COMMITS bug, which was leaving an orphan hand and a burned nonce), settles a dealt natural immediately at an integer 2.5× on an odd wager, and leaves a live hand's stake open; `playMove` hit-to-bust pays nothing, stand plays the dealer out and pays exactly what the shared rulebook says, a double takes a SECOND wager and settles against the doubled stake and is refused whole if the balance cannot cover it, a move on a settled hand and a hand id belonging to another account both refused; replay safety on both routes (no second hand, no second card, no doubled payout); and the projection — the hole card and the deck absent while live, the dealer revealed once settled, `viewOf` carrying no deck at any phase — plus the routes answering `{profile, hand, replayed}`, **ignoring a hostile body carrying `payoutCents`, `outcome`, `result` and cards**, 400 on an unparseable body, 409 on a refusal, 401 without a token. **The peek and insurance at the MONEY layer**, which the pure suite cannot reach: a dealer natural settles at the deal with exactly ONE stake off the ledger and the double refused rather than silently taken; the side stake moves through the LEDGER with its own `wagers` row named by `hand_id` and both rows closed by one settlement; a paid insurance leaves the balance exactly LEVEL on a lost hand; **`recordOutcome` still fires once and the hand is a LOSS** (v1 called `recordWin` here, inflating the win count and the mastery chain that reads it, for a hand the player had just lost); an unaffordable insurance refused WHOLE with the offer still answerable the other way (the `return`-out-of-a-transaction-COMMITS ordering, on a new stake); both refusal directions; a replay paying once rather than staking twice; and the frame the decision is made on carrying ONE dealer card, with two hands differing only in the hole card asserted INDISTINGUISHABLE to the client |
| `PUT /profile` cannot set a balance, XP, stats, achievements or inventory | `boardwalk-api/tests/api.test.ts` (24) — a hostile body carrying all five is accepted and changes none of them; the opening stake is the server's `signup` grant and fires exactly once per uid; 409 (not 400) for a refusal, 400 for a missing nonce |
| The dealt-hand seam plays the shared rulebook and hides the hole card | `tests/blackjack-seam.test.ts` (10) — the LOCAL implementation driven against the shared reducer as an oracle (deal/hit/stand/double card-for-card, the stake taken once, a double staking twice and settling over the doubled wager, a dealt natural settling inside `deal` with the odd-wager 3:2 exact), the refusals (an unaffordable stake writes NO intent, a repeated nonce replays instead of dealing again, an unknown hand refused), and the projection: a live hand carries one dealer card with the hole card and the deck absent from the serialised payload, a settled one reveals — asserted against the **shared** `viewOf` (`@boardwalk/game-logic/games/blackjack`), which all three call sites now import, so the test asks whether what the repo hands out *is* the sanctioned projection rather than whether two copies of it resemble each other |
| The Firebase→SQLite backfill cannot lose an account or mint one | `boardwalk-api/tests/backfill.test.ts` (34) — the RTDB wire coerced (stripped-empty objects, hostile types, a missing bankroll defaulting to the opening stake rather than $0, a legacy `level` ignored); one `migration` ledger row sized to LAND on the Firebase balance; the `migration:v1` marker making a re-run a total no-op (ten runs, and a re-run that must NOT refund a loss the player has since taken); **a backfilled player signing in afterwards is refused a second signup stake**; per-uid transactions so one malformed record does not roll back the batch; a dry run that writes nothing and does not burn the marker; and `reconcile` catching two swapped balances that a matching grand total would hide |
| The room referee arbitrates seats, and a forged uid cannot claim one | `boardwalk-api/tests/rooms.test.ts` (44, the store/seat logic) + `gateway.test.ts` (28, driven over a REAL socket) — handshake auth, host-only gating, monotonic `seq`, owner-only private hands, author-pinned chat, disconnect→seat-release |
| A table asked for SEATED comes up seated, and one that asks for nothing comes up as it always did | `boardwalk-api/tests/rooms.test.ts` fillAi block (6) + `gateway.test.ts` (2, over a REAL socket) — the pure `fillWithAi` (empty chairs only, `CPU <n>` one-based to match what `SeatList` writes by hand, a human never displaced, and **an `ai` seat that is already sitting keeps its NAME** — a mid-game leaver's chair is released to `'ai'` carrying their display name, so relabelling it would erase who had been there), the store seating them in the SAME construction as the host (a 7-seat table is never observably half-filled, and the seat array stays the referee's), a one-chair table filling nothing rather than throwing, and the index unmoved: a bot-filled table is still listed with every bot chair joinable, because a person displaces the house — filling the chairs must not take your own table off the board. The socket half is a separate failure and a quiet one: the store can be entirely right while `onCreate` drops the field, and the symptom is a modal that promised a table of bots and delivered empty chairs, with no error anywhere. **`fillAi` absent reads as no fill** — asserted in both places and over the wire, because it is the deploy-order default: an old referee ignores the field and makes today's table, an old client never sends it |
| A table's STAKE is the room's, chosen once, and a guest sees it before sitting | `tests/room.test.ts` `anteChoices` block — always offers "nothing" FIRST (a `betting` manifest means a game *can* be played for money, never must be; zero is also the default, because money must not leave an account because a control went unnoticed), the rungs inside the declared range (UNO's reproduces v1's NONE/$25/$100/$500/$1K), collapse-to-`[0]` when the range admits no rung (the `tableSizeChoices` rule: one option is a control that cannot change the outcome), garbage collapsed rather than rendered, an ascending non-repeating ladder, and — read off the REAL registry — every offered stake integer cents a fresh account could cover, since a fractional rung dies at `validateBet` and a rung above the opening bankroll is a betting mode nobody can open. Plus the server half in `boardwalk-api/tests/rooms.test.ts`: the ante stamped at create and visible on the snapshot, a hostile stake FLOORED to a non-negative integer before it can reach a ledger row, write-once across seats/status/state/presence (so nobody can raise the stakes on a player who already sat down — v1 pushed a retuned ante to the room on change), and on the browser's poster. And the wire, over a REAL socket in `gateway.test.ts`: the stake reaches a GUEST on their own subscription before they take a chair, and an unsent one reads as `0` rather than `undefined` |
| A house rule is the TABLE's, chosen once, and the referee and every client read the same booleans | `tests/uno-house-rules.test.ts` (26) — the shared resolver (every non-object to defaults, only a literal `true` as on, **OWN properties only** — the first draft's bare index walked the prototype chain, so `{__proto__:{stack:true}}` turned every rule on for an object owning nothing, and the failure direction is the bad one), `crossStack` NORMALISED off without `stack` so no read site has to spell the dependency, and the resolver total over the declared id set. Plus the **bijection**, the drift that typechecks and renders perfectly: the manifest's toggle ids equal the rulebook's keys as a SET, so a fourth toggle cannot ship as a control that does nothing and a rule cannot ship that no table can turn on — and each spec's `requires` is asserted to AGREE with what the resolver normalises, since those are two mechanisms for one rule. Then the OS bag (a dangling prerequisite dropped, no-op by IDENTITY, the cascade that turns off what depended on a rule being un-ticked — otherwise the host sends a value the host cannot see) and the carriage: `deal` stamps them resolved, they **survive a move** (the play branch rebuilds the game field by field, so a missing line is not a type error and a stacking table would silently stop stacking on move one — falsified by deleting it), they survive the JSON round trip the match is stored through, and `toPublic` **resolves rather than passes through**, so a match dealt before the field existed projects as all-false instead of a hole on the wire. And the DEPLOY-ORDERING case, which would break every room game rather than just UNO: the frontend deploys on push and the Pi by hand, so a new client will read a snapshot from a referee that has never heard of the field — `undefined[id]` is a TypeError that takes the lobby down, and reading a missing bag as "no rules" is both crash-free and true (a server that never heard of house rules is not running any). The Pi still goes first; this makes getting it wrong degrade instead of break |
| Stacking is a rule the reducer ENFORCES, and it can neither leak nor hang the table | `tests/uno-stacking.test.ts` (37) — the legality collapse (a live stack REPLACES colour/value matching rather than extending it, so a red 5 on a red +2 and even a plain WILD are refused), the ladder's deliberate ASYMMETRY (a +4 answers a +2 with `crossStack`; a +2 **never** answers a +4, cross-stacking or not — the tidy symmetric version is the one that does not terminate, since a table holding enough +2s could keep one +4 alive forever), and the ADDITIVITY guard: with `stack` off a draw-two still deals on the spot and skips, which is the assertion that says the whole feature is invisible to a table that did not ask for it. Then the reducer — a +2 dealing NOTHING and passing one seat, the debt accumulating round the table, cross-stacking raising a +2 stack to a +4 stack and the ladder then locking, a take pulling exactly what is owed, and the property the design rests on: **a stack nobody answers rotates the table identically to the immediate version**, so the skip moved rather than vanished. **The dry deck, both directions**: a debt cleared when the deck comes up SHORT, a debt cleared and the turn MOVED when the deck yields nothing at all (returning unchanged there is a victim who can neither answer nor draw, on a turn only they can take — the table hangs forever), and still unchanged with nothing owed, which the board's auto-draw key depends on. Plus `drawDebt` degrading rather than throwing on a referee that has never heard of either field (the deploy order — an absent bag is `undefined.stack`), the reducer surviving that same legacy row **by playing a draw card**, which is the only branch that asks what a rule says (the first draft played a number and passed vacuously while the reducer still read the bag raw — found by falsifying it), the JSON round trip the match is stored through, a won round clearing a debt nobody will be asked to pay, and whole dealt games played to a WINNER at both tiers with `stack` and `crossStack` on, every move asserted to change the state. Falsified seven ways — the blanket dry-deck no-op, an uncleared debt, the collapse ordered after the wild rule, a symmetric ladder, `drawDebt` reading the bag raw, stacking forced on, and the reducer reading the bag raw — each going red |
| A table's house rules are stamped at create, bounded, write-once, and on the poster | `boardwalk-api/tests/rooms.test.ts` house-rules block (6) — stamped where the dealer reads them (`rulesOf`), `{}` for a room that does not exist rather than `undefined` (a missing room must never read as a rule somebody's hand is played under), a hostile bag BOUNDED at the one moment it crosses the wire (only literal `true`, ids under 32 chars, capped at 16 — a listing frame's size is not a stranger's to choose), **write-once across seats/status/state/presence** (the property that makes "nobody changes the game under a player who already sat down" true by construction; it matters more than the ante's twin because unlike a raised stake it costs the guest nothing measurable, so nothing would ever surface it), and on the public listing, because "UNO" and "UNO with stacking" are different enough games to change whether a stranger wants the chair |
| A GUEST reads the rules on their own subscription, before taking a chair | `boardwalk-api/tests/gateway.test.ts` house-rules block (2, over a REAL socket) — asserted on BOB's frame and not on the host's create reply, from a socket holding NO seat (checked, not assumed), because the host already knows what they chose and the guest is the one who needs telling; plus rules a client never sent reading as `{}` rather than `undefined`. And the other half in `boardwalk-api/tests/unoGateway.test.ts` — **house rules a client tries to name on `unoStart` are IGNORED in favour of the table's own**, the stake test one step across: a `playToLast` nobody agreed to is refused entry and the `stack` the room was created with is dealt regardless of how the host phrased the start. That failure is quieter than the stake's and therefore worse — nobody is charged anything, so the only tell is a card that will not go down |
| Ranked places keeps a table moving after 1st, places everyone, and splits the pot to the cent | `tests/uno-places.test.ts` (35) — **ADDITIVITY first**: with `playToLast` off a round still ends on the FIRST player out with a podium of one, the straggler is left UNPLACED (the ordinary game has no 2nd place to record), and a heads-up reverse still acts as a skip — every rotation rule is now written in LIVE seats, so a mistake in any of them changes a game nobody asked to change. Then the rule itself: 1st placed with the round NOT over and `toPublic` still saying `-1`, the turn never landing on a seat that has gone out, a draw-two dealt to the next LIVE seat (dealing two into a hand the projection reports as empty is a seat that is out and holding cards), **a reverse acting as a skip at two LIVE players and not two seated ones** (four chairs, two empty-handed, the reverse must bounce back to the player who laid it — falsified by counting seats), the straggler placed last still holding a card they were never asked to play, and heads-up ending exactly where the ordinary game does. Plus the two rules TOUCHING: a live stack passes PAST first place to the next live seat and is only cleared when the round is over. The readers are total — a missing/garbage `finished` is an empty podium (the deploy order), a `-1` or a fraction is dropped rather than marking a seat that does not exist as out, `seatAfterLive` starts from a seat that is ITSELF out (the ordinary case: a player is placed by the same move that then advances past them) and degrades instead of looping when nothing is live, and `winnerOf` still reads a LEGACY row's `winner`, which is the only record of who opens the next round. The log: a placement line while a ranked round runs and no winner line, the ACTOR credited on the move that ends it rather than the straggler (the end places two seats at once — taking the last entry reports the player who went out as having come last), and a seat that is OUT never announced as skipped. Termination is played out — whole dealt games at both tiers, with and without stacking, at 3 and 5 seats, every move asserted to change the state AND the turn asserted never to land on an empty hand, to a COMPLETE podium with nobody placed twice. And `potSplit`: winner-takes-all at one/two/three payers so today's tables do not move, the top half paid on a descending ladder, garbage paying nothing rather than writing a nonsense ledger row, and **conservation stated AS a property** — every table size × every stake, the shares sum to exactly the pot, integer, non-negative and descending. Falsified ten ways — the reverse counting seats, the turn advance and the draw-two victim ignoring placements, the straggler never placed, a debt dying with first place, the log crediting the last placed seat, `placesOf` trusting the wire, `winnerOf` forgetting legacy rows, `potSplit` rounding every share independently, and `roundOver` ending on the first player out — each going red |
| What the house may pay a bot table is MEASURED, and a tier retune has to come back and read it | `tests/uno-house-odds.test.ts` (9) — the one guard here whose whole output is a NUMBER. `plans/done/UNO_HOUSE_RULES.md` §4 wants to pay `ante × M` at a table of bots and refuses to name `M`, because *"`M = N × edge` assumes a player wins about `1/N` against `sharp` bots, and that assumption is the entire safety of the feature"*. So: 2,000 seeded rounds a cell through the REAL reducer and the REAL bots, over every declared table size 2–7 and both rule sets. **It measures policies, not people**, so every rate is a LOWER bound on what a human extracts and no seed turns it into an upper one — which is why the answer is not a win rate but an ORDERING: `casual`→`sharp` is worth 1.24–1.64× fair while `sharp`→an attentive-human proxy is worth only 1.09–1.23×, and a game whose skill gradient has already flattened by `sharp` is one where the unmeasured tail is short. The proxy lives in the test and not in `ai.ts` deliberately: it is an instrument, not a tier, and a third `UnoLevel` with no manifest choice behind it is `loadout.color`. Asserted: identical policies share a table equally over a SESSION at every size (the premise `M = N × edge` rests on — a favoured chair would have to be priced against, and the human knows which chair they are in); the opening seat lifting up to **1.209×** in a single round and that advantage VANISHING over a session, because `deal` hands the lead to whoever just won — **so the bound is the one-round number, since re-dealing to keep the lead costs a click** and pricing off the session rate alone would hand 21% to anybody who noticed; `sharp` genuinely beating `casual`, which is the only thing that makes §4.1's pinned tier price anything; and the bound itself, the worst lift ANYWHERE (1.230, six seats) against the 1.50 that `M = N × 2/3` permits. Plus a stall check, without which a policy that hung the table would simply appear to win less often and every rate would be wrong in the quiet direction. The two pricing assertions are deliberately different KINDS: an absolute safety bound, and a **review trigger** at 1.15 rather than the measured 1.22, because every figure is seeded and a band pinned to the last measurement goes red on a shuffle change that moves the number without moving the risk. Falsified four ways — the multiple raised to 0.9, the proxy playing a card it does not hold, the session freezing the lead on seat 0, and the tier hero demoted to `casual` — each landing on exactly its own test. **Slice 5 gave it a reader and one more assertion**: `HOUSE_RETURN` is now IMPORTED from the rulebook rather than restated here, so every bound above is a bound on the money that actually moves, and one case ties the ratio to the cents — `housePayout` must BE `ante × N × HOUSE_RETURN` and strictly below fair at every size, since every lift assertion would sail through a payout re-priced without moving the constant. It also pins the opponents: every rate here was measured against `sharp`, and `HOUSE_TABLE_LEVEL` is asserted to be the policy the harness actually seats, because the day it stops being one the whole table is priced against a game nobody plays |
| UNO's pot is the sum of the stakes — the house's included — and it is never fair odds | `tests/uno-pot.test.ts` (25) — the pot sums an UNEQUAL set of stakes, which has no caller today and is the whole reason it is an array rather than ante × players (it acquires one on the first short stack that shoves); a NaN stake ignored rather than poisoning the pot into a ledger row nobody can read back; and the conservation property stated AS a property — across every table shape 2..7, every mix of humans/bots/open chairs and every rung, the pot equals what the seats paid PLUS what the house did, integer and non-negative. That "plus" is slice 5, and the property was written before it precisely so it could not be written to fit it. **The faucet test moved rather than went away**: a lone player now builds a pot, so what is asserted is that it is `ante × seats × 2/3` and STRICTLY BELOW `ante × seats` at every size and every rung — v1's version paid exactly `ante × seats`, so the whole distinction between a house edge and a $75 grant on a coin flip is one `toBeLessThan`. Plus: a win still returns more than the stake at the smallest table (an edge that charged people to win would pass a sub-fair check); a one-SEAT table refused, since paying 2/3 for winning a game with nobody in it is the only arrangement that pays out backwards; the house never entering a pot two humans are already funding, at every size and mix (additivity — betting tables that exist do not move); `stakesFor` still charging nobody but the humans, because it is what the ledger loops over; `maxRoundPayout` bounding BOTH modes with one number and never binding on an honest round; and `rankedPayees`, where a house pot pays first place and nothing else while a table of people keeps the ordinary podium filter. Falsified: the house dropped from `potFor`, `rankedPayees` ignoring who funded the pot, and `housePayout` re-priced to fair — each going red on its own case |
| A house-banked table is one rule, asked in two places, and the lobby's copy is the one that can lie | `tests/uno-house-bet.test.ts` (9) — the OS decides what to SAY and what to lock (`tableBacking`), the rulebook decides what the ledger does (`potBacking`), and they are apart because `src/system/room` may not import a rulebook — it moves a bag it must not interpret. So the agreement is ASSERTED: the same answer for every table shape 2–7, every mix of humans/bots/open chairs and every rung, read off the REAL manifest rather than a fixture, since the flag that makes a lone player chargeable (`betting.house`) is a manifest declaration and half of what is being compared. Nothing here can pay the wrong amount — which is exactly why it needs a test, because a wrong payout announces itself in a ledger while a lobby saying "winner takes the pot" at a table the house is banking is simply wrong forever and looks fine (the ante line already shipped in that state once). Plus the threshold at the boundary and one below; a game that declared `betting` and NOT `house` still falling back to XP for a lone player, so the behaviour is opt-in per game and not inherited; every `house` game asserted to declare an `ai` mode and two seats, since a house table it cannot SEAT is a stake at a table where Start never lights up; the pin — `pinnedForMoney.value` is a choice the option offers AND equals `HOUSE_TABLE_LEVEL`, the second being the silent one (the referee deals the level the odds were priced against while the lobby promises another); the pin overriding `casual` when the house pays and NOT at a table of people; identity-stability, because it is read in render; and the claim the copy makes — wherever the OS says "house", the rulebook builds a pot bigger than the one stake in it |
| The referee deals UNO, and the money is its own | `boardwalk-api/tests/uno.test.ts` (38) — antes taken through the LEDGER with a wager naming the round, NO betting below two humans, an unaffordable ante refusing the WHOLE start and writing no stake (asserted on `bet` rows, not on an empty ledger — seeding a profile writes its signup grant), the nonce given back on refusal, authority by MEMBERSHIP, off-turn and illegal moves refused with the round unchanged, the pot paid to the seat the RULES say won with wagers closed by match id, `recordOutcome` once per human (the reason the board must not report), `checkSettle` refusing `uno`, a fresh ante per ROUND with the last round's winner opening the next, and the boot sweep voiding and refunding. **The replay case is UNO's own**: `applyMove` consumes randomness (an emptied deck reshuffles mid-move), so unlike Liar's Dice a re-run would deal a different table — the test drives a DRIFTING rng and asserts the reducer was never re-entered. Plus the RANKED settle, which is the half of places that moves money and the only part `tests/uno-places.test.ts` cannot ask about: `potSplit`'s arithmetic is proved where it is pure, so what is asked here is whether the referee hands it the right LIST — get that wrong and every share is computed correctly and paid to the wrong person. A three-human ranked round is **not settled when FIRST place goes out** (the failure is paying the pot with two players still holding cards, and it is only visible on a table big enough for the two moments to differ), the pot splits by placement with the table's total money exactly where it started, exactly ONE `won` row across three players (placing 2nd of 3 is not a win), and a BOT on the podium takes nothing while the humans' own money still lands entirely on humans. Falsified four ways — the winner paid whole, the ladder indexed by seat rather than by placement, a bot consuming a share, and the round settling on the first player out. **Then slice 5's half, which is the only settle in this repo that MINTS rather than moves**: a lone player is charged, the pot is `housePayout` and strictly below `ante × seats`, exactly one wager row exists and no bot has one; the tier is PINNED to `HOUSE_TABLE_LEVEL` however the frame phrased it, while a table of PEOPLE still gets the `casual` it asked for and a FREE bot table is pinned to nothing (a tier is only worth taking away where it prices something). Both economics are asserted, and they are asserted through a SEEDED rng end to end with a seed found for each side — the other settle tests let the deal decide and branch, which is fine when both branches are one rule and wrong here, where a run that always landed on a win would never once check that a loss costs the ante. Ranked is the case the ordinary filter gets wrong and it is most rounds rather than a corner: with one payer the podium filter is that player at EVERY placement, so a loss on a complete 4-seat podium must pay nothing where `potSplit(pot, 1)` would have paid the lot. And the per-match ceiling, reached the only way it can be — by CORRUPTING the stored pot to 20× what a 2-seat table could hold, since on an honest round it never binds and a guard nobody has watched fire is a guard nobody has tested. Falsified three more ways — the pin removed, the clamp removed, and `housePayout` re-priced to fair |
| A dealt UNO table never sends a hand to anyone but its owner — the HOST included | `boardwalk-api/tests/unoGateway.test.ts` (12, over a REAL socket) — each player sent their own seven and `null` for every other seat on every frame (the assertion the whole cutover exists for: the host used to legitimately hold every hand), the public state carrying counts and a pot with no `"deck"`, `"hands"`, `"pending"` or `"ackNonce"` anywhere in the serialised payload, **a stake a client tries to name IGNORED in favour of the table's own** (falsified by letting the dealer read the frame — the pot became 2×$4,000 instead of 2×$25, a perfectly fair game at a price nobody consented to), the antes taken with the reply carrying the authoritative profile, a non-host refused the deal, a non-seated socket and an off-turn move both refused, a bot driven by the REFEREE with its hand written nowhere, and `parseMove` refusing (not coercing) anything that is not a move while dropping every hostile extra. Plus the one branch ranked places could STALL a table through, driven against the dealer directly rather than over a socket (`AI_DELAY_MS` is 900ms of real time and this needs exactly one bot move): with `playToLast` on, a round somebody has already gone out of still gets its next bot move SCHEDULED. Removing `UnoGame.winner` made every such site a compile error, but *which* predicate replaces it was still a choice, and the wrong one is invisible — the round is legal, every human can still move, and a bot's turn simply never comes. The position is reached by PLAYING to it rather than hand-writing a state, so the round the dealer is handed is one the rules produced. Falsified by scheduling on "somebody went out" instead of `roundOver` |
| A crashed player does not strand a table, and a blip does not cost a live player their seat | `boardwalk-api/tests/gateway.test.ts` crash-recovery block (7, over a real socket **terminated** rather than closed) — a kill mid-game hands the seat to an AI *after* the grace window and the room survives with the other player told without asking; a reconnect inside the window **keeps** the seat; `'ai'`/`'open'` decided at FIRE time (a lobby that starts during the window still yields a bot); a lobby drop opens the chair; a seat claimed by a socket that **never declared presence** is still released; a second tab of one account is **not** a departure; and a crash that empties the room GCs it at once, taking its chat and hidden hands with it — the whole of "no orphaned rooms/hands/chat" on this path, since they are one record. **The mid-game AI branch had ZERO coverage before this** while the gateway's docblock claimed it |
| The RTDB fallback arms a teardown a crashed tab cannot run — and the rules permit it | `tests/crash-recovery.test.ts` (7) — the pure `disconnectUpdates`: a guest seat armed to AI mid-game and OPEN in the lobby, a guest arming **neither** room/hands/chat, a host-alone taking all three in ONE write and **not** its own seat (the resurrection hazard `teardownPlan` documents), a seat-less spectator arming nothing, and no armed write ever carrying a `uid` (the seat validator would refuse it and the table would stall exactly as before). Plus the enforcement half in `tests/database-rules.test.ts` (4, real emulator, real rules file) — the host's atomic three-path delete **succeeds** (all three rules authorise against `meta/host`, so sequential deletes would de-authorise each other; falsified by dropping the hands delete rule), the same write from a guest is refused, a guest may arm its own seat to AI, and no-evict still refuses arming someone else's |
| A client cannot bank more offline results than it was issued tickets for, and a replay pays once | `boardwalk-api/tests/tickets.test.ts` (37) — sign/verify round-trip, a tampered ticket, one account's ticket refused for another (the uid is in the MAC, not the string), a short signature refused rather than THROWN (`timingSafeEqual`'s length trap), non-canonical sequences (`01`/`1e0` are not second spellings of `1`), the rotation window (previous key verifies, a key rotated all the way out is refused and flagged `retired`, and selection is by `kid` — proved by a ticket that must ALSO fail on a server holding only the other key), **20 fabricated devices yielding exactly `TICKET_BATCH` between them**, a sequence never issued refused (the key-leak bound), the gate refusing a client-minted nonce while enforcement is on and ACCEPTING one while it is off, `/bet`+`/daily` untouched by the gate, spend accounting not doubling on a replay, and **the attack itself: bank a settle, re-send it five times, assert one ledger row, `played` 1, `won` 1** |
| The offline queue's rules | `tests/offline-queue.test.ts` (19) — spend order, **`takeTicket` returning null rather than minting when exhausted**, top-up at the low-water mark, "unknown server" still asking (a `null` treated as `false` would send the first settle self-minted into a 409), cap = batch, drop-oldest, re-stamp swapping only the coupon, and persistence: garbage degrades to empty instead of throwing at boot, a hostile `localStorage` cannot smuggle a `purchase` or `daily` into the outbox |
| The flush loop's orchestration | `tests/offline-store.test.ts` (15) — drain order, STOP at the first network failure (never burn the queue against a dead connection), a retry replaying the ORIGINAL nonce, adopt-only-when-empty (mid-drain would roll back XP for a result still queued), a genuine refusal dropped **without burning a spare ticket** (the case a first draft passed for the wrong reason — see the falsification note in the plan), a retired ticket re-stamped exactly once, and no two concurrent drains |
| The profile the server hands back is the one it stores | `boardwalk-api/tests/profile.test.ts` (15) |
| A backup restores, and the drill says so | `boardwalk-api/tests/backup.test.ts` (16) — online-backup API (not a file copy), `PRAGMA integrity_check` on the RESULT, balances recomputed from the restored ledger, and a corrupt/unopenable file reported red rather than thrown |
| The Phase-A shadow diff + mirror are correct | `tests/shadow.test.ts` (13) — `diffProfiles` (clean round-trip empty, null read-back as one whole-profile diff, scalar/nested-stat/daily mismatch, a field present on only one side), and `shadowProfileRepo`/`mirrorProfile` (reads through the primary alone, mirrors on save, a throwing mirror never rejects the write — Firebase stays authoritative) |
| A rematch needs everyone, and cannot be satisfied by a ghost | `tests/rematch.test.ts` (19) — `castVotes` (idempotent, additive, votes every local seat at once for a hot-seat screen, input untouched), and the tally: only HUMAN seats are asked, one human at a table of bots restarts on a single click, a departed player's stale vote is ignored because `needed` is recomputed from the current seats, and **an all-bot/empty table never agrees** (the `every`-over-an-empty-list trap that would restart a dead room forever). Falsified by dropping the `needed.length > 0` clause and by counting raw vote keys instead of the needed subset — one test each. Plus the HOST'S GATE, which is the half that moves money — `restartGate` driven as a SEQUENCE rather than asserted call-by-call, because any single call looks right under either scheme and only a run of them tells the old one from the new: it fires once on agreement, stays quiet through the window before the new state lands (a second firing is a second deal and, at a betting table, a second ante off everyone), re-arms when the votes clear, and — the case it was rewritten for — **deals a SECOND rematch when two matches end on the same round number**, which is the position a referee-dealt game reaches by design since each match restarts `round` at 0. Falsified by breaking the re-arm, which is exactly what the round-keyed version did when a round repeated: four go red, that one included |
| The rules release cannot go stale, run out of order, or red-X `main` before it is configured | `tests/rules-deploy.test.ts` (8) — the workflow that finally closes "deployed by hand". A workflow is a pile of strings nothing typechecks and every way it fails is SILENT, so three mechanisms are pinned: the `paths` trigger is asserted against the ruleset **`firebase.json` actually names** (rename it and the filter goes stale — the change lands on main, no run is queued, nothing is red, and production quietly keeps the old ruleset, which is the exact state this closes); `rules:test` is asserted to run BEFORE the release by string INDEX, since a job that publishes an unproven ruleset automatically is worse than the manual process it replaces; and the deploy is asserted to be gated on the credential check rather than unconditional, so a repo without the secret skips loudly instead of failing forever on the security boundary. Plus the workflow's self-reference in its own `paths` (api.yml's convention — the one line whose absence has no other symptom), no release from a pull request, and service-account auth rather than a deprecated unscoped `FIREBASE_TOKEN`. Falsified three ways — firebase.json repointed, the gate removed, the order inverted — each landing on its own case |
| The preview IS the table you get | `tests/room.test.ts` `plannedSeats` block — the lobby draws this array before the table exists and the create path produces it, so what is at stake is a PROMISE. v1 had the property for free by calling one `buildSeats` from both places; here the two EXECUTIONS genuinely differ — an AI fill is a boolean the REFEREE applies inside `store.create`, a local fill is a loop of claims from the host's own client — so the composition is asserted rather than assumed: an unfilled table put through the hot-seat claim loop must EQUAL `plannedSeats(fill: 'local')`, uid and label included. Read off the REAL registry at every size every game can actually be created at (the picker's rungs, or `min` when it draws none), because the shape of a planned table has to be a fact about the manifests this app ships: exactly one host, at index 0, every occupied chair carrying a DISTINCT non-empty name (an unnamed bot renders as `SeatList`'s "…" placeholder, which reads as a seat still loading), and a bot chair holding no uid — one carrying a uid is refused by the RTDB seat validator outright, so `null` is not cosmetic. Plus the degradations: a seat count that cannot seat a host is `[]` and not a phantom chair (`SeatPreview` then draws nothing), and a fresh array every call, since it is read in render and handed to a component. **What it cannot reach is stated rather than faked**: the referee's own `fillWithAi` is in `boardwalk-api`, outside this workspace, so both sides pin the `CPU <n>` literal in their own suite and the join between them is a comment — a test comparing a copy of the rule to the rule is the vacuous guard this section warns about. Falsified four ways — a zero-based `CPU <n>`, a local fill dropping the host's uid (two go red, the composition included), the fill overwriting the host's own chair, and a phantom chair for a zero-seat table |
| Seats/ordering/lifecycle are correct | `tests/room.test.ts` — claim (open-before-ai, no-evict), `releaseSeat` fallback, `localSeatIds` ×3 modes, `aiSeatsToDrive` host-only, `seq` strictly-fresh + shuffled-delivery, `teardownPlan` (host clears chat/room, guest doesn't), and `tableSizeChoices`: every size in the range inclusive, **nothing at all when the range holds one size** (a picker with one button is a control that cannot change the outcome — falsified by relaxing `max <= min` to `max < min`), a reversed/zero/fractional/NaN range collapsing rather than rendering a broken picker, and — read against the REAL registry, not a fixture — every size it offers being one the lobby can actually START, since `canStart` needs a full table and a picker offering a size the game refuses is a Start button that never lights up. Plus **every room game's `seats.min >= 2`**, read off the REAL registry: Tic-Tac-Toe declared `{ min: 1, max: 2 }`, meaning "one human is enough" — true of the GAME and false of the TABLE, since `modes` already carries "you can play this alone". `tableSizeChoices` therefore offered `[1, 2]` and the lobby defaults to `seats.min`, so the default Tic-Tac-Toe table was ONE chair, which `tableIsFull` calls full and `canStart` lights up, on a board whose `seats[1]` is `undefined`. It survived because the seat picker was a small unlabelled row on a page nobody looked at twice; the launch modal puts it at eye level. Stated as a rule over the registry rather than a fix to one manifest, and asserted about the SEATS rather than about `tableIsFull` — a table of one IS full, and it is still not a table. A solo game is exempt by construction, never mounting a lobby at all. Falsified by putting the `1` back: two go red. And `humanCapacity`, the pre-deal sibling of `humanCount` that counts an OPEN chair as a human the table could hold — asking `humanCount` of a PLANNED online table answers "one human, so the house banks this" and locks UNO's bot tier at `sharp` on the strength of a guess that nobody else will ever join |
| Chat orders by key, not clock — and says a long log short without reordering it | `tests/chat.test.ts` — `messageKey` fixed-width ASCII sort = send order, counter tiebreak/rollover, `sanitizeMessage`; plus `groupMessages`, whose two collapses are both strictly LOCAL: consecutive messages from one author share a name, consecutive identical texts fold into one line and a count, and neither reaches across a gap — A→B→A stays three runs and a repeat split by another message stays two lines, because the tidier-looking version renders a conversation nobody had (falsified by matching a run on any earlier group of the same author: the order test goes red). Grouping keys on `uid`, never the display name — a name is denormalized copy, the uid is what the rules pin — and a folded repeat keeps the key of the message that OPENED it, so a line does not remount and lose its place on screen every time somebody says the same thing again |
| Every sound role names a file that is staged | `tests/audio.test.ts` (4) — every `sounds.ts` file exists in `public/audio/`, every role non-empty, variation pools distinct, `click` primer single-file. Covers P5's `unlock`/`fanfare` by construction (the test walks the registry, so a role added without its file is red) |
| Every card + every card back maps to art that is on disk | `tests/cards.test.ts` (8) — all 52 `cardSrc` paths resolve in `public/cards/standard/`, suit-casing + `10`, every `CARD_BACKS` id resolves, an unknown/absent back id falls back to the default (never a 404), a known id maps to its own file, **every `cardback` store cosmetic resolves to art + the default back is a free starter**, `isRed` |
| Every felt maps to art that is on disk, and the store sells no felt without it | `tests/felts.test.ts` (7) — every `FELTS` id resolves in `public/felts/`, each id maps to its OWN file (two ids sharing one image is the store selling a felt twice), `null` for nothing-equipped AND for an unknown id (a retired felt degrades to a bare table, never a 404), base-path awareness, plus the catalogue half: every `felt` cosmetic resolves to art, none is a free starter (the default is NO felt), none is earn-only (no chain grants one) |
| Every chess set's men are on disk, and its squares are a colour the theme defines | `tests/chess-sets.test.ts` (14) — all 12 men resolve for every set with art, **the king and the knight are different files** (chess notation uses `n` for the knight because `k` is the king; naming files from the English word's first letter silently collapses the two, which happened while curating this art and renders a king on both squares), every set's twelve are distinct, the STARTER draws glyphs and `squares: null` so the Phase-6 board does not move by a pixel, an unknown/absent id falls back to the starter rather than to broken images (the card-back rule, not the felt's `null` — a board must always draw), base-path awareness, both catalogue directions (no row without a set, no set without a row), exactly one free starter, no earn-only set with no grant site, no two sets that look identical, and **no square class built by interpolation** — checked against the SOURCE TEXT, because Tailwind generates a utility only from a complete name it can find while scanning: an interpolated one yields the right string at runtime and no CSS at all. The first draft of that check inspected the runtime value, claimed in its comment to guard exactly this, and stayed green when falsified with a template literal |
| A frame's ring colour cannot drift from its rarity | `tests/frames.test.ts` (6) — every catalogue frame is registered and every registered id is real (both directions, so a tone for an unbuyable frame is dead data too), **each frame's tone EQUALS its catalogue rarity** (the one that would actually rot: re-tier a frame and its ring keeps the old colour, which no disk check and no compiler can see), every tone resolves to a **flat** `border-rarity-*` class carrying no shadow/glow — the guard that keeps this kind off the glow budget — and `null` for nothing-equipped/unknown |
| A new column reaches the database that already EXISTS, not just a fresh one | `boardwalk-api/tests/migrations.test.ts` (6) — builds the pre-P5 `profiles` table by hand, proves `migrateColumns` adds `equipped_felt`/`equipped_frame` and leaves the old columns alone, that ten re-runs are a no-op, that every `COLUMN_MIGRATIONS` entry names a column the fresh DDL also creates (the two halves diverging is how one path silently misses it), and that a migrated database round-trips a felt and a frame. **`migrateColumns` carried a comment claiming this test since Phase B; it did not exist.** Falsified by dropping the two P5 entries: these go red while the rest of the API suite stays green, which is exactly the prod-only blindness the file exists for |
| All four equipped slots survive the server round-trip | `boardwalk-api/tests/api.test.ts` (24) — a `PUT /profile` carrying cardback+title+felt+frame reads back with all four, asserted on a FRESH `GET` and not merely the write's own echo (a write can echo its input while the columns never held it), and un-equipping a felt CLEARS the column rather than leaving the old id |
| A declared pre-game option is well-formed, and resolves to a value the game offers | `tests/game-options.test.ts` (17) — `resolveOptionValues` turning nothing/partial/unoffered/wrong-typed/foreign-keyed input into a complete valid set, `setOptionValue` refusing an unknown id or unoffered value **by identity** (a no-op that does not re-render), and the DECLARATION half over the real registry: unique option ids, unique choice values, and **the default is one of the choices** — the failure that typechecks, throws nothing, and renders a control with nothing selected (falsified by re-defaulting Solitaire's `draw` to `'2'`); plus the AI-difficulty declarations as a BIJECTION — every declared choice maps to a level of its own and each game's default is still the level it shipped, the rot being a fourth choice added to a manifest that the mapper silently collapses into an existing tier while the control renders perfectly (falsified by adding a `brutal` choice to Tic-Tac-Toe); and the `default` guard's twin for slice 5's `pinnedForMoney` — the pinned value must be one of the choices, the reason under it must be non-empty (a lock with no reason reads as a broken control), and only a game that puts money on the table may pin anything for money. Swept over the whole registry rather than over UNO, so it is true of the SEVENTH game rather than of the one that declares it today. **And the URL is now a value's home across a navigation** (the launch modal picks a tier on the HUB; the game that reads it is mounted one route later), so the round trip is asserted over every choice of every declared option — plus the ways a query string, which is user-editable text, is not one: an unoffered, empty, repeated or un-namespaced key all read as the default, a bare `draw=3` is NOT an option (the `o.` prefix is a namespace so an id can never collide with `table` or `mode`), `table`/`mode` survive a write untouched while the PREVIOUS game's option keys are cleared (a stale `o.bots` on a Tic-Tac-Toe link is ignored by the resolver and carried forever by the link), and the params React Router handed over are never mutated. Falsified three ways — the namespace dropped, the stale-key clear removed, and a solo game's options skipped — each going red |
| Every game's entrance offers exactly the ways in it declares | `tests/launch-modal.test.ts` (20) — the modal renders what these pure functions return and holds no second opinion (the `plannedSeats`/`<SeatPreview>` split), so they are what is asserted, and swept over the REAL registry because every failure here is a property of the games this app ships and none is visible in the file that causes it. The ways in ARE `manifest.modes`, in order; every one is labelled, and the label is not the raw enum member — the lobby rendered `{m}` for five phases, so the screen said "ai" and "online"; every mode's label is its OWN, which `Record<GameMode, string>` cannot see (four copies of "Play" satisfies it) and which renders as two buttons a player cannot tell apart; and EVERY registered game gets a modal, single-mode games included, which is decision 3 as an assertion. Then `launchStepFor` — a room mode always asks for a table, a solo game asks only what it DECLARES (so Blackjack's depth landing later needs no edit here), and both answers are asserted to occur on the registry as it stands, or the case passes vacuously the day every solo game declares options. `playPath` carries the table, the mode and the options, and the options are read BACK through `readOptionValues` (a path that carried them in a shape the reader cannot parse loses the tier silently, and looks exactly like the default being right) — using the LAST choice of each option, so a value that happens to be the default cannot pass it by accident; a solo game names no `mode`, because nothing reads it there. And `isPlainClick`, which is why the hub card is still an `<a>`: ctrl/cmd/shift/alt and a middle click all belong to the BROWSER, and one modifier short silently costs "open in new tab" — the loss nobody files a bug about. **And it MOUNTS**: the modal itself goes through `renderToStaticMarkup` in Node (`tests/modal.test.ts`'s trick — no DOM, so the effects do not run but the markup a browser would be handed does), because the ways the entrance could fail are not visible in a diff. It draws a throwaway `<GameShell>` (which reads the router and would throw outside one) and pulls `<TableSetup>` into the hub's import graph, so a crash on mount would look exactly like the card doing nothing. Asserted: the buttons ARE the labelled ways in, as a list, for every registered game — not merely that the label appears, since "Play" is a substring of "Play Online" — and a modal with nothing launching draws no buttons at all, which is what "closed" has to mean when one modal stays mounted for every card on the page. Falsified six ways — two modes sharing a label, a solo game's options skipped, `altKey` dropped, the option namespace removed, the button rendering the raw enum member, and a closed modal still drawing its body — each landing on its own case |
| Every game icon a manifest names is on disk | `tests/game-icons.test.ts` (2) — every `manifest.icon` resolves in `public/games/`, and `gameIconSrc` is base-path-aware + undefined-safe |
| The one modal is three widths wide, and its body flexes instead of clamping | `tests/modal.test.ts` (9) — the kit's first test that looks at what a component RENDERS, because everything here is a class string and a class string typechecks however wrong it is. It runs the real `<Modal>` through `renderToStaticMarkup` in Node (no DOM: the effects, which is all `showModal()` is, do not run — the markup does), so the assertions are about what a browser is handed rather than what the source looks like. Every `MODAL_WIDTH` entry resolved against a `--container-*` the theme really declares — the `theme-tokens` family, since Tailwind answers an unmatched one by generating nothing and the box silently keeps its old width — and **exactly ONE `max-w-*` on the box** rather than "the right one is present": a stale width left in the shared BOX list beside the size means CSS source order, not the prop, picks the winner, and it looks perfectly correct in the diff that adds it. Plus the default still being `max-w-lg` (the three existing call sites must not move by a pixel), the body carrying `flex-1`/`min-h-0`/`overflow-y-auto` and **no `max-h-*` in any spelling**, header and footer pinned `shrink-0`, and a childless modal still rendering no body at all (`useConfirm` builds one). **One row here came from the browser and could not have come from anywhere else**: `max-h-full` on the box clamps NOTHING unless the dialog pins its single grid row, because an auto row is sized by its item and `max-height: 100%` then resolves against a height the item itself produced. Every class was correct and every assertion above was green while a tall body rendered a 1463px box hanging 679px off the bottom of an 800px screen — so the two classes are asserted together as one mechanism, `minmax(0,1fr)` and not `1fr` (a fr track keeps a min-content minimum, which is `min-h-0`'s trap one layout system across). Falsified six ways — a stale width in BOX, the body re-clamped at a fresh `70vh`, `lg` re-pointed at a container that does not exist, `min-h-0` dropped, the row left auto, and `1fr` for `minmax(0,1fr)` — each landing on its own case |
| No game draws its own end-of-round panel | `tests/game-result.test.ts` (4) — the SOURCE-TEXT guard, because there is no DOM in this suite and "the panel renders over the page" is not assertable (pretending otherwise is the vacuous guard this file's own Enforcement note warns about). Both directions: every REGISTERED game presents its result through `<GameResult>` (so game #7 cannot ship with a panel of its own), and nothing imports `@/system/room/Rematch` without it (the specific regression — the rematch button is the control that used to sit below the fold, and it must stay mounted in ONE place). Plus the surface itself: it must be the kit's `<Modal>`, since a rewrite back to a positioned div would pass every other case here while losing the top layer, which is the whole property. A file must both IMPORT it by path and RENDER `<GameResult`, and that pair is the falsification talking: the first draft asked only for `includes('GameResult')`, and renaming the component to `GameResultXX` left all four cases GREEN because the impostor contains the string. Falsified three ways after the fix — the rename, a game keeping `<Rematch>` with the surface deleted, and the modal swapped for a div — each landing on its own case |
| Every glow, shadow and animation a component spells is one the theme DEFINES | `tests/theme-tokens.test.ts` (5) — the asset-resolution rule (`audio`, `cards`, `felts`) turned on the theme, because a utility with no token is a dead reference of exactly the same kind and this one **shipped**: UNO's pot carried `text-shadow-neon-gold` while `--text-shadow-neon-gold` did not exist, so the pot rendered FLAT from the day it landed. Nothing could have caught it — `tsc` sees a string, `no-raw-palette` looks for raw colours and this is not one, `no-daisyui-classes` looks for component words and this is not one either, and Tailwind v4 answers an unmatched `--*` namespace by generating nothing at all, silently. So every `shadow-glow-*`, `text-shadow-*` and non-built-in `animate-*` in `src/` is resolved against `packages/theme/theme.css`, scoped to the three families the theme solely owns (a blanket sweep would fail on Tailwind's own `shadow-sm`/`animate-spin`). Plus the two tokens UNO's call added, named directly because a sweep only proves that whatever is spelled resolves: `--shadow-glow-uno` must be built from `--color-warning` and **must not** be `--color-accent`, which is the glow budget as an assertion — gold is money, and calling UNO wins you none. Falsified twice: renaming the gold token reproduces the shipped bug (two go red), re-pointing UNO's glow at the money accent goes red on its own |
| `boardwalk-api/` is linted, typechecked, tested and built in CI | `boardwalk-api/eslint.config.mjs` (flat, type-aware over `tsconfig.test.json` so **src, tests and `vitest.config.ts`** are all in the program — the build config includes only `src`, and the usual cure for the resulting "not in project" noise is to stop linting tests) + `.github/workflows/api.yml` on push **and pull_request**, `paths`-filtered to the package *and the workflow file*, so a change disabling the guard is checked by it |
| Liar's Dice's rules are correct | `tests/liars-dice.test.ts` (44) — the deal clamped to 2..6 seats (v1's `[5,5,5,5]` literal made a 2- or 3-player match UNWINNABLE), wilds counted once and never twice on a bid of 1s, the **wild-ones conversion** (halve into 1s, double-plus-one out), opening refused on wilds but allowed in palifico where they are not wild, palifico's locked face, spot-on both directions (everyone-else vs the caller alone), elimination + a 2-player match that CAN be won, turn authority, `applyAction` totality + immutability, the projection asserted STRUCTURALLY (`'dice' in view === false` + a `JSON.stringify` scan), the reveal opening every cup and only at a reveal, and the house — never returning an action the reducer would refuse (an illegal bot action is a no-op, and a no-op on a bot's turn stalls the table forever) |
| The referee deals Liar's Dice, and the money is its own | `boardwalk-api/tests/liarsDice.test.ts` (25) — antes taken through the LEDGER with a wager naming the match, NO betting below two humans (the pot would be your own ante handed back), an unaffordable ante refusing the WHOLE start and writing nothing, the nonce given back on refusal, authority by MEMBERSHIP (another account's match is a refusal, not a read), off-turn and illegal actions refused, the pot paid to the seat the RULES say won with wagers closed by match id, `recordOutcome` once per human, replay safety on both routes, and the boot sweep — a restart voids and REFUNDS every live match, because the room is in memory and the antes are not |
| A dealt table never sends a cup to anyone but its owner | `boardwalk-api/tests/ldGateway.test.ts` (10, over a REAL socket) — each player sent their own five and `null` for every other seat on every frame, the public state carrying counts and no dice anywhere in the serialised payload, the antes taken and the pot paid with no client naming a number, a non-seated socket and an off-turn action both refused, a bot driven by the REFEREE with its cup written nowhere, and `parseAction` refusing (not coercing) anything that is not one of the three actions, extra hostile fields dropped |
| `patchState` cannot be called by a stranger who knows a room code | `boardwalk-api/tests/gateway.test.ts` patchState block (2) — a socket holding no seat and not hosting is refused; a seated player and the host (who may hold no seat — UNO's dealer does not) are permitted. The handler's comment claimed this authorisation for two phases while checking only that the room existed |
| A room survives a remount instead of being collected between two effects | `boardwalk-api/tests/gateway.test.ts` reap block (2) — an `unpresence`/`presence` pair leaves the room alive, and an `unpresence` nobody returns from still collects it. React StrictMode sends a real `unpresence`, so before this NO WS room game could be developed locally: the table died the moment it was created |
| The room browser advertises only tables you can actually sit at | `boardwalk-api/tests/rooms.test.ts` open-table block (9) + `gateway.test.ts` open-table block (4, over a REAL socket) — the store half pins every exclusion, and each one is a Join button that would lead nowhere: a table drops out of the index the moment it STARTS (the one that matters most — a listing that outlives the deal sends joiners at a game in progress), a `private` table is never in it, a table nobody is PRESENT at is never in it (v1 listed rooms by existence and apologised with a stale-room GC; here a ghost is never advertised in the first place), and a table with no claimable chair is out — while an AI chair COUNTS as joinable, because a person displaces the house. Plus `hostName` stamped at create rather than read from `seats[0]` (a disconnect blip must not relabel somebody's table "CPU"), newest-first ordering with a `roomId` tiebreak so an unchanged index is byte-stable, and the index spanning games. The socket half proves it reaches a browser without asking: an `open` frame on `browse`, a push on a seat claim and on start, an unknown `visibility` read as PRIVATE (the failure modes are not symmetric — guessing `public` publishes a table nobody chose to), and silence after `unbrowse`. Falsified by dropping the presence clause and by dropping the status clause: two go red each time |
| Every dice set maps to six faces on disk, and the store sells none without art | `tests/dice.test.ts` (10) — all six faces of every registered set resolve in `public/dice/`, each set has six DISTINCT files (a set missing only its 6 looks fine until somebody rolls well), each id maps to its own art, an unknown id falls back to the free STARTER rather than 404ing (a die must always draw — the card-back rule, not the felt's `null`), a known id gets its own art and not the fallback, every catalogue set is registered, exactly one free starter, and no earn-only set with no grant site |
| Every link to a plan lands on a plan that is there | `tests/doc-links.test.ts` (4) — the asset-resolution rule (`audio`, `cards`, `felts`, game icons) pointed at PROSE, and it earned its place before it was finished. A link is a string: it typechecks however wrong it is, it renders as ordinary text when it is dead, and no compiler here reads one. What makes it worth a guard rather than a convention is that the failure has a MECHANISM that fires every time — a plan is finished, it moves to `plans/done/`, and its references stay where they were. The Liar's Dice and UNO-pot designs had each been dead in **four** places for weeks (CLAUDE.md, two manifests, the schema, the wire protocol), and writing this found **four more** of the opposite kind: links BETWEEN plans, which break in both directions — a live plan pointing at a finished sibling through `done/` lands a directory too deep the moment it joins it there, and a plan that moves down a level takes its `../CLAUDE.md` with it and is now one short. A root-relative sweep cannot see those at all, because the text contains no `plans/` segment, so there are two passes: repo-relative references from anywhere in the tree, and relative link targets resolved from their own directory. **The one thing it must not flag is the ARCHIVE** — `plans/done/ARCHITECTURE.md` names a path into `../Game-Room/`, which is correct and will never resolve here, and a first pass that matched the tail of that string called it broken; a guard with a false positive is a guard somebody deletes on its first red run, so not-flagging it is asserted as its own case. Both walkers assert they found something (a sweep that silently matched nothing reports success forever), and the file is deliberately IN its own scan — naming the dead paths in its docblock made it fail on itself, and skipping the file would put a hole in the one file that must not have one, so the war story names no paths. Falsified four ways — a reference left behind by a move, a relative link a directory too deep, the plan itself moved back out of `done/`, and a fresh `../Game-Room/` path that must stay green |
| Every test count quoted in this table is the real one | `tests/claude-md-counts.test.ts` (2) + `boardwalk-api/tests/claude-md-counts.test.ts` (3) — each reads the counts out of `vitest list` (the COLLECTOR, so no emulator boots and nothing runs) and diffs them against every `` `path` (N) `` this file claims, reporting **all** drift at once rather than one failed run at a time. Split in two because `boardwalk-api` is outside the workspace with its own `npm ci` and its own CI job, and a single guard would have to *skip* the half it could not install — a guard that skips reports success by doing nothing. A bare mention with no number is ignored on purpose (the table names files without counts, and `tests/economy-parity.test.ts` is discussed in the past tense as deliberately deleted). The API half also pins the suite total in Develop. **The spawn lives inside the `it`, never the `describe`** — a `describe` body runs during collection, so the first draft re-entered itself through `vitest list` and hung until it was killed |
| Every achievement tier's medal is art on disk | `tests/medals.test.ts` (4) — every `TIER_ORDER` rung resolves in `public/medals/`, each tier has its OWN file (two tiers sharing one image is a ladder that does not climb, and it looks deliberate — only distinctness catches it), every tier the REAL catalogue uses has art, and base-path awareness. The shelf drew `🥉🥈🥇🏆` before this: emoji are rendered by whatever font the OS supplies, so the one thing on that page that must read as an ORDERED ladder came out as four unrelated pictures on some platforms. **The locked state is `opacity` alone and NOT `grayscale`** — the emoji version desaturated, and copying that made bronze/silver/gold/platinum four identical grey discs on a fresh account, erasing the exact property the art was brought in for. No test here can see that; it was caught by looking at the shelf |
| The house actually WINS at blackjack, and v1's difficulty ladder could never have shipped | `tests/blackjack-house-odds.test.ts` (6) — the second guard here whose whole output is a NUMBER, and the one that **killed the feature it was written to price**. `plans/BLACKJACK_DEPTH.md` slice 2 set out to offer v1's dealer-stand selector properly, with every rung PRICED through the natural's payout so none is EV-positive, and deliberately named no payout in advance so the harness could say otherwise. It did. Measured at 3:2 with a computed near-optimal proxy: dealer stands on **14 → −5.57%, 15 → −4.59%, 16 → −0.86%, 17 → +0.50%, 18 → −5.49%, 19 → −18.18%**. **17 is the dealer's OPTIMAL stand value, so every alternative favours the player in BOTH directions** — lower leaves it on weak totals a standing player beats, higher forces it to hit 17 and 18, which bust on 36 of the 52 cards. There is no harder table to be had, so v1's Easy/Normal/Hard ladder was not merely mislabelled: its "Hard" hands the player 16.24%. And the lever cannot reach — a natural is ~4.8% of hands, so 3:2→1:1 is worth ~2.4%, leaving exactly two priceable candidates and neither shippable (stands-16 at 6:5 measured **+0.16% / +0.75% / +0.42%** across three seeds, a swing wider than the number; stands-16 at 1:1 is safe at +1.57% and strictly worse than classic, so nobody would pick it). **The tier does not ship and its plumbing was REVERTED rather than left standing**, because a seam built for a feature the evidence says not to build is `loadout.color` with more steps. What remains guards the shipped game: every other blackjack test proves a RULE is followed, and only this proves the rules ADD UP to a game the house wins. **The bound is an UPPER one, unlike UNO's** — `dealHand` reshuffles `freshDeck()` every deal, so there is no count, basic strategy is OPTIMAL rather than good, and the proxy is a ceiling on human EV rather than a floor (which is also why v1's 1/4/6-deck shoe must never be ported: a persistent shoe puts the tail back and turns the bound over). The proxy is COMPUTED per dealer rule, not a copied chart, since a chart is a chart for one rule and would have made the sweep meaningless. Two things the first draft got wrong and are written down: the dealer distribution **bucketed totals from 17**, telling the proxy a standing 16 LOSES to a dealer 16 where it pushes — so it over-hit and the edge came out flattering to the house by up to two points, the unsafe direction, under a comment claiming it was the safe one; and the per-hand variance is large enough that one 400k run swings ±0.2 points on a 0.5% edge, which is why the bound is asserted per seed and the margin on the pooled estimate. Falsified with v1's own "Hard" rule (four cases red) and a 5:2 natural (three). What it deliberately does NOT catch — a dealer taught to hit soft 17, which makes the house ~0.2% richer and stays in band — is pinned hand-by-hand in `tests/blackjack.test.ts`, so it is a division of labour rather than a hole |
| Every guard above actually fires | `tests/lint-rules.test.ts` (51 — the two Phase-6 rules proved **twice**, once per games tree, falsified by dropping `packages/game-logic/src/games` from `GAMES_DIRS` and watching exactly the three new cases go red), `tests/file-size-guard.test.ts` (8), `tests/credentials.test.ts` (25), `tests/firebase-config.test.ts` (8) |

| Not yet enforced | Lands in |
|---|---|
| **The launch modal's `fillAi` (slice 0) is DEPLOYED to the Pi** | ✅ **2026-08-08, verified from the artifact — and deployed while nothing yet sends the field**, which is the ordering rule kept with room to spare rather than in the nick of time: the client half is slice 3, and a referee that has never heard of `fillAi` would answer a modal promising a table of bots with six empty chairs. **The currency check did the work before the deploy did**: per-FILE hashes over both `src` trees said the Pi differed by *exactly* the four files this slice touched — same 69-file set, `packages/game-logic` byte-identical — which proves in one step both that it was behind by this change **and** that no other session's undeployed work was about to ride along. The shared rsync was therefore a genuine no-op, and it was still run, because the procedure not the guess is what decides that. Evidence, none of it an exit code: `dist/rooms/seats.js` and `store.js` carry `fillWithAi` and `gateway.js` carries `fillAi`, with the `CPU ${…}` template built; the mtimes run **src (01:00:36) → dist (01:02:01) → PID (01:04:33)** with `cwd` in the rsync'd tree and `node_modules/@boardwalk/game-logic` resolving to `/home/mogar13/packages/game-logic`; and **387/390 on the device**, the 3 the expected `../CLAUDE.md` ENOENT (named, not assumed). **The boot sweep was priced BEFORE restarting**: 6 unsettled rounds — 5 UNO, 1 Liar's Dice — every `pot_cents` 0, so the journal's `voided 5 abandoned round(s), refunded 0 cents` and `voided 1 abandoned match(es), refunded 0 cents` is the predicted cost paid in full, and the ledger carries **zero `void` rows** because there was nothing to give back. Ledger byte-identical either side — 5 profiles, 32 rows, $20,705.00, every per-uid sum and xp unchanged, `integrity_check ok` — and `/health` on the Funnel answers `{"ok":true,"db":"up","tickets":"on"}` with CORS 204 for the Pages origin. `sudo systemctl restart` returned 0; that is still not the evidence, `MainPID` moved 2721745 → 3288196 |
| **UNO's house-banked table (slice 5) is DEPLOYED to the Pi** | ✅ **2026-08-06, verified from the artifact — and deployed BEFORE the PR merged**, which is the first time the ordering rule has been honoured in that literal a sense rather than closed a few hours later. It is a money change in `boardwalk-api` (`startMatch` pins the tier, `settleMatch` pays a pot the house funded), so unlike stacking it could not reach prod through the shared package alone. **The window it avoided is a UI that lies and costs nobody a chip**: a new client creating an AI table at a stake sends `anteCents` to an old referee whose `potFor` still floors a lone player to zero, so the lobby would say "the house banks the pot", the board would draw none, and nothing would be charged or paid. The reverse direction is fully inert — an old client has no ante picker in AI mode, so a deployed referee sees no house table at all. **The currency check answered a second question this time**: comparing per-FILE hashes rather than one rolled-up digest showed the Pi differing by *exactly* `domain/uno.ts`, `logic/pot.ts` and `logic/ai.ts` — which proves in one step both that it was behind by this slice and that it was otherwise current with `main`, where a single digest only ever says "different". Evidence, none of it an exit code: both path-stripped digests byte-identical after (`89feafe6…` api, `6eee2803…` shared, 33/36 files); `packages/game-logic/dist/…/pot.js` carrying `housePayout`/`rankedPayees`/`maxRoundPayout`/`potBacking`/`houseStakeFor` with `HOUSE_RETURN_NUMERATOR`, `ai.js` carrying `HOUSE_TABLE_LEVEL`, and `dist/domain/uno.js` naming all of it, with `node_modules/@boardwalk/game-logic` resolving to `/home/mogar13/packages/game-logic`; **379/382 on the device**, the 3 the expected `../CLAUDE.md` ENOENT (named, not assumed); and the mtimes running **src (01:44:31) → dist (01:57:11 api, 01:58:06 shared) → PID (02:00:16)** with `cwd` in the rsync'd tree. **The boot sweep was priced BEFORE restarting**: one live UNO round at `pot_cents` 0, so the journal's `voided 1 abandoned round(s), refunded 0 cents` is the predicted cost paid in full. Ledger byte-identical either side — 5 profiles, 25 rows, $19,230.00, every per-uid sum and xp unchanged, `integrity_check ok` — and `/health` on the Funnel answers `{"ok":true,"db":"up","tickets":"on"}`. `sudo systemctl restart` returned 0 this time; that is still not the evidence, `MainPID` moved 2602356 → 2621861 |
| **UNO's ranked places (slice 3) is DEPLOYED to the Pi** | ✅ **2026-08-06, verified from the artifact.** The first house rule that reaches MONEY: the rotation rides to the referee for free through the shared package, but `settleMatch` is server code, so this one could not have gone live on the merge alone. **Both deploy directions degrade benignly, by construction and tested rather than hoped for** — new client / old referee reads no `finished`, `placesOf` calls it an empty podium, and every board renders what it rendered before (the toggle is a control that does nothing, which is a UI that lies, which is why the Pi goes FIRST); old client / new referee is why `UnoState.winner` is deliberately KEPT on the wire (derived, `roundOver ? finished[0] : -1`), since "did the round end" is the only question a client predating places knows how to ask. Evidence, none of it an exit code: the path-stripped `md5sum` said BEHIND before (shared 34 files vs 36 — exactly `ai.ts` and `places.ts`) and byte-identical after (`61392729…` both sides, 33/33 + 36/36); the shared `dist` carries `seatAfterLive`/`potSplit`/`placesOf`/`roundOver`/`winnerOf` with `places.js` and `ai.js` built, `dist/domain/uno.js` names `potSplit` and `dist/rooms/unoDealer.js` names `roundOver`, and `boardwalk-api/node_modules/@boardwalk/game-logic` resolves to that copy; **374/377 on the device**, the 3 the expected `../CLAUDE.md` ENOENT; and the mtimes run **src (00:40:31) → dist (00:42:25) → PID (00:44:57)** with `cwd` in the rsync'd tree. **The boot sweep was priced BEFORE restarting, not after**: one live UNO round at `pot_cents` 0, so the journal's `voided 1 abandoned round(s), refunded 0 cents` is the predicted cost paid in full, and the ledger is byte-identical either side — 5 profiles, 25 rows, $19,230.00, `integrity_check ok`. `/health` on the Funnel answers `tickets: "on"` with CORS 204 for the Pages origin. `sudo systemctl restart` again logged `Failed with result 'timeout'` on the STOP and had restarted anyway — the documented lie; read `MainPID` |
| **UNO's house rules (slices 1–2) are DEPLOYED to the Pi** | ✅ **2026-08-06, verified from the artifact.** The rulebook is shared code the referee runs from its own built copy, so the toggles were live-but-inert between the merge and this — **benign by construction and tested rather than hoped for** (an old referee sends no `houseRules` and no `pendingDraw`, `drawDebt` reads both as nothing owed, and every client plays the ordinary game *in agreement with the dealer*), but a control that does nothing is a UI that lies, which is why the Pi goes FIRST. Evidence, none of it an exit code: the `md5sum`-over-`src` check said BEHIND before (shared 32 files vs 34) and byte-identical after (`832a61eb…` both sides); `packages/game-logic/dist/…/stacking.js` carries `answersStack` and `uno.js` carries `pendingDraw`/`drawDebt`, and `boardwalk-api/node_modules/@boardwalk/game-logic` resolves to that copy; **369/372 on the device**, the 3 the expected `../CLAUDE.md` ENOENT; and the mtimes run **src → dist → rulebook → PID** in that order (process started 152s after `dist`, 139s after the rulebook) with `cwd` in the rsync'd tree. Ledger byte-identical either side of the restart — 5 profiles, 25 rows, $19,230.00, `integrity_check ok` — and `/health` on the Funnel answers `tickets: "on"` with CORS 204 for the Pages origin. **The boot sweep was checked BEFORE restarting, not after**: 6 unsettled UNO rounds, every `pot_cents` 0 and none touched in the sample window, so voiding them refunded exactly 0 cents. `sudo systemctl restart` reported `Failed with result 'timeout'` on the STOP and had restarted anyway — the documented lie, read `MainPID` rather than the exit code |
| **Rules deployed from CI** — the workflow is BUILT and guarded; it releases nothing until one secret exists | `.github/workflows/rules.yml` + `tests/rules-deploy.test.ts` (8). Tests the ruleset against the emulator on every PR and push that touches it, then releases it to Firebase — **but only once `FIREBASE_SERVICE_ACCOUNT` is set** (a service-account JSON key with the Realtime Database Admin role; the project id is REUSED from `VITE_FIREBASE_PROJECT_ID`, so CI cannot release rules to a different project than the app talks to). Until then it tests, emits a `::warning::` naming what is missing, and skips — deliberately, because merging it must not red-X `main`, and a job that skips QUIETLY is this repo's oldest defect. **What it does not buy: the exit code is still not evidence.** Reading the ruleset back is the real proof and is deliberately NOT automated — RTDB serves rules with comments stripped, this file is mostly comments attached to security decisions, and a naive strip-and-compare would either false-positive forever or need a JSON-with-comments parser this repo does not have. An untested verifier wired into the one job that touches the security boundary is worse than an honest gap |
| **Offline hardening is DEPLOYED and ENFORCING** | ✅ 2026-07-18, all three phases, verified in prod from the artifact: `/health` on the Funnel returns `tickets: "on"`, a live tic-tac-toe win settled with a **signed ticket** (`v1.<kid>.<device>.<seq>.<sig>`, 200), the book went 64→63, that ticket re-sent **3×** answered `replayed=true` with xp and bankroll unmoved, and a client-minted nonce was refused **409 `not a ticket`**. `ticket_devices` accounting matched the client exactly (issued 64 / spent 1 / outstanding 63). The real player's row was untouched throughout (xp 700, $5,215.00) and the throwaway account was deleted from SQLite **and** Firebase Auth. **The secret is the cutover and goes LAST** — setting it before the client shipped 409'd every settle from the deployed frontend, which happened for ~2 minutes with no impact; rollback is renaming the env key and restarting, no rebuild. Three-phase procedure: [plans/done/OFFLINE_HARDENING.md](plans/done/OFFLINE_HARDENING.md#deploy-order--three-phases-and-the-secret-goes-last) |
| **P5 is DEPLOYED — both surfaces, both verified from the artifact** | ✅ **DONE 2026-07-18, and the frontend merge is unblocked.** (1) **Rules**: `GET /.settings/rules.json` on `boardwalk-fca02-default-rtdb` returns an `equipped` block carrying `cardback`, `title`, `felt`, `frame` and `$other: false`. **Deployed once from the wrong tree first** — the command ran in the primary checkout, which sits on `main` and does not carry the branch, so Firebase released the OLD four-key-less file and printed the identical green `Deploy complete!`. A rules deploy is only meaningful from a tree that HAS the change, and only provable by reading the rules back. (2) **Pi**: two rsyncs (`packages/game-logic` as a sibling, then `boardwalk-api`), `npm install && npm run build && npm test` ON the device — **194/194 green** — then restart. `PRAGMA table_info(profiles)` now lists `equipped_felt` and `equipped_frame` (COLUMN_MIGRATIONS ran on open), `dist/db/schema.js` carries both, and the ledger is byte-identical either side of the restart (1 profile, 2 rows, $5,215.00, `integrity_check` ok). The Pi's `package.json` was found **stale**, not hand-patched — still the Phase-D `--prefix` scripts that `54f8a98` replaced with `build:shared` — so the Pi can drift behind `main` between deploys, and a deploy is the thing that reconciles it |
| Phase B is DEPLOYED and the backfill has RUN | unguarded — both done by hand 2026-07-18 and both **verified on the box, not inferred**. Server: deployed from `cb42e44`, `dist/domain/economy.js` present, `mutations` + `wagers` migrated in, 143/143 API tests green ON the Pi, deployed hashes match the commit. Client: `VITE_API_BASE_URL` is baked into the prod bundle (the `gameContext` chunk names the Funnel URL) and the Pi's CORS returns 204 for the Pages origin. Backfill: **1 `migration:v1` marker** present (it was 0), and SQLite matches Firebase field for field — `bankrollCents` 521500, `xp` 700, `played` 19, `wins` 5. **Nothing in this repo can prove any of it**, and a health check is NOT evidence: `/health` answers identically under Phase A and Phase B, which is exactly how this row twice claimed something it could not see. Check the marker and the parity, or check nothing. **Verified in prod 2026-07-18** — bet/settle/purchase/daily round-tripped against the live Pi on a throwaway account (since deleted): a replayed nonce moved nothing, a $1M payout with no open wager was refused 409, an earn-only title was refused, and a hostile `PUT /profile` carrying `bankrollCents: 999999999` left the balance at the server's own `500000`. See BACKEND_PLAN.md |
| **The Pi is CURRENT with `main` (2026-08-05), and the DOC is not the artifact either** | unguarded — and this row exists because the *previous* row nearly caused an unnecessary restart. UNO's dealer merged at 18:10 and the newest deploy record said 13:47, so a reasonable reading was "prod UNO is calling `unoStart` at a referee that does not know the frame". **It was already deployed.** A concurrent session had shipped it and not written it down, which is the same class of mistake as trusting `/health`: *the record of a deploy is not the deploy*, and the box is the only thing that can answer. So the answer to "is the Pi behind?" is never a doc lookup — it is `md5sum` over the rsync'd `src` trees against a clean worktree at `origin/main`, which is cheap, exact, and needs no restart. **Verified 2026-08-05 at `3f64410` with NO deploy run**: `boardwalk-api/src` 35/35 files and `packages/game-logic/src` 32/32 files byte-identical to `main`; `dist` written 19:04:47, newest `src` 18:02:37, running PID started **19:07:51** — so the process postdates the build which postdates the source — with `cwd` in the rsync'd tree; `unoStart`/`unoMove`/`anteCents`/`potCents` all present in the built artifact; `uno_matches` + `uno_players` created; six rounds dealt since the restart and **not one line in the journal after `listening`**. Ledger untouched at 5 profiles / 25 rows / $19,230.00, `integrity_check` ok. **Restarting anyway would not have been free**: the boot sweep voids and refunds every live match, and three UNO rounds and one Liar's Dice match were unsettled at the time (all `pot_cents` 0, so no money — but four tables would have died to confirm something a checksum already proved). **Earlier the same day, per-game mastery (PR #44, `c069f5a`) WAS hand-deployed**, and it is the one deploy in this table with no route to probe, because a catalogue change adds none: the check is `node -e` on the device loading the shared package the referee actually reads and printing `ACHIEVEMENTS.length` — **27 → 43**, all six games' chains present — plus the four new title ids in the resolved `dist`, a PID postdating that build by 36s, and a ledger byte-identical either side, which for a catalogue change is precisely the proof that it moved no money |
| The Pi is CURRENT with `main` (2026-07-21) | unguarded — done by hand and **verified from the artifact, because the exit code proves nothing**. Deployed from a clean detached worktree at `b13f9c6`, never the shared checkout (a concurrent session's edits once beat an rsync by seconds). Two rsyncs — `packages/game-logic` to `~/packages/game-logic` as a sibling first, since `refillGrantFor` is new shared code the API imports — then `npm install && npm run build && npm test` ON the device: **293/296**, the 3 failures being the expected `claude-md-counts` `ENOENT` on a `../CLAUDE.md` that does not exist beside a standalone directory. It cleared **two** owed deploys at once: Liar's Dice's server half and the bankrupt refill. **The obvious liveness check was inconclusive and is written down so nobody repeats it**: `POST /refill` → 401 looks like proof the route exists, but `POST /bogusroute` → 401 too, because auth runs before routing. What actually proves it: `dist/routes/economy.js` carries `/refill`, `dist/domain/mutations.js` carries `applyRefill`, and the running PID started **541 seconds after** every one of those files was written, with `cwd` in the rsync'd tree. Ledger byte-identical either side of the restart (2 profiles, 7 rows, $8,935.00, `integrity_check` ok, 0 refill rows) |
| Phase D is deployed to the Pi | **DONE 2026-07-18.** The unverified half resolved to the bad case — the Pi is a standalone `~/boardwalk-api` directory, not a git checkout — so `packages/game-logic/` is now rsync'd to `~/packages/game-logic` beside it and the relative `file:` dependency resolves. `ExecStart` never moved. Procedure + the `--omit=optional` trap are in [BACKEND_PLAN.md](plans/done/BACKEND_PLAN.md#the-deploy-delta-phase-d--done-and-what-it-turned-out-to-be). **The Pi deploys by hand while the frontend deploys on push, so the Pi goes FIRST** — merging Phase D before it broke prod blackjack for ten minutes |
| `PascalCase.tsx` / `camelCase.ts` | unguarded — convention only |
| The kit/lobby renders correctly in a real browser | unguarded, but Phase 5 added the surface: `VITE_USE_EMULATOR=1` + `/_dev/lobby` drives the whole room flow against the emulator (a manual Playwright pass, not a build guard) |
| **The ENTRANCE works, for all six games, on the path prod uses** | unguarded by construction — this is the row the launch modal's slice 4 exists to fill, and every line of it is a fact no static tool in this repo can see. Driven 2026-08-08 on the **WS referee** (emulator + a locally-run `boardwalk-api` + Vite, the recipe in Develop — the emulator-only loop tests the RTDB fallback, which is not the path prod uses), with the API gate relaxed for the run so the economy and the dealt hands were the referee's too. **Zero console errors and zero 4xx across every script.** All six cards open a modal offering exactly their labelled ways in, at `sm`, URL unchanged, Escape-closable with no dead scroll. Then each way in end to end: Tic-Tac-Toe AI created SEATED (Start lit with no Add-CPU click) and played to a win against the `casual` bot the modal picked — a tier that only reached the engine through `?o.house=casual`, which a `perfect` bot would have made impossible; Chess hot-seat came up with both local chairs and played both colours from one screen; UNO AI at 3 seats, Stacking on and a $25 ante dealt with the bankroll going $5,000 → $4,975 and the stored match carrying `pot_cents 5000`, `houseRules {stack:true,…}` and `level "sharp"` — the seat count, the house rule, the stake and the pin all arriving from the modal at the referee; Liar's Dice AI dealt its cups and took a bid; Solitaire's Draw 3 emptied a 24-card stock in **8** clicks where `?o.draw=1` took **24**, which is the URL round trip proved in the reducer rather than in a query string; Blackjack, having nothing to ask, navigated on the click and dealt a server-dealt hand. **Online** was driven with two accounts: the host's table came up with an OPEN chair and Start dark (§5.3's decline, visible), the guest found it in the room browser INSIDE the modal, joined by the shared-link code path, sat, and moves crossed both ways. Plus the three claims only a browser can answer — a ctrl-click opened a second tab and NO modal (the card is still an anchor), "Fill with CPUs" turned three open chairs into `CPU 2/3/4` and lit Start (the label the preview promises, written by the other package), and the tallest panel measured 876px unscrolled at 1080p and 388px = viewport − padding with its header pinned at 900×420. The modal's own behaviour too: back returns to the ways in, a REOPEN lands on the ways in with the panel state reset (it is keyed by game id), and another card opens as itself |

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

**The gap Phase 2 left, and what is left of it.** `database.rules.json` used to be deployed only by
hand (`npm run rules:deploy`), so **the file in this repo could silently stop matching production** —
worse than having no file, because it reads like the truth. That argument was won four times by hand
(P2, P3, P5, `chessset`), and one of those releases went out **from the wrong worktree** and printed
an identical green `Deploy complete!` while publishing the OLD file. `.github/workflows/rules.yml`
now tests and releases it on every push to `main` that touches it. **Two things are still true and
should stay written down.** The workflow releases nothing until `FIREBASE_SERVICE_ACCOUNT` is set —
it tests, warns and skips — so until that secret exists the hand deploy is still the only one
happening. And a green CI run is *still* not proof the live ruleset matches: the tests prove the file
is right and the workflow proves the CLI was invoked, neither proves what Firebase is serving. Read
the ruleset back when it matters.

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
npm run rules:deploy   # push database.rules.json to Firebase BY HAND. CI does this too now
                       # (.github/workflows/rules.yml) — but only once FIREBASE_SERVICE_ACCOUNT
                       # is set; until then it tests, warns and releases nothing.
```

`boardwalk-api/` is a **separate package** — not in the npm workspace, its own lockfile, its own
tooling. The root's `lint`/`test`/`build` do not reach it and are not supposed to; it has its own,
gated by `.github/workflows/api.yml` (push + PR, `paths`-filtered):

```bash
cd boardwalk-api && npm ci
npm run lint        # eslint . — src, tests AND scripts/*.mjs. Type-aware over tsconfig.test.json
npm run typecheck   # tsc -p tsconfig.test.json — the only thing that typechecks the tests
npm test            # vitest — 398
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

That drives the **RTDB fallback**, which is not the path prod uses. To drive the WS REFEREE — which
is what a multiplayer browser pass should be testing — run `boardwalk-api` beside it and add
`VITE_WS_ROOMS=1`:

```bash
npx firebase emulators:start --only auth,database --project demo-boardwalk
cd boardwalk-api && npm run build && FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  FIREBASE_PROJECT_ID=demo-boardwalk GOOGLE_CLOUD_PROJECT=demo-boardwalk \
  DB_PATH=/tmp/drive.db PORT=8788 ALLOWED_ORIGIN=http://localhost:5176 node dist/server.js
VITE_USE_EMULATOR=1 VITE_API_BASE_URL=http://127.0.0.1:8788 VITE_WS_ROOMS=1 \
  VITE_FIREBASE_PROJECT_ID=demo-boardwalk VITE_FIREBASE_API_KEY=demo \
  VITE_FIREBASE_DATABASE_URL="http://127.0.0.1:9000/?ns=demo-boardwalk" \
  VITE_FIREBASE_APP_ID=1:1:web:1 npx vite --port 5176 --strictPort
```

**`npm run build` the API first, and check the artifact rather than the exit code** — a stale `dist/`
is the failure mode here, and it does not announce itself: a `dist/` predating the empty-room reap
grace collects every table the instant it is created, which reads exactly like "create is broken".

Phases are listed in [ARCHITECTURE.md](plans/done/ARCHITECTURE.md#phases) — one per conversation, each ends
green and deployed. **Phase 6 is complete: Tic-Tac-Toe, Blackjack, Chess, UNO and Solitaire all
shipped. The launch set of five is done — the next game is built only because one sounds fun, never
to reach a number (see Scope discipline).**

**Every plan that was started before 2026-08-08 is closed** — Phases 0–6, backend Phases A–D, the
Progression Overhaul P1–P5, and the launch modal, all four slices. **One plan is OPEN**:
[plans/BLACKJACK_DEPTH.md](plans/BLACKJACK_DEPTH.md), the seats / dealer-stand tier / insurance gap
the launch modal's Decision 3 carried a rider about and its §6 table still shows as *nothing yet*.
Three slices, none of them started, and its middle one is the reason it needed a design at all:
**a dealer-stand tier is the first client-named value in this repo that changes what a hand PAYS**,
which UNO answered by PINNING the tier (unavailable here — every Blackjack hand has a stake, so a
pinned tier is a control that never appears) and which this must answer by pricing every tier off a
measured house edge. The other file beside the ROADMAP is
[plans/DOMINOES_BRIEF.md](plans/DOMINOES_BRIEF.md), which is a brief for a
session that has not happened rather than work in flight — and it is a game, so it is optional
forever by the same rule as any other. What outlived the phases is in [plans/ROADMAP.md](plans/ROADMAP.md), ordered by what goes
wrong if it is never done — and **both items that could still cost data or chips are now closed**:
offline replay-hardening (deployed and enforcing) and room crash-recovery (built and guarded), each
with its design doc in `plans/done/`. What remains cannot move a chip: the *decision* of whether to
close Phase C by deleting the RTDB rooms fallback — **taken 2026-07-18, and the answer was "not
yet"**, with a concrete trigger recorded in place of the un-meetable "longer track record" — and a
sixth game, which is optional forever. That file is explicitly **not** a checklist.
