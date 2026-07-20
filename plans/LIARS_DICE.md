# Liar's Dice — the referee-dealt game

**Status:** BUILT 2026-07-19, green and browser-verified. **Not deployed** — the Pi and the rules
both go by hand, and both go before the frontend merges. See [§9](#9-deploy-order).

Written 2026-07-18 as a design. What follows is that design with the corrections contact with the
code forced. Four things changed, and the last two were found only by playing it:

1. **The protocol delta was smaller than planned.** §5 predicted new server→client frames and a
   fourth registry in `socket.ts`. None was needed: the projection rides the existing `room`
   broadcast and each cup rides the existing owner-only `private` channel. **Two frames in, zero
   out**, and the client transport was not touched at all.
2. **`patchState` was worse than "worth fixing regardless".** Its comment claimed an authorisation
   the code did not perform, so any authenticated socket with a four-character room code could
   overwrite any room's entire state. Fixed in slice 1, and falsified.
3. **The repo answering `void` was wrong.** §5 argued the state arrives over the subscription so an
   action need not answer — true of the STATE, false of the PROFILE. Two accounts anted a dollar
   each in a real browser, the ledger recorded both, and both top bars went on saying $5,000.
   `start`/`act` answer with the authoritative profile, exactly as blackjack's do.
4. **The board must not call `reportResult`.** The plan did not consider this and it is the sharpest
   consequence of a dealt game: the referee records the outcome inside the settle transaction, so a
   report is a client claiming a result the server already banked. `checkSettle` refuses
   `liars-dice`, so it could not double-count — it simply toasted "settled by the dealer, not by a
   claim" at every player at the end of every match.

And one that predates this phase entirely: an empty room was collected the instant its presence set
emptied, so React StrictMode's double-mount killed a table the moment it was created. **No WS room
game could be developed locally at all.** Fixed with the grace crash-recovery already established
for seats, applied to `unpresence` and deliberately not to a socket close.

The sixth game, and the first one that is neither host-dealt nor room-less. It exists because
someone wants to play it — see [Scope discipline](../CLAUDE.md#scope-discipline--the-rule-most-likely-to-be-violated),
which is still the governing rule and is not repealed by this document.

But it is also the game that forces two questions the codebase has been carrying openly:
[ROADMAP item 4](ROADMAP.md#4-a-sixth-game--only-if-one-sounds-fun) names both — the `dice`
cosmetic with no reader, and non-Blackjack outcomes still being self-reported. This build answers
both, because a bluffing game that bets real chips cannot be built any other way.

---

## The decisions, locked

Taken by the owner 2026-07-18, before any code:

| Decision | Answer |
|---|---|
| Rules over v1 | **Spot-on call**, **proper wild-ones raising**, **palifico rounds**. Loser-leads-next-round declined. |
| Betting | **Yes** — real chips. |
| Who holds the match | **The gateway.** The referee rolls, deals, reduces and settles. |
| The `dice` cosmetic | **Built alongside**, closing the kind that has had art and no reader since P2. |

The betting decision is what makes this a backend phase rather than a game slice. It is called
**Phase E** below, and it is roughly 3–4× the build UNO was.

---

## 1. What v1 was, and why "upgraded" means "built"

`Game-Room/games/liars_dice/` is 598 lines across three files. Read for reasoning, not ported —
the usual rule.

**It has no multiplayer.** The HTML initialises the Firebase SDK and exports handles to `window`;
the app never reads them. `currentRoomId` and `isHost` are declared and never used. Commit `8b8c5a5`
removed the online option outright, leaving the comment:

> Online removed: it was never implemented (the lobby opened but no game data ever synced, so both
> players hung after the first bid).

**Two- and three-player games are unwinnable.** `dieCounts` is hardcoded `[5, 5, 5, 5]` regardless of
`playerCount`, and the win check is `dieCounts.filter(c => c > 0).length <= 1`. In a 2-player game
seats 2 and 3 sit at five dice forever, so the count never drops below 2. The human can be reduced to
zero dice and the game simply calls `startRound()` again. **Only 4-player games can reach the win
branch at all.**

The same root cause corrupts the AI: `totalDiceInPlay` sums all four seats, so in a 2-player game
`unknownDice` is ~15 instead of ~5, `expectedOthers` is 5 instead of 1, and the bot essentially never
calls LIAR.

**Other defects worth recording**, because this file's rules are paid for by defects:

- No turn authority. `handleBid`/`handleLiar` trust `activeTurn` and a CSS `pointer-events` gate;
  calling `handleBid()` from the console during a bot's turn attributes your bid to the bot.
- `handleLiar()` has no reentrancy guard, so a double-click decrements the loser twice and queues two
  round-start timers.
- The 4.5s reveal timer is never cancelled — leaving to the lobby lets the game restart itself.
- `getDicePrefix()` reads `SystemProfile.data.inventory` into a variable it never uses and
  unconditionally returns `"dieWhite_border"`. **This is `loadout.color` again**: a cosmetic read with
  no effect. It is the direct ancestor of the `dice` kind this build finally gives a real reader.
- Stats are never recorded — `system_stats.js` is loaded and never called.

**And the bid ladder is broken**, which matters because it is a rule and not a bug in the usual
sense. v1 orders faces `[2,3,4,5,6,1]` and treats 1s as merely the top of that order, so "three 1s"
is a one-step raise over "three 6s" despite being vastly harder to make. That is what the wild-ones
upgrade below fixes.

---

## 2. The rulebook

Pure, in `packages/game-logic/src/games/liars-dice/logic/`. Tests before any UI, as always.

### Base

- **5 dice per player**, 2–6 players. Lose one per lost challenge; at zero you are out.
- Every surviving player re-rolls all their dice at the start of each round.
- A **bid** is `{quantity, face}`, claiming that many of that face across *all* dice on the table.
- **1s are wild** — they count as every face — except in palifico (below).
- The round ends when someone **challenges** or **calls spot-on**.

### Raising

A legal raise is a higher quantity at any face, or the same quantity at a strictly higher face.
Face order within a quantity is `2 < 3 < 4 < 5 < 6`.

**Wild-ones conversion** — the upgrade v1 lacks. Because 1s are wild they are roughly twice as hard
to make, so the ladder converts rather than treating 1s as a sixth face:

- Switching **to** 1s: the new quantity must be at least `ceil(current / 2)`.
- Switching **off** 1s: the new quantity must be at least `current * 2 + 1`.

So "seven 5s" → "four 1s" is a legal raise, and "four 1s" → "nine 6s" is the cheapest way back out.
This is the standard Dudo rule and it makes 1s a real decision instead of a free top-of-ladder.

### Spot-on

A third action alongside bid and challenge: **claim the bid is exactly right**.

- Correct → **every other player** loses a die.
- Wrong → **the caller** loses a die.

Deliberately asymmetric: challenging costs one player one die, spot-on costs everyone else one
each. It is the high-risk play and it is what gives a losing position a way back.

> **Open, decided in play:** some variants let a correct spot-on caller *regain* a die instead
> (capped at 5). Regaining is more forgiving and lengthens matches. Starting without it —
> everyone-else-loses-one is already a large swing — and it is a one-line change if matches feel
> too short.

### Palifico

When a player drops to **exactly one die**, the next round is palifico:

- **1s are not wild.**
- The opener names a face, and that face is **locked** for the whole round — subsequent players may
  only raise the quantity.

Classic Dudo, and it is what stops a one-die player being purely dead weight.

### Round and match end

- The loser of the challenge drops a die. At zero dice they are eliminated.
- **Last player with dice wins the match.**
- Turn order after a round: v1's "seat 0 always opens" is kept (loser-leads was declined). Noted here
  because with palifico and elimination it may read oddly in play; switching to loser-leads is one
  line in `startRound`.

### The reducer

Total and pure, the UNO/Chess contract: an illegal action returns the state unchanged, so the
referee can hand any wire action straight in without pre-validating it.

```
deal(seatCount, rng)            → LiarsDiceMatch
applyAction(match, seat, action, rng) → LiarsDiceMatch   // total; illegal ⇒ unchanged
chooseAiAction(match, seat, rng)      → Action
viewFor(match, seat)            → LiarsDicePublic        // see §4
```

`Action` is `{type:'bid', quantity, face} | {type:'challenge'} | {type:'spotOn'}`.

**The AI is a real upgrade, not v1's one-integer difficulty knob.** v1's bot always raises quantity
by exactly one, always swings the face to its own best face (telegraphing its hand every turn), and
never bids 1s. The replacement bids from the binomial expectation over unknown dice, sometimes raises
face instead of quantity, and bluffs at a rate that varies by how many dice it has left. All
deterministic given an injected rng, so it is unit-testable — the same seam
`chooseAiMove` uses in UNO.

---

## 3. Why the gateway deals, and not the host

UNO is **host-as-dealer**: one client holds every hand and projects a public view. That was right for
UNO and is wrong here, for two independent reasons.

**The host can see everyone's dice.** In UNO that is already true and already stated as a cost. In a
*bluffing* game it is not a cost, it is the end of the game — the host wins every challenge. UNO
tolerates it because a leaked hand loses you a card; here a leaked cup loses you the match and the
pot.

**Outcomes would be self-reported.** ROADMAP item 4 says it plainly: Chess, UNO, Solitaire and
Tic-Tac-Toe get away with self-reporting because payout is forced to `0`, so a dishonest client can
inflate its level but not its bankroll. Add `betting` to a client-held room game and that stops being
true. The payout ceiling in `checkSettle` bounds the theft; it cannot stop it, for exactly the reason
`domain/blackjack.ts:5-12` gives:

> no ceiling can, because "did this player actually win" is not a question you can ask about a number.

Gateway-as-dealer also closes two things for free: a host reload no longer loses the game
(`useUnoHost.ts:88-91` states that exposure openly), and the dealer is no longer a player.

### The fit is better than expected

Three facts make this much less speculative than it sounds:

1. **The gateway is in the same process as the database.** `server.ts` builds one `openDb`, one
   Express app, one `TokenVerifier`, and attaches the `WebSocketServer` to the same HTTP server.
   `RoomGateway`'s constructor takes only `verifier` today — giving it `db` is **one argument in
   `server.ts:38`**. `better-sqlite3` is synchronous, which composes cleanly with the gateway's
   synchronous message handling.
2. **The API already imports game rulebooks.** `boardwalk-api/src/domain/blackjack.ts:46` imports
   from `@boardwalk/game-logic/games/blackjack`. Phase D built exactly this road.
3. **No new server→client frame is needed.** The gateway already pushes `room` (public state) and
   `private` (owner-only, re-authorised on every push). The dealer writes the projection to room
   state and each player's dice to their private node, and both fan out through paths the client
   already handles. **The client's `socket.ts` needs no new push registry** — which is the change I
   most expected to be forced and turns out not to be.

So the client-side board looks almost exactly like UNO's, minus `useUnoHost.ts`.

### The hole that must be fixed first

[gateway.ts:250-257](../boardwalk-api/src/rooms/gateway.ts#L250-L257):

```ts
private onPatchState(conn: Conn, id: number, gameId: string, roomId: string, data: unknown): void {
  // Any seated participant may advance state (the turn-owner, or the host-as-dealer). The server
  // owns the seq bump, so a client cannot rewind or skip ordering.
  if (!this.store.has(gameId, roomId)) return this.reply(conn, id, { ok: true });
  this.store.patchState(gameId, roomId, data);
```

**The comment describes an authorization the code does not perform.** It checks neither seating nor
turn. Any authenticated socket with a 4-character room code can overwrite any room's entire state.

Today that is griefing, not theft — no game on this path bets. But it is a standing bypass of
everything below, and it is the same shape of defect as leaving `POST /settle` open for Blackjack:
the new road works perfectly while the old one stays open beside it.

**Fixed in slice 1, before anything else**: `patchState` requires the caller to hold a seat in the
room. Liar's Dice actions do not use it at all — they get their own turn-checked message types.

---

## 4. Where state lives

Three tiers, and the split is the design:

| Tier | Holds | Where | Survives restart |
|---|---|---|---|
| Match | every die, the bid, whose turn, dice counts | SQLite `liars_dice_matches.state_json` | Yes |
| Public projection | bid, counts per seat, turn, phase, eliminated | gateway room `state` (in memory) | No — rebuilt from the match |
| Private | **your dice only** | gateway room `privates[seat]` (in memory) | No — rebuilt from the match |

The match blob follows the Blackjack precedent exactly (`schema.ts:145-148`): opaque JSON, because
nothing queries inside a match and the shape is owned by the shared reducer, so columns would be a
second definition that could drift.

**But the Blackjack schema encodes an assumption that must be broken.** `blackjack_hands.uid` is both
owner and only participant. A match has many participants, so:

```sql
CREATE TABLE IF NOT EXISTS liars_dice_matches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    TEXT NOT NULL,
  room_id    TEXT NOT NULL,
  state_json TEXT NOT NULL,
  settled    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS liars_dice_players (
  match_id   INTEGER NOT NULL REFERENCES liars_dice_matches(id) ON DELETE CASCADE,
  uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  seat       INTEGER NOT NULL,
  ante_cents INTEGER NOT NULL,
  PRIMARY KEY (match_id, uid)
);
```

Both are **new tables, so neither needs a `COLUMN_MIGRATIONS` entry** — `CREATE TABLE IF NOT EXISTS`
does reach an existing database. Only a new *column* on an *old* table silently never lands
(`schema.ts:245-248`). The `match_id` columns added to `wagers` and `mutations` **do** need entries,
and that is the trap this build must not walk into.

Every load is scoped by membership, never by id alone — the Blackjack rule (`blackjack.ts:112-119`)
that "an id is not a secret, so the query must carry the authority," adapted from ownership to
membership.

### The projection

`viewFor(match, seat)` in `packages/game-logic/src/games/liars-dice/logic/view.ts`, written once and
imported by every call site, because `view.ts:9-15` already records what happens otherwise:

> Three copies of "what may a client see" is three chances to reveal a card, and the two that are not
> the referee's are the ones nobody would think to audit.

`LiarsDicePublic` **has no field for another player's dice** — absent, not filtered. It carries per-seat
*counts*, the current bid, turn, phase, palifico flag, and eliminations.

**The reveal phase is new and has no precedent here.** UNO never publishes previously-private state.
Liar's Dice must: when a challenge resolves, every cup opens. That is modelled as a phase on the
match (`'bidding' | 'reveal'`) with the projection carrying a `revealed` array that is empty during
bidding and complete during reveal. It is the *match* that decides, not the renderer — a client must
never be sent dice it is merely expected not to draw.

### Restart, stated honestly

The room is in memory; the match is durable. If the Pi restarts mid-match the room is gone and the
match cannot continue — but antes have already left the ledger.

**So: on boot, every unsettled `liars_dice_matches` row is voided and every ante refunded**
(`appendLedger(+ante, 'void')`), in one transaction per match. Not silently — the row is marked
settled so it cannot be refunded twice. This is the only honest option: the alternative is
reattaching players to a room that no longer exists, and the alternative to *that* is stranded
wagers, which is exactly the class of bug the ledger design exists to prevent.

---

## 5. The protocol delta

**Client → server**, new in `protocol.ts`, all request/reply with an `id`:

```ts
| { t: 'ldStart';  id: number; gameId: string; roomId: string; nonce: string; anteCents: number }
| { t: 'ldAction'; id: number; gameId: string; roomId: string; nonce: string; action: LdAction }
```

**Server → client**: nothing new. The dealer writes state and privates through the store and the
existing `room` / `private` broadcasts carry them.

**Absent by design**, the Blackjack discipline: neither frame has a field for a die, a face count, an
outcome, a payout, or another player's anything. `uid` is absent too — it comes off the verified
socket (`conn.uid`), never the wire.

Authorization on `ldAction`, all before any write:

1. The socket's uid holds a seat in this room (membership).
2. That seat is the current turn.
3. The match is live and in a phase that accepts the action.

Then `applyAction` runs, and being total, an illegal action changes nothing and answers `ok`.

### Idempotency, and the part that is *not* like Blackjack

Every action carries a nonce and claims it through the existing `mutations` table
(`INSERT OR IGNORE` + `changes`, `mutations.ts:87-115`). This is not optional here: `socket.ts`'s
outbox queues frames with drop-oldest and `onReady` replays subscriptions on reconnect, so an action
frame can genuinely be sent twice.

**But dice rolls are random, so the "replay = do nothing and re-read" pattern is wrong** — the same
reasoning `pack_opens` exists for. A replayed action must re-serve the *persisted* outcome, not
re-run the reducer against a fresh roll. `mutations.match_id` pins which match a nonce acted on, and
the answer is the match state as it stood after that action.

And the hazard that has its own paragraph in `blackjack.ts:210-215`, restated because it will bite
here too:

> **a `return` out of a better-sqlite3 transaction COMMITS — only a throw rolls back.** So "refuse and
> change nothing" is not something the transaction gives us for free; it is something the order of
> these statements has to earn. **Nothing is written until nothing can refuse.**

Every refusal path calls `releaseNonce` so a retry is possible.

---

## 6. Money

**Ante at match start, winner takes the pot.** Each human seat stakes `anteCents` when the host
starts; the last player standing is paid the whole pot.

- Stake: `appendLedger(uid, gameId, -ante, 'bet')` + a `wagers` row naming the match, per human seat,
  all inside the start transaction. Any player who cannot cover the ante refuses the **whole start** —
  nothing is dealt and no stake is taken.
- Settle: `appendLedger(winner, gameId, +pot, 'settle')`, close every wager **by match id**, then the
  shared `recordOutcome` for stats/XP/achievements — one function, not a second copy, so money and
  stats cannot diverge.
- A player who leaves mid-match forfeits their ante to the pot. Their seat is handed to an AI by the
  existing grace-timer path, so the table survives.

**Bots do not ante.** They have no bankroll. That produces one rule worth stating plainly:

> **Betting requires at least two human seats.** A table of one human and five bots plays for XP and
> stats only — the pot would otherwise be your own ante handed back to you, which is a betting UI
> that cannot move a chip.

`manifest.betting` is present, so `<BetRack>` mounts; the lobby hides the stake control when the
table has fewer than two humans.

### Closing the old road

`'liars-dice'` joins `SERVER_DEALT_GAMES` in `domain/economy.ts:158`, so the generic
`POST /bet` + `POST /settle` route refuses it outright at any amount. Without that, Phase E is opt-in
rather than enforced and the bypass is trivial.

**Timing is a deploy hazard, not a style choice** — the docblock is explicit: a game earns its place
on that list *the moment the referee can deal it*, not before, or a live client is refused mid-match
with nowhere to go. It lands in the same deploy as the dealer.

---

## 7. The `dice` cosmetic

The kind has been named and deliberately withheld since P2. `catalog.ts:19-22`:

> `dice` and a chip skin both have abundant art in the trove and NO reader — no dice game exists...
> Staging art for them "while the union is open" is precisely the `loadout.color` mistake in its most
> tempting form.

This build is the reader. **The catalogue rows and `useEquippedDice()` land in the same commit** —
that is the whole rule, and shipping the rows first would recreate exactly the defect being closed.
(v1's own `getDicePrefix()`, which reads inventory and returns a constant, is the ancestor.)

Art is already in the tree at `public/assets/dice/` — 24 PNGs, four complete sets of six faces
(white, red, white-bordered, red-bordered). Curated into `public/dice/` following the
`public/felts/` convention, that is a four-row ladder and no more; anything beyond four sets needs
sourcing from the wider trove.

**Dice take the card-back shape, not the felt shape.** A felt can be absent — `feltSrc(undefined)` is
`null` and the table is bare. A die must always draw a face, so there is a **free-starter default**
(`dc_white`) and `diceSrc(unknown)` falls back to it rather than 404ing. The hook returns the **id**
and `<Die diceId pips>` takes it as a prop, so other players' dice can be drawn with their own set
later without component surgery — the `<Avatar frame>` reasoning.

The full per-kind checklist (catalogue, registry, `Equipped`, rules, API column + migration, store
UI, seven test files) is long and mechanical; it is derived from P5 and lives in the slice list
below rather than being restated here.

**One test will break rather than fail to exist**: `tests/database-rules.test.ts:353-360` currently
uses `dice: 'dc_ivory'` as its *stray key* example proving `$other: false`. Once `dice` is a real key
that write starts succeeding. The stray key moves to `chip`, the remaining deferred kind, and the
test is renamed to "a SEVENTH kind."

---

## 8. Slices

Each ends green. Roughly in dependency order.

1. **Fix `patchState` authorization.** Seat-membership check, plus a test that a non-seated socket is
   refused. Independent of everything else and worth landing alone.
2. **The rulebook.** `packages/game-logic/src/games/liars-dice/` — reducer, wild-ones ladder,
   spot-on, palifico, elimination, AI, `viewFor`. Tests before any UI: the bid ladder at every
   conversion boundary, spot-on both directions, palifico's locked face and wilds-off, totality,
   immutability, and the projection asserted **structurally** (`'dice' in view === false`, plus a
   `JSON.stringify` scan — the failure guarded against is a *field appearing*).
3. **Schema + match store.** The two tables, `match_id` on `wagers`/`mutations` **with their
   `COLUMN_MIGRATIONS` entries**, load-by-membership, the boot-time void-and-refund sweep.
4. **The dealer.** `db` into `RoomGateway`, `ldStart`/`ldAction`, turn authority, nonce discipline,
   projection + private deal through the existing broadcasts, settle through `recordOutcome`,
   `SERVER_DEALT_GAMES`. Tests over a real socket, following `gateway.test.ts`'s harness.
5. **The client.** Manifest (`modes: ['ai','online']` — no hot-seat, hidden dice and one screen
   contradict), `<Lobby>` wrapper, board, bid controls, reveal animation, `LiarsDiceRepo` as its own
   interface (**not** bolted onto `RoomRepo`, which would obligate the Firebase repo to implement it).
6. **The `dice` cosmetic.** The P5 checklist end to end, including the rules change.
7. **Browser pass.** The memory recipe: emulator + a real browser, both modes, two accounts each
   seeing only their own dice, zero console errors. Static green is not enough and never has been.

---

## 9. Deploy order

The Pi deploys by hand and the frontend deploys on push, so **the Pi goes first** — merging Phase D
before deploying it broke prod Blackjack for ten minutes.

1. `npm run rules:deploy` **from a tree that has the change**, then read it back with
   `GET /.settings/rules.json`. A deploy from the wrong checkout succeeds identically and prints the
   same green line. Until the rules ship, production refuses *every* profile write carrying `dice` —
   which is every write a player makes once the new frontend is live, not merely equips.
2. Pi: rsync `packages/game-logic` as a sibling **and** `boardwalk-api`, build on the device, run the
   suite there, restart. Verify `PRAGMA table_info(profiles)` shows `equipped_dice` and
   `table_info(wagers)` shows `match_id`. The artifact is the evidence; `/health` is not — it answers
   identically under every phase.
3. Only then merge the frontend.

---

## 10. What was verified, and how

Static green was not evidence: 651 frontend and 279 API tests passed while the game was unplayable.
Driven against the emulator and the real referee in two real browsers.

| Claim | Evidence |
|---|---|
| Each player sees only their own cup | Two accounts, one table: 25 hidden dice and five own faces on BOTH pages, and no opponent face on either at any point before a reveal |
| The public state carries no dice | Every `room` frame scanned — no `"dice"` anywhere in the serialised payload |
| The reveal is a phase the rules own | Seven consecutive reveals opened every cup (`hidden: 0`) and closed again |
| Palifico is real | Fired on its own when a player reached one die; the "wild" label left the face picker |
| The referee drives the bots | Five bots each raised with no client asking; a bot's cup written nowhere |
| The antes leave the ledger | Two humans at $4,999.00 each, ledger `bet -100` twice, pot 200 — UI and ledger agree to the cent |
| The pot arrives | B challenged, the table showed 0, A lost their last die: B's UI read **"You win $2.00" at $5,001.00**, A's $4,999.00, `settle +200`, match settled, **zero** open wagers, stats played=1/won=1 against played=1/won=0 |
| Nothing else broke | Zero console errors beyond a pre-existing `GET /profile` 404 at signup |

A full match is ~25 die-losses with a 4s reveal each, so the payout case set the table and took the
antes for real and then forced the last round directly in SQLite — the referee re-reads the row on
every action, so the finish itself was ordinary and fully refereed. Said plainly because it is the
one assertion above that did not come from playing the whole game.

## 11. Open questions

- **Spot-on regain.** Everyone-else-loses-one to start; regain-a-die is a one-line change if matches
  run short.
- **Loser leads.** Declined for now. If seat-0-always-opens reads wrong in play with palifico live,
  it is one line in `startRound`.
- **Table size.** `Lobby.tsx:80` creates rooms at `seats.max` and `canStart` requires a full table, so
  a Liar's Dice table would always seat six with bots filling. A variable table size has no seam
  today. Either accept always-six, or add one — and if added, it is OS work that UNO wants too.
- **The generic seam.** `types.ts:329-334` says a `GameSessionRepo<TState>` was deliberately not
  invented because it had one caller: "When a second game is dealt server-side, THAT is when the shape
  of the general one is knowable." This is that second caller. **Build `LiarsDiceRepo` concrete
  first**, then look at the two side by side — extracting the general one before both exist is the
  mistake that doc is warning about.
