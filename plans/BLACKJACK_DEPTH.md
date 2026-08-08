# Blackjack's depth — the game that pays, and the three things it will not offer you

**Status: OPEN.** Written 2026-08-08. Three slices (§8). **ONE SLICE PER SESSION.**

[done/GAME_LAUNCH_MODAL.md](done/GAME_LAUNCH_MODAL.md) closed with a rider from the owner attached
to its Decision 3: *"right now Blackjack is very bare bones… it should be like that for all games,
you can make the modal then we can wire the stuff up later."* This is the wiring up. That plan owed
this one a surface to land on and delivered it — a game's pre-game choices are `manifest.options`
and the entrance draws them for free — so what is left is the part the modal cannot supply, which
is what the choices MEAN.

Boardwalk's Blackjack today: one seat, one stake, hit / stand / double, a fresh 52-card deck every
hand, dealt and settled by the referee. v1's: 1–4 seats, a dealer-stand "difficulty", and
insurance. Three gaps, and [done/GAME_LAUNCH_MODAL.md](done/GAME_LAUNCH_MODAL.md) §6 has a row for
this game reading *nothing yet* that has been waiting for them.

**None of the three is a UI job, and that is the whole reason this needs a plan rather than a
ticket.** Blackjack is the only game in the building where every hand moves real money out of the
ledger — there is no free mode, because `betting` is not optional here the way an UNO table's ante
is. So each of the three changes what the money does, and one of them changes what the money is
WORTH, which is a different kind of change and the one this document mostly exists for.

---

## The decisions, locked

| # | Question | Answer |
|---|---|---|
| 1 | Where does a dealer-stand tier live? | **`manifest.options` — the URL — and the REFEREE prices it.** Not `manifest.houseRules`: that seam is a create-time ROOM parameter and this game has no room, and it carries booleans where this is a three-way value. §2 |
| 2 | May a player choose the dealer's rule at a table that pays real money? | **Yes, once every tier is priced so that none is EV-positive.** Choosing which table you sit at is what a casino is. Choosing your own edge is a faucet with a dropdown. §4 |
| 3 | What prices a tier? | **The natural's payout**, computed by the referee from its own table. **Not** the bet range — v1 tied `minBet` to the tier, and a minimum changes the size of a bet, never the return per dollar. §4.2 |
| 4 | What decides the actual numbers? | **A measurement, not a judgement.** `tests/blackjack-house-odds.test.ts`, on the `tests/uno-house-odds.test.ts` precedent. **This plan deliberately names no payout.** §4.3 |
| 5 | Insurance | **A fourth `Move`.** Zero new routes, zero new request fields, and the one player decision in the repo whose outcome only the dealer can see. §3 |
| 6 | Seats | **Last, and separable.** It makes Blackjack the third referee-dealt game and the first dealt one with no pot. §5 |
| 7 | Split / surrender | **Out of scope** — v1 had neither, so neither is a GAP. §9 says what would change that, and §5.4 says why seats makes split cheap. |

**Deploy order: the Pi goes FIRST, on slices 1 and 2 both.** Each changes `packages/game-logic`
and `boardwalk-api`, the frontend deploys on push and the Pi by hand, and the failure is not benign
in the usual direction: a new client offering an **Insure** button to a referee that has never heard
of the move gets a 409 on a control the table is drawing. That is a UI that lies, which is the same
standard [done/GAME_LAUNCH_MODAL.md](done/GAME_LAUNCH_MODAL.md) §5.2 held `fillAi` to.

---

## 1. What v1 had — and the three defects one small feature was carrying

`games/blackjack/bj_app.js:489` is the insurance handler. It is eleven lines and it holds three
separate bugs, each of which this repo already has a rule for:

```js
const insBet = currentBets[activeSeat] / 2;
SystemUI.money -= insBet;
if (calculateScore(dealerHand) === 21) {
    SystemUI.money += (insBet * 3);
    SystemStats.recordWin("blackjack", insBet * 3);
```

