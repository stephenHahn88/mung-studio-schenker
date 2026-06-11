#!/usr/bin/env bash
#
# start_web_persistent.sh — build + serve the hosted app AND open a public
# Cloudflare tunnel, both detached so they survive logging out / closing the
# terminal. Use this for an "always-on" deployment.
#
# Logs:    logs/web-backend.log, logs/web-tunnel.log
# PIDs:    logs/web-backend.pid, logs/web-tunnel.pid
# URL:     logs/public-url.txt  (also printed below)
#
# Stop everything with ./stop_web.sh
#
# Config (export to override): MUNG_PYTHON, PORT, YOLO26_MODELS_DIR,
#   YOLO26_DEVICE, MUNG_USERS_FILE, CLOUDFLARED

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
mkdir -p logs

# Default to the venv that has the matching ultralytics (8.4.18, with E2ELoss);
# bare `python3` on the cluster resolves to ~/.local ultralytics 8.3.102 which
# cannot load the YOLO26 weights. Override with MUNG_PYTHON if needed.
DEFAULT_PY="/home/users/yh477/venvs/cs572_colab/bin/python3"
[ -x "$DEFAULT_PY" ] || DEFAULT_PY="python3"
MUNG_PYTHON="${MUNG_PYTHON:-$DEFAULT_PY}"
PORT="${PORT:-8080}"
export YOLO26_MODELS_DIR="${YOLO26_MODELS_DIR:-$ROOT/models}"
export YOLO26_DEVICE="${YOLO26_DEVICE:-0}"
if [ -z "${MUNG_USERS_FILE:-}" ] && [ -f "$ROOT/simple-php-backend/users.json" ]; then
  export MUNG_USERS_FILE="$ROOT/simple-php-backend/users.json"
fi

CLOUDFLARED="${CLOUDFLARED:-}"
if [ -z "$CLOUDFLARED" ]; then
  if command -v cloudflared >/dev/null 2>&1; then CLOUDFLARED="$(command -v cloudflared)"
  elif [ -x "$HOME/bin/cloudflared" ]; then CLOUDFLARED="$HOME/bin/cloudflared"
  else echo "cloudflared not found; set CLOUDFLARED=/path/to/cloudflared" >&2; exit 1; fi
fi

# Refuse to double-start.
if [ -f logs/web-backend.pid ] && kill -0 "$(cat logs/web-backend.pid)" 2>/dev/null; then
  echo "Backend already running (pid $(cat logs/web-backend.pid)). Run ./stop_web.sh first." >&2
  exit 1
fi

# Build if needed.
if [ ! -d node_modules ]; then npm ci; fi
if [ ! -f dist/index.html ]; then echo "Building frontend..."; npm run build; fi

# --- backend (detached) ---------------------------------------------------
echo "Starting backend on :$PORT ..."
setsid nohup "$MUNG_PYTHON" simple-php-backend/server.py \
  --port "$PORT" --documents "$ROOT/documents" --frontend "$ROOT/dist" \
  > logs/web-backend.log 2>&1 &
echo $! > logs/web-backend.pid

# Wait for it to answer.
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT/"; then break; fi
  sleep 0.5
done

# --- tunnel (detached) ----------------------------------------------------
echo "Opening public Cloudflare tunnel ..."
: > logs/web-tunnel.log
setsid nohup "$CLOUDFLARED" tunnel --url "http://localhost:$PORT" \
  > logs/web-tunnel.log 2>&1 &
echo $! > logs/web-tunnel.pid

# Capture the public URL.
URL=""
for _ in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' logs/web-tunnel.log | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 0.5
done

if [ -n "$URL" ]; then
  echo "$URL" > logs/public-url.txt
  echo
  echo "============================================================"
  echo "  PUBLIC URL:  $URL"
  echo "  (also saved to logs/public-url.txt)"
  echo "  Backend pid: $(cat logs/web-backend.pid)   Tunnel pid: $(cat logs/web-tunnel.pid)"
  echo "  Stop with:   ./stop_web.sh"
  echo "============================================================"
else
  echo "Tunnel started but no URL captured yet — check logs/web-tunnel.log" >&2
fi
