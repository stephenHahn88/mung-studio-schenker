# Hosting MuNG Studio for a team

Annotators can use MuNG Studio from a browser without installing anything
when one machine serves the frontend, the documents and the model actions
from a single origin.

```
annotator's browser ──HTTPS──> reverse proxy ──> python simple-php-backend/server.py :8080
                                                   ├── serves dist/ (the built frontend)
                                                   ├── serves and saves documents/
                                                   └── runs the model actions (optional)
```

## Setup

1. Install the frontend dependencies and build with `SAME_ORIGIN`, so the
   frontend talks to whatever origin it was loaded from:
   ```bash
   npm ci
   SIMPLE_PHP_BACKEND_URL=SAME_ORIGIN npm run build
   ```
2. Create one token per annotator:
   ```bash
   cp simple-php-backend/users.example.json simple-php-backend/users.json
   chmod 600 simple-php-backend/users.json
   python3 -c "import secrets; print(secrets.token_urlsafe(18))"
   ```
   Each entry is `{"name": "...", "token": "..."}`. The name appears in the
   audit log and in the collaboration presence bar; the token is the password
   an annotator enters on the Simple Backend page.
3. Optionally configure the model actions ([model-actions.md](model-actions.md)).
4. Start the server:
   ```bash
   MUNG_USERS_FILE=simple-php-backend/users.json \
     python3 simple-php-backend/server.py --host 127.0.0.1 --port 8080 \
     --documents documents --frontend dist
   ```
5. Put an HTTPS reverse proxy (for example nginx or Caddy) in front of port
   8080. Keep `collab-stream` responses unbuffered, because they are
   server-sent events.

The server is threaded: reading and saving pages continue while a model
action runs. Model actions run one at a time by default
(`MUNG_MODEL_MAX_CONCURRENT`).

## Updating

After a code change, rebuild `dist/` if the frontend changed and restart
`server.py`. Documents are never touched by a rebuild; `documents/` and
`dist/` are ignored by git.

## Backups and logs

Every save writes `documents/<page>/backups/<date>.xml`, a copy of the page
for that day. Back up the whole `documents/` folder regularly with the tools
of your hosting environment. `documents/audit_log.txt` and the per-page
`access_log.txt` and `write_log.txt` record which user opened or saved each
page.

## Security notes

- Treat `users.json` as a secret and never commit it.
- Anyone with a token can read and write every document and run the models.
  Rotate tokens by editing `users.json` and restarting the server.
- Without `MUNG_USERS_FILE` or `MUNG_USERS`, the server accepts the public
  development token `123456789`; never expose such a server.
