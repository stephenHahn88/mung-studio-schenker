#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${MUNG_STUDIO_SYNC_HOST:-duke-login}"
REMOTE_DIR="${MUNG_STUDIO_SYNC_DIR:-/home/users/yh477/lab/Schenkerian_OMR/mung-studio-schenker}"

ssh "${REMOTE_HOST}" "mkdir -p '${REMOTE_DIR}'"

rsync -az --progress --stats \
  --exclude '.DS_Store' \
  --exclude '.env' \
  --exclude '.env.production' \
  --exclude '.git/' \
  --exclude '.parcel-cache/' \
  --exclude '.venv/' \
  --exclude 'dist/' \
  --exclude 'model_release/' \
  --exclude 'node_modules/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  "${PROJECT_ROOT}/" \
  "${REMOTE_HOST}:${REMOTE_DIR}/"

echo "MuNG Studio synchronized to ${REMOTE_HOST}:${REMOTE_DIR}"
