# UNO house rules — stacking, ranked places, and betting the house

**Status:** DESIGN. No code yet. Written after [UNO_POT.md](UNO_POT.md) shipped, and it changes what
every one of these costs: the referee deals UNO now, so **three of the four items below are rulebook
changes that land on the Pi**, and the Pi goes first.

Asked for by the owner (and Steve). Decisions taken before any code:

| Decision | Answer |
|---|---|
| Where a house rule lives | **A create-time room parameter**, the road `anteCents` already built — not `manifest.options`. See [§1](#1-where-a-house-rule-lives). |
| Stacking | **+2 on +2 and +4 on +4.** Cross-stacking (+4 onto a +2) is a separate toggle, default off. See [§2](#2-stacking). |
| Ranked places | **A house rule (`playToLast`), default OFF**, so today's round is unchanged unless asked for. See [§3](#3-ranked-places). |
| Betting a bot table | **House odds with the bot tier PINNED** — Blackjack's model, not v1's faucet. See [§4](#4-betting-the-house). |
| The multiple | **Measured, not guessed.** A simulation sets it before the feature ships. See [§4.2](#42-the-number-is-an-empirical-question-not-a-design-one). |

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

### The trap that has to be tested

`drawCards` already stops early when the deck is dry and the discard cannot be recycled — that is a
friendly game simply stopping. With a stack it is not friendly: if the victim is owed 12 and the
deck yields 5, **`pendingDraw` must still reset to 0**. Leaving an unpayable debt on the table means
the next player is owed a stack nobody can pay, cannot play anything else, and the table hangs
forever on a turn only they can take — which is the same failure mode as an illegal bot move, one
step removed. The test asserts the debt clears even when the draw comes up short.

### The bots

`chooseAiMove` must answer a stack when it can. Both tiers stack — `sharp` deterministically,
`casual` picking randomly among its stackable cards — because the alternative for `casual` is a
tier that eats every +4, and CLAUDE.md's rule is that **a tier must never make the game
unwinnable**. That rule was paid for by UNO's own first `casual` draft. The guard is the same one:
play whole dealt games to a WINNER at both tiers with `stack` on, asserting every move changes the
state.

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

Two rules stop being about SEATS and start being about LIVE seats:

1. `seatAfter` must skip finished seats.
2. **A reverse acts as a skip at two LIVE players, not two seated ones.** This is the exact line
   [UNO_POT §2](UNO_POT.md#2-why-ante-only-first) named as the reason raise/call/fold was deferred —
   a folded seat leaves the rotation the same way a finished one does. **Doing ranked first makes
   the pot's slice 2 cheaper**, because the rotation surgery is done once and both features read it.

The round ends when `finished.length === liveSeatCount - 1`; the straggler is placed last without
having to play a final unwinnable hand against nobody.

### The pot

A pure shared `potSplit(potCents, places)` beside `potFor`, with the same conservation property
asserted as a property: **the split sums to exactly the pot at every table size and every stake**,
remainder to 1st, integer cents throughout. That is the one thing a percentage split gets wrong by
default, and the ledger cannot absorb a rounding error.

Stats: only 1st place counts as `won`. Placing 2nd of 4 is not a win, and inventing a
half-win would put a second meaning into a number four leaderboards already rank.

---

## 4. Betting the house

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

Until that number exists, this item is not ready to build. §1–§3 are.

---

## 5. Slices, and the deploy that comes first

**Slice 0 — the Pi is behind `main` right now.** UNO's dealer merged at 18:10 on 2026-08-05; the
last recorded deploy was 13:47 the same day. The frontend deploys on push and the Pi by hand, so
prod UNO is calling `unoStart` at a referee that may not know the frame. **Nothing below ships until
that is resolved**, and `/health` will not tell you either way — grep `dist/` for the symbol and
check the running PID postdates it ([pi-deploy-procedure]).

1. **House rules as a create-time room parameter** — the shared type, `resolveHouseRules`, the
   `create` frame, `RoomMeta`, `RoomListing`, the lobby toggles, the RTDB repo answering defaults.
   Ships with every rule OFF and therefore changes nothing observable: a pure seam, green, and
   independent of the three rules that will use it.
2. **Stacking** — the rulebook, its tests (including the dry-deck debt), the bots, the projection,
   the log, the board. Pi first, then merge.
3. **Ranked places** — `finished[]`, the live-seat rotation, `potSplit` and its conservation
   property, the result UI. Pi first, then merge. Makes the pot's slice 2 cheaper.
4. **The house-odds simulation** — a test that reports `sharp`'s true win rate per seat count, with
   and without stacking. Read the number, then decide whether §4 ships and at what multiple.
5. **Betting the house** — only if step 4 says the edge is real.

Every slice ends green, and each of 2 and 3 is a **shared-rulebook change**, which means the Pi
carries it before the frontend that depends on it — the ordering rule Phase D paid ten minutes of
prod downtime to learn.
