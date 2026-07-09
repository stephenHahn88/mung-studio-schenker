#!/bin/bash
# One auto-deploy cycle. Invoked every ~60s by run_mung_service.sbatch on the
# service node, so a push to GitHub (upstream/main) goes live within ~1-2 min:
#   fetch -> ff-only pull -> rebuild frontend (if src changed) -> restart
#   backend (if backend .py changed; the sbatch watchdog relaunches it).
#
# Safety rules:
#  - documents/ and dist/ are gitignored: annotations are never touched
#  - skips (loudly) if the working tree has uncommitted tracked changes
#  - fast-forward only: never auto-merges diverged history
#  - a failed build never replaces the currently served dist/
#
# Because this script is re-read from disk on every cycle, it updates itself
# via the very git pull it performs.

set -u
ROOT=/home/users/yh477/lab/mung-studio-schenker
cd "$ROOT" || exit 1
# node v24 lives in the (shared) home dir; system node on compute nodes is v12
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"

REMOTE=upstream   # stephenHahn88/mung-studio-schenker (the deploy source)
BRANCH=main
LOGDIR="$ROOT/logs"

log() { echo "$(date '+%F %T') $*"; }

[ "$(git branch --show-current)" = "$BRANCH" ] || { log "not on $BRANCH; skipping"; exit 0; }

git fetch -q "$REMOTE" "$BRANCH" 2>/dev/null || { log "git fetch failed (network?); will retry"; exit 0; }
TARGET=$(git rev-parse "$REMOTE/$BRANCH")
[ "$(git rev-parse HEAD)" = "$TARGET" ] && exit 0   # up to date (stay silent)

log "new commits: $(git rev-parse --short HEAD) -> $(git rev-parse --short "$TARGET")"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  log "SKIP: uncommitted local changes in the checkout; commit/stash them first"
  exit 0
fi
if ! git merge-base --is-ancestor HEAD "$TARGET"; then
  log "SKIP: local history diverged from $REMOTE/$BRANCH; reconcile manually"
  exit 0
fi

CHANGED=$(git diff --name-only HEAD "$TARGET")
git merge -q --ff-only "$TARGET" || { log "ERROR: ff merge failed"; exit 0; }
log "pulled to $(git rev-parse --short HEAD)"

if echo "$CHANGED" | grep -qE '^package(-lock)?\.json'; then
  log "package.json changed -> npm install"
  if ! npm install --no-audit --no-fund >>"$LOGDIR/auto-deploy-npm.log" 2>&1; then
    log "ERROR: npm install failed (see auto-deploy-npm.log); keeping old build"
    exit 0
  fi
fi

if echo "$CHANGED" | grep -qE '^(src/|package(-lock)?\.json|tsconfig|\.parcelrc)'; then
  log "frontend changed -> building"
  rm -rf .parcel-cache dist_autodeploy
  if npx parcel build --public-url ./ --dist-dir dist_autodeploy \
       >>"$LOGDIR/auto-deploy-build.log" 2>&1 && [ -f dist_autodeploy/index.html ]; then
    rm -rf dist_old_auto
    [ -d dist ] && mv dist dist_old_auto
    mv dist_autodeploy dist
    log "frontend deployed"
  else
    log "ERROR: build failed (see auto-deploy-build.log); OLD dist stays live"
    exit 0
  fi
fi

if echo "$CHANGED" | grep -qE '^simple-php-backend/.*\.py'; then
  PIDF="$LOGDIR/backend.pid"
  if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
    log "backend changed -> killing backend (watchdog relaunches with new code)"
    kill "$(cat "$PIDF")"
  else
    log "backend changed but no live backend pid; new code applies on next start"
  fi
fi

log "auto-deploy DONE at $(git rev-parse --short HEAD)"
