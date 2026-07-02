#!/bin/bash
# backup_documents.sh — off-site, VERSIONED backup of MuNG Studio annotations to Google Drive.
#
# Why not a plain mirror: `rclone sync` would propagate deletions/corruption to the backup.
# So we keep history three ways:
#   1) sync -> current/  with --backup-dir archive/<timestamp>/  (every overwritten/deleted
#      file's PREVIOUS version is moved into a dated archive, never lost)
#   2) one full snapshot per day under snapshots/<date>/  (coarse restore points; text is tiny)
#   3) rclone deletes go to Google Drive Trash by default (30-day net) + Drive version history
# Rollback: copy a file back from archive/<ts>/ or a whole day from snapshots/<date>/ (see RESTORE.md).
#
# Safe to run before the gdrive remote is configured (it just exits). Locked against overlap.
#
#   ~/bin/rclone config           # one-time: create the "gdrive" remote (see the tutorial)
#   bash backup_documents.sh      # run once, or on a timer / via the "Backup now" button

set -uo pipefail

RCLONE="${RCLONE:-/home/users/yh477/bin/rclone}"
# Be explicit about the rclone config so this works identically under cron (where
# HOME/rclone defaults may differ), the web backend, and an interactive shell.
export RCLONE_CONFIG="${RCLONE_CONFIG:-/home/users/yh477/.config/rclone/rclone.conf}"
DOCS="${MUNG_DOCS:-/home/users/yh477/lab/mung-studio-schenker/documents}"
REMOTE="${MUNG_BACKUP_REMOTE:-gdrive:mung-studio-backup}"
LOGDIR="/home/users/yh477/lab/mung-studio-schenker/logs"
LOCK="/tmp/mung_backup_${USER:-$(id -un)}.lock"
TS="$(date +%Y-%m-%dT%H%M%S)"
DAY="$(date +%Y-%m-%d)"
EXCLUDES=(--exclude "*/thumbnail.jpg" --exclude "*/backups/**" \
          --exclude "*/access_log.txt" --exclude "*/write_log.txt" \
          --exclude "audit_log.txt")   # append-only log: handled separately (see below)

mkdir -p "$LOGDIR"

# single-flight: skip if another backup is already running
exec 9>"$LOCK" || exit 0
if ! flock -n 9; then
  echo "$(date) [backup] another run in progress, skipping" >> "$LOGDIR/backup.log"
  exit 0
fi

# not configured yet -> no-op (lets the timer exist before the token is added)
if ! "$RCLONE" listremotes 2>/dev/null | grep -q "^gdrive:"; then
  echo "$(date) [backup] gdrive remote not configured yet, skipping" >> "$LOGDIR/backup.log"
  exit 0
fi

# 1) mirror to current/, archiving any overwritten/deleted file under archive/<ts>/
"$RCLONE" sync "$DOCS" "$REMOTE/current" \
  --backup-dir "$REMOTE/archive/$TS" \
  "${EXCLUDES[@]}" --transfers 8 --checkers 8 \
  --log-file "$LOGDIR/backup.log" --log-level INFO
rc=$?

# 1b) keep the audit log off-site WITHOUT versioning every superseded copy.
#     It is append-only, so current/audit_log.txt is always the COMPLETE cumulative
#     trail. We excluded it from the sync above (so it never lands in archive/<ts>/
#     as confusing near-empty diffs) and instead overwrite it in place here.
if [ -f "$DOCS/audit_log.txt" ]; then
  "$RCLONE" copyto "$DOCS/audit_log.txt" "$REMOTE/current/audit_log.txt" \
    --log-file "$LOGDIR/backup.log" --log-level INFO || true
fi

# 2) one full snapshot per day (cheap for text; coarse restore points)
if ! "$RCLONE" lsf "$REMOTE/snapshots/$DAY" >/dev/null 2>&1; then
  "$RCLONE" copy "$DOCS" "$REMOTE/snapshots/$DAY" "${EXCLUDES[@]}" \
    --log-file "$LOGDIR/backup.log" --log-level INFO
fi

# 3) retention: prune old snapshots (60d) and archives (30d) — only if the dir exists yet.
#    NOTE: no --rmdirs. It tries to rmdir every dir including today's (non-empty) dated
#    folders, which logs harmless-but-noisy "directory not empty" errors every cycle.
#    We only need to delete the OLD FILES; leaving empty dated dirs behind is free/cosmetic.
if "$RCLONE" lsf "$REMOTE/snapshots" >/dev/null 2>&1; then
  "$RCLONE" delete "$REMOTE/snapshots" --min-age 60d 2>>"$LOGDIR/backup.log" || true
fi
if "$RCLONE" lsf "$REMOTE/archive" >/dev/null 2>&1; then
  "$RCLONE" delete "$REMOTE/archive" --min-age 30d 2>>"$LOGDIR/backup.log" || true
fi

if [ "$rc" -eq 0 ]; then
  echo "$(date) [backup] OK ($TS)" >> "$LOGDIR/backup.log"
else
  echo "$(date) [backup] sync exited $rc ($TS)" >> "$LOGDIR/backup.log"
fi
exit "$rc"
