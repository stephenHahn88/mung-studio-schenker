#!/usr/bin/env bash
#
# start_web_tmux.sh — run the hosted app inside a persistent tmux session named
# "mung": window 0 = GPU backend (API + frontend + recognition), window 1 =
# public Cloudflare tunnel. The tmux server keeps both alive after you detach
# or log out (as long as the SLURM allocation on this GPU node holds).
#
# Usage:
#   ./start_web_tmux.sh           # start (prints the public URL)
#   tmux attach -t mung           # watch logs / interact
#   (Ctrl-b d to detach)
#   tmux kill-session -t mung     # stop everything
#
# Logs: logs/web-backend.log, logs/web-tunnel.log
# URL:  logs/public-url.txt (also printed)

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"; mkdir -p logs

PORT="${PORT:-8080}"
# venv with the matching ultralytics (8.4.18 / E2ELoss); bare python3 on the
# cluster is ~/.local 8.3.102 and CANNOT load the YOLO26 weights.
PY="${MUNG_PYTHON:-/home/users/yh477/venvs/cs572_colab/bin/python3}"
[ -x "$PY" ] || PY=python3
CF="${CLOUDFLARED:-/home/users/yh477/bin/cloudflared}"
[ -x "$CF" ] || CF="$(command -v cloudflared || true)"
USERS="$ROOT/simple-php-backend/users.json"

if [ ! -f dist/index.html ]; then echo "No dist/ — run: npm run build" >&2; exit 1; fi

# Build the two window commands.
BACKEND_CMD="YOLO26_MODELS_DIR=$ROOT/models YOLO26_DEVICE=0 MUNG_USERS_FILE=$USERS $PY simple-php-backend/server.py --port $PORT --documents $ROOT/documents --frontend $ROOT/dist > logs/web-backend.log 2>&1"
TUNNEL_CMD="$CF tunnel --url http://localhost:$PORT > logs/web-tunnel.log 2>&1"

tmux kill-session -t mung 2>/dev/null
: > logs/web-tunnel.log
# Create the session in a clean command (so the tmux server daemonizes and
# survives); the heavy processes run as the windows' own commands.
tmux new-session -d -s mung -n backend -c "$ROOT" "$BACKEND_CMD"
tmux new-window  -t mung   -n tunnel  -c "$ROOT" "$TUNNEL_CMD"

# Capture the public URL from the tunnel log.
URL=""
for _ in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' logs/web-tunnel.log | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 0.5
done

echo
echo "============================================================"
echo "  tmux session 'mung' started (backend + tunnel)."
if [ -n "$URL" ]; then
  echo "$URL" > logs/public-url.txt
  echo "  PUBLIC URL:  $URL"
else
  echo "  Tunnel URL not captured yet — check logs/web-tunnel.log"
fi
echo "  Attach:  tmux attach -t mung      Stop:  tmux kill-session -t mung"
echo "============================================================"