1. **It reads the hole card in the browser.** `calculateScore(dealerHand)` sums both dealer cards,
   one of which the same file is drawing face down 160 lines away (`bj_app.js:650` —
   `isHidden = (index === 1 && …)`). The card was in memory the entire hand and the RENDERER hid
   it. Here that line cannot be written at all: `HandView.dealer` carries one card until the reveal
   and [`viewOf`](../packages/game-logic/src/games/blackjack/logic/view.ts) is the only road from a
   state to the wire.
2. **`/ 2` on an odd stake.** A float half-chip, in a currency that is integer cents — the exact
   sibling of the `parseInt` 3:2 bug this repo names in three places. Here it is
   `Math.floor(wagerCents / 2)` and it is house-rounded down for the same reason `payoutCents` is.
3. **`recordWin` on a side bet.** It records a WIN for the game, at 2:1 on half a stake, for a hand
   the player may be about to lose — and Blackjack has a mastery chain counting exactly that number.
   Here `recordOutcome` fires once per hand out of `settleHand`, and insurance must move money
   without going near it.

That is a good position for a feature this small: **all three of v1's insurance defects are already
either unspellable or already answered here**, so what is left to build is the rulebook, which is
the half v1 got right.

### 1.1 The difficulty that was three knobs in a trenchcoat

`savedDifficulty` is `"15" | "17" | "19"` and it drives three unrelated things:

- the dealer's stand value (`bj_app.js:122` carries its own prose copy of what the number means);
- `numDecks` — 1 / 4 / 6 (`bj_app.js:354`);
- `minBet` — $2 / $5 / $10 (`bj_app.js:186`).

**Keep one, throw two, and the two reasons are different.**

**Deck count is meaningless here, and it must stay meaningless.** `dealHand` shuffles
`shuffle(freshDeck(), rng)` on EVERY deal, so no card survives a hand and there is no count to
keep. A persistent shoe is the only thing that would make counting viable, and a counted shoe is
the one way a player legitimately takes an edge off a house that pays out of a real ledger. So the
fresh deck is not a simplification — it is load-bearing, and it is precisely what turns §4's
measurement into an upper bound rather than a guess (§4.1). Porting a deck-count knob would import
the exploit and call it a difficulty.

**The min bet is the tell that nobody computed anything.** Raising the floor at a friendlier table
changes the SIZE of a bet and not the return per dollar staked. A tier that is EV-positive is
EV-positive at $2 and at $10; a floor only makes the good table slower to get rich at. It has the
shape of a price without being one, which is worth naming because it is the obvious wrong answer
and it already shipped once.

### 1.2 And the labels were probably backwards

Nobody measured, and it shows. "Hard" is *stand on 19*, which means the dealer must HIT a 17 — a
hand that busts on any card above a four, which is 36 of the 52 in the deck. A dealer forced to
hit 17 and 18 busts constantly, and a dealer that busts pays everybody still standing. "Easy" is
*stand on 15*, which keeps the dealer on weak totals a player standing on 17 beats. **Both of v1's
non-standard tiers look player-favourable, and the "hardest" one looks like the most generous table
in the building.**

It cost v1 nothing, because its money was a client-side `SystemUI.money` that a devtools console
could set anyway. It would cost this one real chips.

**That paragraph is a claim and it is written as one on purpose.** It is what §4.3 measures, and the
plan does not depend on it: if it turns out false, the tier still has to be priced and the price
still has to come off a number nobody currently has. What would be indefensible is shipping the
selector on the strength of the reasoning above — that is how the tier got into v1.

---

## 2. Where a dealer rule lives, and why both existing seams are the wrong one

The repo has exactly two places a pre-game choice can go, and this choice fits neither cleanly.
Working out which one bends is most of the design.

