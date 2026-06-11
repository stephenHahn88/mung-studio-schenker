#!/usr/bin/env bash
#
# start_web.sh — build the frontend and serve the whole hosted app from ONE
# origin on http://localhost:8080 (API + single-page app + GPU recognition).
#
# This does NOT expose anything to the public internet. To make it reachable
# by other people, run ./start_tunnel.sh in a second terminal once this is up.
#
# Configuration (override by exporting before running):
#   MUNG_PYTHON       python interpreter with torch/ultralytics/transformers
#                     (default: python3 — must be the env that has the deps)
#   PORT              backend port (default: 8080)
#   YOLO26_MODELS_DIR directory holding the model files (default: ./models)
#   YOLO26_DEVICE     CUDA device for inference (default: 0)
#   MUNG_USERS_FILE   JSON list of {name, token} (default: simple-php-backend/users.json
#                     if it exists; otherwise the built-in dev token is used)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Default to the venv that has the matching ultralytics (8.4.18, with E2ELoss);
# bare `python3` on the cluster resolves to ~/.local ultralytics 8.3.102 which
# cannot load the YOLO26 weights. Override with MUNG_PYTHON if needed.
DEFAULT_PY="/home/users/yh477/venvs/cs572_colab/bin/python3"
[ -x "$DEFAULT_PY" ] || DEFAULT_PY="python3"
MUNG_PYTHON="${MUNG_PYTHON:-$DEFAULT_PY}"
PORT="${PORT:-8080}"
export YOLO26_MODELS_DIR="${YOLO26_MODELS_DIR:-$ROOT/models}"
export YOLO26_DEVICE="${YOLO26_DEVICE:-0}"

# --- users / tokens -------------------------------------------------------
if [ -z "${MUNG_USERS_FILE:-}" ] && [ -f "$ROOT/simple-php-backend/users.json" ]; then
  export MUNG_USERS_FILE="$ROOT/simple-php-backend/users.json"
fi
if [ -z "${MUNG_USERS_FILE:-}" ]; then
  echo "WARNING: no users.json found — using the built-in dev token 123456789."
  echo "         Copy simple-php-backend/users.example.json to users.json and"
  echo "         set real per-annotator tokens before sharing the public URL."
fi

# --- dependencies ---------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "Installing npm dependencies (first run)..."
  npm ci
fi

# --- build the frontend (reads .env.production -> SAME_ORIGIN) ------------
echo "Building frontend..."
npm run build

# --- serve API + frontend from one origin ---------------------------------
echo
echo "Serving on http://localhost:${PORT}  (Ctrl-C to stop)"
echo "Models:    $YOLO26_MODELS_DIR  (device $YOLO26_DEVICE)"
echo "Documents: $ROOT/documents"
echo
exec "$MUNG_PYTHON" simple-php-backend/server.py \
  --port "$PORT" \
  --documents "$ROOT/documents" \
  --frontend "$ROOT/dist"
