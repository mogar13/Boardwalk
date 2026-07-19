# Offline replay-hardening — the design

**Written 2026-07-18.** Item 1 in [ROADMAP.md](../ROADMAP.md), owed since Phase B, never built. This
document answers the five design questions before any code exists, because the scope decision
(**FULL: server-signed nonces, unbounded offline duration**) has more surface to get wrong than to
write.

**BUILT, DEPLOYED AND ENFORCING IN PRODUCTION (2026-07-18).** See [What shipped](#what-shipped) for
the evidence — the replay attack failing against the live Pi, the one real bug the browser pass
caught that 584 green tests did not, and the deploy-order mistake this document made and then had
to correct on a running system.

---

## The finding that reframes the job

**There is no offline queue today, and therefore no replay hole today.**

The locked Phase-B decision (2026-07-17) is that offline wins are ranked with sync-on-reconnect. It
was never implemented. What actually happens when an economy write fails is one branch in
`applyEconomy` (`src/system/auth/authStore.ts`):

```ts
} catch (error) {
  if (get().profile === optimistic) set({ profile: prev });
  throw error;
}
```

The optimistic profile reverts, the caller toasts "check your connection", and **the intent — nonce
included — goes out of scope and is gone.** There is no outbox, no `navigator.onLine`, no service
worker, no persisted intent, no retry, anywhere in `src/`. Every one of the six nonce mint sites
mints inside the dispatch callback, so a "retry" would be a *different* nonce and the server's
idempotency would not even engage.

This changes the shape of the work in a useful direction. The ROADMAP frames this as hardening an
existing hole; it is really **building the banking mechanism and its bound in the same commit**. The
hole never has to exist. That is strictly better than retrofitting, and it is why the honest title
of this work is "offline banking, bounded" rather than "replay-hardening".

It also means the guard is falsifiable in the strongest way available: the replay test can bank a
result offline, re-send it, and assert the ledger moved once — against a path that has never been
able to move it twice, rather than against a regression.

---

## What this buys, and what it does not — read before scoping

Being precise here, because the neighbouring claims are easy to overstate.

**Already closed, and not by this work:**

- A forged *payout* is refused by `checkSettle` — a settle with no open wager pays 0, and a payout
  over the per-game ceiling is refused with the wager left open.
- A forged *badge* or *grant* is unspellable: `/settle` has no `unlockedAchievementIds` and no
  `grantedItemIds`, and the server recomputes from its own tables.
- Blackjack — the one game that can win money — is refused by `/settle` outright
  (`SERVER_DEALT_GAMES`). The server deals it.

So **an offline queue cannot mint chips today even with unlimited forged nonces.** The money paths
are bounded by the ledger balance and the recorded wager, neither of which a nonce influences.

**What an unbounded offline queue *would* let a dishonest client do:** inflate `xp`, `played` and
`won` for the four non-betting games by banking arbitrarily many "wins" that never happened. That is
the leaderboard, not the bankroll.

**What signed tickets actually buy, stated without inflation:**

1. They make offline banking possible at all — the locked decision, currently unbuilt.
2. They **bound offline-minted work**: a client offline with a 64-ticket batch banks at most 64
   results, not 64,000.
3. They make the queue replay-safe by construction — the ticket is the idempotency key, persisted
   with the intent, so a flush and a re-flush collapse to one effect.
4. They give a provable per-device order, so a gap is visible rather than invisible.

**What they do NOT buy, and no ticket scheme can:** they do not make a self-reported outcome true. A
client that is *online* can already spam `/settle` for chess with fresh tickets, refilling its batch
each time. Closing that is [ROADMAP item 4's](../ROADMAP.md#4-a-sixth-game--only-if-one-sounds-fun)
much larger job — the server holding the match. **Tickets bound the offline surface to the online
surface; they do not shrink the online one.** Anyone reading this later should not mistake the
mechanism for a solution to outcome-forgery.

**Proportionality.** There is currently 1 real player — the owner's own account. The work is worth
doing because the whole backend exists to make chips un-forgeable and a second road to the same
place should not be left open; it is not worth an alerting pipeline, a device-approval UX, or a
revocation console for a single-player deployment. Where a choice below is cheaper than its
"proper" version, that is why, and it is named.

---

## The mechanism, in one paragraph

**A ticket is a signed nonce, and it goes in the `nonce` field.** The server issues a batch of
opaque strings, each an HMAC over `(uid, deviceId, seq)`; the client spends one per intent by
putting it where the client-minted nonce used to go. The server verifies the signature and the uid,
then claims it in `mutations` exactly as it claims a nonce today. Spend-once is unchanged —
`mutations(uid, nonce)` with `INSERT OR IGNORE` inside the work's own transaction — because a ticket
*is* a nonce that the client could not have made up.

**`EconomyIntent` does not change. Not one field.** This matters more than it looks: the property
that no intent has a place to put a balance, a price, an XP amount, a stat count, a clock, a seed or
an item survives untouched, because a ticket is still just an opaque idempotency key. The wire shape
of `/bet`, `/settle`, `/purchase`, `/daily`, `/pack` and both blackjack routes is byte-identical. The
only new route is the one that hands out tickets.

---

## Question 1 — where does the signing key live, and what happens on rotation?

**The key.** A 256-bit random secret in `TICKET_SECRET`, read by `readConfig` alongside the existing
env, living in the Pi's systemd environment file beside `GOOGLE_APPLICATION_CREDENTIALS`. Not
committed, not in `.env.example` as a value, generated once with `openssl rand -base64 32`.

HMAC-SHA256, not an asymmetric signature and not a JWT. `src/auth/verify.ts` opens with "identity
stays in Firebase Auth… do NOT hand-roll JWTs", and that rule is right and stays: a ticket is **not
an identity**. It is a bearer coupon that is only meaningful when presented *alongside* a verified
Firebase token for the uid it was issued to. Nothing is authenticated by a ticket; a ticket only ever
narrows what an already-authenticated request may do. That is why a symmetric MAC verified by the one
process that issues it is the right primitive and a JWT would be borrowed ceremony.

**Rotation: two keys, a `kid` in the ticket, and an overlap window.**

- `TICKET_SECRET` — the current key. Signs new tickets, verifies.
- `TICKET_SECRET_PREVIOUS` — verifies only. Never signs.

Each carries a short key id (`k2`, `k1`) baked into the ticket, so verification selects a key rather
than trying both — trying both is how a retired key quietly stays live. Rotating is: move the current
value to `TICKET_SECRET_PREVIOUS`, generate a new `TICKET_SECRET`, restart. Tickets signed under the
old key keep verifying until the *next* rotation drops it. There is no rotation schedule and there
should not be one for a single-player deployment; the mechanism exists so that a leaked key has a
remedy that is not "invalidate every outstanding ticket at once".

**If `TICKET_SECRET` is absent, ticket enforcement is OFF** and the server accepts client-minted
nonces exactly as it does today. This is a fail-open on a security control and it needs its
justification stated rather than assumed:

- It is a **kill switch in the shape this repo already uses** — `VITE_API_ECONOMY=0`,
  `VITE_WS_ROOMS=0`, `VITE_API_BLACKJACK=0` — and the Pi deploys by hand, so a deploy that lands the
  code before the env var must degrade to today's behaviour rather than 401-ing every money route on
  the live site.
- The control **is not what protects money.** Per the section above, the ledger balance, the recorded
  wager and the server-dealt blackjack are what protect money, and none of them depends on this.
  Fail-open costs the *offline bound*, not the bankroll.
- Failing closed here would mean a missing env var takes the economy down. That is a worse outcome
  than the thing it prevents.

It logs loudly at boot (`configProblems` gets a non-fatal warning line) and `/health` reports
`tickets: 'on' | 'off'` so the state is checkable from the artifact rather than inferred — the
[health-is-not-deploy-evidence](../../CLAUDE.md) lesson applied to this feature's own switch.

---

## Question 2 — how many tickets, and what happens on exhaustion? (the "unbounded" reconciliation)

This is the tension the scope decision creates, and the answer is that **"unbounded" was true on the
wrong axis.**

> If nonces are server-issued and the client may be offline indefinitely, it must bank using tickets
> obtained *before* going offline — so it holds a batch — and a batch is exactly the thing that
> bounds how much forgeable work exists.

The reconciliation: **duration is unbounded; volume is not, and cannot be.**

- **Offline duration: genuinely unbounded.** A ticket has no expiry. A device offline for a year
  reconnects and its year-old tickets still verify (subject only to key rotation, Q3). Nothing in
  this design expires an unspent ticket.
- **Offline volume: bounded at the batch size, and this is inherent.** Any scheme where the server
  issues the right to bank must issue a finite number of them in advance. The only way to make
  volume unbounded is to let the client mint — which is the hole. So the honest sentence is:

  > **Unbounded offline *time*, bounded offline *volume*. The bound is `TICKET_BATCH`, and it is 64.**

Do not let this document, CLAUDE.md, or a commit message say "unbounded offline play" unqualified.

**Why 64.** A ticket is spent per banked result, and the four queueable games are one result per
finished game — a chess match, a solitaire deal, a UNO table, a tic-tac-toe round. 64 finished games
is a long train ride and a short flight; it is far past any real session and far short of a number
that makes leaderboard inflation interesting. It is a constant in shared code, not a negotiation.

**On exhaustion offline: the client stops banking and says so.** It does not stop playing — the four
queueable games are entirely local and run fine. Results past the batch are **not ranked**: no XP, no
stat, no achievement. The board shows a plain, non-alarming line ("Offline — results past this point
won't be saved"), and the count is visible before it runs out.

The rejected alternative is worth recording: *queue results without tickets and attach tickets on
reconnect.* This is the obvious-looking design and it is exactly wrong — it reduces to client-minted
nonces with extra steps, because at flush time the server cannot distinguish 64 honest banked results
from 6,400 fabricated ones. **The ticket must be spent at the moment of the event, which is precisely
what makes the ticket count the bound.**

**Top-up.** The client refills to a full batch whenever it is online and below a low-water mark
(`TICKET_LOW = 16`), on sign-in and after each successful flush. In normal online play a top-up
happens rarely and never on the critical path of an action.

---

## Question 3 — a result banked against a batch issued before a rotation

Answered by the `kid` and the overlap window in Q1, spelled out:

| Situation | Outcome |
|---|---|
| Ticket signed under the current key | Verifies. Normal path. |
| Ticket signed under the previous key, after one rotation | **Verifies.** This is what the overlap window is for, and it is the case that matters: a player offline across a rotation banks normally. |
| Ticket signed under a key dropped by a second rotation | **Refused**, with a distinct error the client can act on. |
| Ticket carrying a `kid` the server has never held | Refused. Indistinguishable from a forgery, and treated as one. |

**What the client does with a refused-because-retired ticket.** It is the one refusal that is the
*server's* fault rather than the player's, so it must not silently eat a result. The queued intent is
re-stamped with a fresh ticket and re-sent — safe precisely because the old ticket was never spent
(the server refused it before claiming it, and refusal happens before the `mutations` insert). If no
fresh ticket is available, the entry is dropped with an honest toast rather than retried forever.

This is the only place a queued intent's nonce ever changes, and it is sound only because a refused
ticket is provably unspent. A ticket that was *accepted* is never re-stamped — that would be the
double-pay bug this whole document exists to prevent.

---

## Question 4 — how is a device identified, and what stops a client claiming to be several?

**Nothing stops it, and the design is built so that nothing needs to.**

The device id is a random 128-bit value the client generates on first run and persists in
`localStorage`. It is registered implicitly at first ticket issuance. There is no attestation, no
device approval, no proof of any kind — a client can clear storage, or lie, and be a new device
whenever it likes. Pretending otherwise would be the forgeable-`isDev`-field mistake in a new costume:
**a field that grants nothing but that the next feature believes.**

So the design refuses to make the device a trust boundary:

> **The outstanding-ticket cap is per `uid`, across all devices.** Registering a hundred devices
> yields zero extra tickets.

`TICKET_BATCH = 64` is the maximum number of **unspent issued tickets a uid may hold at once**, summed
over every device it has ever registered. A request for more returns however many bring the uid back
to the cap, and zero if it is already there. A client that fabricates devices is dividing its own 64,
not multiplying it.

**What the device id is actually for, then:** it is a **sequence namespace** — it lets each device
number its own tickets so ordering is well-defined without cross-device coordination, and it makes a
gap attributable to one device rather than smeared across the account. It is for ordering and
diagnosis. **It is not for authorization**, and no check anywhere may treat it as such. That sentence
is the guard's job to keep true.

Storage is one small table:

```sql
CREATE TABLE IF NOT EXISTS ticket_devices (
  uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,
  issued_seq  INTEGER NOT NULL DEFAULT 0,  -- highest seq ever issued to this device
  spent_count INTEGER NOT NULL DEFAULT 0,  -- tickets from this device the server has claimed
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (uid, device_id)
);
```

Outstanding for a uid is `SUM(issued_seq - spent_count)`. New table, so **no `COLUMN_MIGRATIONS`
entry is needed** — `CREATE TABLE IF NOT EXISTS` does reach the Pi's existing database, and only a
new *column on an old table* silently does not. (`spent_count` on this table is new-with-the-table
and therefore fine; if a later change adds a column here, it needs an entry, and
`tests/migrations.test.ts` is what catches forgetting.)

**No new stored profile field, so `database.rules.json` does not change and there is no manual rules
deploy in this work.** Tickets are server-side state in SQLite and client-side state in
`localStorage`; nothing lands in the RTDB profile that `$other: false` would have to pin. This is a
deliberate constraint on the design, not a happy accident — it removes the highest-risk manual step
from the deploy.

---

## Question 5 — what does the server do with a gap in the sequence?

**Accept out of order, refuse a seq that was never issued, record the gap, and never block on one.**

Rejected: **reject on gap.** A single dropped or abandoned result would permanently wedge the queue
behind a sequence number that will never arrive. Gaps are *normal and innocent* here — a player
closes the tab mid-game, a ticket is stamped onto an intent that is then discarded, a refused-and-
re-stamped entry (Q3) leaves its original seq unspent forever. Blocking on that turns routine
behaviour into a stuck account.

Rejected: **hold and reorder.** It requires a server-side pending buffer with its own eviction policy
and its own failure modes, to buy ordering that nothing in the economy actually needs. No mutation
here depends on the order of another: a settle is bounded by an open wager, not by its predecessor.
Ordering is a diagnostic property, not a correctness one — which is exactly why the cheap option is
the correct one rather than merely the affordable one.

**What is enforced:**

- The signature must verify under a live key. (Forgery.)
- The uid in the ticket must equal `req.uid`. (One account cannot spend another's — the same scoping
  the nonce already had, now cryptographically bound rather than merely namespaced.)
- `seq` must be `<= issued_seq` for that `(uid, device)`. A client cannot present a ticket from the
  future, and it could not sign one anyway; this catches the case where a key leaks and bounds the
  damage to already-issued sequence space.
- The ticket must be unspent — `mutations(uid, nonce)`, unchanged.

**What is recorded:** `spent_count` increments and `last_seen_at` updates in the same transaction as
the work. Outstanding, and therefore the gap total, is derivable at any time.

**On "flag":** with one player there is nothing to page. The gap is *derivable state in a table*, not
an alert — `issued_seq - spent_count` per device, which is exactly the number an operator would want
and costs nothing to maintain. Claiming an alerting pipeline that nobody reads would be the
un-adopted `validateAndCommit()` all over again. If a second player ever exists and this matters, the
data is already there to build on.

---

## Client scope — what is queueable, and what deliberately is not

**Only `settle` goes in the outbox.** That is the locked decision's actual content — offline *wins*
are ranked — and nothing more.

| Intent | Offline? | Why |
|---|---|---|
| `settle` (chess, uno, solitaire, tic-tac-toe) | **Queued** | Payout is 0 by `checkSettle`'s zero-wager branch. Only XP and a stat move. This is the feature. |
| `bet` | No | Only blackjack bets, and blackjack cannot go offline. A queued bet would be checked against the ledger at flush time, and a failure there would silently collapse the ceiling of a settle already banked against it. |
| blackjack `deal`/`move` | **No, structurally** | The server holds the cards. There is no offline blackjack and there must not be — that is the whole point of Phase D. The table already shows "the dealer could not be reached". |
| `purchase` / `pack` | No | Both need a server answer to render at all (a price, a roll). A pack especially: the roll is the server's and queuing one means an animation with nothing to show. |
| `daily` | No | Claimed against the server's clock, on purpose. Queuing it would reintroduce the client clock as an input by the back door. |

### Which routes require a ticket — `/settle` and only `/settle`

Decided while reading the routes, and it is a correction to the obvious "require tickets
everywhere", which is wrong for a reason worth writing down:

> **The 64 tickets are the offline banking budget. If an online action spends one, online play
> starves the offline reserve it was sized for.**

An online shopping spree through `/purchase`, or a run of `/pack` opens, would drain the same
counter that is supposed to represent "results I can bank on a train". So the ticket requirement is
scoped to the one intent that is actually queueable:

| Route | Ticket required | Why |
|---|---|---|
| `/settle` | **Yes** | The only queueable intent, and the only one whose repetition inflates anything (XP, `played`, `won`). This is the surface being bounded. |
| `/bet` | No | Bounded by the ledger balance. Not queueable. |
| `/purchase`, `/pack` | No | Bounded by the server's price and the server's roll. Not queueable. |
| `/daily` | No | Bounded by the server's clock. Not queueable. |
| `/blackjack/deal`, `/blackjack/move` | No | Structurally online — the server holds the cards. The nonce here is a retry key, not a right to bank, and a repeated deal costs a real stake from the ledger. |

Everything not listed as requiring a ticket keeps client-minted nonces and is **unchanged by this
work**, which also keeps the blast radius of a bad ticket deploy to one route.

**The outbox** is a `localStorage`-persisted array of `{ intent, stampedAt }` where `intent.nonce` is
already a spent-intent ticket. It is capped (`OUTBOX_CAP = 64`, matching the batch — a full outbox
and an empty ticket store are the same condition) and it flushes in order, one at a time, on the
`online` event and on a slow poller. `socket.ts` already implements this shape in-memory for rooms
and is the local precedent to follow.

**Optimistic profile and the queue.** A queued settle keeps its optimistic profile — the player sees
the XP immediately, which is the point of offline play. The server's authoritative profile replaces
it on flush. A refusal on flush reverts. This is the existing `applyEconomy` contract, extended in
time rather than changed in shape.

---

## Guards this work owes

Every rule gets its guard and a test that the guard fires, in the same commit.

| Guard | What it proves |
|---|---|
| `boardwalk-api/tests/tickets.test.ts` | Sign/verify round-trip; a tampered ticket refused; a ticket for uid A refused for uid B; a `kid` never held refused; previous-key verify accepted, dropped-key refused; a seq above `issued_seq` refused; the per-uid cap holds **across fabricated devices** (the Q4 claim, tested directly); issuance at the cap returns zero. |
| `boardwalk-api/tests/economy.test.ts` (extended) | **The replay attack, demonstrated:** bank a settle with a ticket, re-send the identical body, assert the ledger has one row, the stat moved once, and XP moved once. Then the same with `tickets: off` to prove the fallback is today's behaviour exactly. |
| `tests/outbox.test.ts` (root) | The pure outbox logic — enqueue, cap, flush order, a flush that fails leaves the entry, a flush that 409s drops it, a re-flush of an already-sent entry is a no-op, persistence round-trips through a fake storage, and a throwing `localStorage` never loses the in-memory queue. |
| `tests/ticket-store.test.ts` (root) | Spend-once locally, top-up at the low-water mark, exhaustion reports empty rather than minting, and a retired-key refusal re-stamps exactly once. |
| `boardwalk-api/tests/migrations.test.ts` (extended) | `ticket_devices` reaches a pre-existing database (a new table does, and the test should say so rather than leaving it assumed). |
| `tests/deploy-env.test.ts` | Already guards that the workflow injects every `import.meta.env` var the source reads — a new client kill switch is covered by construction. |

**Falsification plan** — each guard broken on purpose and watched go red before it is trusted: drop
the uid check from `verifyTicket` (the cross-account test must fail); make the cap per-device instead
of per-uid (the fabricated-devices test must fail); make the outbox flush non-idempotent (the ledger
test must fail); remove the `kid` selection and try both keys (the dropped-key test must fail).

**Beyond the suite:** the [browser verification recipe](../../CLAUDE.md) applies, and a passing suite is
explicitly not evidence here. The real drive is: emulator + local API, sign in, play a chess game
online and confirm the settle lands; kill the API; play two more and watch them queue with the XP
showing optimistically; bring the API back; watch the queue flush and the profile reconcile; then
re-trigger a flush and confirm the ledger did not move twice.

---

## Deploy order — THREE phases, and the secret goes LAST

**This section was wrong on first writing, and the error was live in production for about two
minutes. Read the correction before deploying anything.**

The original said "the Pi goes first" and then listed *set `TICKET_SECRET`* as step 3 and *merge the
frontend* as step 5. Both halves of that are individually true and the combination is broken:

> **Setting the secret IS the cutover, not part of the server deploy.** The moment it is set, the
> gate refuses any nonce that is not a ticket — and the deployed frontend is still minting its own.
> Every chess/UNO/solitaire settle on the live site 409s until the new client ships.

"Server first is safe" is only true **while the secret is absent**. So the deploy is three phases,
and the secret belongs to the third:

### Phase 1 — server code, enforcement OFF

1. rsync `packages/game-logic` as a sibling of `~/boardwalk-api`, then `boardwalk-api`.
2. `npm install && npm run build && npm test` **on the device**. (Never `--omit=optional` — it
   builds and runs but breaks `npm test`.)
3. Restart. **Do NOT set `TICKET_SECRET` yet.**
4. Verify from the artifact: `/health` reports `tickets: "off"`, the boot log carries the
   `TICKET_SECRET is not set` warning, `PRAGMA table_info(ticket_devices)` lists the six columns
   (the table is created at open even with enforcement off), and the ledger is byte-identical.

At this point production is **exactly as it was** — old clients keep working, the new table exists,
and nothing is enforced.

### Phase 2 — the client

5. Merge to `main` and let Pages deploy. The new client asks `POST /tickets`, is told
   `enabled: false`, and mints its own nonces — the same behaviour as before, with no error path.
   That is what `enabled` being a *third state* buys: the client works correctly on both sides of
   the cutover, so there is no window where either half is broken.

### Phase 3 — the cutover

6. Set `TICKET_SECRET` in `~/boardwalk-secrets/boardwalk-api.env` (generate it **on the Pi** —
   `openssl rand -base64 32` — so it never crosses the wire), restart, and verify `/health` reports
   `tickets: "on"`.
7. Confirm a real settle still lands, and that a forged nonce is refused 409.

**Rollback is one line and does not need a redeploy**: rename the key (e.g. to
`TICKET_SECRET_PENDING`) and restart. `/health` goes back to `"off"` and every client works again.
That property is worth more than it looks — it is the difference between a cutover you can undo in
fifteen seconds and one that needs a rebuild.

No rules deploy. No new profile field, by design (Q4).

---

## What shipped

Built as designed above, with the three review decisions confirmed (fail open, `TICKET_BATCH = 64`,
`settle` only) and one correction found while reading the routes (the gate is on `/settle` **alone**
— see the table above).

**The shape, in one line each:**

| Piece | Where |
|---|---|
| `TICKET_BATCH` / `TICKET_LOW` — the one rule both sides run | `packages/game-logic/src/economy/tickets.ts` |
| Sign / verify / issue, the per-uid cap, the `kid` keyring | `boardwalk-api/src/domain/tickets.ts` |
| `POST /tickets` and the `/settle` gate | `boardwalk-api/src/routes/tickets.ts` |
| The spend record, inside the mutation's own transaction | `claimNonce` in `boardwalk-api/src/domain/mutations.ts` |
| `ticket_devices` | `boardwalk-api/src/db/schema.ts` (new TABLE — no `COLUMN_MIGRATIONS` entry needed) |
| The pure queue and ticket book | `src/system/offline/queue.ts` |
| Storage, top-up, flush loop | `src/system/offline/offlineStore.ts` |
| `TicketRepo` behind the seam | `src/system/repo/types.ts`, `api/ticketRepo.ts` |
| The banking path | `src/system/economy/useGame.ts` |

**`EconomyIntent` did not change by one field**, as promised: a ticket is spent in the `nonce`
slot, so no intent gained a place to put a balance, a price, an XP amount, a stat count, a clock, a
seed or an item.

**Guards: 71 new tests** — 37 in `boardwalk-api/tests/tickets.test.ts`, 19 in
`tests/offline-queue.test.ts`, 15 in `tests/offline-store.test.ts`. Every one falsified by breaking
its subject on purpose.

**The falsification pass earned its keep.** Eleven deliberate breaks; ten went red immediately, and
one did not: *re-stamp on ANY refusal, not just a retired ticket* left the whole suite green. The
test that should have caught it seeded an **empty** ticket book, so the re-stamp failed for want of
a ticket and the entry got dropped anyway — passing for the wrong reason. The replacement seeds
spares and asserts none is burned. A guard that cannot fail is the thing this repo's Enforcement
section exists to prevent, and it landed on a guard written by the same commit.

### Driven for real, because a passing suite is not evidence

Full stack against the RTDB/Auth emulators: `boardwalk-api` with `TICKET_SECRET` set (`/health`
read back `{"tickets":"on"}` from the running process, not inferred), the app on Vite, Chromium via
Playwright. `/settle` was aborted at the network layer while everything else stayed up — a truer
simulation of the Pi being down than full offline, which would also kill the RTDB emulator the room
needs to play at all.

```
tickets granted: 64  enabled=true  device=d-2a838dc3d69c7369
a ticket looks like: v1.b7a7db0f.d-2a838dc3d69c7369.1.ZKBcJ5koNGU8LONRc1EVS6

GAME 1 — online          nonce sent IS A SIGNED TICKET: true      book: 63 left
GAME 2 — /settle down    BANKED: queue=1, 62 left, persisted to localStorage: true
RECONNECT                DRAINED: queue=0    3 requests, 2 DISTINCT nonces
```

Three `/settle` requests, two distinct nonces — the banked result went out **twice with the same
ticket**, which is exactly the replay the design has to survive. The database afterwards:

```
stats: played 2, lost 2      xp 20      settle mutations: 2      ledger rows: 1
ticket_devices: issued_seq 64, spent_count 2     → outstanding 62, matching the client exactly
```

Then the attack, by hand against the live server: the banked nonce re-sent **3 more times** answered
`replayed=true` every time with `xp` and `bankroll` unmoved, and a client-minted nonce
(`"i-made-this-up"`) was refused **409**. Re-reading the tables after all four: `played 2`, `xp 20`,
`2` mutations, `1` ledger row, `spent_count 2`. **Nothing moved twice.**

**The bug the browser found that 584 green tests did not.** `useOfflineSync` ran its first tick on
mount — which happens *before* anyone is signed in — and then slept for the poll interval. Sign-up
succeeded, the hub rendered, and `POST /tickets` was never called; a fresh session had an empty
ticket book for up to 30 seconds. Every unit test passed because they all call the store directly
with a session already present. The fix keys the effect on session readiness rather than on mount.
This is the fourth time in this repo's history that only looking at the running thing found the
defect, and it is the argument for the manual pass being non-optional, not a formality.

*(`acquireNonce`'s await-a-top-up path would have masked the symptom — the first settle would have
fetched tickets on demand — which is precisely why it is worth naming: a latent 30-second hole,
papered over by a safety net, is the kind of thing that is never found later.)*

### Deployed, and what the deploy taught

Shipped in three phases on 2026-07-18 (server → client → secret). **Verified in production from the
artifact, never from an exit code:**

```
/health (Funnel)          {"ok":true,"db":"up","tickets":"on"}
live tic-tac-toe win      settle 200, nonce v1.5afc0756.d-7590ff3b5835b753.1.…  signed ticket
ticket book               64 -> 63
same ticket re-sent 3x    replayed=true, xp 10 -> 10, bankroll unchanged
client-minted nonce       409 {"error":"not a ticket","ticket":"invalid"}
ticket_devices            issued 64 / spent 1 / outstanding 63  — matches the client exactly
```

The real player's row was untouched throughout (xp 700, $5,215.00, 2 ledger rows, integrity ok,
identical before and after); the throwaway verification account was deleted from SQLite **and**
Firebase Auth afterwards.

**The mistake this document made.** The original deploy order said "the Pi goes first", listed *set
`TICKET_SECRET`* as step 3 and *merge the frontend* as step 5 — and I ran it in that order. Setting
the secret IS the cutover: from that moment the gate refuses anything that is not a ticket, and the
deployed frontend was still minting its own nonces, so every chess/UNO/solitaire settle would 409.
Live for about two minutes, no impact (the DB was byte-identical afterwards and no requests landed
in the window), rolled back by renaming the env key and restarting. The section is now three phases
with the secret last — see [Deploy order](#deploy-order--three-phases-and-the-secret-goes-last).

Two things made that cheap, and both were design decisions rather than luck: **`enabled` is a third
state**, so the new client works correctly on both sides of the cutover, and **the switch is an env
var**, so the undo is fifteen seconds and no rebuild.

**A verification gotcha worth recording.** Driving the live site from a machine on the tailnet fails
in a way that looks like a product bug: the Funnel hostname resolves to a private `100.x` address,
so Chrome's Local Network Access check blocks the request from the `github.io` origin
(`CORS policy: Permission was denied for this request to access the local network`). `curl` is
unaffected, and so is any user not on the tailnet. Launch Chromium with
`--disable-features=BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks,PrivateNetworkAccessChecks`
to verify from here.

**No rules deploy was needed**, as designed — the feature adds no stored profile field.

---

## Open questions for review

Three calls where I could defensibly have gone the other way, flagged rather than buried:

1. **Fail-open when `TICKET_SECRET` is absent** (Q1). Justified above, and it is still a fail-open on
   a security control. The alternative — refuse every money route without a secret — is safer in
   theory and takes the economy down on a deploy that forgets an env var.
2. **`TICKET_BATCH = 64`** (Q2). The number is a judgment call. It is the offline volume bound and
   the outbox cap simultaneously.
3. **Only `settle` is queueable** (Client scope). This is narrower than "offline play works"; it is
   exactly "offline wins are ranked". A wider scope is a much bigger job for no current player.
