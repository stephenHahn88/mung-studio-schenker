#!/usr/bin/env bash
# Build the frontend and serve it together with the Python backend on one port.
#
#   ./start_local.sh            then open http://localhost:8080
#
# Environment variables:
#   MUNG_BACKEND_PORT     port of the server (default 8080)
#   MUNG_DOCUMENTS_PATH   folder with one subfolder per page (default ./documents)
#   PYTHON_BIN            Python interpreter (default .venv/bin/python or python3)
# The model actions read the downloaded models from models/ (or MUNG_MODELS_DIR)
# and run in the Python environments set with MUNG_SYMBOL_PYTHON and
# MUNG_MODEL_PYTHON (docs/model-actions.md). Without models the tool works for
# manual annotation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PORT="${MUNG_BACKEND_PORT:-8080}"
DOCUMENTS_PATH="${MUNG_DOCUMENTS_PATH:-$ROOT/documents}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT/.venv/bin/python"
fi

mkdir -p "$DOCUMENTS_PATH"

# The frontend talks to the server that serves it.
export SIMPLE_PHP_BACKEND_URL=SAME_ORIGIN
npm run build

echo
echo "MuNG Studio is running at http://localhost:$PORT"
echo "Development token: 123456789 (set MUNG_USERS or MUNG_USERS_FILE to change it)"
echo "Press Ctrl-C to stop."
echo

exec "$PYTHON_BIN" simple-php-backend/server.py \
  --host 127.0.0.1 --port "$PORT" \
  --documents "$DOCUMENTS_PATH" --frontend dist
