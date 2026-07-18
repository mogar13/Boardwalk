# The Phase-B cutover runbook — Firebase → SQLite backfill

**Status: NOT RUN. Nothing in here has been executed against production.**

This is the ordered procedure for moving every real player's account from Firebase RTDB into the
referee's SQLite database, and only then pointing the frontend at the referee.

## Why this exists, stated plainly

`boardwalk-api`'s SQLite holds **one** profile — Phase A's shadow mirror only ever ran for the
developer's own account. Firebase RTDB holds **every** real player. The frontend's cutover path calls
`PUT /profile` on sign-in, and `upsertProfile` grants the opening $5,000 to any uid with no `profiles`
row. So cutting over first and backfilling later does not mean "some data arrives late" — it means
every player signs in to a **fresh $5,000 account with no XP, no stats, no achievements and no
inventory**, and the ledger is append-only, so the old numbers exist only in RTDB.

The backfill runs **before** the cutover. That ordering is the whole point of this document.

## The safety properties you are relying on

| Property | Where it is enforced | Test |
|---|---|---|
| Re-running changes nothing | `mutations(uid, 'migration:v1')`, claimed `INSERT OR IGNORE` in the same transaction as the work | `re-running ten times does not multiply the money` |
| A backfilled player gets no second signup stake | The backfill writes the `profiles` row, so `upsertProfile`'s `existed` branch is taken forever after | `a backfilled player signing in afterwards is NOT granted a second stake` |
| Money lands exactly, not approximately | One `migration` ledger row sized `firebaseBalance - currentLedgerBalance` | `reconciles a uid that ALREADY had a signup grant` |
| A partial failure is re-runnable | One transaction **per uid**; a bad record skips itself and names itself | `one malformed record does not roll back the others` |
| Verification is per-uid, not just totals | `reconcile()` compares each uid, because two swapped balances produce a matching grand total | `catches two swapped balances that a grand total would hide` |
| A bad credential fails red, not silently | `withTimeout` — RTDB retries **forever** and never rejects | `rejects a promise that never settles` |

`boardwalk-api/tests/backfill.test.ts` — 34 tests. Both central guards were falsified (broken on
purpose, watched go red, restored) before being trusted.

---

## Step 0 — Prerequisites

On the Pi (`mogar13@boardwalk-pi.tail1bed2f.ts.net`):

- `GOOGLE_APPLICATION_CREDENTIALS` points at the installed service-account JSON. The Admin SDK
  **bypasses `database.rules.json`**, which is what lets it read every `users/<uid>` node.
- You know `FIREBASE_PROJECT_ID` and the RTDB URL (the frontend's `VITE_FIREBASE_DATABASE_URL`,
  typically `https://<project>-default-rtdb.firebaseio.com`).

**Announce a maintenance window and stop the API before Step 2.** The backfill takes one RTDB
snapshot; a player who finishes a hand between that snapshot and the cutover has their result written
to RTDB and never migrated. A window of a few minutes with the service down removes the race entirely
rather than shrinking it.

---

## Step 1 — Back up, and prove the backup restores

Do not skip the drill. The backfill writes to the live database; the backup is the only way back.

```bash
ssh mogar13@boardwalk-pi.tail1bed2f.ts.net
cd ~/boardwalk-api

DB_PATH=/mnt/boardwalk-db/data/boardwalk.db \
BACKUP_DIR=/mnt/boardwalk-db/backups \
npm run backup

BACKUP_DIR=/mnt/boardwalk-db/backups npm run restore:drill
```

**Gate:** the drill prints `restore drill: ... OK`. If it does not, stop — you have no rollback.

Copy the snapshot off the box, and note its filename; Step 7 is written against it.

```bash
rsync -az /mnt/boardwalk-db/backups/ desktop:/srv/boardwalk-backups/
```

---

## Step 2 — Stop the API

```bash
sudo systemctl stop boardwalk-api
```

Nothing may write to the ledger while the backfill runs. This also starts the maintenance window.

---

## Step 3 — Build, then DRY RUN the backfill

```bash
cd ~/boardwalk-api
git pull && npm ci && npm run build     # the backfill lives in dist/, like every other script

export DB_PATH=/mnt/boardwalk-db/data/boardwalk.db
export FIREBASE_PROJECT_ID=<project-id>
export FIREBASE_DATABASE_URL=https://<project>-default-rtdb.firebaseio.com

npm run backfill -- --dry-run
```

The dry run writes **nothing** and prints what the real run would do:

```
read 41 user node(s)
backfill DRY RUN (nothing written): 41 migrated, 0 already migrated, 0 skipped (empty)
  target total: $214430.00  ledger delta written: $214430.00
  bankroll defaulted to the opening stake for 0 record(s)
reconcile FAILED
  profiles: 41 in firebase, 1 in sqlite
  ...
(dry run — nothing was written, so a reconcile failure above is expected)
```

**Read these four numbers before continuing:**

1. **`read N user node(s)`** — does N match the number of accounts you believe exist? A number far
   too small means the credential is reading a different project.
2. **`migrated`** — should be every real player. `already migrated` should be 0 on a first run.
3. **`skipped (empty)`** — uids whose `users/<uid>` node has no `profile` child. Usually accounts that
   never finished creating one. A large number here is worth understanding before proceeding.
