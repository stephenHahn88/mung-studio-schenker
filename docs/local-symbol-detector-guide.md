# Local Symbol Detector Guide

This guide explains how to run the Schenkerian symbol-detector version of
MuNG Studio, add annotation pages, choose models, run full-page recognition,
and re-run recognition on selected regions.

## What This Version Adds

This repository contains a local Python detection backend and a Recognition
panel inside the MuNG Studio editor.

The added workflow lets annotators:

- Open local annotation documents from the Simple Backend page.
- Run large-symbol detection, small-symbol detection, or both.
- Choose between registered YOLO26L and DETR models before running detection.
- Edit detector hyperparameters from the Recognition panel.
- Re-run detection only inside a manually drawn area of the page.
- Automatically remove duplicate predictions after every detector run.
- Clear all predicted symbols.
- Undo and redo graph edits, including detector insertions and removals.

Model weights and annotation pages are not tracked by git. Each user keeps
their own `models/` and `documents/` contents locally.

## Repository Layout

Important local-release paths:

```text
mung-studio-schenker/
  docs/local-symbol-detector-guide.md
  documents/
    README.md
    .gitkeep
  models/
    README.md
  simple-php-backend/
    server.py
    yolo26_inference.py
  src/editor/view/overview-panel/RecognitionQuickAction.tsx
  start_local.sh
  start_local.bat
  requirements-yolo26.txt
```

The git-tracked `documents/` and `models/` directories contain only README
files and placeholders. Put real pages and model files there after cloning.

## Prerequisites

Install these first:

- Git
- Node.js 18 or newer
- Python 3.10 or newer
- A shell terminal on macOS/Linux, or Command Prompt/PowerShell on Windows

For DETR models, the Python requirements install `torch`, `transformers`,
`timm`, and `safetensors`. For YOLO26L models, they install `ultralytics`.

## Clone The Repository

```bash
git clone https://github.com/stephenHahn88/mung-studio-schenker.git
cd mung-studio-schenker
```

If you are working on another branch, switch to it before installing:

```bash
git checkout main
```

## Install Dependencies

Install JavaScript dependencies:

```bash
npm install
```

Create and activate a Python virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements-yolo26.txt
```

On Windows:

```bat
python -m venv .venv
.venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements-yolo26.txt
```

## Add Model Files

Put local model files under `models/`. Large model files are intentionally
ignored by git.

Supported YOLO model files:

```text
models/yolo26l_large_fullwidth_7pages_pre.pt
models/yolo26l_tiled_7pages_pre.pt
models/yolo26l_large_fullwidth_9pages_pre_ep300.pt
models/yolo26l_tiled_9pages_pre_ep300.pt
```

Supported DETR model directories:

```text
models/detr_large_9pages_plus50/model/
  config.json
  model.safetensors
  preprocessor_config.json

models/detr_tiled_9pages_plus50/model/
  config.json
  model.safetensors
  preprocessor_config.json
```

The editor can still open without every model. A missing model appears as
`(missing)` in the dropdown, and run buttons are disabled when the selected
model is unavailable.

### Optional Model Path Overrides

If model files live outside `models/`, set environment variables before
starting the backend:

```bash
export YOLO26_LARGE_MODEL=/path/to/yolo26l_large_fullwidth_7pages_pre.pt
export YOLO26_TILED_MODEL=/path/to/yolo26l_tiled_7pages_pre.pt
export YOLO26_LARGE_9PAGES_EP300_MODEL=/path/to/yolo26l_large_fullwidth_9pages_pre_ep300.pt
export YOLO26_TILED_9PAGES_EP300_MODEL=/path/to/yolo26l_tiled_9pages_pre_ep300.pt
export DETR_LARGE_9PAGES_PLUS50_MODEL=/path/to/detr_large_9pages_plus50/model
export DETR_TILED_9PAGES_PLUS50_MODEL=/path/to/detr_tiled_9pages_plus50/model
```

## Add Annotation Documents

Each page is one folder inside `documents/`.

Use this structure:

```text
documents/Page_Name_001/
  image.png
  mung.xml
