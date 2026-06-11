#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BACKEND_PORT="${MUNG_BACKEND_PORT:-8080}"
FRONTEND_PORT="${MUNG_FRONTEND_PORT:-1234}"
DOCUMENTS_PATH="${MUNG_DOCUMENTS_PATH:-$ROOT/documents}"
BACKEND_PID=""
FRONTEND_PID=""
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT/.venv/bin/python"
fi

if ! find "$ROOT/models" -type f \( -name "*.pt" -o -name "model.safetensors" \) | grep -q .; then
  echo "No local detector models were found."
  echo "See models/README.md for the supported model file names."
  echo "The app can still start, but detection buttons will be disabled for missing models."
fi

mkdir -p "$DOCUMENTS_PATH"

export SIMPLE_PHP_BACKEND_URL="${SIMPLE_PHP_BACKEND_URL:-http://localhost:$BACKEND_PORT}"
export YOLO26_BACKEND_URL="${YOLO26_BACKEND_URL:-http://localhost:$BACKEND_PORT}"

npm run build

cleanup() {
  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$FRONTEND_PID" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

"$PYTHON_BIN" simple-php-backend/server.py --port "$BACKEND_PORT" --documents "$DOCUMENTS_PATH" &
BACKEND_PID=$!

sleep 2

npx http-server dist -a 127.0.0.1 -p "$FRONTEND_PORT" --cors &
FRONTEND_PID=$!

echo
echo "MuNG Studio is running at http://localhost:$FRONTEND_PORT"
echo "Backend is running at http://localhost:$BACKEND_PORT"
echo "Simple Backend token: 123456789"
echo "Press Ctrl-C to stop both servers."
echo

wait "$BACKEND_PID" "$FRONTEND_PID"