4. **`bankroll defaulted`** — records with no usable `bankrollCents`, each granted the opening stake
   because that is the balance the frontend currently shows them. A large number means something is
   wrong with the read, not with the players.

**The `reconcile FAILED` at the end of a dry run is correct and expected** — nothing was written yet.

---

## Step 4 — Run it

```bash
npm run backfill
```

```
backfill complete: 41 migrated, 0 already migrated, 0 skipped (empty)
  target total: $214430.00  ledger delta written: $214430.00
reconcile OK
  profiles: 41 in firebase, 41 in sqlite
  cents:    $214430.00 in firebase, $214430.00 in sqlite (ledger sum, all uids)
```

**Gate:** the script exits **0** and prints `reconcile OK`. On a per-uid mismatch it exits 1, names
the uids, and says `do not cut the frontend over`. Believe it.

A re-run at this point is safe and is a no-op — `npm run backfill` again should report
`0 migrated, N already migrated`, which is itself a decent confirmation that the marker took.

---

## Step 5 — Verify the database independently of the tool that wrote it

The script grading its own homework is worth something, but not everything. Check by hand:

```bash
sqlite3 /mnt/boardwalk-db/data/boardwalk.db <<'SQL'
SELECT COUNT(*) AS profiles FROM profiles;
SELECT COUNT(*) AS migrated FROM mutations WHERE nonce = 'migration:v1';
SELECT COUNT(*) AS signup_rows FROM ledger WHERE reason = 'signup';
SELECT reason, COUNT(*), SUM(delta_cents) FROM ledger GROUP BY reason;
SELECT COUNT(*) FROM profiles WHERE uid NOT IN (SELECT uid FROM ledger);
SQL
```

Expected:

- `profiles` = migrated players (+ any pre-existing API-only test account).
- `migrated` = the number the script reported.
- `signup_rows` = **1** — the one pre-existing profile. If this grew, a signup grant fired during the
  backfill and something is wrong.
- The last query returns **0**: no profile without a ledger row.

Spot-check one real account you can log into, against what the Firebase console shows for its
`users/<uid>/profile`: bankroll, xp, a couple of stats, the equipped card back.

---

## Step 6 — Deploy the API, then the frontend

Only after Step 5 passes.

```bash
sudo systemctl start boardwalk-api
systemctl status boardwalk-api
curl -s https://boardwalk-pi.tail1bed2f.ts.net/health
```

**Gate:** healthy, and the journal is clean (`journalctl -u boardwalk-api -n 50`).

The frontend cutover is a push to `main` — `.github/workflows/deploy.yml` builds with
`VITE_API_BASE_URL` from GitHub Actions secrets. Confirm that secret is set to the Funnel URL
**before** pushing; with it absent the build silently ships the pre-Phase-B economy.

The kill switch, if prod goes wrong: set **`VITE_API_ECONOMY=0`** and rebuild. That reverts the
economy to Firebase-authoritative with no code change. It does **not** un-migrate anything, and it
does not need to — the SQLite copy simply sits there unread.

---

## Step 7 — Verify in prod

In a real browser, signed in as a real account:

1. **Your account is yours.** Bankroll, XP, level badge, achievements, inventory and equipped card
   back all match what you had before the cutover. This is the whole point; check it first.
2. **A bet moves money the server's way.** Play a blackjack hand. The bankroll changes, and a reload
   still shows the new number (the ledger, not an optimistic local copy).
3. **A purchase is charged at the server's price.** Buy something in the store.
4. **The daily claim works and the streak survived** — it was migrated, so a player mid-streak must
   not have been reset to day 0 or handed a free claim.
5. **Devtools cannot move the bankroll.** Try. This is the claim Phase B exists to make.
6. **The leaderboard is populated** — not one row. A leaderboard with a single player is the
   signature of a cutover that happened before the backfill.
7. Console clean, and `journalctl -u boardwalk-api -f` clean while you do all of it.

---

## Rollback

**Before Step 6 (nothing deployed yet):** restore the Step 1 backup.

```bash
sudo systemctl stop boardwalk-api
sudo cp /mnt/boardwalk-db/data/boardwalk.db /mnt/boardwalk-db/data/boardwalk.db.pre-restore
sudo cp /srv/boardwalk-backups/boardwalk-<stamp>.db /mnt/boardwalk-db/data/boardwalk.db
sudo rm -f /mnt/boardwalk-db/data/boardwalk.db-wal /mnt/boardwalk-db/data/boardwalk.db-shm
sudo chown mogar13:mogar13 /mnt/boardwalk-db/data/boardwalk.db
sudo systemctl start boardwalk-api
```

**After Step 6 (players have been on the new economy):** do **not** restore the pre-backfill backup —
it predates every hand played since, and restoring it deletes them. Use `VITE_API_ECONOMY=0` and
rebuild the frontend. Firebase is still being written by the shadow path, so it is a live fallback.
Diagnose with the API stopped, not by rewinding the ledger.

## The residual risk, named rather than papered over

**Firebase and SQLite diverge from the moment the snapshot is taken.** The maintenance window makes
that gap small and empty rather than eliminating it. If the cutover is delayed by hours after Step 4,
players will have played against Firebase in the meantime, and those results are not in SQLite. The
marker means a second backfill run will **not** pick them up — it skips every migrated uid by design,
which is the correct behaviour for the double-run hazard and the wrong one here. If the window slips
that far: restore the backup, and start again from Step 1.