```

The image may be named:

```text
image.png
image.jpg
image.jpeg
```

The `mung.xml` file can be empty at the beginning. Its `document` attribute
should match the folder name:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Nodes dataset="Schenkerian_OMR" document="Page_Name_001" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CVC-MUSCIMA_Schema.xsd"></Nodes>
```

If you only have an image and no MuNG file yet, create the folder, rename the
image to `image.png`, and add the empty `mung.xml` above.

Do not leave page images directly in the root of `documents/`; the backend only
lists subfolders that contain a `mung.xml`.

## Start The App

### macOS/Linux

From the repository root:

```bash
source .venv/bin/activate
./start_local.sh
```

The script builds the frontend, starts the Python backend on port `8080`, and
serves the built frontend on port `1234`.

Open:

```text
http://localhost:1234
```

### Windows

```bat
.venv\Scripts\activate
start_local.bat
```

Open:

```text
http://localhost:1234
```

### Manual Startup

If you prefer separate terminals:

Terminal 1:

```bash
source .venv/bin/activate
python3 simple-php-backend/server.py --port 8080 --documents documents
```

Terminal 2:

```bash
export SIMPLE_PHP_BACKEND_URL=http://localhost:8080
export YOLO26_BACKEND_URL=http://localhost:8080
npm run build
npx http-server dist -a 127.0.0.1 -p 1234 --cors
```

## Log In To The Simple Backend

Open:

```text
http://localhost:1234
```

Choose the Simple Backend page.

Use this token:

```text
123456789
```

The Documents list should show every folder under `documents/` that contains a
valid `mung.xml`.

## Open A Page

1. Open the Simple Backend page.
2. Log in with token `123456789`.
3. Select a document from the Documents list.
4. The editor opens with the page image and the current MuNG nodes.

If the page opens with an image but no symbols, the `mung.xml` file is empty.
You can immediately run recognition or annotate manually.

## Zoom And Navigate

Use normal browser/editor navigation:

- Mouse wheel or trackpad to zoom.
- Drag/pan with the hand tool.
- Use the editor selection tool to inspect or select nodes.

The Recognition panel is on the left sidebar.

## Full-Page Recognition

In the Recognition panel:

1. Choose a `Large-symbol model`.
2. Choose a `Small-symbol model`.
3. Adjust detection parameters if needed.
4. Click one of:
   - `Run large`
   - `Run small`
   - `Run both`

`Run large` replaces previous large-source predictions on the page.
`Run small` replaces previous small-source predictions on the page.
`Run both` replaces both large-source and small-source predictions.

After every run, duplicate predicted symbols are removed automatically.

## Area Recognition

Use area recognition when only one region needs to be re-detected.

In the Recognition panel:

1. Choose models and parameters.
2. Click one of:
   - `Area large`
   - `Area small`
   - `Area both`
3. Drag a rectangle over the target region on the page.
4. Release the mouse button.

The backend runs detection only on the selected image crop. The new predictions
are inserted in their original page coordinates.

Only old predictions that belong to the selected area are replaced. A previous
prediction is considered part of the selected area only if at least 50 percent
of its own bounding-box area is inside the drawn rectangle. This protects
correct long symbols that merely cross the edge of the selected area.

Press `Escape` before drawing finishes to cancel area recognition.

## Prediction Management

The Recognition panel includes:

- `Clear predictions`: removes all detector-generated nodes.
- `Undo`: returns to the previous graph state.
- `Redo`: reapplies an undone graph state.

Detector-generated nodes are marked in MuNG node data with fields such as:

```text
symbol_detector_prediction
symbol_detector_source
symbol_detector_model_key
symbol_detector_confidence
```

This lets the editor distinguish detector predictions from manually created
or edited symbols.

## Detection Parameters

The panel exposes the most useful detector parameters. Defaults are shown in
the UI.

### Confidence Thresholds

`Large confidence threshold`

Minimum confidence for large-symbol predictions. Increase it to reduce false
positives. Decrease it to recover missed large symbols.

`Small confidence threshold`

