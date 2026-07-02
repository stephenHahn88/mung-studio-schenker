# Restoring MuNG Studio annotations from the Google Drive backup

Backups live under `gdrive:mung-studio-backup/` (Google Drive), written by `backup_documents.sh`:

```
mung-studio-backup/
  current/                    # latest mirror of documents/
  archive/<timestamp>/        # PREVIOUS version of every file changed/deleted at that sync
  snapshots/<YYYY-MM-DD>/      # one full snapshot per day (kept 60 days)
```
All commands use the rclone at `~/bin/rclone`. `DOCS=/home/users/yh477/lab/mung-studio-schenker/documents`.

> Note: `audit_log.txt` is append-only, so it is kept (always complete) in `current/`
> but deliberately NOT versioned into `archive/` (it changed every sync and spawned
> confusing near-empty archive folders). Everything else IS versioned.

## Find every backed-up version of a file (easiest)
```bash
bash find_backup_versions.sh Schubert_Einsamkeit_Graphs011/mung.xml   # one file
bash find_backup_versions.sh Schubert_Einsamkeit_Graphs011            # whole document
```
It lists, newest-first, every copy across `current/`, `archive/<ts>/` and
`snapshots/<date>/` with modtime + size, and prints the restore command.

## See what's available
```bash
~/bin/rclone lsf gdrive:mung-studio-backup/snapshots/            # daily snapshots
~/bin/rclone lsf gdrive:mung-studio-backup/archive/              # per-sync archives (timestamps)
```

## Roll back ONE document (recover a deleted / clobbered page)
Find the newest archive that still has the good version, then copy it back:
```bash
# preview which archives contain that document
~/bin/rclone lsf --dirs-only gdrive:mung-studio-backup/archive/ | sort
# restore its mung.xml from a chosen timestamp
~/bin/rclone copy \
  "gdrive:mung-studio-backup/archive/<timestamp>/<DocName>/mung.xml" \
  "$DOCS/<DocName>/"
```
Or from a daily snapshot:
```bash
~/bin/rclone copy "gdrive:mung-studio-backup/snapshots/<DATE>/<DocName>" "$DOCS/<DocName>"
```

## Roll back EVERYTHING to a given day (disaster recovery)
```bash
# e.g. server rebuilt, documents/ empty -> restore the whole set from a snapshot
~/bin/rclone copy "gdrive:mung-studio-backup/snapshots/<DATE>" "$DOCS" --progress
# (or from current/ for the very latest)
~/bin/rclone copy "gdrive:mung-studio-backup/current" "$DOCS" --progress
```

## Malicious / accidental deletion
Scenario: someone deletes/clobbers a document, then a backup runs and pushes the
deletion to `current/`. You are still covered by THREE independent layers:
1. **archive/** — the deleted/overwritten file's previous version was auto-moved to
   `archive/<timestamp-of-the-deletion-sync>/` (kept 30 days). Run
   `find_backup_versions.sh <name>` to locate it, then copy it back (above).
2. **snapshots/** — daily full snapshots give coarse restore points for 60 days,
   independent of any single sync.
3. **Google Drive Trash** — rclone deletions go to Trash (default), recoverable for
   ~30 days by the Drive account owner at drive.google.com, EVEN if the deletion was
   done on the server. The `drive.file` token scope also means the token can only
   ever touch files IT created (the backup folder) — it cannot reach the rest of your
   Drive.

Limit of protection (be honest): a determined insider who has the server's rclone
token could also delete the Drive backup itself (`rclone delete` + `rclone cleanup`
would even bypass Trash). To defend against THAT, keep an air-gapped/pull-based copy
the server cannot reach — e.g. a cron on a *different* machine/account that pulls
`current/` periodically, or turn on Drive's own file version history. Ask if you want
this stronger tier set up.

## Sanity check the backup is running
```bash
tail -n 20 /home/users/yh477/lab/mung-studio-schenker/logs/backup.log
~/bin/rclone lsf gdrive:mung-studio-backup/current/ | head
```
