# Python backend

`simple-php-backend/server.py` is the backend used for the Schenkerian
annotation. It implements the documents API of the original
[Simple PHP Backend](simple-php-backend.md) (`index.php`) and adds:

- a four-stage document workflow (symbol recognition, precedence links,
  syntax links, temporal structure),
- a shared registry of custom classes and display colors,
- review comments per document,
- real-time collaboration (several annotators on one page),
- the model actions described in [model-actions.md](model-actions.md),
- serving the built frontend from the same origin.

It needs Python 3.10 or newer and Pillow
([requirements.txt](../simple-php-backend/requirements.txt)).


## Running

```bash
npm ci
SIMPLE_PHP_BACKEND_URL=SAME_ORIGIN npm run build
python3 simple-php-backend/server.py --port 8080 --documents documents --frontend dist
# open http://localhost:8080 and sign in with the token 123456789
```

`./start_local.sh` runs the same steps. During frontend development, run
`npm start` (port 1234) and the backend without `--frontend`; `.env` then
points the frontend to `http://localhost:8080`.

Options and environment variables:

| Option / variable | Meaning |
|---|---|
| `--host`, `--port` | listening address (default `0.0.0.0:8080`) |
| `--documents` / `MUNG_DOCUMENTS_PATH` | folder with one subfolder per page (default `documents/`) |
| `--frontend` / `MUNG_FRONTEND_PATH` | built frontend (`dist/`) to serve from the same origin |
| `MUNG_USERS_FILE` | JSON file with users, see `simple-php-backend/users.example.json` |
| `MUNG_USERS` | users inline, `name:token,name2:token2` |
| `MUNG_CUSTOM_CLASSES_FILE` | custom class registry (default `<documents>/custom_classes.json`) |
| `MUNG_*` model variables | see [model-actions.md](model-actions.md) |

Without `MUNG_USERS_FILE` or `MUNG_USERS` there is one development user,
`Root`, with the token `123456789`. Set real tokens before the server is
reachable by anyone else, and keep the users file out of version control
(`simple-php-backend/users.json` is ignored by git).


## Documents folder

```
documents/
    page_001/
        image.jpg            page image (or image.png); coordinates of mung.xml
        mung.xml             MuNG graph, including time groups (see below)
        original.jpg         optional: the unprocessed scan, shown on demand
        status.json          workflow stages (created on the first status change)
        review_comments.json review comments (created on the first comment)
        backups/2026-01-31.xml   copy of mung.xml for each day it was saved
        thumbnail.jpg, access_log.txt, write_log.txt
    custom_classes.json      shared custom classes and display colors
    audit_log.txt            all reads, writes and model runs
```

A new page needs only `image.jpg` (or `image.png`) and `mung.xml`; an empty
`mung.xml` is shown in [simple-php-backend.md](simple-php-backend.md).
Document names may contain letters, digits, spaces, dots, underscores and
hyphens.

### Workflow stages

`status.json` stores one status and annotator per stage. The storage keys are
`recognition` (Symbol Recognition), `assembly` (Precedence Links), `syntax`
(Syntax Links) and `temporal` (Temporal Structure). The statuses are
`not-started`, `in-progress`, `pending-review`, `changes-requested` and `done`.

```json
{
  "stages": {
    "recognition": {"status": "done", "annotator": "A. Analyst",
                    "updatedAt": "2026-01-31T10:00:00Z", "updatedBy": "Root"},
    "assembly": {"status": "pending-review", "annotator": "A. Analyst"},
    "syntax": {"status": "in-progress", "annotator": "B. Analyst"},
    "temporal": {"status": "not-started", "annotator": ""}
  },
  "status": "done",
  "annotator": "A. Analyst",
  "updatedAt": "2026-01-31T10:00:00Z",
  "updatedBy": "Root"
}
```

The top-level `status` and `annotator` repeat the recognition stage.

### Time groups

Time groups are stored on their member noteheads as MuNG DataItems, so they
travel with `mung.xml`. Every member of a group carries a DataItem with the
key `schenker_time_group_v1_<group id>` and a JSON string value:

```json
{"version": 1, "label": "Group 3", "kind": "shared-time",
 "provenance": "manual", "createdAt": "...", "updatedAt": "..."}
```

`provenance` is `manual` for groups made by annotators and `predicted` for
groups created by the time-group model. The annotation scheme is documented in
[dataset/ANNOTATION_SCHEME.md](../dataset/ANNOTATION_SCHEME.md).


## HTTP API

Every request carries the bearer token of a user
(`Authorization: Bearer <token>`) and names the action in the query string,
for example `/?action=list-documents`. The actions of the PHP backend
(`whoami`, `list-documents`, `get-document-mung`, `get-document-image`,
`get-document-thumbnail`, `upload-document-mung`) behave as documented in
[simple-php-backend.md](simple-php-backend.md); `list-documents` additionally
returns the workflow `stages` and comment counts of each document.

| Action | Method | Purpose |
|---|---|---|
| `get-document-original` | GET/POST | the unprocessed scan (`original.jpg`), if present |
| `set-doc-status` | POST | change one stage: `{"stage": "syntax", "status": "done", "annotator": "..."}` |
| `list-custom-classes`, `add-custom-class` | POST | read or extend the shared class registry |
| `set-class-color`, `clear-class-color` | POST | shared display color of a class |
| `list-review-comments`, `add-review-comment`, `set-review-comment-resolved` | POST | review comments of a document |
| `collab-stream` (GET, server-sent events), `collab-op`, `collab-presence` | | real-time collaboration |
| `list-models` | GET/POST | availability of the model actions |
| `detect-symbols`, `predict-syntax-links`, `predict-time-groups`, `predict-precedence`, `convert-document` | POST | model actions, see [model-actions.md](model-actions.md) |
| `version` | GET | code version and capabilities (no token needed) |

`set-doc-status` without `stage` changes the recognition stage.


## Tests

```bash
npm run test-backend     # python3 -m unittest discover -s simple-php-backend/tests
```

The tests do not need the models.