Minimum confidence for small-symbol predictions. Small symbols often need a
lower threshold than large symbols.

### Large-Symbol Strip Parameters

`Large image size`

Input size used by the large-symbol model. Larger values can improve recall but
are slower.

`Strip width`

Width of each large-symbol strip. `0` means full page width.

`Strip height`

Height of each large-symbol strip.

`Strip step X`

Horizontal step between strips. For full-width strips, this is usually `1`.

`Strip step Y`

Vertical step between strips. Smaller values create more overlap and slower
recognition.

### Small-Symbol Tile Parameters

`Tile patch`

Tile size for small-symbol detection.

`Tile step`

Distance between neighboring tiles. Smaller values increase overlap and runtime.

`Tile margin`

Predictions near tile edges are ignored unless the tile is on the page edge.
This reduces duplicate boxes created at tile boundaries.

### Deduplication Parameters

`Same-class IoU`

Overlap threshold for duplicate boxes with the same class. Lower values remove
more same-class duplicates.

`Same-class area`

Area-similarity threshold for same-class duplicate removal.

`Cross-class IoU`

Overlap threshold for conflicting boxes with different classes.

`Cross-class area`

Area-similarity threshold for cross-class duplicate removal.

## Saving

MuNG Studio saves through the Simple Backend. When the editor status says
`Saved.`, the backend has written the current `mung.xml` file in that document
folder.

The backend also writes local access and write logs inside document folders.
Those local logs are not needed for sharing the software.

## Sharing The Repository

The repository is designed so collaborators can clone the code and then add
their own models and documents.

Tracked:

- Source code
- Python backend
- Startup scripts
- Documentation
- Empty `models/` and `documents/` placeholders

Not tracked:

- Model weights
- DETR `model.safetensors` files
- Annotation page images
- Local `mung.xml` annotation files
- `.env`
- `dist/`
- `.venv/`
- `node_modules/`

## Troubleshooting

### The Documents list shows `TypeError: Failed to fetch`

The frontend cannot reach the backend.

Check that the Python backend is running on port `8080`:

```bash
curl "http://localhost:8080?action=list-detection-models"
```

If it fails, restart the app:

```bash
./start_local.sh
```

### The Documents list says `Invalid user token`

Click `Forget User Token`, then log in again with:

```text
123456789
```

### A model shows `(missing)`

The backend cannot find that model file or directory.

Check `models/README.md` and confirm the path exists. For example:

```bash
ls models/yolo26l_large_fullwidth_9pages_pre_ep300.pt
ls models/detr_large_9pages_plus50/model/model.safetensors
```

Then restart the backend.

### Recognition opens an alert with `TypeError: Failed to fetch`

The editor can load pages, but the recognition request cannot reach the
detector endpoint. Make sure `YOLO26_BACKEND_URL` points to the same backend as
`SIMPLE_PHP_BACKEND_URL`.

For local use:

```bash
export YOLO26_BACKEND_URL=http://localhost:8080
```

### A newly added image does not appear in Documents

The image must be inside a subfolder with a `mung.xml` file:

```text
documents/New_Page/
  image.png
  mung.xml
```

Refresh the Simple Backend page after creating the folder.

### Area recognition removes too many old predictions

Draw the rectangle more tightly around the part that should be re-run. The
editor protects old predictions unless at least 50 percent of their area falls
inside the selected rectangle.

### Detection is slow

Try:

- Increasing `Strip step Y`
- Increasing `Tile step`
- Lowering `Large image size`
- Running only `Run large` or only `Run small`
- Using area recognition instead of full-page recognition

## Recommended Workflow For Annotators

1. Add a page folder under `documents/`.
2. Open the page in MuNG Studio.
3. Run `Run both` once with the preferred models.
4. Inspect obvious false positives and missed symbols.
5. Use `Area large`, `Area small`, or `Area both` for regions that need a
   different threshold or model.
6. Use `Clear predictions` only when you want to restart detector output for
   the whole page.
7. Manually edit the final graph.
8. Wait for `Saved.` before closing the editor.
