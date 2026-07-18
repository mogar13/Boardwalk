# Progression Overhaul — Store, Achievements, Leaderboards, Assets

**Status: DESIGN DRAFT — react before we build.** Nothing here is code yet. This is the contract
for the phase(s) that build it, in the same spirit as [BACKEND_PLAN.md](BACKEND_PLAN.md).

> This is OS work, not game-count creep. It makes the five games we already have *deeper*, which is
> exactly the kind of expansion [Scope discipline](../CLAUDE.md#scope-discipline--the-rule-most-likely-to-be-violated)
> wants. No new games are proposed here.

---

## 1. The problem, named

The XP / levels / store / achievements loop is **flaccid** — the owner's word, and it's the right
one. The disease is precise:

> **The rewards have no scarcity, no stakes, and therefore no status.**

An avatar emoji you can buy for pocket change tells another player *nothing* about you. There's no
"how did you get that," no "I could never afford that," no "you must have won a hundred games." Every
lever that makes meta-progression compelling — rarity, mastery signalling, the near-miss, the
variable-reward pull — is currently absent. The fix is **not more cosmetics.** It's making the ones
we have *mean something*.

Three levers do almost all the work:

1. **Scarcity + an earn-vs-buy split.** Money buys *flair*; skill buys *prestige*. The best items
   can't be bought at any price — they're achievement-locked. That single split kills "paying for
   emojis feels cheap."
2. **Variable rewards.** Direct purchase is a vending machine; a randomized *pack* is a slot machine.
   Play-money, so it's ethically clean — but the dopamine loop is the real thing.
3. **Stat porn.** One stiff "wins" number is a crime against the owner's stated love of stats. Many
   boards, a rich per-game breakdown, so *everyone can be #1 at something*.

---

## 2. What exists today (honest inventory)

Grounded in the actual code, so the design proposes real deltas, not fantasy.

| System | File(s) | Shape today |
|---|---|---|
| **Profile** | `system/profile/types.ts` | `name, avatar, bankrollCents, xp, stats, achievements, inventory, daily`. No `equipped` map beyond `avatar`. |
| **Store** | `system/store/catalog.ts` | **Avatars only** — 3 free starters + 10 paid emoji, $1k→$100k. `Cosmetic = {id,name,emoji,priceCents,kind:'avatar'}`. `applyPurchase`/`applyEquip` pure. |
| **Achievements** | `system/progress/achievements.ts` | **6 flat badges** (`first_win, big_win, high_roller, seasoned, table_regular, deep_pockets`). Predicate model over an `AchievementView` (6 fields: totalPlayed, totalWins, bankrollCents, xp, lastWagerCents, lastNetCents). |
| **Stats** | `system/progress/stats.ts` | Per-game `{played, won, lost, pushed}`. `totalWins`/`totalPlayed` derived sums. |
| **Leaderboard** | `Leaderboard.tsx`, `profileRepo.publicProjection` | **One board**, ranked by `wins`, tie-broken bankroll→xp. Projects `{name, avatar, bankrollCents, xp, wins}`. |
| **Daily** | `system/rewards/daily.ts` | 7-day streak ladder $500→$5,000, then flat. UTC day index. |
| **Award pipeline** | `system/economy/result.ts` | `applyResult` — the **one** pure call that moves bankroll+xp+stats+achievements together. XP flat by outcome (win 100 / push 20 / loss 10). |

**The load-bearing constraint, and why the store is thin.** [`catalog.ts`](../src/system/store/catalog.ts)
says it outright: a cosmetic *must have a reader* or it's `loadout.color` — v1's cosmetic written by
the store and read by nothing. Avatars are the only cosmetic with a reader today (the top bar + profile
card render `profile.avatar`). Card backs, felts, dice have **no reader** — nothing drew a game board
until Phase 6. So **expanding the store is really about giving cosmetics readers**: the card games read
your equipped card back, the boards read your equipped felt. That's the honest spine of Pillar 1, and
it's the real (well-scoped) work.

**The other load-bearing constraint: `$other: false`.** Every profile field, every per-game stat, and
every leaderboard field is pinned in [`database.rules.json`](../database.rules.json) with `$other: false`
— the server *refuses* an unknown key. So **any new stored field is a rules change + a `.validate` +
a test that the refusal holds**, in the same commit. This is the migration surface, tabulated in §7.

---

## 3. Pillar 1 — The Store

### 3.1 New cosmetic kinds, each with a real reader

`CosmeticKind` grows from `'avatar'` to a union. Each kind ships **with the game wiring that reads it**,
never before — that's the rule.

| Kind | Reader (who renders it) | Notes |
|---|---|---|
| `avatar` | top bar, profile card | exists today |
| `cardback` | Blackjack, UNO, Solitaire, Chess-not (no cards) | the face-down card art; `cardBackSrc` becomes equipped-aware |
| `felt` | game board backgrounds (all 5) | the table surface / board theme |
| `title` | profile card, leaderboard row, lobby seat | a text flex — "Grandmaster", "The House". **Earn-only tier lives here.** |
| `frame` | avatar ring in top bar / leaderboard | a glow/border around the avatar. **Respects the glow budget** — see caution below. |
| `dice` | (no dice game yet) | ⚠️ **NOT until a dice game exists to read it.** Listed so the union is designed, but it does not ship in this plan — that would be the exact dead cosmetic we're fixing. |

> **Glow-budget caution.** The theme's glow budget is *fixed and nearly spent* (blue=act, cyan=here,
> gold=money — [CLAUDE.md](../CLAUDE.md#ui)). `frame` cosmetics must **not** mint new neon meanings.
> They draw from a pre-approved palette of frame treatments added to `packages/theme` as tokens, never
> inline colors. If frames threaten the budget, they get cut before the budget does.

### 3.2 Rarity tiers

Add `rarity: 'common' | 'rare' | 'epic' | 'legendary'` to `Cosmetic`. Rarity drives:
- the card's border/label in the store (a theme token per tier, no new glow),
- pack pull odds (§3.4),
- and *nothing functional* — a legendary card back deals the same cards. Pure status.

A `legendary` item priced absurdly high (e.g. $10M+) is a permanent **sink** so chips always have
somewhere to go and the whales have a mountain left to climb.

### 3.3 Earn-vs-buy split (the "cheap emoji" fix)

- **Buyable with chips:** card backs, felts, frames, most avatars, common/rare/epic cosmetics.
- **Earn-only (no price, achievement-gated):** the best `title`s and a handful of `legendary`
  cosmetics. "Grandmaster" is *granted* by completing the Chess win-chain, not sold. You cannot buy
  your way to it, which is the entire point — it signals mastery because money can't fake it.

Mechanically: an earn-only cosmetic has `priceCents: null` (or a `source: 'earned'` discriminant) and
is added to `inventory` by the **achievement pipeline**, not the store. This wires Pillar 2 → Pillar 1:
completing an achievement chain *drops loot*.

### 3.4 Packs — the variable-reward loop (the actual addiction mechanic)

The single biggest "addictive" lever, and the thing missing today. A **pack** is a chip-priced
randomized pull:

- `Pack = { id, name, priceCents, pool: CosmeticKind[], odds: Record<Rarity, number> }`.
- Buying a pack: spend chips, roll against `odds`, grant one (or N) cosmetic(s) from the pool the
  player doesn't own, add to `inventory`. **Duplicate protection**: if you'd pull an owned item,
  convert to a small chip refund ("dust") so a pack is never a total dud.
- The roll is **pure and seeded** — `openPack(profile, pack, seed) → {profile, pulled}` — so it's a
  unit test, not a thing discovered in the UI. The seed comes from the caller (a nonce), never
  `Math.random()` inside the logic, same discipline as everything else in `logic/`.
- Ethics guardrail: **play-money only, odds shown on the pack, no real-money purchase, ever.** We're
  copying the *fun* of pack-opening, not the predatory economics. This gets stated in the code
  comment so no future change quietly adds a card-purchase.

Packs are where a big chunk of the "vastly improved store" energy goes, and they make the daily-reward
chips have a destination more exciting than a flat "buy the crown."

### 3.5 Data-shape deltas

```ts
// profile/types.ts — Profile gains an `equipped` map (avatar stays for back-comp OR folds in)
readonly equipped: {
  readonly avatar: string;    // emoji (today's `avatar`)
  readonly cardback?: string; // cosmetic id
  readonly felt?: string;
  readonly title?: string;
  readonly frame?: string;
};
```
(Exact migration of `avatar` → `equipped.avatar` is an open question — §8.)

Rules: `equipped` needs a `.validate` block; `inventory` already accepts any `$itemId: true` so new
cosmetic ids need **no** rules change (nice — the store can grow items freely). See §7.

---

## 4. Pillar 2 — Achievements 2.0

### 4.1 Tiered chains

Replace flat one-shot badges with **chains** — Bronze→Silver→Gold→Platinum of the same idea, so
there's always a next tier glowing just out of reach.

```
Wins:      10 / 50 / 100 / 500        (Bronze→Platinum)
Chess:     win 1 / 10 / 50 / 100      → completing Platinum grants the "Grandmaster" title
Blackjack: 1 / 10 / 50 / 100 wins     → grants a card-back cosmetic
Bankroll:  $10k / $50k / $250k / $1M
Level:     5 / 10 / 25 / 50
```

The predicate model already supports this beautifully — a chain is just four rows in `ACHIEVEMENTS`
with escalating thresholds. **No architectural change**, just more rows + a `chain` group id + a
`tier` for rendering.

### 4.2 Skill / luck feats (game-specific, brag-worthy)

The memorable ones. These need **more facts in `AchievementView`** — today it only sees aggregate
totals + last wager/net. To fire "win blackjack with a natural" or "win UNO holding a Draw Four",
`applyResult` must pass a small **game-specific result payload** into the view.

- "Natural Blackjack" — win with a two-card 21.
- "Comeback" — win UNO from 7+ cards behind. / "Ruthless" — end someone on a Draw Four.
- "Speedrun" — win Chess in < 20 moves. / "Scholar's Mate victim survives" (hidden).
- "Clean Sheet" — win Solitaire without recycling the stock.
- "Perfect" — Tic-Tac-Toe win streak of 10.

**This is the one real architectural reach:** `ResultReport` grows an optional `feats?: string[]` (or a
typed `detail` bag) that the *game* computes and passes, and the pipeline records any listed
achievement ids. The game already knows these facts; it just doesn't report them. Keeps the predicate
model for state-based achievements, adds an event-flag path for the moment-based ones. Design detail
in §8.

### 4.3 Hidden achievements + completion %

- **Hidden**: `hidden: true` renders as a locked "???" until earned — discovery is its own dopamine hit.
- **Completion %**: a derived `earned / total` shown on the profile. Some people 100% for the number
  alone. Pure derivation, no storage.

### 4.4 Chains feed the store

Completing a chain's top tier grants an **earn-only cosmetic** (§3.3) — a title or exclusive card back.
This is the loop that ties the whole overhaul together: play → achieve → unlock prestige cosmetic →
wear it → other players see it → they want it. Achievements stop being a corner shelf and become the
engine of the status economy.

---

## 5. Pillar 3 — Leaderboards & Stats ("we are all gooning for stats")

### 5.1 A rich profile stats page

The breakdown the owner asked for. Today `Profile.tsx` + `StatsPanel` show aggregate wins. Expand to:

- **Per-game table**: played / won / lost / pushed / **win rate** for each of the 5 games.
- **Highlights**: favorite game (most played), best win streak, net chips won, biggest single payout,
  achievement completion %, total time played (if we track it).
- All **derived** from `stats` where possible — the `level`/`wins` rule: don't store a second source
  of truth for something the counts already determine.

### 5.2 Many boards, not one

The core "stat porn" fix. Multiple ranking axes, each a tab on the leaderboard:

| Board | Rank key | Source |
|---|---|---|
| Most Wins | `wins` (exists) | derived sum |
| Richest | `bankrollCents` | already projected |
| Highest Level | `xp` | already projected |
| Best Win Rate | `won / played` (min N games) | **needs projecting** |
| Longest Streak | current/best win streak | **needs a stored stat** |
| Per-game | wins in chess / blackjack / uno / … | **needs per-game projection** |

Everyone can top *some* board → more players stay in the chase. This is the highest-value-per-line
change in the whole plan.

### 5.3 Data-shape deltas (the honest cost)

The leaderboard projection (`publicProjection`) and its rules pin (`leaderboard/<uid>`, `$other: false`)
carry exactly `{name, avatar, bankrollCents, xp, wins}` today. New boards mean **new projected fields
+ rules `.validate` + a refusal test** for each. To avoid an ever-growing public projection, options:

- **A**: project a compact `boards: { winRate, streak, chessWins, … }` sub-object (one rules block).
- **B**: separate top-level nodes per board (more rules, cleaner reads).
  → **Recommend A** — one pinned sub-object, fewer moving rules parts. Decided in §8.

Some boards need a **new stored per-game stat** (win streak). That touches the `stats.$game` validate
set, which is `$other: false` on `{played, won, lost, pushed}` — so adding `streak`/`bestStreak` is a
rules change + test. Net winnings per game similarly.

### 5.4 Later (not this plan)

- **Seasonal / weekly boards** (resets → fresh competition, old whales don't dominate forever). Needs
  a season clock + archival. Real value, but a phase of its own.
- **Head-to-head records** for chess/uno. Needs per-opponent storage. Defer.

---

## 6. Pillar 4 — Assets

*(Concrete inventory from the asset sweep folded in below once it lands. Strategy is stable regardless.)*

**Strategy:** every store cosmetic needs art *on disk* — and the repo already enforces this
(`tests/cards.test.ts` etc. resolve every path to a real file). So the asset pass is a **prerequisite**
for Pillar 1's item counts, not a parallel nice-to-have. We curate from the Game-Shack / Game-Room CC0
trove into `public/` — **curate, not dump** ([asset-sources memory]): only art that a cosmetic actually
reads gets staged, same rule as everything else.

### 6.1 What we actually have (asset sweep result)

Rich. The trove more than covers Pillars 1–3, with two honest gaps.

| Cosmetic need | Availability | Verdict |
|---|---|---|
| **Card backs** | **23 already staged** (`cards/standard/cardBack_{blue,green,red}1-5` = 15, `assets/standard-1/back01-08` = 8) + ~18 more raw in Game-Shack | ✅ **Abundant** — a full rarity ladder + pack pool with zero new sourcing. The flagship cosmetic is ready. |
| **Felts / table themes** | 3 staged (`assets/boards/table_{blue,green,red}.png`) + 3 backgrounds | 🟡 **Enough for a starter trio**; more variety would want light recoloring (theme tokens) rather than new images. |
| **Chip designs** | 8 color families + 2 poker styles ×9 (Game-Shack), 2 staged styles | ✅ Available — **but chips have no cosmetic reader** (they're betting UI, not equippable). Defer like dice. |
| **Dice skins** | Huge (color/symbol/poker/isometric, 100s) | ⛔ **No dice game reads them.** Confirms the design: `dice` kind stays out until a dice game exists. |
| **Victory / unlock SFX** | **85 jingles** (`Game-Shack/jingles/`, 5 styles ×17) — none staged + named `victory/win/lose/tie` (Game-Room) | ✅ **Ideal** for achievement-unlock, pack-open, jackpot stingers. Curate a handful into `public/audio/` with a new role (`unlock`, `fanfare`). |
| **Badge / achievement icons** | `crown, streak, win, gold, coin-pile, lucky-seven, four-leaf-club, horse-shoe, cherries, bell` + **18 blank `icon1-18` canvases** (staged in `assets/icons/`) | 🟡 **Good raw material** for per-achievement faces; today badges use emoji, which also works. |
| **Avatar images** | **None anywhere** | ✅ **Non-issue** — avatars are emoji by design; no art needed. |
| **Title decorations** | Pure text | ✅ No art needed. |
| **Frame / ring treatments** | Essentially none (`scroll.png` only) | ✅ Intended as **theme tokens**, not images — no sourcing needed. |
| **Trophy / medal tier art** (Bronze→Platinum) | None dedicated (`crown/gold/win` approximate) | 🟡 **The one real gap** — tier art would be created (recolor the blank `icon1-18` canvases per tier, or use emoji + a tinted ring). Not blocking. |

**Bottom line:** card backs and celebration SFX — the two highest-impact assets — are effectively
free. Dice and chips have art but no reader, so they correctly wait. The only thing we'd *make* is
Bronze→Platinum tier badge art, and even that has a cheap emoji-plus-tint fallback.

### 6.2 Licensing caveat (real, must respect)

Per `public/audio/CREDITS.md`: the **curated** `public/audio` + `public/cards` sets are CC0. The
wholesale `public/assets/` library is **mixed CC0 / CC-BY, private-use only**, and 7 branded game
logos were deliberately excluded (Monopoly, Clue, Risk, etc. — still in `~/Desktop/Game-Room`; **never
stage or "sell" them**). Boardwalk is a private rebuild ([gameshack-rebuild memory]) and the store is
play-money, so private use is fine — but curate from CC0 first, and keep the branded logos out. Same
rule as always: **curate into `public/`, don't dump.**

---

## 7. Migration surface — every `$other: false` we touch

The honest cost table. Each row is a rules `.validate` + a test-that-it-refuses, in the same commit
(the CLAUDE.md rule). **Remember: rules are deployed by hand — `npm run rules:deploy` — so deploy in
the same breath** ([prod-signup memory]).

| Change | Node | Rules work |
|---|---|---|
| `equipped` map on profile | `users/<uid>/profile/equipped` | new `.validate` block, `$other:false`, refusal test |
| new cosmetic ids | `…/inventory/$itemId` | **none** — already `$itemId: true`. Free growth. ✅ |
| achievement chains / feats | `…/achievements/$achId` | **none** — already `$achId: number`. Free growth. ✅ |
| per-game streak/net stats | `…/stats/$game/{streak,…}` | extend the pinned `{played,won,lost,pushed}` set + tests |
| leaderboard boards | `leaderboard/<uid>/boards` | new pinned sub-object + refusal test |

**Good news:** the two systems that grow the most (cosmetics via `inventory`, achievements via
`achievements`) need **zero** rules changes — they were designed open-ended. The cost is concentrated
in `equipped`, new stats, and leaderboard projection.

---

## 8. Owner decisions (RESOLVED 2026-07-17)

1. ✅ **`avatar` migration** — **keep `avatar` top-level, add `equipped` for the new kinds.** No data
   migration for existing accounts.
2. ✅ **Feats mechanism** — **approved.** `ResultReport` grows an optional `feats?: string[]` a game
   computes and reports; the pipeline records any listed achievement ids. Keeps the predicate model
   for state-based achievements, adds an event-flag path for moment-based ones.
3. ✅ **Packs** — **approved, as a fast-follow (P4).** Not a quality cut — packs roll against `rarity`,
   which P2 builds, so P4 is the earliest order with no throwaway stub. Full quality when it ships.
4. **Leaderboard boards shape** — compact `boards` sub-object (recommend) vs. separate nodes. *Decide
   at P1 build time against how `LeaderboardRepo.top` sorts.*
5. ✅ **First slice** — **P1 (Stats & boards) first**, per §9.

---

## 9. Suggested sequencing (so it's not a big bang)

Each is a green, deployable slice, in the phase spirit of the repo:

- ✅ **P1 — Stats & boards** — **SHIPPED 2026-07-17.** Four leaderboard boards (Wins / Richest / Level /
  Win Rate) as tabs, ranked through one pure `system/progress/boards.ts` registry (16 tests); richer
  profile stats panel (per-game win %, favorite table, badge completion). Projected `played` alongside
  `wins` (one new rules `.validate` + refusal test). 431 tests green, browser-verified (password eye,
  all 4 tabs, stats tiles, zero console errors). **⚠️ Rules changed — must `npm run rules:deploy` before
  this reaches prod (see below).**
- ✅ **P2 — Rarity + earn-vs-buy + card backs** — **SHIPPED 2026-07-17.** `CosmeticKind` grew to
  `avatar | cardback | title`; every `Cosmetic` gained a `rarity` (pure status — flat theme tokens,
  no glow). The real work was the READER: `cardBackSrc(backId)` is equipped-aware (`cards.ts` owns
  the `CARD_BACKS` id→file map, the game passes the id via `useEquippedCardBack`), and Blackjack +
  Solitaire now draw the player's equipped back — **standard-deck games only; UNO stays on its own
  back** (one UNO-specific design, no variants — waits like `dice`, owner decision). The `equipped`
  map landed on the profile (owner decision #1: `avatar` stays top-level, no migration) with a new
  `.validate` block + `$other: false` in `database.rules.json` and a refusal test (57 rules tests).
  Earn-vs-buy is modelled: card backs are chip-buyable, the best titles are earn-only
  (`priceCents: null` + an `unlock` line, shown locked) — the GRANT mechanism is P3. Titles read on
  the profile card. 445 tests green, browser-verified (equip a card back → renders in Blackjack +
  Solitaire, title on profile, zero console errors). **⚠️ Rules changed — `npm run rules:deploy`
  must run before the frontend reaches prod, or every profile write carrying `equipped` is refused
  (same class as P1's `played`).**
- ✅ **P3 — Achievements 2.0 — SHIPPED 2026-07-17.** The 6 flat badges gave way to five Bronze→Platinum
  **chains** (wins 10/50/100/500, level 5/10/25/50, bankroll $10k–$1M, and per-game chess & blackjack
  1/10/50/100), keeping the four single-milestone/event badges that are not chain-shaped (`first_win`,
  `big_win`, `high_roller`, `table_regular`) and dropping the two now-redundant with chain tiers
  (`seasoned`≡level-silver, `deep_pockets`≡bankroll-silver). The **grant** mechanism ties P2→P3: the
  chess/blackjack Platinum tiers grant the earn-only `ttl_grandmaster` / `ttl_thehouse` titles straight
  into `inventory` (the only way to obtain them — the store refuses to sell them). The **feats** path
  (owner decision #2): `ResultReport.feats?: string[]`, an allow-listed event-flag channel the games
  report on — Natural (blackjack two-card 21), Clean Sheet (solitaire with 0 recycles, via a new
  `recycles` state counter), and the hidden Blitz (chess win < 20 fullmoves, parsed from the FEN).
  **Hidden** achievements render "???" until earned; **completion %** is a pure `earned/total` derivation.
  Tier art is the medal-emoji + tint fallback the asset sweep called for — no new sourcing, no new glow.
  **NO rules change** (chains/grants/feats all land under already-open `achievements/$achId` and
  `inventory/$itemId`), so no deploy needed for P3. 477 tests green (`tests/achievements.test.ts` +24,
  `tests/progress.test.ts` retargeted, `tests/solitaire.test.ts` recycle counter), browser-verified
  (profile renders all five chains + feats + hidden ??? + "0 / 27 · 0%", zero console errors). Feeds P2's
  earn-only cosmetics.
- ✅ **P4 — Packs — SHIPPED 2026-07-18.** The variable-reward loop, on top of P2's rarity. Three
  packs (`src/system/store/packs.ts`): Card Back $2,500, Avatar $10,000, Grand $20,000, each
  publishing its rate table on the card — and the displayed table IS `pack.odds`, the object
  `openPack` rolls against, so the shown rate cannot drift from the real one. The roll is **pure and
  seeded** (`openPack(profile, pack, seed)`, mulberry32; the nonce is minted in `useStore`, never
  inside the logic), so the distribution is 21 assertions in `tests/packs.test.ts` rather than a
  thing discovered by clicking Open. **Duplicates are real and deliberate**: the roll picks
  uniformly within the rolled rarity and does NOT steer to what you are missing — steering would
  make the dust refund code with no reader, the mechanic form of `loadout.color`. A duplicate
  instead converts to dust that scales on BOTH axes — up with the rarity rolled (base 10/25/50/100%
  of the pack price; a duplicate legendary always refunds the lot) and up with how much of the pool
  you already own, `rate = base + (1 - base) × completion`. That second axis closes the one window
  where a pack genuinely stung: at 13-of-14 collected, a near-certain duplicate was still costing
  full price. `completion` is DERIVED from `inventory` — the same rule that keeps `level` out of the
  profile — so the relief a pity timer buys costs no stored counter, no `$other: false` change and
  no deploy. What `canOpen` refuses is a pack whose pool you have COMPLETED — that is a fee, not a
  gamble; the approach to it is now cushioned rather than cliff-edged. Two invariants carry the earn-vs-buy split through: the pool is `priceCents > 0`, so
  a pack can never drop an **earn-only** title (chips still cannot buy "Grandmaster", not even
  through a slot machine) nor a free **starter**; both are asserted over the catalogue and
  exhaustively over the roll, and the earn-only half is enforced BY TYPE — `PackPull.item` is a
  `PackableCosmetic`, reachable only through the `isPackable` gate, so a future change that builds a
  pull straight out of `CATALOG` is a compile error rather than a test we must remember to keep. The card-back ladder grew from 8 to all **15** staged backs — a pack
  needs depth or every pull is a duplicate by the third open. Reveal is one modal reusing the
  existing `jackpot`/`win`/`push` roles (no new audio staged; celebration stingers stay P5). The
  ethics guardrail is stated in the code: play money only, published odds, no real-money path, ever.
  **NO rules change** (pulls land under the already-open `inventory/$itemId`), so no deploy needed.
  506 tests green, browser-verified against the emulator (fresh account → pack shelf with all three
  rate tables, only the affordable pack enabled, opened it, pulled a back, bankroll $5,000 → $2,500,
  collected count 0→1 of 14 and the quoted duplicate refund moving $250→$411 with it, zero console
  errors, zero failed requests, no broken art).
- ✅ **P5 — Felts / frames / celebration SFX — SHIPPED 2026-07-18.** The last slice, and the one
  that had to pay for its own deploy surface. `CosmeticKind` grew to
  `avatar | cardback | title | felt | frame`, each landing WITH its reader, and the two new kinds
  answer the "no reader" rule in opposite ways.

  **`felt` is art.** `src/system/felt/felts.ts` owns id→file, `useEquippedFelt()` resolves to a URL,
  and `<Card felt={…}>` draws it as a muted `object-cover` layer — so all five boards read it
  through **one** kit prop rather than five bespoke edits, because `<Card>` was already the surface
  every board sits on (its docblock has said "the felt, the table" since Phase 1). Three felts
  (Emerald / Midnight / Crimson), curated from the trove into `public/felts/`. **No free starter:**
  the default is no felt, which is the exact `bg-base-200` table Phase 6 shipped, so the kind is
  additive on a live app and an account that buys nothing sees no change. Drawn at `opacity-80`
  because the theme's contrast pairs are computed against the base surfaces.

  **`frame` is not art — and it is not a new colour either.** The sweep found no ring art, and §3.1
  said if frames threaten the glow budget, frames get cut. They didn't have to: a frame is drawn in
  P2's **rarity** tokens, which are already flat and already cleared, so the kind adds **zero hues**
  and a frame's colour IS its rarity. Four frames, and the three avatar `<span>`s (top bar,
  leaderboard, profile card) collapsed into one `<Avatar>` in the same commit. **Own-avatar only**
  (owner decision): another player's frame would need projecting into `leaderboard/<uid>`, a fourth
  pinned `$other: false` node and its own deploy — so `<Avatar>` takes the frame as a prop, leaving
  that a one-prop change later.

  **Celebration SFX** are two real roles, `unlock` and `fanfare` (Kenney Sax jingles, CC0), replacing
  the `jackpot`/`win` the P4 reveal borrowed as a stated placeholder. Single-file, not pools — a
  celebration is punctuation, not a burst — and both play sites fire once per BATCH, since one
  result can complete several chain tiers. Felts and frames also joined **`pk_grand`** (owner
  decision), which is explicit: `packPool` is gated on `pack.kinds`, so adding cosmetics to
  `CATALOG` alone would have changed nothing. Honest knock-on: the pool is bigger, so existing
  collectors' completion — and the dust their duplicates refund — drops.

  **NOT in scope, and staying out:** `dice` and chip skins. Both have abundant art and no reader,
  which is the whole reason the union stayed closed around them even while it was open for editing.

  539 tests green (`tests/felts.test.ts` +7, `tests/frames.test.ts` +6 — the frame one guards
  tone-vs-rarity drift, the failure no disk check or compiler can see) plus
  `boardwalk-api` 194 (`tests/migrations.test.ts` +4, `api.test.ts` +2). Every new guard falsified
  by breaking its subject on purpose. Browser-verified against the emulator: felt renders on
  Solitaire, Blackjack and a live Tic-Tac-Toe board, the ring renders in the top bar, a pack open
  plays `unlock.ogg`, both stingers confirmed loadable-and-playable, **zero console errors, zero
  failed requests, no dead scroll**.

  ✅ **Deploys: BOTH DONE 2026-07-18, both verified from the artifact rather than the exit code.**
  Rules: `GET /.settings/rules.json` shows `equipped` pinning cardback/title/felt/frame with
  `$other: false`. Pi: two rsyncs, 194/194 tests green ON the device, then restart —
  `PRAGMA table_info(profiles)` now lists `equipped_felt`/`equipped_frame`, `dist/db/schema.js`
  carries them, and the ledger is byte-identical either side (1 profile, 2 rows, $5,215.00,
  integrity ok). Two things the process taught: the rules were first deployed from the PRIMARY
  checkout, which sits on `main` and does not carry the branch, so Firebase released the old file
  and reported success in identical green; and the Pi's `package.json` turned out to be STALE
  (still Phase D's `--prefix` scripts, replaced on main by `54f8a98`), so the Pi drifts behind
  `main` between deploys and the deploy is what reconciles it.

P1 first because it's the cleanest win and the owner asked for it most concretely. Packs (P4) are
gated behind rarity (P2) existing.

---

*Design draft. React on §8, and I'll turn the agreed slice into a build.*
