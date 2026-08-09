#!/bin/bash
# Pull the Pi's verified backups off-box, and PROVE the newest one restores.
#
# Runs on the workstation, NOT on the Pi. That is the whole point: BACKUP.md has said since
# 2026-07-18 that "the stick and the Pi fail together" and that off-box is a PULL — the target
# holds the credentials, so a compromised Pi cannot reach into the backup store, and the Pi cannot
# reach this box anyway (it runs no sshd). What was missing was anything that RAN it: the off-box
# copies were last refreshed by hand on 2026-07-18, three weeks stale, while the nightly on-Pi
# backup wrote faithfully to `/mnt/boardwalk-db/backups` — a directory on the very stick it exists
# to survive. On 2026-08-09 that stick fell off the USB bus. It came back; the point is that the
# day it does not, every backup goes with it.
#
# IT VERIFIES RATHER THAN COPIES. `npm run restore:drill` is the repo's own checker and this calls
# it rather than reimplementing it — a second copy of "is this backup sound" is a second answer
# waiting to disagree with the first. BACKUP.md: "Run the drill on the OFF-BOX copy, not just the
# Pi's. Verifying the file that never left the machine tests the half of the system that was never
# in doubt."
#
# IT FAILS LOUDLY, NEVER QUIETLY. Every exit below is non-zero on trouble, because a backup job
# that skips is a backup job that reports success by doing nothing — this repo's oldest defect, and
# the reason `format:check` sat with zero callers for a phase. `systemctl --user status` is where
# that lands.
set -uo pipefail

# Tried in order, and the ORDER IS THE BUG FIX. The pull unit that ran here before this one failed
# every morning from at least 2026-08-03 with:
#
#     ssh: Could not resolve hostname boardwalk-pi.tail1bed2f.ts.net: Temporary failure in name
#     resolution
#
# `Persistent=true` fires a missed run moments after boot, and Tailscale's MagicDNS has not settled
# by then (this box carries tailscaled's "System DNS config not ideal, /etc/resolv.conf overwritten"
# health warning). So the off-box copy silently stopped at 2026-07-18 while the unit dutifully went
# red into a journal nobody reads -- a backup that fails loudly to an empty room is a backup that is
# not happening. A tailnet IP needs no DNS at all, so it is the answer to exactly this failure; the
# hostname stays first because it survives a node re-address, and the LAN IP last because it is the
# quickest when it works and harmless when it does not.
REMOTES="${BOARDWALK_PI_HOSTS:-mogar13@boardwalk-pi.tail1bed2f.ts.net mogar13@100.104.118.78 mogar13@192.168.100.99}"
# How long to keep trying before giving up. Covers a boot-time race with the network coming up,
# without turning a genuinely-down Pi into a unit that hangs all day.
WAIT_SECS="${BACKUP_PULL_WAIT_SECS:-600}"
REMOTE_DIR=/mnt/boardwalk-db/backups/
LOCAL_DIR="${BOARDWALK_BACKUP_DIR:-$HOME/boardwalk-backups}"
REPO="${BOARDWALK_API_DIR:-$HOME/Documents/Github/Boardwalk/boardwalk-api}"
# 0 = keep forever. Deliberately the default: BACKUP.md argues the off-box copy should hold a
# LONGER history than the Pi, "since the remote is the copy that survives the Pi". A day of
# snapshots is ~1MB.
KEEP_DAYS="${BACKUP_PULL_KEEP_DAYS:-0}"

die() { echo "backup-pull FAILED: $*" >&2; exit 1; }

mkdir -p "$LOCAL_DIR" || die "cannot create $LOCAL_DIR"

# Find an address that actually answers, retrying while the network finishes coming up.
reachable() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$1" true >/dev/null 2>&1
}

REMOTE=""
deadline=$(( $(date +%s) + WAIT_SECS ))
while :; do
  for candidate in $REMOTES; do
    if reachable "$candidate"; then REMOTE="$candidate"; break 2; fi
  done
  [ "$(date +%s)" -lt "$deadline" ] || break
  sleep 30
done
[ -n "$REMOTE" ] || die "no route to the Pi after ${WAIT_SECS}s (tried: $REMOTES)"

# NO --delete. The Pi prunes at BACKUP_KEEP_DAYS=14; mirroring that here would delete the deep
# history the moment the Pi pruned it, which is backwards -- this copy is the one that outlives the
# stick.
rsync -az --timeout=120 "$REMOTE:$REMOTE_DIR" "$LOCAL_DIR/" \
  || die "rsync from $REMOTE failed (reachable, so: ssh key, permissions, or disk)"

newest=$(find "$LOCAL_DIR" -maxdepth 1 -name 'boardwalk-*.db' -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2-)
[ -n "$newest" ] || die "no boardwalk-*.db in $LOCAL_DIR after rsync"

# A pulled file that is merely PRESENT proves nothing. Restore-drill it, from the repo, so there is
# exactly one implementation of "sound backup" in this project.
[ -d "$REPO" ] || die "boardwalk-api checkout not at $REPO (set BOARDWALK_API_DIR)"
cd "$REPO" || die "cannot cd $REPO"
npm run --silent restore:drill -- "$newest" || die "restore drill did not pass on $newest"

if [ "$KEEP_DAYS" -gt 0 ]; then
  # `boardwalk-*.db` only, never "everything in the directory" -- the on-Pi backup script's own
  # rule, for the same reason.
  find "$LOCAL_DIR" -maxdepth 1 -name 'boardwalk-*.db' -mtime "+$KEEP_DAYS" -delete
fi

count=$(find "$LOCAL_DIR" -maxdepth 1 -name 'boardwalk-*.db' | wc -l)
echo "backup-pull ok: $count off-box snapshot(s) in $LOCAL_DIR via $REMOTE, newest verified: $(basename "$newest")"
