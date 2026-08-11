# Live house rules — changing the game without changing the round

The server half PR #91 deliberately left out. `<GameRules>` already renders a table's house rules
in-game, read-only, and its docblock names exactly what was missing: *"a new wire frame, a relaxation
of that write-once guard, and a hand deploy to the Pi before any client may draw the control."*

This is that slice.

---

## 1. The fairness call — host-only, and the invariant that decides it

**Decision: HOST-ONLY.** Not the `<Rematch>` unanimity pattern.

The write-once rule exists so that *nobody changes the game under a player who already sat down*.
The question is whether "it lands at the next round" is enough to keep that promise, and whether
guests should get a veto.

**What write-once was actually protecting.** House rules were never a thing guests voted on. At
create the host picks them alone; a guest consents by SITTING DOWN at a table whose rules are
advertised — on the public listing (`listOpen()` carries `houseRules`), in the setup panel, and
since PR #91 in `<GameRules>`. The invariant was never "guests have a say". It was **"the game you
are playing right now cannot change beneath you."**

That invariant is untouched here, and it is untouched *by construction* rather than by promise:
`deal` stamps the resolved rules onto the match (`UnoGame.houseRules`, which is why they survive a
restart and live in `uno_matches.state_json`). A round in flight is played under what it was DEALT
with, and no room-level write can reach it. §3 asserts that rather than assuming it.

**So what would unanimity buy?** A veto over the host's table settings that guests never had at
create. It would be inventing a new power in order to defend an invariant that is not under threat —
and it would cost real things:

- **It stalls.** A host ticks Stacking and nothing happens until four people vote. The control looks
  broken. `<Rematch>` gets away with a stall because a rematch has no state to be in the meantime;
  a half-agreed rule does.
- **It is a second handshake for one consent.** The deal that carries the new rules ALREADY requires
  every human seat to press Ready — `<Rematch>` is unanimous, and UNO's next round comes through it
  (`Board.tsx` renders `<Rematch restart={dealAgain}>` inside `<GameResult>`). So a player who
  dislikes the change declines the deal, or leaves. Gating the change too asks the same table for
  the same permission twice.

**The escape hatches, named.** Decline the rematch; leave the table (`<ExitGame>`, one control, in
the header). Both are pre-existing and neither needed anything added.

### What this decision is CONDITIONAL on

Host-only is only defensible if the change is **visible before the next deal**. A rule that lands
silently makes the rematch vote nominal. So the announcement is load-bearing, not decoration — §4.

### What deliberately does NOT change: the ante

`anteCents` stays write-once. The two are not the same kind of fact:

- A rules change alters **what game** you are playing. It shapes play and nothing else.
- An ante change alters **what it costs**, and the ante is charged automatically inside the deal's
  own transaction at whatever the room says. The blast radius of getting it wrong is a ledger row.

Nobody asked for a changeable stake, money gets the conservative default, and "you could decline the
next round" is a thin argument to put in front of somebody's bankroll. If it is ever wanted it is its
own slice, with its own evidence.

---

## 2. The frame, and why it carries no more than it does

`{ t: 'setHouseRules', gameId, roomId, houseRules: unknown }`.

- **Host-only at the gateway**, the shape `onSetStatus` already has.
- **`unknown`, sanitised by the SAME `sanitizeRules` the create path uses** — one boundary, not two
  that can disagree. The server still does not learn what a rule MEANS; it bounds the shape (literal
  `true` only, ids under 32 chars, at most 16) and nothing else. That is the property
  `plans/done/UNO_HOUSE_RULES.md` §1 rests on and this slice does not spend.
- **No `round` field, no `applyAt`, no "pending" record.** The next-round property is a consequence
  of `deal` stamping the match, so there is nothing to schedule and no second copy of the rules that
  could drift from the room's. A `pendingRules` field would be exactly the second source of truth
  this repo keeps deleting.

**Deploy order: the Pi goes FIRST.** A client drawing an editable toggle at a referee that has never
heard of the frame gets a refusal on a control the table is showing — the "UI that lies" failure,
which bit the one-chair blackjack table in PR #91 and was found only in a browser. The reverse is
inert: an old client never sends the frame.

---

## 3. Relaxing write-once to exactly one writer

The existing guard asserts house rules survive seats / status / state / presence. It is **narrowed,
not deleted**: those four paths must still leave the rules alone, and the new writer must be the only
thing that moves them. The test that used to say "nothing changes them" now says "these four do not,
and `setHouseRules` does" — a stronger statement than either half.

**The claim that must be ASSERTED rather than assumed** (the user's word, and the right one): a rules
change during a live round does not touch the running match, and the NEXT deal picks it up. That is
`deal`-stamps-the-match doing its job, but "free by construction" is how a defect ships. So the API
suite drives it end to end: deal under rules A → change the room to B mid-round → the match still
reads A → deal again → the match reads B.

---

## 4. The announcement — where it goes, and two places it must not

Host-only is conditional on visibility (§1), so this is part of the decision rather than polish.

**Not the UNO move log**, which is where this was first proposed. The log is derived from `UnoEvent`s
inside the match projection, which the REFEREE stamps by diffing the game either side of a move. A
room-level rules change would have to be synthesised into a game's state by the OS — crossing the
exact boundary that keeps `src/system/room` free of rulebooks and the server free of knowing what a
rule means. It would also be UNO-only, so game #7 inherits nothing.

**Not chat.** `ChatMessage` is uid-pinned and `database.rules.json` requires `uid === auth.uid`. A
system message needs a synthetic author — a rules change and a hand-run deploy, for a line of text.

**The room snapshot, which already carries it.** `houseRules` rides on `RoomMeta` and is broadcast to
every subscriber the instant it changes, so the announcement costs no wire field at all. Two
surfaces, and they are different kinds on purpose:

- **Persistent** — the lobby's header line and the `<GameRules>` panel both derive from `meta`, so
  the new set is on screen for anyone who looks up late. This is the UNO colour-pill argument: *a
  timer shows the answer only to whoever was looking.*
- **Transient** — a toast when the bag changes under you, which is the "it just happened" beat a
  persistent label cannot give.

### The lie this would otherwise ship

During a live round the header reads the ROOM's rules while the round is being played under the
MATCH's. Those differ for exactly as long as a change is pending, and the header would state the new
set as though it were in force — a UI that lies, in this repo's precise sense.

The OS cannot read the match's rules (state is `unknown` to it, and must stay so). It does not need
to: it can distinguish them by **time**. While `status === 'playing'`, the room's set is labelled
*from the next deal*, and the panel says the round in progress keeps what it was dealt with. That is
true without the OS knowing a single thing about UNO.

---

## 5. What a guest sees

The read-only panel PR #91 shipped, unchanged, plus the time label. A guest is never shown a control
the referee would refuse — the same rule that kept the toggles out of PR #91 in the first place.