**`manifest.houseRules` is the natural home and it does not fit twice over.**
[`houseRules.ts`](../src/system/room/houseRules.ts) is explicit that a house rule is stamped onto
the ROOM at create, *"exactly where `anteCents` rides, for exactly its reasons"* — so that a guest
can read the rules before taking a chair. Blackjack has no room, no guest and no chair, so the
mechanism has nothing to attach to. And the bag is `Record<string, boolean>` deliberately: *"There
is no `type` field and no default. Every house rule is a boolean."* A dealer-stand value is a
three-way choice. Growing that seam a value type to fit one solo game is the wrong direction — it
is a room mechanism, and this is not a room.

**`manifest.options` fits mechanically and is disqualified by the rule this repo states about it,
right up until the referee prices it.** The options seam already carries a per-game pre-game choice
in the URL, and [../CLAUDE.md](../CLAUDE.md) is blunt about its one limit: *"a difficulty cannot move a chip,
cannot name an outcome, and the worst a hostile value does is make the house play badly against
whoever sent it."* A dealer-stand value fails all three clauses at once. It is not that a hostile
client could send a bad one — it is that the HONEST control is the exploit, because picking the
table with the lowest edge is simply the correct play.

**So the resolution is not a seam, it is a price.** The tier rides `manifest.options`, and every
tier a client can name is one the referee has priced so that it is not worth choosing for free.
Once that is true the options rule is satisfied literally: the worst a value does is make the house
play badly *at a payout that already accounts for it*.

This is worth stating plainly because it is a first: **the tier is the first client-named value in
this repo that changes what a hand PAYS.** UNO's `level` is the closest thing and it is not close —
a difficulty prices nothing at a free table, and the moment UNO's house started banking a lone
player the tier was PINNED (`HOUSE_TABLE_LEVEL`) rather than priced, precisely so a player could not
choose the odds they were paid at. Pinning is unavailable here: every Blackjack hand has a stake,
so a pinned tier is a control that never appears. Pricing is the only door left, and it is the one
a real casino uses.

---

## 3. Insurance — the one decision only the dealer can settle

### 3.1 The wire cost is zero, and that is the design

Insurance is a fourth `Move`. `POST /blackjack/move {nonce, handId, move: 'insure'}` — no new
route, no new field, and the property the whole seam rests on is untouched: **there is still no
card, no outcome and no payout anywhere on either request body.** A player says *insure*; the
referee, which is the only party holding the hole card, decides what that cost and what it paid.

The stake is `Math.floor(wagerCents / 2)` and it is checked and committed exactly as a double's
second stake is — `checkStake` before any write, `commitStake` after nothing can refuse, its own
`wagers` row named by `hand_id`. An unaffordable insurance is refused whole and leaves the hand
playable, which is the ordering [`domain/blackjack.ts`](../boardwalk-api/src/domain/blackjack.ts)
already earns for the double and states the reason for: *a `return` out of a better-sqlite3
transaction COMMITS.*

It resolves **immediately**, inside the same call, because the dealer peeks. Either the dealer has
a natural — the hand is over, the insurance pays 2:1, and the main stake loses — or it does not,
the side stake is gone, and the hand continues.

### 3.2 What the projection gains

Two fields on `HandView`, and no more:

- `canInsure: boolean` — the rulebook's own predicate, the `canDouble` sibling, so the board never
  re-derives the offer. It depends on the up-card, the player's card count and whether they have
  already insured, **all of which are public**. It cannot be a function of the hole card, and the
  guard for that is that it takes the same `BlackjackState` and is asserted to be identical across
  two states differing only in `dealer[1]`.
- `insurance: { stakeCents, paid } | null` — what was staked and what it returned, so the board can
  say so. `null` until a player insures.

### 3.3 The one place this game deliberately reveals what it was hiding

A resolved insurance tells the player one bit about the hole card: whether it is a ten. That is
correct — **it is what they paid to find out** — and it is worth writing down because every other
sentence in this repo about this game says the opposite. The distinction is that the bit is bought,
priced, and only ever released by the referee as the result of a decision the player made. A
`canInsure` that depended on the hole card would leak the same bit for free, which is why §3.2
pins it.

