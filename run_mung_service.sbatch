#!/bin/bash
# run_mung_service.sbatch — run the MuNG Studio web service as a self-resubmitting,
# self-healing SLURM batch job. SLURM manages the process (no tmux needed).
#  - If the backend or the tunnel process dies, it is restarted automatically
#    (so a dropped cloudflare tunnel no longer takes the whole service down).
#  - ~3 minutes before the wall-time runs out, the job submits a fresh copy of
#    itself and exits, so the service is near-continuous.
# With a NAMED cloudflare tunnel the public URL stays the same across every
# restart, handoff and node change.
#
# Start it:   sbatch run_mung_service.sbatch
# Check it:   squeue -u $USER -n mung-web
# Stop it:    scancel -n mung-web      (cancel ALL copies so it won't resubmit)
#
#SBATCH --job-name=mung-web
#SBATCH --partition=compsci-gpu
#SBATCH --account=users
#SBATCH --gres=gpu:a5000:1
#SBATCH --mem=64G
#SBATCH --cpus-per-task=1
#SBATCH --time=90-00:00:00
#SBATCH --signal=B:USR1@180
#SBATCH --requeue
#SBATCH --open-mode=append
#SBATCH --output=/home/users/yh477/lab/mung-studio-schenker/logs/slurm-mung-%j.log

set -uo pipefail
ROOT=/home/users/yh477/lab/mung-studio-schenker
cd "$ROOT"; mkdir -p logs

PY=/home/users/yh477/venvs/cs572_colab/bin/python3
CF=/home/users/yh477/bin/cloudflared
PORT=8080

# Near the wall-time SLURM sends SIGUSR1 to THIS batch shell (the B: prefix).
# Submit a fresh job, kill children, exit cleanly.
_resubmit() {
  echo "$(date) near time limit -> resubmitting service job"
  sbatch "$ROOT/run_mung_service.sbatch" || echo "WARN: resubmit failed"
  kill "${BACKEND_PID:-}" "${TUNNEL_PID:-}" "${DEPLOY_LOOP_PID:-}" 2>/dev/null || true
  exit 0
}
trap _resubmit USR1

echo "$(date) starting on $(hostname), CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-?}"

# --- backend (frontend + documents + GPU recognition) ---
start_backend() {
  YOLO26_MODELS_DIR="$ROOT/models" YOLO26_DEVICE=0 \
    MUNG_USERS_FILE="$ROOT/simple-php-backend/users.json" \
    "$PY" simple-php-backend/server.py --port "$PORT" \
    --documents "$ROOT/documents" --frontend "$ROOT/dist" \
    >> logs/web-backend.log 2>&1 &
  BACKEND_PID=$!
  echo "$BACKEND_PID" > logs/backend.pid   # auto-deploy uses this to restart us
  echo "$(date) backend started (pid $BACKEND_PID)"
}

# --- public tunnel: named (fixed URL) if configured, else quick tunnel ---
start_tunnel() {
  if [ -f "$HOME/.cloudflared/config.yml" ]; then
    echo "$(date) using NAMED tunnel (fixed URL)"
    "$CF" tunnel run mung >> logs/web-tunnel.log 2>&1 &
  else
    echo "$(date) no ~/.cloudflared/config.yml -> random quick tunnel"
    "$CF" tunnel --url "http://localhost:$PORT" >> logs/web-tunnel.log 2>&1 &
  fi
  TUNNEL_PID=$!
  echo "$(date) tunnel started (pid $TUNNEL_PID)"
}

start_backend
start_tunnel

# --- auto-deploy: poll GitHub (upstream/main) and update the running service ---
# The script is re-read from disk each cycle, so it self-updates via git pull.
(
  while true; do
    sleep 60
    bash "$ROOT/scripts/auto_deploy_once.sh" >> "$ROOT/logs/auto-deploy.log" 2>&1
  done
) &
DEPLOY_LOOP_PID=$!
echo "$(date) auto-deploy loop started (pid $DEPLOY_LOOP_PID, watching upstream/main)"

# --- off-site backup of documents/ to Google Drive ---
# Handled by a DAILY cron job (see `crontab -l`: "mung-studio daily backup"), which is
# decoupled from this service so backups keep running even if the web job is down.
# The "Backup now" button calls backup_documents.sh directly for on-demand backups.
# (This replaced an in-job every-10-minutes loop.)

# Supervise: block until SOME child exits (or the USR1 trap fires near wall-time
# and resubmits). Whichever child died is restarted, so a dropped tunnel or a
# backend crash self-heals instead of taking the whole job down.
while true; do
  wait -n "$BACKEND_PID" "$TUNNEL_PID"
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "$(date) backend exited -> restarting in 5s"
    sleep 5
    start_backend
  fi
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "$(date) tunnel exited -> restarting in 5s"
    sleep 5
    start_tunnel
  fi
done
