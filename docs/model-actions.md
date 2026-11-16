# Model actions

The **Model predictions** section of the editor runs the models on the page that is open, on the whole page or,
with the **Area** button, on a rectangle dragged on the page. The predictions are proposals that the annotator
corrects; they are saved with the normal autosave.

| Button | Backend action | Function called |
|---|---|---|
| Detect symbols | `detect-symbols` | `experiments/symbol_recognition/inference.py` `detect_symbols` |
| Predict syntax links | `predict-syntax-links` | `experiments/syntax_links/inference.py` `predict_syntax_links` |
| Predict time groups | `predict-time-groups` | `experiments/temporal_relations/inference.py` `predict_time_groups` |
| Predict precedence links | `predict-precedence` | `experiments/temporal_relations/inference.py` `predict_precedence` |
| Convert to JSON | `convert-document` | `conversion` package `convert_page` |

- **Symbols.** Detection replaces the earlier predicted symbols of the page (or of the area); manual symbols are
  kept. Detected nodes carry the DataItems `symbol_detector_prediction`, `symbol_detector_model_key` and
  `symbol_detector_confidence`. **Clear predicted symbols** removes the nodes that still carry
  `symbol_detector_prediction`. Detections below the score threshold (default 0.6; the *Symbol score threshold*
  field overrides it for one run, `0` keeps every detection) are dropped.
- **Syntax and precedence links.** A predicted link is added only between two symbols that are not linked yet by a
  link of the same type; existing links are never removed.
- **Time groups.** Predicted groups are stored like manual groups with `"provenance": "predicted"` and take only
  noteheads that are in no group yet.
- **Convert to JSON** saves the page and opens the output of `convert_page` in a new tab.

The relation models receive the nodes currently in the editor (all nodes, or the nodes with at least half of their
box inside the area). Symbol detection reads the page image on the server.

## Models

Model paths are relative to `MUNG_MODELS_DIR` (default `models/`, see [models/README.md](../models/README.md)).

| Action | Default file |
|---|---|
| Detect symbols | `symbol_recognition/yolov8l/HandSchA_seed20261021.pt` and `symbol_recognition/rfdetr_branch/HandSchA_seed43.pth` |
| Predict syntax links | `syntax_links/incidence/handscha/heldout/seed_42/` |
| Predict time groups | `temporal_relations/hgb/time_groups_heldout_rachmaninov_seed42.joblib` |
| Predict precedence links | `temporal_relations/hgb/precedence_heldout_rachmaninov_seed43.joblib` |

## Configuration

Relative model paths are resolved against `MUNG_MODELS_DIR`, other relative paths against the repository root.

| Variable | Meaning |
|---|---|
| `MUNG_MODELS_DIR` | models folder (default `models/` in the repository) |
| `MUNG_SYMBOL_YOLO_WEIGHTS` | YOLOv8L weights of the symbol detector |
| `MUNG_SYMBOL_RFDETR_WEIGHTS` | RF-DETR checkpoint of the symbol detector |
| `MUNG_SYNTAX_MODEL_DIR` | model folder of the syntax-link model |
| `MUNG_TIME_GROUP_MODEL` | time-group model (`.joblib`) |
| `MUNG_PRECEDENCE_MODEL` | precedence-link model (`.joblib`) |
| `MUNG_SYMBOL_CATEGORIES` | class list of the YOLOv8L model (default `experiments/symbol_recognition/data/categories.json`) |
| `MUNG_SYMBOL_SCORE_THRESHOLD` | default detection score threshold (default `0.6`) |
| `MUNG_MODEL_DEVICE` | device of the symbol and syntax models (default `cpu`, for example `cuda:0`) |
| `MUNG_MODEL_PYTHON` | Python interpreter of the model processes (default: the interpreter that runs `server.py`) |
| `MUNG_SYMBOL_PYTHON`, `MUNG_SYNTAX_PYTHON`, `MUNG_TEMPORAL_PYTHON`, `MUNG_CONVERSION_PYTHON` | interpreter of one component (default `MUNG_MODEL_PYTHON`) |
| `MUNG_MODEL_TIMEOUT` | seconds after which a model process is stopped (default 1800) |
| `MUNG_MODEL_MAX_CONCURRENT` | model actions that may run at once (default 1; further requests get HTTP 429) |
| `MUNG_ENABLE_INFERENCE`, `MUNG_ENABLE_SYMBOL_INFERENCE`, `MUNG_ENABLE_RELATION_INFERENCE` | switch the model actions off (`0`, `false`, `no`, `off`) |

