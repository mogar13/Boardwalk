# Backups and the restore drill

The referee owns the ledger, and the ledger is the money. There is no bankroll column anywhere in
this schema — a balance is `SUM(ledger.delta_cents)` — so losing ledger rows does not corrupt the
balance, it *silently changes* it. That is the failure this document exists to prevent.

> **Status: the drill HAS now been run on the real Pi (2026-07-18).** `npm run backup` produced a
> verified snapshot of the live stick, the drill passed against it on the Pi **and** against the
> off-box copy, and the systemd timer is installed and firing. One item remains: the full
> stop/swap/start restore rehearsal — see [Owed](#owed).
>
> Two corrections found while doing it, both of which had made this document wrong in practice:
> `scripts/` and `dist/backup/` **did not exist on the Pi at all**, so the verified backup had never
> run there; and the systemd unit below **would have failed as written** — its `desktop:` rsync
> target does not resolve from the Pi. The installed unit is backup-only and the off-box copy is a
> PULL (a post-step that always fails would mark every good backup failed).

## What the backup actually does

`npm run backup` (→ `scripts/backup.mjs` → `src/backup/backup.ts`):

1. Opens the live DB **read-only** and snapshots it with SQLite's **online backup API**
   (`db.backup(path)`), not a file copy. A `cp` of a live SQLite database can tear — it captures
   some pages from before a commit and some from after — and WAL mode makes a naive copy worse, not
   better, because committed data may still be in a `-wal` sidecar the copy never took. The online
   backup API holds the right locks and produces a single self-contained file that is a consistent
   snapshot of a real committed instant, **while the service keeps serving**.
2. Re-opens the file it just wrote and **verifies** it: `PRAGMA integrity_check`, all six required
   tables (`users`, `profiles`, `stats`, `achievements`, `inventory`, `ledger`), no orphaned ledger
   rows, and every user's balance recomputed from the ledger. **If verification fails it exits
   non-zero and does not prune.** An unverified backup is a rumor.
3. Prunes its own old files (`boardwalk-*.db` only, never "everything in the directory") older than
   `BACKUP_KEEP_DAYS`.
4. Prints one line: path, byte size, profile/ledger/user counts and the total balance.

### Environment

| Var | Default | Meaning |
|---|---|---|
| `DB_PATH` | `./data/boardwalk.db` | Source DB. On the Pi: `/mnt/boardwalk-db/data/boardwalk.db` |
| `BACKUP_DIR` | `/mnt/boardwalk-db/backups` | Where snapshots land |
| `BACKUP_KEEP_DAYS` | `14` | Retention; `0` disables pruning |

### Run it

```bash
cd ~/boardwalk-api
npm run build          # the scripts import dist/, so build first (the Pi already runs dist/)
DB_PATH=/mnt/boardwalk-db/data/boardwalk.db \
BACKUP_DIR=/mnt/boardwalk-db/backups \
  npm run backup
```

A passing run looks like:

```
backup ok: /mnt/boardwalk-db/backups/boardwalk-20260718T031500Z.db 2260992 bytes — 41 profiles, 1873 ledger rows, 41 users totalling $214430.00
```

Exit code 0. Any other exit code means **you do not have a backup from this run.**

## Scheduling on the Pi (systemd timer)

Preferred over cron: systemd gives you `systemctl status`, journal output, and `Persistent=true`
(a missed run because the Pi was off fires on next boot — cron simply skips it).

`/etc/systemd/system/boardwalk-backup.service`:

```ini
[Unit]
Description=Boardwalk SQLite online backup + verify
After=network-online.target mnt-boardwalk\x2ddb.mount
Requires=mnt-boardwalk\x2ddb.mount

[Service]
Type=oneshot
User=mogar13
WorkingDirectory=/home/mogar13/boardwalk-api
Environment=DB_PATH=/mnt/boardwalk-db/data/boardwalk.db
Environment=BACKUP_DIR=/mnt/boardwalk-db/backups
Environment=BACKUP_KEEP_DAYS=14
# node directly, not `npm run backup`: systemd's PATH is minimal and npm adds a shell layer that
# only obscures the exit code. This is what is actually installed on the Pi.
ExecStart=/usr/bin/node scripts/backup.mjs
# NOTE: an `ExecStartPost=rsync ... desktop:` line used to live here and it CANNOT WORK from this
# Pi -- `desktop` does not resolve, and the intended target runs no sshd. A post-step that always
# fails marks every SUCCESSFUL backup as a failed unit, which is how you learn to ignore the unit.
# Off-box is therefore a PULL, run from the machine that holds the credentials -- see below.

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/boardwalk-backup.timer`:

```ini
[Unit]
Description=Nightly Boardwalk backup

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now boardwalk-backup.timer
systemctl list-timers boardwalk-backup.timer     # confirm the next run
sudo systemctl start boardwalk-backup.service    # run once, now
journalctl -u boardwalk-backup.service -n 50     # read the summary line
```

Adjust `User=`, `WorkingDirectory=` and the `mnt-boardwalk\x2ddb.mount` unit name to match the real
box (`systemctl list-units --type=mount | grep boardwalk` gives the exact escaped name). The mount
dependency matters: without it a boot-time run can write "backups" into the empty mountpoint
directory underneath an unmounted stick, which looks like success and is not.

### Cron alternative

```cron
15 3 * * * cd /home/mogar13/boardwalk-api && DB_PATH=/mnt/boardwalk-db/data/boardwalk.db BACKUP_DIR=/mnt/boardwalk-db/backups /usr/bin/npm run backup >> /var/log/boardwalk-backup.log 2>&1 && /usr/bin/rsync -az --delete /mnt/boardwalk-db/backups/ desktop:/srv/boardwalk-backups/
```

Note the `&&`: the off-box push only runs if the verified backup succeeded, so a failed run never
overwrites a good remote copy with a bad one.

## Getting it off-box (this is the point)

The stick and the Pi fail together — a dead Pi, a yanked USB stick, a filesystem that remounts
read-only. Backups that live only on `/mnt/boardwalk-db` protect against exactly one scenario
(accidental `DELETE`) and nothing else.

The Pi is on Tailscale (`boardwalk-pi.tail1bed2f.ts.net`), so any other node on the tailnet is a
destination with no port forwarding and no public exposure.

**Pull from another machine** (safer — the target holds the credentials, so a compromised Pi cannot
reach into the backup store):

```bash
rsync -az --delete \
  mogar13@boardwalk-pi.tail1bed2f.ts.net:/mnt/boardwalk-db/backups/ \
  /srv/boardwalk-backups/
```

**Push from the Pi** (what the unit above does — simpler, one machine to schedule):

```bash
rsync -az --delete /mnt/boardwalk-db/backups/ desktop:/srv/boardwalk-backups/
# or a single file, no rsync:
scp /mnt/boardwalk-db/backups/boardwalk-20260718T031500Z.db desktop:/srv/boardwalk-backups/
```

Both need key-based SSH set up between the nodes (`ssh-copy-id`); `rsync` over a Tailscale hostname
is plain SSH, already encrypted end-to-end by both layers.

`--delete` mirrors the retention policy off-box too. If you would rather keep a longer history
remotely than locally, **drop `--delete`** and prune the remote on its own schedule — that is the
better setup, since the remote is the copy that survives the Pi.

## The restore drill

A backup you have not restored is a rumor. `npm run restore:drill` is the cheapest possible way to
stop it being one, and it is safe to run any time: it never opens the live DB, never writes outside
a temp directory, and opens a **copy** of the backup **read-only**.

```bash
cd ~/boardwalk-api
BACKUP_DIR=/mnt/boardwalk-db/backups npm run restore:drill
# or against one specific file, including one pulled to another machine:
npm run restore:drill -- /srv/boardwalk-backups/boardwalk-20260718T031500Z.db
```

A passing run:

```
restore drill: /mnt/boardwalk-db/backups/boardwalk-20260718T031500Z.db
  integrity_check ..... ok
  tables .............. 8 present, expecting users, profiles, stats, achievements, inventory, ledger
  users ............... 41
  profiles ............ 41
  ledger rows ......... 1873
  recomputed balances . 41 users totalling $214430.00
      u_abc123: $5125.00 from 12 ledger row(s)
      ...
restore drill PASSED — this backup is restorable and the ledger recomputes.
```

Exit code 0. A failing run prints `boardwalk restore-drill FAILED:` with the specific problems and
exits 1.

**Run the drill on the OFF-BOX copy, not just the Pi's.** Verifying the file that never left the
machine tests the half of the system that was never in doubt.

### What the drill checks, and why the last one matters most

- `PRAGMA integrity_check` — the pages are coherent.
- All six tables present — the file is this application's database.
- No orphaned ledger rows — no money attached to a user that no longer exists.
- **Every user's balance recomputed as `SUM(ledger.delta_cents)`** — the data is *usable*, not
  merely readable.

That last one is the reason this is a script and not `sqlite3 backup.db .tables`. A backup that
opens cleanly, has every table, and passes `integrity_check` can still have lost ledger rows; it is
a structurally perfect file describing an amount of money nobody has. `tests/backup.test.ts` has a
test for precisely that case. **Compare the reported total against the previous run** — a total
that moved in a way the day's play does not explain is the signal.

### The drill is not a full restore

It proves the file is readable, complete and arithmetically sound. It does **not** prove the
end-to-end recovery *procedure* — stopping the service, swapping the file in, restarting, watching
the API serve a real profile. That is the thing to do the first time on the real Pi:

```bash
sudo systemctl stop boardwalk-api
sudo cp /mnt/boardwalk-db/data/boardwalk.db /mnt/boardwalk-db/data/boardwalk.db.pre-restore
sudo cp /srv/boardwalk-backups/boardwalk-20260718T031500Z.db /mnt/boardwalk-db/data/boardwalk.db
sudo rm -f /mnt/boardwalk-db/data/boardwalk.db-wal /mnt/boardwalk-db/data/boardwalk.db-shm
sudo chown mogar13:mogar13 /mnt/boardwalk-db/data/boardwalk.db
sudo systemctl start boardwalk-api
curl -s https://boardwalk-pi.tail1bed2f.ts.net/health
```

Deleting the stale `-wal`/`-shm` sidecars is not optional: they belong to the database you just
replaced, and leaving them next to a restored file is how a "successful" restore comes up with the
wrong data.

## Owed

- [x] Run `npm run backup` on the real Pi, against the live stick. *(2026-07-18 — `$5215.00`, exit 0)*
- [x] Install and enable the systemd timer; confirm with `systemctl list-timers`. *(next fire 03:16; `Result=success`)*
- [x] Set up the off-box `rsync` target over Tailscale and confirm a file lands there. *(PULL to `~/boardwalk-backups/`; push is impossible — no sshd on the target)*
- [x] Run `npm run restore:drill` on the Pi **and** on the off-box copy. *(both PASSED, `$5215.00` from 2 ledger rows)*
- [ ] Do one full stop/swap/start restore rehearsal (above) and note how long it took.
- [ ] Then, and only then, delete this section and replace it with the date the drill was last run.
