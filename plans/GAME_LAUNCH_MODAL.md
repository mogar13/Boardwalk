# The launch modal — one entrance to every game, and a table that comes up seated

**Status: OPEN.** Written 2026-08-07. Moves to `plans/done/` when slice 4 lands and the browser
pass is recorded in §10.

Clicking a game on the hub navigates to `/play/:gameId`, which mounts the game, which mounts
[`<Lobby>`](../src/system/room/Lobby.tsx), whose no-table branch is a full PAGE of create/join
panels. Three of the six games therefore answer "I want to play UNO" with a form, and the form
takes a route change and a lazy chunk to arrive.

This replaces that with what The Game Shack did: the card opens a **modal**, the modal offers the
game's ways in, and picking a multiplayer one swaps the modal to the host-setup step — players,
bot level, ante, house rules, a live preview of the seats you are about to create, Create, and
join-by-code beside it. Create navigates straight into the live table.

Two smaller complaints ride along because they are the same work:

- **The kit's modal is too small to hold a setup panel.** Every dialog in the app is pinned to
  `max-w-lg` with the body capped at `max-h-[60vh]`
  ([Modal.tsx:46](../src/ui/Modal.tsx#L46), [:170](../src/ui/Modal.tsx#L170)). v1's host panel
  needed two scrolls on a desktop and this would inherit that exactly.
- **A table does not come up seated.** An AI table means claiming a chair and then pressing "Add
  CPU" once per remaining seat before Start will light. On a 7-seat UNO table that is six clicks to
  play alone. Chess hot-seat has the same shape one level over: you sit yourself down twice.

---

## The decisions, locked

| # | Question | Answer |
|---|---|---|
| 1 | Which tables come up pre-filled? | **AI → bots. Hot-seat → local players.** Online tables stay open (see §5.3 for what was declined and why). |
| 2 | After Create on an AI table? | **Land in the lobby with Start lit.** No auto-deal. |
| 3 | Games with one mode and no settings? | **Every game gets the modal**, Blackjack included — v1 did the same (`openLaunchPanel` runs on every card; only the online button is conditional). The modal is the ENTRANCE to a game, not a picker, and a game with one way in shows one way in. |
| 4 | Delivery | This doc first, then four slices (§8). |

Decision 3 carries a rider from the owner: *"right now Blackjack is very bare bones… it should be
like that for all games, you can make the modal then we can wire the stuff up later."* Blackjack's
depth is **a separate plan** (§11) and is deliberately not in scope here. What this work owes it is
the surface to land on, and the surface costs nothing extra: the day Blackjack declares seats and a
dealer-stand tier, they are `manifest.options` and the modal draws them with no change to this code.

---

## 1. What v1 did, and which half is worth keeping

`hub_app.js:1774` — `openLaunchPanel(cardEl)` builds an overlay from the card's own DOM, showing
the icon, the name, a `🎮 Solo / AI` button and (if the card carries a `.b-online` badge) a
`👥 Play Online` button. Picking one launches the game with `?solo=1` or `?mode=online`.

**Keep:** the shape. One entrance, every game, mode chosen before anything loads. It is right, and
it is why the boardwalk should have it.

**Keep:** the **LOBBY PREVIEW** (`system_lobby.js:38`) — a live list of the seats the room will be
created with, drawn from the same `buildSeats(count)` the create call uses:

```js
buildSeats: (count) => {
    const out = [{ type: "human", name: SystemUI.getPlayerName() }];
    for (let i = 1; i < count; i++) out.push({ type: "ai", name: "AI " + i });
    return out;
}
```

That function is both the autofill AND the preview, which is the whole reason the preview cannot
lie about what you are about to get. §5.1 keeps that property and makes it a test.

**Throw away:** everything about how it was built. The overlay reads the game's name out of an
`<h2>` and its icon out of an inline `background-image`, so the modal is coupled to the card's
markup; the host panel is a 40-line template string of inline styles; and the settings pills are
bound by a delegated listener that mutates `active` classes by hand. Boardwalk has a registry, a
kit and one `<Modal>` — none of that needs re-inventing, which is why this whole feature is a few
hundred lines rather than v1's several hundred of DOM assembly.

**Throw away, with a note:** the **guest lockout** — typing in the join-code box drops the host
settings to `opacity: 0.3`. It exists because host and join were stacked in one scrolling column
and it was genuinely unclear which one the button at the bottom belonged to. §3's two-column
desktop layout removes the ambiguity rather than apologising for it, so there is nothing to dim.

---

## 2. Where the flow lives

**The modal opens over the hub, not over the play route.** The tempting alternative — click the
card, navigate, and let the play route open a setup modal — keeps create/join in one place with no
extraction. It is wrong for one concrete reason: the play route mounts the game's **lazy chunk**,
and it is the game that renders `<Lobby>`. So a setup modal at `/play/uno` arrives *after* a chunk
fetch, behind the "Dealing you in…" fallback. On the hub the manifest is a static import
([registry.ts:230](../src/games/registry.ts#L230)) and the modal is instant. An entrance that makes
you wait is not an entrance.

**But the create panel must not exist twice.** `/play/uno` typed directly, and a shared table link
whose room has closed, both still land on the no-table branch. So:

```
src/system/room/TableSetup.tsx     ← extracted from Lobby's no-table branch. ONE implementation.
   ├── mounted by  src/shell/GameLaunchModal.tsx   (inside <Modal>, over the hub)
   └── mounted by  src/system/room/Lobby.tsx       (inside <Card>, as today)
```

`<TableSetup>` owns: the seat-count row, the ante row, the house-rules toggles, visibility, the
option controls, the seat preview, Create — and the join-by-code form and `<RoomBrowser>` beside
them. It takes `{ manifest, mode, onEntered(roomId) }` and never learns whether it is in a modal or
a page. `<Lobby>` keeps the URL rules, the `<RoomProvider>`, and the in-room view; it gets
materially shorter (628 lines today, and the 800-line ceiling is not far off).

**The hub card stays an anchor.** `GameCard` renders `<Link to="/play/:id">` today. It keeps
rendering one and intercepts the plain click with `preventDefault` to open the modal — so
ctrl/cmd-click and "open in new tab" still navigate, and the route still works typed. A `<button>`
would silently take that away.

**Mode labels become OS data.** The lobby currently renders its mode buttons as the raw union
member — `{m}` — so the screen literally says "ai" and "online". A `MODE_LABEL` map in
`src/system/room/modes.ts` (`ai` → "Solo / AI", `hotseat` → "Same screen", `online` → "Play
Online", `solo` → "Play") is read by both the modal and the lobby, so the two cannot drift and the
copy lives in one place.

---

## 3. The kit change, and why it is the kit's

Both screenshots that prompted this show scrolling inside a modal on a desktop with room to spare.
That is not the launch panel's fault; it is [Modal.tsx](../src/ui/Modal.tsx) — one width for every
dialog, and a body clamped to 60% of the viewport whether or not the content needs it.

Two changes, both in the kit, so every future modal inherits them:

- **`size?: 'sm' | 'md' | 'lg'`** → `max-w-md` / `max-w-lg` (today's, the default) / `max-w-3xl`.
  Three rungs, not a free `className` width, for the reason the kit exists: a per-caller width is
  how five modals end up five sizes. The launch modal's mode step is `sm`; its setup step is `lg`.
- **The body flexes instead of clamping.** The box gets a `max-h` of the viewport minus its own
  padding and the body becomes `min-h-0 flex-1 overflow-y-auto`. Header and footer stay pinned;
  content scrolls only when the *viewport* genuinely cannot hold it. On a 1080p desktop the setup
  panel does not scroll at all, which is the ask.

**One modal, two steps — not two modals.** Stacking a second `<dialog>` is legal and would be the
literal transcription of the screenshots, but the uniformity complaint is precisely that v1's two
panels look like they came from different applications. One `<Modal>` whose title and body change,
with a back affordance on the setup step, is one look by construction.

**Uniformity is mostly already true and this is about keeping it.** Boardwalk has exactly one
`<Modal>` and three call sites (`PackShelf`, `UiRoot`'s confirm host, `ProfileCard`) where v1 has
four modal systems. Slice 1 adds a fourth call site, not a fourth look — and a guard (§9) that
nothing outside `src/ui` hand-rolls a `<dialog>`.

---

## 4. An option chosen before the navigation

The setup step draws the bot-level control, which is `manifest.options` rendered by
[`<GameOptions>`](../src/system/options/GameOptions.tsx). Its values live in `<GameShell>`
([GameShell.tsx:40](../src/system/economy/GameShell.tsx#L40)), which the **play route** mounts. A
tier picked in a hub modal therefore has nowhere to live across the navigation that follows.

**The values ride in the URL, next to `?table=` and `?mode=`.** That is not a new idea being
introduced here — it is the rule `<Lobby>` already states for `mode`, for this exact reason: a fact
that must survive a navigation or a reload lives where the reload can read it. Concretely,
`?o.bots=casual`, and `<GameShell>` seeds its initial values through the existing
`resolveOptionValues`, which is already total (unknown id dropped, unoffered value → default), so a
hand-edited or stale query string cannot produce a value a reducer has no branch for.

Two consequences worth stating rather than discovering:

- **It fixes a live bug.** Today a mid-lobby refresh silently resets the AI tier to its default
  while the host believes they picked one. After this, the URL is the seed and the refresh keeps it.
- **The in-room control must write the URL too**, or the URL and `<GameShell>` become two sources
  of truth for one fact and a reload reverts a change made in the room. `setOption` therefore
  write-throughs to the query string, exactly as `chooseMode` does.

**The modal mounts a throwaway `<GameShell>`** purely so `<GameOptions>` has a context to read —
one control, no second implementation of a segmented picker. Its state is deliberately disposable:
the values leave via the URL, and the play route mounts the real shell seeded from there.

`pinnedForMoney` still works pre-create: `tableBacking(manifest.betting, anteCents, 1)` answers
`'house'` for a lone player at a game declaring `betting.house`, which is exactly the arrangement
UNO pins `sharp` for. Same function the lobby and the referee agree through — no new opinion.

---

## 5. A table that comes up seated

### 5.1 The plan IS the preview

One pure function in [`seats.ts`](../src/system/room/seats.ts), v1's `buildSeats` with the
mode folded in:

```ts
plannedSeats({ seatCount, host, fill }): Seat[]
//   fill: 'ai'    → seat 0 host, the rest { kind: 'ai', name: 'CPU 2' … }
//   fill: 'local' → seat 0 host, the rest { kind: 'human', uid: host.uid, name: 'Player 2' … }
//   fill: 'none'  → seat 0 host, the rest open
```

The modal's **Lobby preview** renders exactly this array, and the create path produces exactly this
array. That is the property worth having and the one the test asserts: the preview is the plan, not
a drawing of the plan. v1 had it for free by calling one function from both places; here it is
worth a guard because the two executions differ (below).

### 5.2 Two fills, two mechanisms, and why

**AI → a server field.** `store.create` seats the host and leaves the rest open
([store.ts:209](../boardwalk-api/src/rooms/store.ts#L209)). The create frame gains one optional
`fillAi?: boolean`; the store fills the remaining chairs in the same construction. It is atomic,
and the seat array stays the referee's.

An old referee ignores the field and produces a table of open seats — **today's behaviour**, so the
degradation is benign, which is the standard this repo holds a new wire field to. The reverse
direction is inert: an old client never sends it. The Pi still goes first (§8), because a control
that promises a seated table and delivers six open chairs is a UI that lies.

**Hot-seat → a client loop.** Filling with LOCAL humans is `claim(i, 'Player N')` against the
host's own uid, which the gateway already authorises per seat (`who.uid === conn.uid`). Chess is
the only hot-seat game and its table is two chairs, so this is one extra call on a private table
nobody can race. A `fillLocal` wire field would be more surface for one seat; if a 4-player
hot-seat game ever exists, that is the moment to reconsider, not now.

### 5.3 What was declined: pre-filling ONLINE tables

v1 did this — the screenshot's preview shows `AI 2 (Open) — JOINABLE`, and the OS here would
support it unchanged (`firstClaimableIndex` is open-before-ai, so a human displaces a bot, and
`listOpen` already counts an AI chair as joinable). It was declined for this pass. A public table
that comes up full starts before anyone can walk up to it, and "start immediately" is the wrong
default for the one mode whose entire point is other people. The host can still fill the chairs
from the room — see the next paragraph.

### 5.4 One button replaces six

`SeatList`'s per-seat "Add CPU" stays (it is how you fill one chair), and the lobby gains a
host-only **"Fill with CPUs"** that seats every remaining chair at once, gated on
`manifest.modes.includes('ai')` like the existing control. That is the escape hatch for an online
table nobody joined, and it is what makes §5.3's decline cheap rather than a limitation.

### 5.5 The defect this uncovers

Tic-Tac-Toe declares `seats: { min: 1, max: 2 }`. `tableSizeChoices` returns `[1, 2]`, the lobby
defaults to `seats.min`, and so **Tic-Tac-Toe's default table today is one chair** — which
`tableIsFull` calls full and `canStart` lights up, on a board whose `seats[1]` is `undefined`.

It has been invisible because the lobby's seat picker is a small unlabelled row nobody looks at
twice. The modal puts a "Players: **1** | 2" control at eye level on the entrance screen, so this
gets fixed in the same slice rather than shipped magnified.

The fix is the manifest, not the function: `seats` is **how many chairs the table has**, and
`modes` already carries "you can play this alone" (`'ai'`). Conflating them is what put a 1 in that
range. Tic-Tac-Toe becomes `{ min: 2, max: 2 }` — which draws no picker at all, and with AI fill
comes up as you plus one CPU. The guard is stated as a rule over the whole registry, not a fix to
one manifest: **a game that mounts a lobby has at least two chairs**, because a room with one chair
is not a table.

---

## 6. What each game's modal actually holds, today

Worth writing down, because it is the honest check on whether the design is doing anything.

| Game | Mode step | Setup step |
|---|---|---|
| **UNO** | Solo / AI · Play Online | Players 2–7 · Bots (casual/sharp, pinned when the house banks) · Ante · 3 house rules · Listed/Code-only · preview |
| **Liar's Dice** | Solo / AI · Play Online | Players 2–6 · Ante · Listed/Code-only · preview |
| **Chess** | Same screen · Play Online | Listed/Code-only · preview (no seat picker — one size) |
| **Tic-Tac-Toe** | Solo / AI · Play Online | House (casual/sharp/perfect) · Listed/Code-only · preview |
| **Solitaire** | Play | Draw 1 / Draw 3 |
| **Blackjack** | Play | *nothing yet* — see §11 |

Blackjack's row is the one that looks thin, and it is the row the owner has already called out.
v1's Blackjack was a 1–4 seat table with a dealer-stand difficulty and insurance
(`bj_app.js:722`); Boardwalk's is one seat and no options. Closing that gap is a separate plan, and
when it lands it is a manifest change that this modal draws for free.

---

## 7. What does NOT change

- **A game still receives `{ onExit }` and nothing else.** The modal is hub chrome; it hands a game
  nothing. `<TableSetup>` is OS code, so it may read the registry and the URL, exactly as `<Lobby>`
  already does.
- **Which table you are at still lives only in the URL.** Create navigates to
  `/play/:id?table=ABCD&mode=…`; the modal holds no room id and closes on navigation.
- **The room browser, the ante rules, the house rules and the referee** are untouched. The controls
  move; nothing about what they mean does.
- **No new theme token, no new animation, no new glow.** The modal is `<Modal>` and the kit's
  existing `rise`; the segmented rows are `<Button>`s already used by the lobby.

---

## 8. Slices, and the deploy that comes first

**ONE SLICE PER SESSION.** Owner's call, and the slices below are cut for it: each one ends green,
with its guards, and leaves the app in a shippable state. A session picks up the first unticked
slice and stops when it lands — do not chain two because the first looked small.

**Slice 0 — the Pi.** ✅ **CODE DONE 2026-08-08; the DEPLOY is still owed.** `create` takes an
optional `fillAi` and `fillWithAi` seats the house in every empty chair, in the same construction as
the host — atomic, and the seat array stays the referee's. Guarded in the store, over a real socket,
and in both places for the absent-field default; falsified four ways. **Nothing sends the field
yet**, so prod is unaffected either way, but the Pi must carry it before slice 3 merges: a control
that promises a seated table and delivers six open chairs is a UI that lies. Standard order — the
frontend deploys on push, the Pi by hand, so the Pi goes first (see the deploy rows in
[../CLAUDE.md](../CLAUDE.md#enforcement)).

**Slice 1 — the kit.** ✅ **DONE 2026-08-08.** `Modal` gains `size` (`MODAL_WIDTH`, three rungs) and
a flexed body; the three existing call sites keep today's width by taking the default. It also
picked up §3's other half — `@boardwalk/no-raw-dialog`, so nothing outside `src/ui` can hand-roll a
second modal system. **The browser pass was not a formality and is written up in §10**: the first
version of the flexed body was wrong in a way every unit assertion called green.

**Slice 2 — the entrance.** `MODE_LABEL`, `<TableSetup>` extracted, `<GameLaunchModal>`, the hub
card intercepting its own click, option values seeded through the URL, and Tic-Tac-Toe's seat range
corrected. At the end of this slice the flow works end to end with seats still filled by hand.

**Slice 3 — the seated table.** `plannedSeats`, the preview, `fillAi` on the client half, the
hot-seat claim loop, and "Fill with CPUs" in the lobby.

**Slice 4 — the browser pass, then the docs.** Drive all six games against the emulator on the WS
path (the recipe in [../CLAUDE.md](../CLAUDE.md#develop) — emulator + API + Vite; the emulator-only
recipe tests the RTDB fallback, which is not the path prod uses). Then CLAUDE.md's Enforcement
table, and this doc moves to `plans/done/`.

---

## 9. What each slice owes a guard

Every row is a failure that typechecks, lints and renders.

| Guard | Why it is not obvious |
|---|---|
| `tests/modal.test.ts` — every `size` resolves to a real `max-w-*`; the body carries `min-h-0 flex-1` and no fixed `max-h` | A width that no longer resolves is a modal at its default forever, silently — the `loadout.color` failure with a `className` |
| `tests/lint-rules.test.ts` — no `<dialog` outside `src/ui` | The uniformity ask, made unspellable. A hand-rolled dialog is how v1 got four modal systems, and it looks fine in the PR that adds the first one |
| `tests/room.test.ts` — `plannedSeats` at every declared size × each fill: exactly one host seat, at index 0, every other chair filled per the fill kind, names unique | A preview that disagrees with what gets created is worse than no preview |
| `tests/room.test.ts` — **every room game's `seats.min >= 2`**, read off the REAL registry | §5.5. Falsified by putting Tic-Tac-Toe's `1` back: one goes red |
| `tests/game-options.test.ts` — round-trip: values → query string → `resolveOptionValues` returns them; garbage/unoffered/foreign keys → defaults | The URL is now a value's home across a navigation, and a query string is user-editable text |
| `tests/launch-modal.test.ts` — the mode step lists exactly `manifest.modes`, labelled, for every registered game; a game with one mode still gets the modal | Decision 3, as an assertion. A `modes` entry with no label renders an empty button |
| `boardwalk-api/tests/rooms.test.ts` — `fillAi` seats every chair but the host's; **absent reads as no fill** (today's table); a full table is still `listOpen`-excluded correctly | The deploy-order case: a new client always meets an old referee at some point, and an absent field must mean the honest default |
| `boardwalk-api/tests/gateway.test.ts` — a `create` carrying `fillAi` over a REAL socket comes back seated, and the host is still seat 0 | The store can be right while the frame drops the field |

Falsify each before trusting it. Two of the rows above (`seats.min >= 2`, the `<dialog>` sweep)
are the kind that report success by matching nothing.

---

## 10. What was verified, and how

### Slice 1, the kit (2026-08-08) — and the bug that only the browser could see

Driven against the emulator at `localhost:5177` with the cached headless Chromium, on the real
`<Modal>` (the profile card's rename dialog), measuring the live boxes rather than the source.

**The first version of the flexed body was wrong, and every unit assertion said it was right.** The
box carried `max-h-full` and the dialog `h-full p-4`, which reads as "the box is at most the
viewport less its padding" and is not: `<dialog>` is `open:grid` with ONE auto row, an auto row is
sized by its item, and `max-height: 100%` on that item therefore resolves against a height the item
itself produced. At 1280×800 with a tall body the measured row was **1463px**, the box **1463px**
tall hanging **679px off the bottom of the screen**, and `body.scrollHeight === body.clientHeight` —
the body never scrolled at all, which is the entire feature. Nothing static could see it: the class
names were all correct, `tsc` sees strings, and the utilities all resolve.

The fix is one class on the dialog — `grid-rows-[minmax(0,1fr)]`, which makes the row definite so
the percentage has something real to resolve against. `minmax(0,1fr)` and not `1fr`, because a fr
track keeps an automatic min-content minimum: the same trap `min-h-0` exists for, one layout system
across. `max-height: calc(100dvh - 2rem)` on the box measured identically and was declined — it
duplicates the dialog's own padding as a constant, so changing `p-4` would silently break it.

Measured after the fix, all with **zero console errors and zero 4xx responses**:

| Case | Box | Header / footer | Body |
|---|---|---|---|
| Short body, 1280×800 | 263px, centred, unchanged from before the change | both visible | does not scroll |
| Tall body, `md`, 1280×800 | 768px = viewport − the dialog's `p-4`, inside the screen | both fully visible | scrolls |
| Tall body, `lg`, 1280×800 | 768px wide (`max-w-3xl`), 768px tall | both fully visible | scrolls |
| Tall body, **900×420** | 388px = viewport − padding | **both fully visible** | scrolls |

That last row is the case the old `max-h-[60vh]` could not do: header + 60vh + footer is more than
the screen, so a short viewport pushed the footer off it. All three rungs emit real CSS
(`max-w-md` → 448px, `max-w-lg` → 512px, `max-w-3xl` → 768px), which is the check the unit test
cannot make — Tailwind generates a utility only from a name it scanned. And the modal adds **no
dead scroll**: the profile page's own `scrollHeight - clientHeight` was 1637 with the dialog closed
and 1637 with it open, which is the Phase-1 `open:grid` signature staying clean.

*(Slices 2–4 fill in the rest.)*

---

## 11. Deliberately out of scope

- **Blackjack's depth.** Seats, a dealer-stand difficulty, insurance — v1 had all three and
  Boardwalk has none. Called out by the owner as its own plan, and it is: it changes a game's
  rulebook and its server-dealt hand, where this changes how you get to a table. This work makes
  that plan cheaper by giving its options somewhere to be drawn.
- **Pre-filled online tables** (§5.3), replaced by one button in the room.
- **Auto-dealing an AI table** (decision 2). You land in the room with Start lit.
- **A chat panel at a table of bots.** The in-room lobby draws one for an AI table, where it is
  furniture. Real, small, and not this plan.
- **Per-game persistence of a chosen tier** (v1's `blackjack_diff` in `localStorage`). That is
  V1_FEATURE_GAPS #10 and it lands when someone misses it; the URL seeding here is about surviving
  one navigation, not about remembering last week.
