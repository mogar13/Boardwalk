# What The Game Shack had that Boardwalk doesn't (yet)

A catalogue of **v1 (The Game Shack) capabilities that did not carry into Casino OS v2**, so the
gaps are a decision instead of an accident. This is a *menu*, not a checklist — read
[Scope discipline](../CLAUDE.md#scope-discipline--the-rule-most-likely-to-be-violated) first. The
point of this doc is the opposite of "port the rest": it's to make sure the things we *drop* are
dropped on purpose, and the OS-level things we eventually *want* have a written home when a game
finally needs one.

> **Written 2026-07-16, before the progression overhaul.** Rows 5 and 11 have since been largely
> delivered by [PROGRESSION_PLAN.md](PROGRESSION_PLAN.md) P1–P4 — the "Boardwalk today" columns
> below are corrected inline where they were flatly wrong. Every `src/system/…` path predates Phase
> D, which moved the economy, profile, progress, store, rewards and the five rulebooks into
> `packages/game-logic/src/…`.

> **Why these are different from "port the games."** Every item here is an **OS/SDK capability that
> spans games** (difficulty tiers, a room browser, a cosmetics loadout), not a 32nd game. v1's own
> lesson is that the reusable framework was the good 4,700 lines and the 30,000 lines of games were
> the liability. So a feature earning its place here is a *better* bet than a new game — but it still
> only gets built when a shipped game (or a shipped need) is the caller, per the SDK's founding rule:
> **add the seam in the commit that has a caller for it.**

Evidence below is from a survey of `../Game-Room` (the archived v1 tree). Counts are "of 31 games."

> **Every build here inherits the repo's guardrails — the 800-line ceiling most of all.** No file may
> reach 800 lines (`scripts/check-file-size.mjs`, enforced on `prebuild`; it *fails* the build, it
> doesn't warn). This matters more for these features than for anything shipped so far, because the
> capability they most resemble in v1 is `system_ui.js` — a ~2,000-line HUD/store/modal/lobby
> god-object with 430 dead lines. The whole point of lifting a feature into the OS is that it arrives
> as small, single-purpose modules (a role→file registry, a pure reducer, a hook), never one growing
> file. If a feature below can't be built under 800 lines per file, that's the signal to split it, not
> to raise the ceiling — the baseline is `{}` and it should stay there. The rest of the guardrails
> apply too: `logic/` stays pure, colours are semantic tokens (no inline hex, even for v1's chat
> colours), and no game imports a sibling.

---

## Priority read

| # | Gap | v1 reach | Boardwalk today | Call |
|---|---|---|---|---|
| 1 | **AI difficulty tiers** | 22/31 games | binary `modes:['ai']`, no tier; Chess has no AI at all | **Build when the 2nd AI game wants it** — design the seam now |
| 2 | **Declarative game options / variants / house rules** | most games | nothing; every option is baked into `logic/` | **Design the seam**; wire per game |
| 3 | **Player-count / fill-with-bots picker** | ~20/31 | manual per-seat "Add CPU" in lobby | Minor; fold into the options seam |
| 4 | In-game services: timers, rematch, undo, hint, resign, spectator | uneven, per-game | none as OS services | **Opt-in shared services**, build the one a game needs first |
| 5 | Store cosmetics beyond avatars (chat colors, titles, card backs, dice, decks) | full catalog | **partly shipped (P2)** — `CosmeticKind = 'avatar' \| 'cardback' \| 'title'`, 31 items, each with a reader; chat colours, felts and dice still absent (felts are P5) | Build alongside their consumer — the rule held: card backs shipped *with* `cardBackSrc`, dice still wait for a dice game |
| 6 | Level **titles** (rank names) | yes | `level` number only | Cheap, pure — good early add |
| 7 | Global/hub chat, name colors, dev badge | yes | room chat only | Build if the hub wants social |
| 8 | Hub discovery: search, favorites, recently-played, categories | yes | piers only | Build when the catalogue outgrows a screen |
| 9 | **Live room browser** ("Active Matches") | yes | share-a-code only | Real multiplayer-UX gap; medium lift |
| 10 | Meta/admin: bug report, dev tools, patch notes, bankrupt refill | yes | none | Situational; refill is the most missed |
| 11 | Progression breadth: more achievements, leaderboard sort tabs | 6 + game-specific / 3 tabs | **CLOSED (P1+P3)** — 27 achievements across 5 Bronze→Platinum chains incl. per-game mastery, plus feats; 4 leaderboard boards as tabs | Done |

---

## 1. AI difficulty tiers — the headline gap

**v1:** 22 of 31 games exposed an AI difficulty selector (a HUD dropdown and/or a lobby setting),
and the tier **mapped to real engine behaviour**, not flavour text:

- **Minimax search depth** — Chess (easy = random, medium = depth 3, hard = depth 4 + move-ordering),
  Checkers (greedy / depth 3 / depth 6), Connect-4 (random / depth-3 + 10% deliberate blunder /
  depth-7), Tic-Tac-Toe (minimax).
- **House-rule value** — Blackjack mapped "difficulty" to the dealer stand threshold (15 / 17 / 19).
- **Deal variant** — Solitaire's "difficulty" was Standard vs guaranteed-winnable deal (not a bot).

Tier vocabulary was inconsistent (easy/normal/hard, easy/medium/hard, normal/hard), so **the SDK
must not hard-code a fixed enum.**

**Boardwalk today:** `GameManifest.modes` carries `'ai'` as a *binary* — a game either offers a bot
or doesn't. There is no difficulty concept anywhere, and the launch set deliberately leans on this:
Tic-Tac-Toe ships a perfect (unbeatable) house with no tier, and **Chess ships no AI at all**
(CLAUDE.md: "a chess engine is a whole other thing"). So there is currently exactly one AI driver in
the whole SDK.

**Recommendation:** Don't build this until a *second* AI-driven game exists — one driver is not
enough evidence for the abstraction (the same rule that kept us from a generic board engine). But
when it lands, the shape is known and worth pre-agreeing:

- Difficulty is **per-game data on the manifest**, not a mode string a game branches on — the same
  discipline as `localSeatIds`. Something like an optional
  `ai?: { levels: readonly { id: string; label: string }[] }` the lobby renders as a picker, with
  the *meaning* of each level living in the game's pure `logic/` (a `chooseAiMove(state, level)`
  signature — UNO already has `chooseAiMove`, just with no level arg).
- Keep the mapping **in `logic/`** so it stays pure/unit-testable (v1's depth→tier maps were the
  correct instinct; they just weren't tested). A difficulty tier is then "which search depth /
  which stand value the pure reducer is asked for," never engine code in the component.
- Note the deferred-change subtlety v1 got right: Chess **queued** a difficulty change to the next
  game and toasted it, rather than mutating a game in flight.

## 2. Declarative game options / variants / house rules

**v1:** Games declared pre-game options through two shared surfaces —
`SystemUI.init({ hudDropdowns })` (in-game HUD) and `SystemMatch.setup({ settingsConfig })` (lobby),
both taking `{ id, label, type: 'select' | 'color', default, options }` arrays. Examples:

- **Monopoly** — starting cash $1,500 vs $2,000, plus a **colour-swatch token picker** (needed a
  `type:'color'` control, not just selects).
- **Solitaire** — Draw-1 vs Draw-3, and the winnable-deal variant.
- **Blackjack** — dealer stand value (doubling as a house rule).
- **Family Feud** — first-to 3 / 5 / 7 rounds.
- **Trivial Pursuit** — category + question count.
- **Hold'em** — stakes were *hardcoded* (`BUY_IN`/blinds), a gap even in v1.

**Boardwalk today:** No options surface at all. Where a variant exists it's **baked into `logic/`** —
e.g. Solitaire supports draw-1/draw-3 in the engine but there's no pre-game selector to choose. The
manifest has `id/name/blurb/icon/pier/seats/modes/betting` and nothing for per-game configuration.

**Recommendation:** This is the most *architecturally* interesting gap, because it's the natural home
for #1 and #3 too (difficulty and player-count are just options). Design one declarative options seam
— a typed `options?` block on the manifest that the lobby (and solo pre-game screen) renders, whose
selected values are passed into the pure reducer's initial state. Constraints to hold:

- Options are **data on the manifest + a value threaded into `logic/`**, never a `system` prop or a
  mode string. The reducer takes an options object; the shell renders the controls.
- Only build the control types a shipped game needs (`select` first; `color`/swatch only when a game
  like a token-colour game exists). A control type with no caller is `loadout.color` reborn.
- Solitaire is the obvious first caller (surface its existing draw-1/draw-3), which makes this a
  *real* seam with a consumer on day one instead of spec-ware.

## 3. Player-count / fill-with-bots picker

**v1:** ~20 games had a "Players: 2 / 3 / 4" selector that filled empty seats with bots (`buildSeats`
returning `{type:'human'|'ai'}`); Blackjack picked 1–4 seats at one table. Bot names embedded the
difficulty (`"AI (hard)"`).

**Boardwalk today:** Seats are the universal primitive (`seats.min/max`) and the lobby lets you add a
CPU **per seat** (gated on `allowAi`) — so the capability exists but as manual seat-by-seat clicks,
not a "3 players, fill the rest" one-shot. UNO's 7-seat AI table proves the plumbing works.

**Recommendation:** Low priority — fold "table size" into the options seam (#2) as a `select`, and
have "start" auto-fill remaining seats with AI. It's a UX nicety over existing plumbing, not new
capability.

## 4. In-game shared services (timers, rematch, undo, hint, resign, spectator)

**v1:** These existed but **per-game and uneven** — none were centralised in `/system`, so every game
reimplemented them:

| Service | v1 reach | Notes |
|---|---|---|
| Timers / clocks | ~11 games | Chess had true per-player chess clocks; others countdown/turn timers |
| Rematch / "Play Again" | 9 games | online = request/host-accept handshake through the room |
| Undo | 4 games | backgammon, solitaire, scrabble |
| Hint | 4 games | chess, family-feud, scrabble, yahtzee |
| Resign / forfeit | ~4 games | often "forfeit buy-in" wording |
| Move history | ~0 shared | no common pattern |
| Spectator | ~1 | never a real cross-game feature even in v1 |

**Boardwalk today:** None of these exist as OS services. A game that wanted a turn clock or a rematch
button would hand-roll it.

**Recommendation:** These are the strongest *consolidation* candidates — the fact that v1 rebuilt
them 4–11 times each is the argument for an OS home. But build **one at a time, when a game needs it**,
and only lift to `system/` on the second caller (the extract-on-repeat rule). Likely order by value:
**rematch** (every multiplayer game wants it and it's a room-state handshake the room layer already
could own) → **turn clock** → **resign**. Undo/hint are game-specific enough to leave in `logic/`.
Spectator was never real; skip it unless explicitly asked.

## 5. Store cosmetics beyond avatars + the loadout

**v1:** A full cosmetics economy with an equip loadout (`cardback / dice / deck / avatar / title /
color` slots):

- **Chat name colours** — 12, including whitelisted **glowing** CSS text-shadows (XSS-guarded).
- **Titles** — 10 equippable ("Card Shark", "Casino Whale", …), some level-gated.
- **Card backs** — 22 (blue/red/green sets + HD "Jumbo").
- **Dice skins**, and a functional **Jumbo/HD deck**.

**Boardwalk today (updated after P2/P4):** the store carries **31 cosmetics** — 12 avatars, 15 card
backs, 4 titles — over a rarity ladder, with an `equipped` map on the profile and three packs to
pull from. Card backs read in Blackjack and Solitaire; titles read on the profile card and the
leaderboard row. The best titles are **earn-only**, unbuyable at any price. Still missing: chat
colours, felts (P5), dice, decks.

**Recommendation:** Each cosmetic type should ship **with its consumer**, not as a store dump (the
same "bring the asset with its reader" rule the audio/card registries hold):

- **Chat name colours** land when/if hub or richer chat lands (#7) — and note the theme rule: a
  colour must be a **semantic token**, not an inline hex (`no-raw-palette`), so v1's freeform hex
  chat colours become a *fixed palette of tokens* here. That's a constraint, not a regression.
- **Card backs / decks** land when a card game wants a back-selector (`cardBackSrc` already exists in
  `src/system/cards`). 
- **Titles** are cheap and pair naturally with #6.
- Widen `CosmeticKind` and the loadout equip UI only as each type gets a real consumer.

## 6. Level titles (rank names)

**v1:** Levels carried titles — Newcomer → Bronze → Silver → Gold → High Roller → VIP Gambler →
"Casino Legend".

**Boardwalk today:** `level` is a derived number (`levelFromXp`) with no name.

**Recommendation:** Cheap, pure, and self-contained — a `titleFromLevel(level)` next to
`levelFromXp` in `packages/game-logic/src/profile/xp.ts`, rendered on the profile/top-bar. Good early morale win;
no new data, no store dependency. (If titles also become *purchasable* cosmetics, that's #5, kept
separate.)

## 7. Chat & social breadth

**v1:** Beyond room chat there was a **hub-wide global chat** (last 50 messages, avatar + username +
timestamp), custom/glowing **name colours**, a **DEV badge** on dev accounts, and an **unread badge +
notification sound** when the panel was closed.

**Boardwalk today:** `useChat` is **room chat only** — uid-pinned (forge-proof author, the v1 dev-badge
bug fixed at the server), no colours, no global channel, no unread affordance. The dev-badge *concept*
exists in the chat types but as an identity pin, not a rendered badge.

**Recommendation:** Only if the hub wants a social surface — it's a product call, not a parity
obligation. If built: reuse the room `ChatRepo` for a global node, keep the forge-proof `uid` pin,
and remember world-writable chat needs the same `.validate`/escape hardening v1 eventually added.
Name colours are tokens (see #5).

## 8. Hub discovery (search, favorites, recently-played, categories)

**v1:** A Steam-style hub — live **search** by name/tags, **category filter** buttons, **favorites**
(star toggle, persisted), **recently-played** bar (last 5), a paginated **carousel** with touch-swipe,
and a per-game **launch panel** (Solo/AI vs Online chooser).

**Boardwalk today:** The hub is **piers** (casino / tables / arcade) — deliberately simpler, and
correct for 5 games. No search, favorites, recent, or filter.

**Recommendation:** Explicitly *not needed at 5 games* — piers are the better IA at this size. This
becomes worth it only if the catalogue grows past a screenful. Favorites/recently-played are the
cheapest and most-loved; search earns its place around ~12+ games. Note the launch-panel role is
already covered by the manifest `modes` driving the lobby.

## 9. Live room browser ("Active Matches")

**v1:** The hub ran a **real-time scanner** across all online games showing joinable open rooms as
chips (host name, seat counts) with one-click JOIN → launched pre-joined. Plus a **stale-room GC**
(30-min idle / 6-hr hard sweeps) and orphan cleanup.

**Boardwalk today:** Multiplayer is **share-a-join-code** only — you can't discover an in-progress
open table, only be handed its code. (Room lifecycle teardown exists — `lifecycle.ts` — but there's
the known crash-recovery gap: abrupt tab-close only reaps presence.)

**Recommendation:** This is the most substantive *missing multiplayer UX*, and a real reason casual
online tables filled in v1. Medium lift: a public "open rooms" index the hub subscribes to, plus the
stale-room GC (which also mitigates the crash-recovery gap). Worth it once there's an online player
base to fill tables for; premature before that. Design it against `RoomRepo` so games stay unaware.

## 10. Meta / admin surfaces

**v1:** A **🐞 bug-report** button → Firebase; a gated **Dev Tools** admin panel (economy /
progression / admin / rewards, e.g. reset daily bonus); an **OS Update / patch-notes** "What's New"
popup; a **↺ REFILL** button when bankroll hit $0; **mobile auto-fullscreen**; and **namespaced
per-game localStorage** for settings persistence.

**Boardwalk today:** None of these.

**Recommendation, in rough value order:**

- **Bankrupt refill** — the most-missed; a player at $0 with no path back is a dead end. Cheap: a
  guarded top-up (rate-limited / daily-linked) through the existing `mutateProfile` writer. Design so
  it can't be a money faucet.
- **Namespaced per-game settings persistence** — a small OS convenience so games don't hand-roll
  `localStorage` keys (v1 had `blackjack_diff`, `chess_mode`, …). Pairs with the options seam (#2).
- **Bug report** — nice-to-have; a modal → a `reports/` node with rules.
- **Dev tools / patch notes / mobile fullscreen** — situational; build only on demand. (Admin rights
  already come from `admins/<uid>` server-side, so a dev panel is UI over an existing boundary.)

## 11. Progression breadth

**v1:** 6 system achievements **plus game-specific ones** (e.g. "Blackjack!" natural-21, "Social
Butterfly" first chat message), each paying XP + chips; a **Trophy Room** viewer with locked/unlocked
cards; and a leaderboard with **three sort tabs** (Bankroll / Level / Wins) + medal ranks.

**Boardwalk today (updated after P1/P3):** **27 achievements** — 4 standalone, 5 Bronze→Platinum
chains (wins / level / bankroll / chess mastery / blackjack mastery) and 3 feats, one hidden — with
an `AchievementShelf`, a completion %, and **4 leaderboard boards** as tabs (Wins / Richest / Level /
Win Rate). `seasoned` and `deep_pockets` were deleted in P3, being redundant with chain tiers.
Per-game hooks exist: the mastery chains read `winsByGame`, and feats ride a filtered channel. Since
Phase D the referee recomputes all of it server-side — a badge is never reported.

**Recommendation:** Incremental, add as content:

- More achievements, including **per-game** ones — the achievement engine already fires on events; it
  just needs game-specific predicates registered (a natural companion to each new game).
- Leaderboard **sort tabs** — cheap; the repo already returns a sortable projection.
- A fuller Trophy Room is polish over the existing shelf.

---

## What we should *not* rebuild

Being explicit so these aren't re-litigated later:

- **Any of the 31 games as games.** The five-game launch set is the coverage; more games come from
  "this sounds fun," never from parity. This doc is about *OS capabilities*, not titles.
- **Spectator mode** — wasn't a real feature even in v1 (~1 game); skip unless explicitly wanted.
- **Freeform hex chat/token colours** — replaced by the semantic-token rule on purpose; v1's
  `profile.chatColor` drift is a bug this project already fixed by design.
- **v1's HUD god-object** (`SystemUI.init({...})` doing everything) — the declarative *config* idea
  is worth keeping (#1/#2), the monolith delivering it is not. Options are manifest data rendered by
  the shell, not a `system` prop.

## Suggested sequencing

If/when this work is picked up, a sane order that keeps every step with a live caller:

1. **Options seam (#2)** with **Solitaire draw-1/draw-3** as its first caller — unlocks #1 and #3.
2. **Level titles (#6)** and **bankrupt refill (#10)** — cheap, self-contained morale/UX wins.
3. **AI difficulty (#1)** the moment a *second* AI game exists to justify the abstraction.
4. **Rematch (#4)** as the first shared in-game service.
5. **Room browser (#9)** once there's an online population to fill tables.
6. Cosmetics (#5), hub discovery (#8), social (#7), progression breadth (#11) — as content/product
   calls, each with its consumer.

Nothing here is committed work — it's the honest list of what v1 could do that v2 can't, so the drops
are chosen and the eventual builds have a spec.
