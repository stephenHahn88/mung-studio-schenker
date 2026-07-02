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
  annotator's browser  ───────────────────────►  https://<your-domain>  (named tunnel)
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

The service runs as a **self-healing SLURM batch job** (`run_mung_service.sbatch`).
SLURM keeps it alive: if the backend or the Cloudflare tunnel dies it is restarted
automatically, and ~3 min before the wall-time limit the job submits a fresh copy of
itself and hands off — so the deployment is near-continuous with no tmux/screen.
With the **named** tunnel (below) the public URL stays the same across every restart.

```bash
sbatch run_mung_service.sbatch      # start
squeue -u $USER -n mung-web         # check (shows node + runtime)
scancel -n mung-web                 # stop ALL copies (so it won't resubmit)
```

Logs: `logs/slurm-mung-<jobid>.log` (supervisor), `logs/web-backend.log`,
`logs/web-tunnel.log`.

### Redeploy after a code / frontend change (graceful, same URL)

```bash
npm run build                             # rebuild dist/ if the frontend changed
squeue -u $USER -n mung-web               # note the current <jobid>
scancel --signal=USR1 --batch <jobid>     # triggers a clean resubmit onto a fresh job
```

The backend re-reads `server.py` / model code on restart; the named tunnel keeps the
same URL, so annotators are only briefly disconnected.

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
2. Restart the backend (graceful resubmit: `scancel --signal=USR1 --batch <jobid>`).

Annotators do nothing; their next recognition run uses the new model.

## Backups

Annotations in `documents/` are backed up **off-site to Google Drive**, versioned
(a live mirror + daily snapshots + archived previous versions of every changed or
deleted file). A daily `cron` job runs `backup_documents.sh` at 05:00, and the
sidebar's **"Backup now"** button triggers one on demand. To recover a deleted or
overwritten file, use `find_backup_versions.sh <name>` and follow **`RESTORE.md`**.

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

- **Service not reachable:** check it's queued/running with
  `squeue -u $USER -n mung-web`; if absent, `sbatch run_mung_service.sbatch`.
  Inspect `logs/slurm-mung-<jobid>.log` for the supervisor's restart messages.
- **Tunnel / URL issues:** check `logs/web-tunnel.log`. With the named tunnel the
  URL is fixed; a quick tunnel prints a `trycloudflare.com` line instead.
- **Recognition returns 401:** the annotator is not logged in, or their token
  is not in `users.json`. The frontend sends the same token used for documents.
- **Detection is slow / first call is ~10s:** the model loads into VRAM on the
  first request and stays resident afterward; subsequent calls are faster.
