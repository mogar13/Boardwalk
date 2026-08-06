# UNO house rules — stacking, ranked places, and betting the house

**Status:** ALL FIVE SLICES SHIPPED AND DEPLOYED — the seam, stacking, ranked places, the
house-odds simulation, and betting a bot table. Slice 5 reached the Pi on 2026-08-06, **before its
own PR merged**, which is the ordering rule ("the Pi goes first") honoured literally rather than
closed a few hours later. Written after
[UNO_POT.md](UNO_POT.md) shipped, and it changes what every one of these costs: the referee
deals UNO now, so **three of the four items below are rulebook changes that land on the Pi**, and
the Pi goes first.

Asked for by the owner (and Steve). Decisions taken before any code:

| Decision | Answer |
|---|---|
| Where a house rule lives | **A create-time room parameter**, the road `anteCents` already built — not `manifest.options`. See [§1](#1-where-a-house-rule-lives). |
| Stacking | **+2 on +2 and +4 on +4.** Cross-stacking (+4 onto a +2) is a separate toggle, default off. See [§2](#2-stacking). |
| Ranked places | **A house rule (`playToLast`), default OFF**, so today's round is unchanged unless asked for. **BUILT.** See [§3](#3-ranked-places). |
| How a ranked pot splits | **The top HALF of the paying places, weighted `k, k-1, … 1`** — so two and three payers are still winner-takes-all and today's tables do not move. See [§3](#the-pot). |
| Betting a bot table | **House odds with the bot tier PINNED** — Blackjack's model, not v1's faucet. **BUILT.** See [§4](#4-betting-the-house). |
| The multiple | **Measured, not guessed — and now measured: `M = N × 2/3`.** Break-even is 0.813; the margin is what pays for the player a simulation cannot play. See [§4.2](#42-the-number-is-an-empirical-question-not-a-design-one). |

---

## 1. Where a house rule lives

`manifest.options` is the declared seam for a pre-game choice and it is the **wrong** one here, for
the reason CLAUDE.md states in the sentence describing its one limit:

> the values live in `<GameShell>`, which is per-client, and today's only room-game option is read
> exclusively by the host … the day a guest must read one, it belongs in room state

The ante was that day. A house rule is that day twice over, because it is read by **every** client
and by the **referee**:

- a guest's board dims a card the rules will refuse (`canPlay` is a feel check), so a guest playing
  under different rules than the dealer swallows legal clicks and offers illegal ones;
- the dealer enforces them, and it must take them from a place no client can name (see below).

So a house rule rides exactly where the ante rides:

- `RoomRepo.create(gameId, { seatCount, host, visibility, anteCents, houseRules })`
- the server's `Room` holds it; `RoomSnapshot.meta.houseRules` publishes it to every subscriber
- the lobby draws the toggles beside the ante picker, at **create** time
- `RoomListing.houseRules` puts it on the poster, so the hub says "stacking" before anyone joins

**`unoStart` still has no field for any of it**, which is the property UNO_POT §4 bought and this
must not spend: a client that can name a game parameter can name a *fair* game nobody consented to.
The referee reads the rules off the room's own record, the same way it reads the stake.

### Shape

A dense object of booleans in `packages/game-logic`, resolved through one shared pure function:

```ts
export interface UnoHouseRules {
  readonly stack: boolean;      // +2 on +2, +4 on +4
  readonly crossStack: boolean; // ...and +4 onto a +2. Requires `stack`.
  readonly playToLast: boolean; // keep playing after 1st place — see §3
}
export const DEFAULT_HOUSE_RULES: UnoHouseRules = { stack: false, crossStack: false, playToLast: false };
export function resolveHouseRules(raw: unknown): UnoHouseRules; // garbage → defaults, never throws
```

Dense and boolean rather than a flag string or a bitfield, because both sides and the wire have to
agree about it and a typed object is the only one of the three a compiler can check. Resolved
through one function for the reason `resolveOptionValues` exists: **a reducer reading a rule must
never have to handle a value the table could not have offered.**

`DEFAULT_HOUSE_RULES` is all-false on purpose — every rung of it is "UNO as it plays today", so the
feature is additive on a live app and a table nobody configures is the table that already exists.

### Three consequences worth stating

1. **No `database.rules.json` change and no Firebase deploy.** The RTDB path never carries a house
   rule, exactly as it never carries an ante, because UNO does not run there at all
   (`repos.uno === null` renders "needs the game server"). The Firebase room repo reports
   `DEFAULT_HOUSE_RULES` and that is the honest answer, not a degradation.
2. **The rules ride into the match for free.** They belong on `UnoGame`, set by `deal`, so they are
   inside `uno_matches.state_json` and survive a restart. A match is played under the rules it was
   dealt with, and there is no second copy to drift.
3. **`toPublic` carries them**, so every client's feel check reads the same booleans the referee
   enforced. One new field on the projection; no new node.

### The control

`<GameOptions>` renders `type: 'select'` only, and the options module says the second control type
arrives with its caller. **House rules are not that caller** — they are room state, not
`<GameShell>` state, so they do not go through `manifest.options` at all and the toggle belongs in
the lobby beside the ante picker. That is a small, honest piece of lobby UI and it leaves the
options seam untouched. A boolean control in `src/system/options` would be a second control type for
a seam with no boolean-typed option in it.

---

## 2. Stacking

**Status: SHIPPED (slice 2) — merged and DEPLOYED to the Pi 2026-08-06.**
`packages/game-logic/src/games/uno/logic/stacking.ts` + `tests/uno-stacking.test.ts` (37). Four
things the design got right and two it did not, recorded below at the point each one is claimed.
**`boardwalk-api` needed ZERO changes** — stacking reaches the referee entirely through the shared
package, which is the Phase-D seam paying for itself. The deploy evidence is in CLAUDE.md's
Enforcement table; the short version is that the Pi's `dist` carries `answersStack`, the running
PID postdates the build, and the ledger did not move.

The rule everybody actually plays: a +2 played at you can be answered with your own +2, and the
debt accumulates until somebody cannot answer and takes the lot.

### State

One field, wire-safe (a number, never null):

```ts
interface UnoGame { readonly pendingDraw: number; /* 0 = nothing owed */ }
```

### What changes in the reducer

- **A draw card played into an empty stack no longer deals.** Today `draw2`/`wild4` immediately
  pull the victim's cards and skip them (`steps = 2`). With `stack` on it sets `pendingDraw += n`
  and advances **one** seat, because the victim must be given the chance to answer. The skip has
  not vanished — it is deferred into the take, below.
- **While `pendingDraw > 0` the legal set collapses** to matching draw cards (`draw2` onto a `draw2`
  stack; `wild4` onto a `wild4` stack; `wild4` onto a `draw2` stack only with `crossStack`). Colour
  and value matching are suspended: you are answering a debt, not following a card.
- **Taking the stack is the `draw` move.** It pulls `pendingDraw` cards, resets it to 0, and ends
  the turn — which *is* the skip that the immediate version applied up front.
- **`canPlay` and `mustDraw` gain the pending draw.** Their signatures change, and that is the
  point: every call site is forced to decide, rather than a default silently meaning "no stack".
  `mustDraw` becomes "there is a debt and nothing in hand answers it" **or** today's condition.

  **As built, one argument rather than two.** They take a `UnoTable` — `{top, color, pendingDraw,
  houseRules}` — because three loose arguments growing to five is how a call site ends up passing
  most of the position. `UnoState` **extends** it, so a board hands its own projection in whole and
  the feel check is literally the referee's call. And `mustDraw` needed **no stacking logic at
  all**: "a debt nothing answers" is not a second condition, it is the first one read against a
  position where `canPlay` has already collapsed the legal set. One rule, one place.

  **`pendingDraw` is never read directly.** `drawDebt(table)` is the only reader, because the raw
  field lies in two directions: a debt at a table whose `stack` is off (the flags are the authority,
  the counter subordinate), and a referee that predates the field — which is the deploy order
  reaching real players, where an absent `houseRules` is `undefined.stack` and takes the board down.

### The trap that has to be tested

`drawCards` already stops early when the deck is dry and the discard cannot be recycled — that is a
friendly game simply stopping. With a stack it is not friendly: if the victim is owed 12 and the
deck yields 5, **`pendingDraw` must still reset to 0**. Leaving an unpayable debt on the table means
the next player is owed a stack nobody can pay, cannot play anything else, and the table hangs
forever on a turn only they can take — which is the same failure mode as an illegal bot move, one
step removed. The test asserts the debt clears even when the draw comes up short.

**As built, the trap was one word worse than this describes.** The short-draw case is real, but the
sharp edge is the draw that yields **nothing at all**: `applyMove` answered that with `return game`,
and with a debt outstanding an unchanged game is a victim who can neither answer nor draw, forever.
So the no-op is now conditional on `owed === 0` — and it has to STAY a no-op there, because the
board arms its auto-draw on a key built from the event seq and a dry deck that returned a changed
state would move the seq and re-arm the timer. Both directions are asserted; the asymmetry is the
rule.

### The bots

`chooseAiMove` must answer a stack when it can. Both tiers stack — `sharp` deterministically,
`casual` picking randomly among its stackable cards — because the alternative for `casual` is a
tier that eats every +4, and CLAUDE.md's rule is that **a tier must never make the game
unwinnable**. That rule was paid for by UNO's own first `casual` draft. The guard is the same one:
play whole dealt games to a WINNER at both tiers with `stack` on, asserting every move changes the
state.

**As built: neither tier needed a line of code**, and that is the single-predicate factoring
earning its keep rather than luck. `canPlay` has already collapsed `playable` to the cards that
answer the debt, so `sharp`'s "play a non-wild first" ranks +2 above +4 (saving the wild, which is
what it was always doing) and `casual` picks at random among the answers — and both tiers' existing
"nothing playable → draw" IS "cannot answer → take it". The alternative was a stacking branch in
each tier, which is two more places for `casual` to acquire a rule that makes the game unwinnable.
The guard ran as specified, over `stack` and `crossStack`, and stayed green.

### The board

- `UnoState.pendingDraw` on the projection, so the draw pile can read **"+6"** and the fan can dim
  every card that does not answer.
- The move log gains the running total, because "CPU 3 stacked +2 — 6 coming at you" is precisely
  the kind of fact a hidden-hand game has nowhere else to say. It is derived by `describeMove`
  diffing the game either side of the move, like every other event.
- The auto-draw already reads `mustDraw`, so it takes the stack for you with no new mechanism — one
  more reason `mustDraw` is the rulebook's own predicate rather than an inline check.

---

## 3. Ranked places

**Status: BUILT (slice 3).** `packages/game-logic/src/games/uno/logic/places.ts` +
`tests/uno-places.test.ts` (35), and the referee half in `boardwalk-api/tests/uno.test.ts` (33).
What the design got right, what it under-specified, and the one thing it left out entirely are
recorded below at the point each is claimed. **`boardwalk-api` needed one real change** — the settle
— which is the difference between this and stacking: a rotation rule reaches the referee for free
through the shared package, a MONEY rule does not.

Today a round ends the instant somebody goes out. Ranked keeps playing: 1st sits out, the rest play
on for 2nd, then 3rd, and the last player standing is last.

### Why it is a house rule and default OFF

It makes a round meaningfully longer, and CLAUDE.md's rule about defaults is that **a default change
must not silently retune a game under someone.** A table that wanted a quick hand and got a
three-stage elimination did not ask for that. `playToLast: false` is today's game, exactly.

### The reducer change, and why it is the expensive one

```ts
interface UnoGame { readonly finished: readonly number[]; /* seats, in placement order */ }
```

`winner: number` goes away rather than living alongside it — two sources of truth for one fact is
the defect this repo names most often. `winner` becomes `finished[0] ?? -1` at the read sites.

**As built, "the read sites" turned out to be TWO QUESTIONS, not one substitution.** Every existing
`winner !== -1` meant "this round has ended", and under `playToLast` that stops being the same thing
as "somebody has gone out" — for most of a ranked round first place is decided and the round is not
over. So there are two readers, `winnerOf` (who came first) and `roundOver` (is anybody still
playing), and each existing site had to be assigned to one of them deliberately. The reducer's own
guard, the referee's settle trigger and the bot timer are all `roundOver`; only the payout seat, the
next round's leader and the log's winner line are `winnerOf`. Substituting mechanically would have
paid the pot out with two players still holding cards.

Two rules stop being about SEATS and start being about LIVE seats:

1. `seatAfter` must skip finished seats. **As built it was REPLACED rather than joined**
   (`seatAfterLive`), because with nobody out the two are identical — asserted directly — so there is
   no second rotation for a call site to pick the wrong one of. Three sites read it: the turn
   advance, a non-stacking draw-two's victim, and the log's skip detection.
2. **A reverse acts as a skip at two LIVE players, not two seated ones.** This is the exact line
   [UNO_POT §2](UNO_POT.md#2-why-ante-only-first) named as the reason raise/call/fold was deferred —
   a folded seat leaves the rotation the same way a finished one does. **Doing ranked first makes
   the pot's slice 2 cheaper**, because the rotation surgery is done once and both features read it.

The round ends when `finished.length === liveSeatCount - 1`; the straggler is placed last without
having to play a final unwinnable hand against nobody. **As built the straggler is appended by the
same move**, so the terminal condition is simply a full podium and `roundOver` stays a question about
the list rather than about the list plus a special case.

**THE THING THE DESIGN LEFT OUT: the debt.** Slice 2 clears `pendingDraw` when the round ends, on the
argument that a debt no seat will be asked to pay is a fact that has stopped being one. Under
`playToLast` going out on a +2 does NOT end the round, and the stack must pass to the next live seat —
which is stacking's own rule ("you answer what is coming at you or you take it") read against a
rotation that no longer contains whoever laid it. The condition moved from "somebody went out" to
`roundOver`, and it is the only line where the two rules touch.

### The pot

A pure shared `potSplit(potCents, places)` beside `potFor`, with the same conservation property
asserted as a property: **the split sums to exactly the pot at every table size and every stake**,
remainder to 1st, integer cents throughout. That is the one thing a percentage split gets wrong by
default, and the ledger cannot absorb a rounding error.

**As built, the design's `places` was ambiguous and the disambiguation is the whole rule.** It is not
the number of chairs and not the number of humans: it is **the paying seats that PLACED, in the order
they placed**. A bot stakes nothing and so takes nothing — it is absent from the ladder rather than
allocated a share that would then have to go somewhere, which is the only version that conserves.
That single sentence also covers the ordinary game without a case of its own: `finished` holds one
seat, so a human winner is `potSplit(pot, 1)` — the whole pot, unchanged to the cent — and a BOT
going out first means no paying seat placed, `places` is 0, and the pot goes to nobody, which is what
this game already did and is already asserted.

**The ladder — the top HALF of the paying places, weighted `k, k-1, … 1`** — is a decision the design
did not take, and it buys two properties. Two and three payers collapse to winner-takes-all
(`floor(k/2)` is 1), so **the tables that exist today do not move whether or not places are on**: a
house rule that re-prices a game nobody asked to re-price is the default-change mistake in a different
hat. And placing badly costs you, because a ladder paying every position hands last place a rebate for
losing — a softer version of the faucet §4 exists to refuse.

The BOARD does not quote a per-place payout, deliberately. It could compute the split, but it would
have to guess which seats ANTED, and a seat that changed hands after the deal makes the guess wrong —
the same reason `potCents` is the server's number on the projection rather than `potFor(seats, ante)`
recomputed locally.

Stats: only 1st place counts as `won`. Placing 2nd of 4 is not a win, and inventing a
half-win would put a second meaning into a number four leaderboards already rank.

---

## 4. Betting the house

**Status: BUILT (slice 5).** What follows is the design as it was reasoned out; what it turned into
is recorded in [§5.5](#5-slices-and-the-deploy-that-comes-first), including the one rule the design
did not see (a house pot has ONE payer, so the ranked ladder pays it out for placing LAST).

**The ask:** be able to bet at a table of bots. **The obstacle:** UNO_POT §3 refused it, and was
right to — v1's *"the house antes for each bot so the pot matches what the player put up"* is, on a
4-seat $25 table, a **$75 grant on a coin flip**. `refillGrantFor` cost a whole plan to make that
class of thing impossible.

### 4.1 The version that is not a faucet

The owner's decision is **Blackjack's model**, and the distinction is exact:

- v1 paid **fair odds**. At N equal seats a player wins 1/N of the time, so an N× payout is
  EV-neutral — and *nobody is equal to a bot*, so in practice it was EV-positive for every player.
  That is a faucet with extra steps.
- Blackjack pays **below fair**, which is what a house edge is. UNO can do the same: the referee
  pays `ante × M` where `M < N`, so the expected value is negative and the money flows the way it
  does at every other table in the building.

The house still funds the win. That is not the objection — Blackjack's house funds every win it
pays. The objection was to funding it at odds that lose money on average, and a sub-fair multiple is
the whole fix.

Two things this needs that a human table does not:

**The bot tier is PINNED when a stake is set.** The difficulty is a `manifest.options` select the
player chooses, and `M` is priced against `sharp`. Leaving `casual` selectable at a `sharp` price is
not an exploit to be discovered later, it is the feature paying out on demand. So a bot table with a
stake locks the control to `sharp` and says why. (A human table is unaffected: the tier only prices
anything when the house is the counterparty.)

**The ceiling is per-match, not a constant.** `DEFAULT_PAYOUT_MULTIPLE` is 3× and a 7-seat bot table
pays more than that, so this cannot go through the generic bound. UNO is already in
`SERVER_DEALT_GAMES` — `/settle` refuses it outright — so the payout happens inside the dealer's own
transaction and gets its own bound, computed from **the match's own seat count** the way Blackjack's
2.5× is computed from its own rules. A constant here would have to be sized for a 7-seat table and
would then be wide open on a 2-seat one.

### 4.2 The number is an empirical question, not a design one

**Status: MEASURED (slice 4).** `tests/uno-house-odds.test.ts` (8). The number exists, the answer is
**yes, §4 can ship**, and the recommended multiple is **`M = N × 2/3`**. What follows is the
question as it was posed, then what the harness actually found — including two things it was not
looking for, one of which changes how slice 5 has to be built.

`M = N × edge` assumes a player wins about `1/N` against `sharp` bots. **That assumption is the
entire safety of the feature and nobody has measured it.** `sharp` is deliberately simple — play a
non-wild first, save the wilds, always call UNO — and a person who counts colours may well beat
three of them far more than 25% of the time. If the real rate is 1/2 at a 4-seat table, then *any*
multiple above 2× is a faucet no matter how it was justified.

So the order is: **simulate first, price second.** The reducer is pure and seeded, so N `sharp` bots
can play tens of thousands of games in a unit test and hand back the true per-seat win rate — and
the same harness measures it with `stack` on, since stacking punishes whoever is holding the wrong
hand and may not be symmetric. The multiple is then set from that number with an edge on top, and
**the assumption is written next to the constant** so the day somebody retunes `sharp` they are told
what else moves. A tier change that quietly re-prices the house is the same class of bug as a
mastery chain added without a Pi deploy.

#### What it measures, and the one thing it cannot

It measures **policies, not people**, so every rate below is a **lower bound** on what a human
extracts and no arrangement of seeds turns it into an upper one. That limit is not a caveat bolted
on at the end — it is what decides the whole shape of the answer, because a lower bound alone
licenses nothing. What makes it usable is the *second* measurement rather than the first: the
harness also plays a deliberately modest **challenger** (counts its own colours, watches hand sizes,
saves wilds, calls UNO — §4.2's *"a person who counts colours"*, built to be exactly that person and
no better), and the gap it opens over `sharp` is small while the gap `sharp` opens over `casual` is
large. **A game whose skill gradient has already flattened by `sharp` is one where the unmeasured
human tail is short**, and that ordering — not any single win rate — is what prices the house.

The challenger lives in the test and not in `ai.ts`, deliberately: it is an instrument, not a tier,
and a third `UnoLevel` with no manifest choice behind it would be `loadout.color`.

#### The numbers

2,000 seeded rounds per cell, every game through the real reducer and the real bots. "Lift" is a
seat's win rate as a multiple of its fair share, so 1.00 is exactly fair — the one form of the
number that is comparable across table sizes. `M = N × edge` is safe exactly while lift < `1/edge`.

| Seats | Fair | `sharp` lead, one round | `sharp` vs a `casual` table | **Challenger, worst** | Break-even `M` | `M` at 2/3 | House edge |
|---|---|---|---|---|---|---|---|
| 2 | .5000 | 1.005× | 1.237× | **1.093×** | 1.83 | 1.33 | 27.1% |
| 3 | .3333 | 1.035× | 1.379× | **1.109×** | 2.71 | 2.00 | 26.1% |
| 4 | .2500 | 1.078× | 1.412× | **1.130×** | 3.54 | 2.67 | 24.7% |
| 5 | .2000 | 1.157× | 1.552× | **1.170×** | 4.27 | 3.33 | 22.0% |
| 6 | .1667 | 1.209× | 1.626× | **1.230×** | 4.88 | 4.00 | 18.0% |
| 7 | .1429 | 1.095× | 1.638× | **1.179×** | 5.93 | 4.67 | 21.4% |

Worst challenger lift anywhere: **1.230** (six seats). Break-even `edge`: **0.813**. Stacking moves
nothing material — it is inside the challenger column, which takes the worse of `stack` on and off.

#### Three findings

1. **The null holds — but only over a session.** Identical `sharp` policies share a table equally,
   every seat within a few percent of `1/N`, at every table size and under both rule sets. So `1/N`
   is the right base and the multiple does not have to be priced against a favoured chair.
2. **The lead is worth real money for exactly one round, and it evaporates over a session.** The
   opening seat lifts up to **1.209×** in an independent round — and flat over a session, because
   `deal` hands the lead to whoever just won, so every seat holds it in proportion to its own wins
   and the effect cancels. **This is the finding that changes slice 5** (see below).
3. **The skill gradient saturates at `sharp`.** `casual` → `sharp` is worth 1.24–1.64×; `sharp` →
   challenger only 1.09–1.23×. The room *below* `sharp` is three to seven times the room *above* it.
   That is the shape of a game where hidden hands and forced moves cap what attention buys, and it
   is the whole reason a lower bound is enough to decide this.

#### The decision

**`M = N × 2/3`**, the payout floored to integer cents (`potSplit`'s discipline — floor the money,
never the rate, and flooring only ever favours the house). Break-even is 0.813, so **2/3 clears the
measured bound by 22%** where 3/4 would clear it by 8%.

The extra quarter-turn is the point rather than timidity: the challenger is a lower bound, so the
margin is not padding around a known number — **it is the only protection against the player the
harness cannot play.** A real person has to be a further 22% better than an attentive-human proxy
that already beats `sharp` before the house starts losing.

The cost is named rather than hidden: this implies an **18–27% house edge**, steep beside
Blackjack's. That is the correct trade and not a compromise — Blackjack's edge is computed against a
rulebook that is fully known, and this one against an opponent nobody has measured.

#### The thing the design did not know, and slice 5 has to

**Re-dealing to keep the lead is free, so the bound must be the ONE-ROUND number.** A player who
creates a fresh table for every round always holds seat 0 and always leads — worth up to 1.209× at
six seats — while a player who sits and plays on gets the flat session rate. Nothing stops the
former: leaving and re-creating a bot table costs a click. So the harness takes the **maximum** over
both regimes at every cell, and the table above is that maximum; pricing off the session number
alone would have handed a 21% edge to anybody who noticed. It is not an exploit to be patched later
— it is the regime the multiple is set in.

The other guard that came out of building this: the harness asserts **no round ever stalls**, at
every table size, under both rule sets. Without it a policy that hangs the table would simply appear
to win less often, and every rate above would be wrong in the quiet direction.

---

## 5. Slices, and the deploy that comes first

~~**Slice 0 — the Pi is behind `main` right now.**~~ **CLOSED.** It turned out the dealer was
already deployed (a concurrent session had shipped it and not written it down — the record of a
deploy is not the deploy), and the Pi then went behind again for slices 1–2 and was brought current
on 2026-08-06. The lasting lesson is the CHECK, not the answer: `/health` will not tell you either
way, and neither will a deploy record — `md5sum` the `src` trees against a clean worktree at
`origin/main`, which is read-only, exact, and needs no restart ([pi-deploy-procedure]).

1. ~~**House rules as a create-time room parameter**~~ — **DONE and DEPLOYED (2026-08-06).** The
   shared type, `resolveHouseRules`, the `create` frame, `RoomMeta`, `RoomListing`, the lobby
   toggles, the RTDB repo answering defaults. Shipped with every rule OFF and therefore changed
   nothing observable: a pure seam, green, and independent of the three rules that use it. It went
   in alongside slice 2 rather than on its own, for a reason worth recording — **it sat finished and
   UNPUSHED in a dead session's worktree**, which is the concurrent-session hazard in its most
   expensive form: not lost work, but work nobody knew existed. Check the worktrees before
   rebuilding a slice.
2. ~~**Stacking**~~ — **DONE and DEPLOYED (2026-08-06).** The rulebook, its tests (including the
   dry-deck debt), the bots, the projection, the log, the board — merged as PR #57, which carried
   slice 1 with it because that slice had been built in a session that died before pushing and
   stacking is meaningless without it.
   **Two things worth carrying into slice 3.** The reducer's read of `game.houseRules` is the first
   one there has ever been, so a match row written before slice 1 can now reach a line that indexes
   the bag — it is resolved rather than indexed, and the totality test has to PLAY A DRAW CARD to
   reach that branch (the first draft played a number, entered nothing, and passed while the bug was
   live). And `mustDraw`/`chooseAiMove` both came out unchanged, which is the evidence that a house
   rule belongs inside `canPlay` rather than beside it.
3. ~~**Ranked places**~~ — **DONE and DEPLOYED (2026-08-06).** `finished[]`, the live-seat rotation,
   `potSplit` and its conservation property, the podium in the result panel, the log's placement
   lines. It is the first house rule that needed a Pi deploy to mean anything at all — stacking
   reached the referee entirely through the shared package, and this one carries a `settleMatch`
   change that does not.
   **Three things worth carrying into slice 4.** `winner !== -1` was never one question (see §3), and
   the two it split into are now the vocabulary the rest of this plan should use. `uno.ts` reached
   the 800-line ceiling, so the AI moved to `ai.ts` — mechanical, re-exported by `index.ts`, no
   caller changed a line, and it is the third file `uno.ts` has shed after `stacking.ts` and
   `places.ts`; the simulation in step 4 will import from it. And the rotation surgery UNO_POT §2
   deferred raise/call/fold for is now DONE, so that slice is cheaper than it was written to be.
   **The deploy degrades benignly in BOTH directions, which is by construction and tested rather
   than hoped for.** A new client against an old referee reads no `finished`, `placesOf` normalises
   it to an empty podium, and every board renders exactly what it renders today — the toggle is a
   control that does nothing, which is a UI that lies, which is why the Pi still goes first. An OLD
   client against a NEW referee is the direction that decided a design: `UnoState.winner` is KEPT on
   the wire (derived, `roundOver ? finished[0] : -1`) rather than replaced by `finished` + an `over`
   flag, because "did the round end" is the only question an old client knows how to ask and
   removing the field would blank the result panel for every one of them during the window between
   the two deploys.
4. ~~**The house-odds simulation**~~ — **DONE.** `tests/uno-house-odds.test.ts` (8), and **no deploy
   of any kind**: it adds no shared code, touches no rulebook and moves no money, which is what makes
   it the one slice here that could be built and merged in a single pass. The answer is in §4.2 —
   the edge is real, `M = N × 2/3`, break-even 0.813, cleared by 22%.
   **Three things worth carrying into slice 5.** The bound is the **one-round** number, not the
   session one, because re-dealing to keep the lead is free (§4.2) — that is a design input, not a
   caveat. The measurement is a **lower bound on human skill** and always will be, so the margin is
   load-bearing and a future retune of `sharp` must come back here and re-read the table rather than
   widen a band. And the pricing guard is deliberately split in two: an absolute safety assertion
   (lift < 1.50, which must never be wrong) and a **review trigger** at 1.15 that fires long before
   the house starts losing, because every figure is seeded and a band pinned to the last measurement
   goes red on changes that move the number without moving the risk.
5. ~~**Betting the house**~~ — **BUILT.** `HOUSE_RETURN` and `housePayout` beside `potSplit` in the
   shared pot (imported by the harness that measured them, which is what turned slice 4's number
   into a price); `potBacking` naming who funds a table; `houseStakeFor` putting the house IN the
   pot; `rankedPayees` and `maxRoundPayout` guarding the settle; the referee pinning the tier;
   `manifest.betting.house` and `GameOption.pinnedForMoney` as the two manifest declarations the OS
   draws from; and the lobby's ante picker reaching an `ai` table at last. `tests/uno-pot.test.ts`
   (25), `tests/uno-house-bet.test.ts` (9) and `boardwalk-api/tests/uno.test.ts` (38).
   **Five things worth recording.**
   **The house's share is a STAKE, not a payout**, and that one framing is why nothing downstream
   acquired a case: the pot stays "the literal sum of what everyone put in" with the house as one of
   "everyone", so `potSplit` divides a pot that conserves and `voidMatch` refunds the players' half
   with the house's simply evaporating.
   **`rankedPayees` is the line the design did not see coming.** §3's rule is "the paying seats that
   PLACED, in the order they placed" — with ONE payer that is the lone player at every placement, so
   under `playToLast` the ordinary filter hands them the whole house pot for finishing fourth of
   five. It is most ranked rounds rather than a corner case. A house pot pays first place and
   nothing else, because a win rate is the only thing `HOUSE_RETURN` was ever priced against.
   **The ceiling bounds both modes with one number**, `ante × every chair`: a players' pot is
   `ante × payers` and payers never exceed chairs, and a house pot is `2/3` of the same product. So
   it never binds on an honest round — which is what a ceiling should do — and it CLAMPS rather than
   refusing, because a settle that threw would roll back its own transaction and strand the antes in
   a round nobody can finish.
   **`StoredMatch.level` had a docblock that stopped being true.** It argued a difficulty "cannot
   move a chip … the worst a hostile value could do is make the house play badly against the person
   who chose it", which held for every UNO table ever dealt and is exactly inverted here. Watch for
   that shape: a field is safe *because of* a fact, and the slice that changes the fact does not
   touch the field.
   **The OS restates the backing rule and is asserted to agree**, because `src/system/room` may not
   import a rulebook — it moves a bag it must not interpret, which is what keeps a second game's
   house rules from having to work around UNO's. `tableBacking` decides copy and locks, `potBacking`
   decides money, and `tests/uno-house-bet.test.ts` drives both over every table shape off the real
   manifest. Nothing there can pay the wrong amount, which is why it needs a test at all: a wrong
   payout announces itself in a ledger, and a lobby saying "winner takes the pot" at a table the
   house is banking is wrong forever and looks fine.
   **It is a money change in `boardwalk-api`, so the Pi went first** — unlike slices 2 and 4, and
   like slice 3, except that this one was deployed before its PR merged rather than after. The
   window it avoided is benign and named rather than hoped for: a new client at an old referee
   sends `anteCents` on an AI table, the old `potFor` floors a lone player to zero, and the lobby
   promises a pot nobody is charged for and nobody is paid. A UI that lies, and not a chip moved —
   which is precisely the argument for the ordering rather than against it. The currency check
   earned its keep in a new way too: comparing per-FILE hashes rather than one rolled-up digest
   said in a single step both that the Pi was behind by this slice and that it was otherwise
   current with `main`, where a single digest only ever says "different". Full evidence is in
   CLAUDE.md's Enforcement table.

Every slice ends green, and each of 2 and 3 is a **shared-rulebook change**, which means the Pi
carries it before the frontend that depends on it — the ordering rule Phase D paid ten minutes of
prod downtime to learn.
