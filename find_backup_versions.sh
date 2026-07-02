#!/bin/bash
# find_backup_versions.sh — locate EVERY backed-up version of a file/document in
# the Google Drive backup, across all three layers (current / archive / snapshots).
#
# Usage:
#   bash find_backup_versions.sh <path-substring>
# Examples:
#   bash find_backup_versions.sh Schubert_Einsamkeit_Graphs011/mung.xml
#   bash find_backup_versions.sh Schubert_Einsamkeit_Graphs011      # whole document
#
# Output lists, newest first, where each version lives + its modtime & size, and
# prints the exact rclone command to restore a chosen version.
set -uo pipefail

RCLONE="${RCLONE:-/home/users/yh477/bin/rclone}"
REMOTE="${MUNG_BACKUP_REMOTE:-gdrive:mung-studio-backup}"
DOCS="${MUNG_DOCS:-/home/users/yh477/lab/mung-studio-schenker/documents}"
Q="${1:-}"

if [ -z "$Q" ]; then
  echo "usage: $0 <path-substring>   (e.g. Schubert_Einsamkeit_Graphs011/mung.xml)"
  exit 1
fi

echo "Searching backup '$REMOTE' for versions matching: *$Q*"
echo "(newest first; 'archive/<ts>' = version just BEFORE it was changed/deleted at that sync)"

for area in current archive snapshots; do
  echo ""
  echo "### $area/"
  # --format "tsp": modtime ; size ; path   — filter by substring, newest first
  out=$("$RCLONE" lsf -R --format "tsp" --separator "  |  " "$REMOTE/$area" 2>/dev/null \
        | grep -i -- "$Q" | sort -r)
  if [ -z "$out" ]; then
    echo "  (no matching version here)"
  else
    echo "$out" | sed 's/^/  /'
  fi
done

cat <<EOF

--------------------------------------------------------------------------------
To restore one version back onto the server, copy it into $DOCS, e.g.:

  $RCLONE copyto \\
    "$REMOTE/archive/<timestamp>/<DocName>/mung.xml" \\
    "$DOCS/<DocName>/mung.xml"

  # or a whole document folder from a daily snapshot:
  $RCLONE copy "$REMOTE/snapshots/<DATE>/<DocName>" "$DOCS/<DocName>"

Also: rclone deletions go to Google Drive Trash (~30 days) — you (the Drive
account owner) can restore them at drive.google.com even if the deletion happened
on the server. See RESTORE.md for the full playbook.
EOF