The server prints at start-up which model actions are available (`GET /?action=list-models` returns the reason for
an unavailable one), and the editor greys out their buttons. The frontend build can hide the model actions with the
same three `MUNG_ENABLE_*` variables in `.env` (see `.env.example`).

### Python environments

Each model action runs in a separate Python process (`simple-php-backend/model_worker.py`) with its component folder
first on `sys.path`. The symbol detector needs its own environment; the other components share one:

```bash
python3.12 -m venv .venv-symbols
.venv-symbols/bin/pip install -r experiments/symbol_recognition/requirements-inference.txt
python3.12 -m venv .venv-relations
.venv-relations/bin/pip install -r experiments/syntax_links/requirements.txt \
    -r experiments/temporal_relations/requirements.txt -r conversion/requirements.txt

export MUNG_SYMBOL_PYTHON=.venv-symbols/bin/python
export MUNG_MODEL_PYTHON=.venv-relations/bin/python
./start_local.sh
```

Without these variables the model processes use the interpreter of the server; actions whose packages are missing
report the missing module (HTTP 503) and the tool still works for manual annotation.

## Calling conventions

`simple-php-backend/model_actions.py` calls the functions with keyword arguments:

```python
detect_symbols(image_path=..., yolo_weights=..., rfdetr_weights=..., class_names=[...],
               region=None or [left, top, right, bottom], score_threshold=0.6, device="cpu")
predict_syntax_links(nodes=[...], image_size=[width, height], model_dir=..., device="cpu")
predict_time_groups(nodes=[...], image_size=[width, height], model_path=...)
predict_precedence(nodes=[...], image_size=[width, height], model_path=...)
convert_page(mung_xml_path=..., image_path=...)
```

- `image_path`: the page image of the document, in the pixel coordinates of `mung.xml`.
- `class_names`: the names of `MUNG_SYMBOL_CATEGORIES` in id order.
- `region`: page pixels, clipped to the page; `None` for the whole page.
- `nodes`: dicts with the keys `id`, `class_name`, `left`, `top`, `width`, `height` (page pixels), sorted by id.

Return values:

- `detect_symbols`: list of dicts `class_name`, `left`, `top`, `width`, `height`, `score`.
- `predict_syntax_links`, `predict_precedence`: list of dicts `source_id`, `target_id`, `score`.
- `predict_time_groups`: list of groups, each a list of node ids.
- `convert_page`: dict with `document`, `schenkernote`, `notes`, `unresolved`, `warnings`, `details`, `summary`. Its
  `ConversionError` is reported as HTTP 422 with the message.

## HTTP API

All model actions require the bearer token of a user and take a JSON body.

```bash
curl -X POST -H "Authorization: Bearer 123456789" -H "Content-Type: application/json" \
  -d '{"document": "page_001", "region": {"left": 0, "top": 0, "width": 2550, "height": 1754}, "scoreThreshold": null}' \
  "localhost:8080/?action=detect-symbols"
```

Response (`scoreThreshold` is the threshold that was applied):

```json
{
  "model": "yolov8l/HandSchA_seed20261021.pt+rfdetr_branch/HandSchA_seed43.pth",
  "image": {"width": 5100, "height": 3509},
  "region": {"left": 0, "top": 0, "width": 2550, "height": 1754},
  "scoreThreshold": 0.6,
  "predictions": [
    {"className": "noteheadBlack", "left": 412.3, "top": 220.5,
     "width": 31.0, "height": 24.2, "confidence": 0.93}
  ]
}
```

`predict-syntax-links`, `predict-time-groups` and `predict-precedence` take `{"document": ..., "nodes": [{"id": 1,
"className": "noteheadBlack", "left": ..., "top": ..., "width": ..., "height": ...}, ...]}` and return
`{"model": "syntax_links/incidence/handscha/heldout/seed_42", "links": [{"source": 2, "target": 1, "score": 0.9},
...]}` or `{"model": ..., "groups": [[1, 3], [4], ...]}`.

`convert-document` takes the document name in the URL (`?action=convert-document&document=page_001`) and returns
`{"document": "page_001", "result": <output of convert_page>}`.

Errors: 400 invalid request, 404 unknown document or missing page image, 422 page rejected by the converter, 429
another model action is running, 500 the model raised an error, crashed or timed out, 502 the model returned data in
an unexpected format, 503 action disabled, model files not found, or packages missing in its environment.
