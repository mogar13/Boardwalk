#!/bin/bash
# Boardwalk DB-stick watchdog: remount /mnt/boardwalk-db after a USB event and bring the
# referee back up. Invoked every minute by boardwalk-mount-watchdog.timer.
#
# WHY THIS EXISTS. `boardwalk-api.service` declares `RequiresMountsFor=/mnt/boardwalk-db`, so
# systemd STOPS it — cleanly, SIGTERM, exit 0 — the moment the stick unmounts. That is the unit
# doing its job: a referee with no ledger must not run. But it means `Restart=on-failure` never
# fires, because nothing failed, and the service stays down until a human notices. On 2026-08-09
# that was 3h28m of "sign-in silently bounces you back to the login form" (the client reads a dead
# API as a failed profile load). Nothing on this box remounted the stick: `nvr-watchdog` recovers
# /media/recordings only.
#
# WHY IT IS PASSIVE ABOUT USB. `nvr-watchdog` already unbinds and rebinds the xhci controller to
# recover the NVR drive — which is what drops THIS stick as collateral. Two scripts resetting one
# USB controller is strictly worse than one, so this one never touches the bus: it waits for the
# device node to exist and then mounts it. That makes the two cooperate rather than fight — the NVR
# watchdog brings the controller back, this one puts the database back on it.
#
# WHY NO fsck. The kernel replays the ext4 journal on mount, which is the designed recovery path
# and is exactly what cleaned this filesystem after the real incident ("EXT4-fs (sdb1): recovery
# complete", integrity_check ok, not one row lost). An unattended repair tool pointed at a
# half-present USB device is a way to turn a recoverable outage into a restore-from-backup. If the
# mount fails, this logs loudly and stops, because that is the case where a human should look.
set -u

LABEL=boardwalk-db
TARGET=/mnt/boardwalk-db
# Mirrors DB_PATH in ~/boardwalk-secrets/boardwalk-api.env. Deliberately NOT sourced from that
# file: it also holds TICKET_SECRET, and a script that reads secrets is one leak away from logging
# one. If DB_PATH ever moves, move this with it.
DB_REL=data/boardwalk.db
UNIT=boardwalk-api.service
# Set while the mount is known-missing, so a restored mount can be told from a service a human
# stopped on purpose (a deploy). Under /run, so it evaporates on reboot.
STAMP=/run/boardwalk-mount-watchdog.lost

log() { logger -t boardwalk-mount-watchdog -- "$*"; }

exec 9>/run/boardwalk-mount-watchdog.lock
flock -n 9 || exit 0

mounted() { findmnt -no TARGET "$TARGET" >/dev/null 2>&1; }

# Mounted, carrying the real database, and writable. The DB check is the load-bearing one: with
# nothing mounted, $TARGET is a bare empty directory on the root filesystem, and starting the
# referee against that is how you get a brand-new empty ledger while the real one sits unmounted.
healthy() {
  mounted || return 1
  [ -f "$TARGET/$DB_REL" ] || return 1
  local probe="$TARGET/.wd_$$"
  timeout 15 bash -c "touch '$probe' && rm -f '$probe'" >/dev/null 2>&1 || return 1
  return 0
}

# Bring the referee back ONLY if we are recovering a mount that was lost. Without the stamp this
# would fight a human: `systemctl stop boardwalk-api` during a deploy looks identical, in unit
# state, to a service systemd stopped for us — both are enabled-and-inactive.
start_api_if_recovering() {
  [ -f "$STAMP" ] || return 0
  if systemctl is-active --quiet "$UNIT"; then
    rm -f "$STAMP"
    return 0
  fi
  if systemctl start "$UNIT" >/dev/null 2>&1; then
    log "RECOVERED: mounted $TARGET and started $UNIT"
    rm -f "$STAMP"
  else
    log "ERROR: $TARGET is healthy but $UNIT failed to start; leaving stamp for the next run"
  fi
}

if healthy; then
  start_api_if_recovering
  exit 0
fi

# Unhealthy from here down. Record it, so whichever later run finds the mount back knows this was
# a loss rather than a deliberate stop.
if [ ! -f "$STAMP" ]; then
  log "UNHEALTHY: $TARGET not mounted/writable — will remount when the device returns"
  : > "$STAMP"
fi

if [ ! -e "/dev/disk/by-label/$LABEL" ]; then
  # Hardware genuinely absent — mid-USB-reset, or the stick is out. Nothing to do but wait; the
  # next run picks it up. Not logged every minute, because a stick left out would fill the journal.
  exit 0
fi

if mounted; then
  log "ERROR: $TARGET is mounted but unhealthy (missing $DB_REL, or read-only) — NOT touching it"
  exit 1
fi

# Options come from fstab, so there is one place that decides how this filesystem is mounted.
if ! mount "$TARGET" >/dev/null 2>&1; then
  log "ERROR: mount $TARGET failed with the device present — needs a human (fsck?)"
  exit 1
fi

if healthy; then
  log "remounted $TARGET"
  start_api_if_recovering
else
  log "ERROR: mounted $TARGET but it is still unhealthy — NOT starting $UNIT"
  exit 1
fi
