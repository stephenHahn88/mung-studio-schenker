# Web Deployment (hosted, no local models)

This guide explains how to run MuNG Studio as a **hosted web app** so that
annotators just open a URL — they no longer clone the repo, download models, or
run a local Python backend. The models and GPU live on **one** machine; that
machine serves the frontend, the documents, and the recognition backend from a
single origin, and a Cloudflare tunnel makes it reachable on the public
internet.

## How it works

```
                         (public internet)
  annotator's browser  ───────────────────────►  https://<name>.trycloudflare.com
                                                          │  cloudflared tunnel
                                                          ▼
  GPU node (this machine)        python simple-php-backend/server.py :8080
    ├── serves dist/ ............ the built single-page app  (GET /)
    ├── serves documents/ ...... list / open / save mung.xml + images
    └── runs models/ ........... YOLO26 / DETR detection on the GPU
```

Key points:

- **Single origin.** The Python server serves both the SPA and the API, so
  there is no CORS and no separate web host. The frontend is built with
  `SIMPLE_PHP_BACKEND_URL=SAME_ORIGIN` / `YOLO26_BACKEND_URL=SAME_ORIGIN`
  (see `.env.production`), meaning it talks to whatever origin the page was
  loaded from. **The public URL can change without rebuilding the frontend.**
- **Auth.** Every endpoint, including recognition, requires a Bearer token.
  Tokens live in `simple-php-backend/users.json`.
- **Concurrency.** The server is threaded; GPU inference is serialized behind a
  lock so simultaneous requests queue instead of thrashing VRAM.

## One-time setup

Already done on this machine, listed here for reproducing elsewhere:

1. Node deps: `npm ci`
2. Python deps (torch, ultralytics, transformers, pillow, numpy) in the active
   environment — see `requirements-yolo26.txt`.
3. `cloudflared` binary (no root needed):
   ```bash
   curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
     -o ~/bin/cloudflared && chmod +x ~/bin/cloudflared
   ```
4. Tokens: copy the template and edit it.
   ```bash
   cp simple-php-backend/users.example.json simple-php-backend/users.json
   chmod 600 simple-php-backend/users.json
   ```
   Each entry is `{ "name": "...", "token": "..." }`. The `name` shows up in the
   audit log; the `token` is the password an annotator types on the login page.
   Generate strong tokens with:
   ```bash
   python3 -c "import secrets; print('mung-'+secrets.token_urlsafe(18))"
   ```

## Running it (always-on)

Run this in **your own terminal** (ideally inside `tmux`/`screen` so it survives
disconnects):

```bash
tmux new -s mung
./start_web_persistent.sh
```

This builds the frontend (if needed), starts the backend detached, opens the
public tunnel, and prints the public URL (also saved to `logs/public-url.txt`).
Detach from tmux with `Ctrl-b d`; the deployment keeps running.

Stop everything:

```bash
./stop_web.sh
```

### Alternative: two terminals (foreground)

```bash
./start_web.sh       # terminal 1 — build + serve on :8080 (local only)
./start_tunnel.sh    # terminal 2 — open the public URL
```

## Giving access to annotators

Send each person two things:

1. The public URL (e.g. `https://<name>.trycloudflare.com`).
2. Their token from `users.json`.

They open the URL → choose the **Simple Backend** page → paste the token → they
see the shared documents and can run recognition. Nothing to install.

## Updating models

Because models live only here, updating them is a one-place operation:

1. Drop the new weights into `models/` (or point env vars at them — see
   `models/README.md`).
2. Restart the backend (`./stop_web.sh` then `./start_web_persistent.sh`).

Annotators do nothing; their next recognition run uses the new model.

## Stable / custom-domain URL (optional)

The quick tunnel URL is random and changes on restart. For a fixed, memorable
URL, use a **named** Cloudflare tunnel with a domain you control:

```bash
cloudflared tunnel login                          # opens a browser, pick your domain
cloudflared tunnel create mung-studio
cloudflared tunnel route dns mung-studio mung.yourdomain.com
cloudflared tunnel run --url http://localhost:8080 mung-studio
```

No code or build changes are needed — `SAME_ORIGIN` already adapts to whatever
hostname is in front of it.

## Security notes

- Treat `users.json` as secrets (`chmod 600`, never commit — it is gitignored).
- Anyone with a token can read/write every document in the shared library and
  run GPU jobs. Rotate tokens by editing `users.json` and restarting.
- The audit log (`documents/audit_log.txt`) and per-document `access_log.txt` /
  `write_log.txt` record which `name` opened or wrote each document.
- The quick tunnel exposes the service to the whole internet; the only gate is
  the token. Keep tokens private and prefer the named tunnel for anything long
  lived.

## Troubleshooting

- **`./start_web_persistent.sh` does nothing / exits oddly inside an automated
  agent shell:** sandboxed shells may block detached processes. Run it in a
  normal interactive login shell / tmux.
- **No public URL printed:** check `logs/web-tunnel.log`; the line to look for
  contains `trycloudflare.com`.
- **Recognition returns 401:** the annotator is not logged in, or their token
  is not in `users.json`. The frontend sends the same token used for documents.
- **Detection is slow / first call is ~10s:** the model loads into VRAM on the
  first request and stays resident afterward; subsequent calls are faster.
