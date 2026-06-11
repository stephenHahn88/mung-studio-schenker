#!/usr/bin/env bash
#
# start_tunnel.sh — expose the locally-running app (start_web.sh on :8080) to
# the public internet via a Cloudflare tunnel, so other people can use it in a
# browser without installing anything.
#
# Run start_web.sh first (in another terminal), then run this. It prints a
# public https://<random>.trycloudflare.com URL — share that.
#
# This uses a QUICK tunnel: zero-config, but the URL is random and changes
# every restart. Because the frontend is built with SAME_ORIGIN, that is fine
# — nothing needs rebuilding when the URL changes. For a stable, custom-domain
# URL, set up a named Cloudflare tunnel instead (see docs/web-deployment.md).
#
# Configuration:
#   PORT          local backend port to expose (default: 8080)
#   CLOUDFLARED   path to the cloudflared binary (default: searches PATH then ~/bin)

set -euo pipefail

PORT="${PORT:-8080}"

CLOUDFLARED="${CLOUDFLARED:-}"
if [ -z "$CLOUDFLARED" ]; then
  if command -v cloudflared >/dev/null 2>&1; then
    CLOUDFLARED="$(command -v cloudflared)"
  elif [ -x "$HOME/bin/cloudflared" ]; then
    CLOUDFLARED="$HOME/bin/cloudflared"
  else
    echo "cloudflared not found. Install it or set CLOUDFLARED=/path/to/cloudflared." >&2
    exit 1
  fi
fi

echo "Opening a public Cloudflare tunnel to http://localhost:${PORT} ..."
echo "Watch for the https://<something>.trycloudflare.com URL below — that is the"
echo "address to share. Keep this process running; closing it takes the site down."
echo
exec "$CLOUDFLARED" tunnel --url "http://localhost:${PORT}"
