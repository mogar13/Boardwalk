# UNO's pot — the ante, and the deal moving to the referee

**Status:** IN BUILD. Slice 1 of the pot: **ante at the deal, winner takes the pot.** Raise / call /
fold is deliberately a second slice — see [§2](#2-why-ante-only-first).

Decisions taken by the owner before any code:

| Decision | Answer |
|---|---|
| Scope | **Ante-only first.** Raise/call/fold lands on a working dealt UNO. |
| The ante amount | **The host picks it**, v1's ladder (NONE / $25 / $100 / $500 / $1K). |
| Who deals | **The referee.** The money and the cards move together — there is no other option. |
| The house anteing for bots | **No.** v1 did; it is a faucet. See [§3](#3-why-bots-do-not-ante). |

---

## 1. Why the referee must deal it

Two independent reasons, either one fatal on its own.

**The ceiling.** A 4-seat $25-ante table pays $100 on a $25 stake — **4×**. The generic `/settle`
ceiling is **3×** (`DEFAULT_PAYOUT_MULTIPLE`). A 7-seat table pays 7×. Raising the ceiling so a
client-dealt game can pay itself is the move the Money section exists to refuse, and it would raise
it for every game that shares the constant.

**The dealer is a player.** UNO is host-as-dealer: `useUnoHost.ts` holds every hand *and* the draw
pile in one client's memory. That is already stated as a cost, and for a game with no stakes it is a
cost worth paying. Add money and it stops being a cost and becomes the end of the game — the same
argument that put Liar's Dice on the referee, one word changed:

> a host who can see every cup is a player who cannot lose

So `useUnoHost.ts` is **deleted**, not kept beside the new path. Leaving it as an RTDB fallback would
be two dealers running two copies of the rulebook, which is the drift this repo has a lint rule
about, and "the cheapest way to defeat a cutover is to leave the road it replaced standing."

### The cost, named rather than papered over

**UNO stops working on the RTDB fallback** (`VITE_WS_ROOMS=0`), exactly as Liar's Dice never worked
there. The board renders "UNO needs the game server" instead of degrading, because the only available
degradation is one player's browser holding everyone's hand. This is a real loss — UNO is a flagship
game and the fallback exists to be flipped on during a Pi outage — and it is accepted because during
a Pi outage there is no ledger either, so a betting UNO could not have paid anyone anyway.

---

## 2. Why ante-only first

The pot as v1 built it is a poker layer: raise on your turn, everyone else owes call-or-fold when
their turn comes round, three raises a round, capped at 3× the ante, short stacks shove and stay in,
no side pots. That is a genuinely good design and it is **slice 2**.

The reason to split is not size, it is blast radius. **Ante-only touches the UNO rulebook not at
all** — antes are taken at the deal and the pot is paid at the win, and `logic/uno.ts` never learns
either happened. Raise/call/fold does touch it: a folded seat leaves the turn rotation, so
`getNextPlayerIndex` changes, and a reverse acts as a skip once only two players are **live** rather
than two **seated**. That ripples into the 604-line reducer, its 30 tests, the move log, the seat
layout and the direction ring.

Doing both at once means a failed browser pass has two suspects — the dealt migration or the poker
layer — and the dealt migration is the risky half. So: dealt UNO with a pot first, green and
verified; the poker layer onto a known-good base.

---

## 3. Why bots do not ante

v1's comment is explicit: *"The house antes for each bot so the pot matches what the player put
up."* On a 4-seat table that means the player stakes $25, the house adds $75, and the winner takes
$100 — **a $75 grant on a coin flip**, funded by nobody.

That is a faucet, and this repo has a rule about faucets that cost a whole plan to get right
(`refillGrantFor` — a top-up **to** a floor, never a grant **of** an amount, precisely so no
sequence of them leaves anyone richer). A house-funded pot fails that test on the first hand.

So: **bots do not ante, and betting needs two humans.** Below that the table plays for XP and stats
alone and the lobby says so — Liar's Dice's rule, for Liar's Dice's reason (one human's pot is their
own ante handed back, and a betting UI that cannot move a chip is worse than none).

---

## 4. Where the ante lives — and why `unoStart` has no field for it

The owner chose a host-picked ante, which raises a question a fixed ante does not: **a guest must
know the stake before they sit down.**

`manifest.options` is the declared seam for a pre-game choice, and it is the wrong one here.
CLAUDE.md says why in the sentence that describes its one limit:

> the values live in `<GameShell>`, which is per-client, and today's only room-game option is read
> exclusively by the host … the day a guest must read one, it belongs in room state

An ante is that day. So the ante is **a create-time room parameter**, riding the road `seatCount` and
`visibility` already ride:

- `RoomRepo.create(gameId, { seatCount, host, visibility, anteCents })`
- the server's `Room` holds it; `RoomSnapshot.meta.anteCents` publishes it to every subscriber
- the lobby draws the picker beside the table-size picker, at **create** time
- `RoomListing.anteCents` puts it on the poster, so the hub reads "$25 table" before anyone joins

**Create-time, not lobby-mutable**, for the reason the table-size picker is create-time — with more
force. A table cannot grow a chair under someone who joined by code; a table must **certainly** not
raise the stakes under them. v1 let the host retune the ante in the lobby and pushed it to the room
on change, which means the number you agreed to when you sat down was not the number you paid.

### The consequence, which is the best part

Because the referee holds the room, it already knows the stake. So:

```ts
| { t: 'unoStart';  id: number; gameId: string; roomId: string; nonce: string }
| { t: 'unoAction'; id: number; gameId: string; roomId: string; nonce: string; move: unknown }
```

**`unoStart` has no field for a stake**, where `ldStart` carries `anteCents`. That is not tidiness;
it closes a hole Liar's Dice has. A client that names its own ante can name a large one: a hostile
host sends `anteCents: 100000000`, every seat is charged $1M for a game they agreed to at $25, and
the game is *fair* — it is simply at stakes nobody consented to. Taking the stake from the room's own
record makes that unspellable rather than validated, which is the Money rule applied one level up:
no frame in this game has a field for a card, a winner, a stake or a payout.

(Liar's Dice's own `ldStart` should follow. Out of scope here — noted in [§9](#9-follow-ups).)

---

## 5. Where state lives

Three tiers, the Liar's Dice split exactly:

| Tier | Holds | Where | Survives restart |
|---|---|---|---|
| Match | every hand, the draw pile, the discard, turn, direction | SQLite `uno_matches.state_json` | Yes |
| Public projection | top card, hand COUNTS, turn, direction, colour, log events | gateway room `state` (in memory) | No — rebuilt |
| Private | **your hand only** | gateway room `privates[seat]` (in memory) | No — rebuilt |

`toPublic` already exists and already hides every card behind sentinels; it moves from the client
host to the referee unchanged, which is the Phase-D payoff — the projection a client used to compute
is now computed by the server from the same lines of code.

```sql
CREATE TABLE IF NOT EXISTS uno_matches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    TEXT NOT NULL,
  room_id    TEXT NOT NULL,
  state_json TEXT NOT NULL,
  pot_cents  INTEGER NOT NULL,
  settled    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS uno_players (
  match_id   INTEGER NOT NULL REFERENCES uno_matches(id) ON DELETE CASCADE,
  uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  seat       INTEGER NOT NULL,
  ante_cents INTEGER NOT NULL,
  PRIMARY KEY (match_id, uid)
);
```

Both **new tables, so neither needs a `COLUMN_MIGRATIONS` entry** — `CREATE TABLE IF NOT EXISTS`
reaches an existing database. `wagers.match_id` and `mutations.match_id` already exist (Phase E added
them with their migration entries), so this build adds **no column to any existing table** and the
migration surface is zero.

Authority by **membership**, never by id: a match has no owner, so every load joins `uno_players`.

### A round is a match

UNO differs from Liar's Dice in one structural way: a table plays **many rounds**, and the OS's
`<Rematch>` service starts the next one. Each round is its own pot, so each round is its own
`uno_matches` row with its own antes and its own settle. v1 gated this with `payAnteIfNeeded(roundId)`
so a resync could not double-charge; here the nonce does that job, and the rematch handshake is
already everybody-must-ask, so nobody is anted into a round they did not agree to.

---

## 6. Money

- **Stake:** `appendLedger(uid, 'uno', -ante, 'bet')` + a `wagers` row naming the match, per human
  seat, inside the start transaction. A player who cannot cover refuses the **whole start** — nothing
  is dealt and no stake is taken. *Nothing is written until nothing can refuse* (a `return` out of a
  better-sqlite3 transaction COMMITS; only a throw rolls back).
- **Settle:** `appendLedger(winner, 'uno', +pot, 'settle')`, close every wager **by match id**, then
  the shared `recordOutcome` for stats/XP/achievements.
- **Void:** a boot sweep refunds every live match's antes, because the room is in memory and the
  antes are not.
- **`'uno'` joins `SERVER_DEALT_GAMES`** in the same commit that teaches the referee to deal it, so
  `POST /bet` + `POST /settle` refuse it outright.
- **…so the board stops calling `reportResult`.** The referee banks the stat, the XP and the
  achievements inside the settle transaction. What the client still needs is the authoritative
  profile at the two moments money moves: the **deal** (every human antes, but only the host sends
  `unoStart`) and the **settle** (a BOT's move can trigger it, so no client made a request at all).

---

## 7. Slices

Each ends green.

1. **The ante as a create-time room parameter** — `create` frame, server `Room`, `RoomMeta`,
   `RoomListing`, the lobby picker, the RTDB repo reporting `0`. Independent of everything else.
2. **Pure pot logic** in `packages/game-logic/src/games/uno/logic/pot.ts` — `potFor(seats, ante)`
   and the conservation property. Small now; it is where slice 2's stakes/folds land.
3. **Schema + `domain/uno.ts`** — `startMatch` / `playMove` / `settleMatch` / `voidMatch` /
   `sweepAbandonedMatches`, load-by-membership, nonce discipline.
4. **`rooms/unoDealer.ts`** + the two frames + `SERVER_DEALT_GAMES` + bot driving on the referee's
   own timer. Tests over a real socket.
5. **The client** — delete `useUnoHost.ts`, add `UnoRepo`, board becomes a renderer, `reportResult`
   goes, `manifest.betting` arrives.
6. **Browser pass**, two accounts, ledger checked to the cent.

---

## 8. Deploy order

The Pi deploys by hand and the frontend deploys on push, so **the Pi goes first**. No rules change
this time (the RTDB path never carries an ante), so `database.rules.json` is untouched and there is
no Firebase deploy in this build.

1. Pi: rsync `packages/game-logic` as a sibling **and** `boardwalk-api`, build on the device, run the
   suite there, restart.
2. Verify from the **artifact**: `dist/domain/uno.js` present, `.tables` shows `uno_matches`, and the
   running PID started after those files were written. A `/health` check proves nothing and a 401 on
   a bogus route proves nothing (auth runs before routing).
3. Only then merge the frontend.

---

## 9. Follow-ups

- **Raise / call / fold** — slice 2, the poker layer. The reducer change is the real work.
- **`ldStart` should stop carrying `anteCents`** for the reason in §4. One frame, one field, and
  Liar's Dice gets the same "a client cannot name its own stake" property UNO ships with.
- **The generic dealt-game seam.** `types.ts` deferred a `GameSessionRepo<TState>` until a second
  server-dealt room game existed. This is it. Build `UnoRepo` concrete first, then look at the two
  side by side — extracting before both exist is what that note warns against.
</content>
</invoke>