### 3.4 The defect this uncovers: the dealer never peeks

Insurance is the dealer peeking for a natural, and asking for it exposes that **Boardwalk's dealer
does not peek at all**. [`reducer`](../packages/game-logic/src/games/blackjack/logic/blackjack.ts)'s
`deal` case settles on a PLAYER natural and returns `dealt` otherwise — the dealer's own two cards
are never asked about. So a hand against a dealer natural plays on: the player hits, may double,
and only at the end does `settle` return `lose`.

`settle` itself is right and is asserted right (`tests/blackjack.test.ts:137` — *"dealer natural
beats a non-natural 21"*). Nothing asks it at deal time, which is why this is invisible: every
assertion about the rule passes, and the rule is never consulted at the moment it matters.

**It costs the player money, in exactly one place.** Hitting into a lost hand is free. **Doubling is
not** — `canDouble` is true on the opening two cards regardless, so a player can put a second stake
down against a hand that was already over, and `settle` takes both. A real table ends the hand
before anyone acts and takes one stake. So this is the house quietly collecting a second stake it
is not owed, on a hand nobody can see is finished, and it has been live since Phase D.

The fix is the peek, in the reducer, in the same slice as insurance because it is the same rule:
a dealt dealer natural settles at the deal. It moves the edge a little in the player's favour,
which is a correction rather than a knob, and §4.3's measurement runs after it so the numbers price
the game as corrected.

---

## 4. The dealer-stand tier — measured, then priced

### 4.1 Why the bound available here is stronger than UNO's, and why it is the fresh deck that buys it

`tests/uno-house-odds.test.ts` measures POLICIES rather than people, so every rate it produces is a
**lower** bound on what a human extracts, and the safety of that feature rests on an argument about
how short the unmeasured tail is.

Blackjack is the other way round, and it is the better way round. With a fresh 52-card deck every
hand there is no count, so **basic strategy is optimal — not "good", optimal** — and a proxy playing
it is an **upper** bound on human EV rather than a lower one. That is the strongest form of this
argument the repo has been able to make, and it is available only because `dealHand` reshuffles per
deal (§1.1). It is also the reason the deck-count knob must never be ported: a persistent shoe
would put the tail back and turn the bound over.

Two honest caveats, both of which the harness has to carry rather than the prose:

- A proxy that is only NEARLY basic strategy is a bound that is only nearly the ceiling, in the
  wrong direction. So the harness must assert its proxy beats a naive baseline (mimic-the-dealer),
  which is `uno-house-odds`'s *"`sharp` genuinely beats `casual`"* case doing the same job — without
  it, a proxy with a bug measures a house edge that is not there.
- Optimal basic strategy depends on the DEALER'S RULE, so the proxy has to take the tier. A proxy
  that plays S17 strategy at an S19 table understates what a real player takes at that table, which
  is the failure that would let the generous tier through.

### 4.2 The lever is the payout, and there is only one sane one

A tier needs a price the referee applies in the same transaction as the deal. Three candidates:

1. **The natural's payout.** 3:2 at the standard table, 6:5 or lower at a friendlier dealer. It is
   what real casinos actually use, it is integer arithmetic of exactly the shape `payoutCents`
   already has, and it lands on the hand where the edge was given away. **This is the one.**
2. A rake on wins. Not a thing any casino calls a table rule, and it would need a new ledger reason.
3. A bet floor. v1's answer, and §1.1 is why it is not one.

The consequence to accept up front: `payoutCents` gains an argument. It is `payoutCents(result,
wagerCents)` today and becomes a function of the table as well, which is churn at every call site
— the board's "+$37.50 this hand" line included. **That churn is the feature**, in the same sense
[done/UNO_HOUSE_RULES.md](done/UNO_HOUSE_RULES.md)'s `canPlay(card, table)` churn was: a call site
that can still compute a payout without saying which table it was at is a call site that will
quietly keep quoting 3:2 at a 6:5 table, and the screen disagreeing with the ledger is worse than
either being wrong.

### 4.3 What the harness answers, and what this plan refuses to name

**No payout appears in this document, and that is deliberate.**
[done/UNO_HOUSE_RULES.md](done/UNO_HOUSE_RULES.md) §4 refused to name its multiple for the reason
that applies here word for word: the number IS the safety of the feature, and a number written down
by someone reasoning about it in prose is a number nobody measured.

`tests/blackjack-house-odds.test.ts` — N seeded hands per candidate tier, through the REAL reducer
and the REAL settle path, with a basic-strategy proxy. What it must produce:

- **The house edge at every tier, at that tier's proposed payout, is ≥ 0.** The absolute safety
  bound, and the only one that matters. A tier that cannot be priced non-negative does not ship.
- **The standard table is unchanged.** S17 at 3:2 is what is live today, and the tier landing must
  not retune the game anybody is already playing — the *default is what already shipped* rule that
  AI difficulty follows.
- **The ordering.** Which tier is actually friendliest, so the LABELS are not v1's (§1.2). A
  control whose "Hard" pays best is worse than no control.
- **A review trigger separate from the safety bound**, at a margin above the measured figure rather
  than pinned to it — every number is seeded, and a band pinned to the last measurement goes red on
  a shuffle change that moved the number without moving the risk. `uno-house-odds` makes the same
  split for the same reason.

And it must import the tier table rather than restate it, which is the correction slice 5 of the
UNO house rules made to its own harness: while the constant lived in the test, the bound was a
bound on a number the ledger did not necessarily pay at.

### 4.4 The referee still does not trust the client, and the tier and its price are ONE record

The deal request names a tier **id from a closed set** — never a raw stand value, which would let a
client name a rule nobody priced. The referee looks the id up in its own table and takes BOTH
halves from it.

**One record, both halves, in `packages/game-logic` so the browser and the referee read the same
one.** A tier applied with the standard payout is the entire faucet, and it is one missing lookup
away at all times. This is the `PRICES_CENTS`-derived-from-`CATALOG` rule: *priced on one side and
not the other* stops being a state the system can be in, by construction rather than by a parity
test.

**An unknown or absent tier id reads as the STANDARD table.** That is the deploy-order default: an
old client sends none, and the honest answer to "which table is this" from a request that does not
say is the one that has always been there.

---

## 5. Seats — the third dealt game, and the first dealt one with no pot

### 5.1 What it is

Blackjack stops being room-less: `modes` gains `'ai'` and `'online'`, `seats` becomes a real range
(v1's was 1–4), it mounts `<Lobby>`, and the referee grows a dealer beside
[`unoDealer.ts`](../boardwalk-api/src/rooms/unoDealer.ts) and `liarsDiceDealer.ts`. Every seat bets
its own stake, the table acts in turn order, and the dealer plays out ONCE for everybody.

### 5.2 What it does NOT need, which is most of what UNO needed

This is the cheerful half, and it is why seats is a slice rather than a plan of its own:

- **No private channel at all.** Every player's cards are face up in blackjack. The only hidden
  card is the dealer's hole card and it is hidden from *everyone equally*, so it stays in
  `state_json` and never reaches the projection. UNO's `hands/` node and its per-seat `writeHand`
  have no caller here. A dealt multiplayer game with no private information is strictly simpler
  than the two that exist.
- **No pot.** Every seat settles against the HOUSE independently, so `potFor`, `potSplit`,
  `rankedPayees` and `maxRoundPayout` acquire no case. There is no split to conserve and no
  placement ladder.
- **No house-banking question.** The house has banked this game since it existed, at odds that are
  already priced — which is what §4 is about — so `betting.house`, `HOUSE_RETURN` and the "two
  humans or no betting" rule are all untouched. A lone player at a blackjack table is the ordinary
  case, not the faucet risk it is at UNO.
- **No new payout ceiling.** One seat pays at most 2.5× its own stake, comfortably inside
  `DEFAULT_PAYOUT_MULTIPLE`'s 3×.

What it DOES need, and what will actually cost the session: per-seat betting (v1 hit a real bug
here — *"pushing the whole gameState here let two players betting at once clobber each other's
bets"*, `bj_app.js:162` — which is arbitrated away by construction once the referee owns the
table), turn order with a seat that has busted or stood, and bots that play a seat without stalling
the table (the *"a bot's move must be one the reducer ACCEPTS"* rule).

### 5.3 The coverage claim moves, and it moves to a game that already carries it

[../CLAUDE.md](../CLAUDE.md) calls Blackjack *"the economy proof, a room-LESS game"*, and half of that stops
being true here. It is fine, and the reason is that the claim was already double-covered: Solitaire
is the room-less proof (`modes: ['solo']`, no seats, no bankroll), and it is the better one, because
it proves the seam carries a game with no economy either. Blackjack keeps the half that was only
ever its own — the economy, the payouts, the server-dealt hand. The doc edit is part of the slice,
not a follow-up.

### 5.4 What it makes cheap, and the reason to do it before split

Seats turns `HandView` from one hand into a table of hands with an active index. **Split needs
exactly that shape** — one seat, several hands, one active. So if seats lands, split is a rulebook
change against a projection that already exists; if split lands first, it is the same refactor done
for one seat and then done again. That is the whole argument for this ordering and it is why split
sits in §9 rather than being declared impossible.

---

## 6. What does not change

- **A game still receives `{ onExit }` and nothing else.**
- **The request bodies still have no field for a card, an outcome or a payout.** Insurance adds a
  move name; the tier adds an id from a closed set. Both are decisions. Neither is a result.
- **`viewOf` is still the only road from a `BlackjackState` to the wire**, and `HandView` still has
  no `deck` field to forget to strip.
- **`checkSettle` still refuses `blackjack` outright** (`SERVER_DEALT_GAMES`). None of this reopens
  the client-settled road, and seats does not add a second one.
- **The offline table keeps up.** [`local/blackjackRepo.ts`](../src/system/repo/local/blackjackRepo.ts)
  runs the same shared reducer, so every rulebook change lands there for free — but the TIER TABLE
  is shared code too, which is what stops the offline twin quietly paying 3:2 at a 6:5 table. Seats
  is the exception and it is stated rather than papered over: a dealt multiplayer game exists only
  on the WS path, exactly as Liar's Dice and UNO do.

---

## 7. What each slice owes a guard

Every row is a failure that typechecks, lints and renders.

| Guard | Why it is not obvious |
|---|---|
| `tests/blackjack.test.ts` — **the peek**: a dealt dealer natural settles AT THE DEAL, `canDouble` is false on it, and the player loses ONE stake and not two | §3.4. `settle` is already asserted correct in isolation and the reducer never asks it, so every existing assertion passes while the house takes a second stake it is not owed |
| `tests/blackjack.test.ts` — **insurance**: offered only on an ace up with two cards, never twice, stake is `floor(w/2)` on an ODD wager, pays 2:1 **plus** the stake back, and a losing insurance costs exactly the side stake and changes the hand's result by nothing | v1's three defects, one assertion each. The odd wager is the `parseInt` chip; the "changes nothing" case is what stops a side bet leaking into the main settle |
| `tests/blackjack.test.ts` — `canInsure` is **identical across two states differing only in `dealer[1]`** | The offer must not be a function of the hole card. A predicate that peeked would leak the bit §3.3 says is bought, and it would look completely correct |
| `boardwalk-api/tests/blackjack.test.ts` — insurance moves through the LEDGER with its own `wagers` row closed by `hand_id`, an unaffordable one is refused whole leaving the hand playable, replay pays once, and **`recordOutcome` still fires exactly ONCE per hand** | The `recordWin` defect: a side bet that records a win inflates `played`/`won` and the mastery chain that counts them. The refusal case is the `return`-out-of-a-transaction-COMMITS trap the double already pays for |
| `tests/blackjack-house-odds.test.ts` — the measured edge at every tier and its proposed payout is **≥ 0**; the standard table is unchanged; the proxy **beats a mimic-the-dealer baseline**; the proxy takes the TIER | §4.3. A proxy weaker than a real player turns the upper bound into a lower one and inverts the entire safety argument — and it would do so silently, by measuring an edge that is not there |
| `tests/blackjack-house-odds.test.ts` — the harness **imports** the tier table rather than restating it | Slice 5 of the UNO house rules made exactly this correction to its own harness: a bound on a restated constant is not a bound on what the ledger pays |
| `packages/game-logic` — a tier's rule and its payout are ONE record, and a test asserts every declared `manifest.options` choice for the tier resolves to one | §4.4. A tier applied at the standard payout is the faucet, and it is one missing lookup away |
| `boardwalk-api/tests/blackjack.test.ts` — an **unknown or absent** tier id deals the STANDARD table | The deploy-order default. An old client sends none, and a referee that guessed generously would pay a rate nobody chose |
| `tests/game-options.test.ts` (existing) | Acquires a new subject for free: unique ids, the default is one of the choices, and the URL round trip. Nothing to write — but check it went red when you broke it, because a sweep over the registry is the kind of guard that silently stops covering a game |
| `boardwalk-api/tests/blackjackGateway.test.ts` (slice 3) — every seat sees every player's cards and **no seat sees the hole card**, a non-seated socket is refused, and a bot seat is driven by the REFEREE | The dealt-game shape, minus the private channel. The hole card is the only hidden thing and it is hidden from everyone, which is easier to get right and just as fatal to get wrong |

Falsify each before trusting it.

---

## 8. Slices

**ONE SLICE PER SESSION.** Each ends green, with its guards, and leaves the app shippable.

**Slice 1 — insurance, and the peek.** The reducer settles a dealt dealer natural; `'insure'`
joins `Move`; `canInsure`/`insurance` join `HandView`; the referee stakes, resolves and settles it
in the transaction it already runs. The board grows one button and one line. **Pi first.** Ends
with a game that plays the hand a real table plays, and with the house no longer taking a second
stake off a double against a natural.

**Slice 2 — the tier, measured and priced.** The harness and the tier land TOGETHER, because a
constant arriving before its reader is `loadout.color` and because the harness is what decides
whether the tier ships at all. `payoutCents` takes the table; the tier table lives in
`packages/game-logic`; the referee reads both halves from it; `manifest.options` declares the
choices and the entrance draws them with no code. **Pi first.** Ends with
[done/GAME_LAUNCH_MODAL.md](done/GAME_LAUNCH_MODAL.md) §6's *nothing yet* row replaced.

**Slice 3 — seats.** Blackjack becomes the third dealt game: `modes` gains `'ai'`/`'online'`, the
lobby, a dealer on the referee, per-seat stakes, turn order, bots. **Optional, and last.** If it is
never taken, slices 1 and 2 stand on their own and this document still closed the gap the owner
named.

---

## 9. Deliberately out of scope

- **Split, and resplit.** v1 had neither, so neither is a gap — and the projection shape it needs
  is the one seats builds (§5.4). It becomes cheap exactly once, and this is the ordering that
  makes it so.
- **Surrender.** Same category as split, minus the shared refactor. It is a pure rulebook addition
  whenever somebody wants it.
- **A persistent shoe / deck count.** Refused with a reason (§1.1), not merely skipped: it would
  reintroduce counting and turn §4.1's upper bound into a lower one.
- **Per-game persistence of the chosen tier.** V1_FEATURE_GAPS #10's `localStorage` item, and the
  same answer the launch modal gave: the URL survives a navigation, not a week.
- **Any change to how Blackjack is entered.** The modal already draws whatever this declares.
