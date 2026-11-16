"""Model actions of the MuNG Studio backend.

Each action calls an inference function of this repository:

    action       HTTP action            function
    symbols      detect-symbols         experiments/symbol_recognition/inference.py   detect_symbols
    syntaxLinks  predict-syntax-links   experiments/syntax_links/inference.py         predict_syntax_links
    timeGroups   predict-time-groups    experiments/temporal_relations/inference.py   predict_time_groups
    precedence   predict-precedence     experiments/temporal_relations/inference.py   predict_precedence
    conversion   convert-document       conversion/ (package)                         convert_page

Every call runs in a new Python process (model_worker.py) that imports only the component it needs, so each
component can use its own Python environment. Without model files the actions report that they are unavailable.

The configuration is read from environment variables (ModelConfig.from_env).
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from model_worker import FUNCTIONS

BACKEND_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = BACKEND_DIR.parent
WORKER = BACKEND_DIR / "model_worker.py"

ACTIONS = ("symbols", "syntaxLinks", "timeGroups", "precedence", "conversion")

LABELS = {
    "symbols": "Symbol detector (YOLOv8L + RF-DETR)",
    "syntaxLinks": "Syntax-link model",
    "timeGroups": "Time-group model",
    "precedence": "Precedence-link model",
    "conversion": "Graph-to-JSON conversion",
}

# model files used when the variables are not set, relative to MUNG_MODELS_DIR
DEFAULT_MODEL_FILES = {
    "MUNG_SYMBOL_YOLO_WEIGHTS": "symbol_recognition/yolov8l/HandSchA_seed20261021.pt",
    "MUNG_SYMBOL_RFDETR_WEIGHTS": "symbol_recognition/rfdetr_branch/HandSchA_seed43.pth",
    "MUNG_SYNTAX_MODEL_DIR": "syntax_links/incidence/handscha/heldout/seed_42",
    "MUNG_TIME_GROUP_MODEL": "temporal_relations/hgb/time_groups_heldout_rachmaninov_seed42.joblib",
    "MUNG_PRECEDENCE_MODEL": "temporal_relations/hgb/precedence_heldout_rachmaninov_seed43.joblib",
}
DEFAULT_SYMBOL_CATEGORIES = "experiments/symbol_recognition/data/categories.json"
DEFAULT_SCORE_THRESHOLD = 0.6

PYTHON_VARIABLES = {
    "symbols": "MUNG_SYMBOL_PYTHON",
    "syntaxLinks": "MUNG_SYNTAX_PYTHON",
    "timeGroups": "MUNG_TEMPORAL_PYTHON",
    "precedence": "MUNG_TEMPORAL_PYTHON",
    "conversion": "MUNG_CONVERSION_PYTHON",
}

MAX_NODES = 20000


class ModelUnavailable(RuntimeError):
    """The action is disabled, or its code, model files or packages are missing."""


class ModelBusy(RuntimeError):
    """Another model action is running and the request should be retried."""


class ModelFailed(RuntimeError):
    """The model process raised an error, crashed or timed out."""


class InvalidModelRequest(ValueError):
    """The request body cannot be passed to a model."""


class InvalidModelOutput(RuntimeError):
    """A model returned data in a format the backend does not accept."""


def _env_flag(environ, name: str, default: bool = True) -> bool:
    value = environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _path(value: str, base: Path) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else base / path


def _interpreter(value: str, root: Path) -> str:
    """A command name (python3) is looked up on PATH; a relative path such as
    .venv-symbols/bin/python is resolved against the repository root."""
    if os.sep not in value and "/" not in value:
        return value
    return str(_path(value, root))


@dataclass
class ModelConfig:
    """All model settings of the backend, read from environment variables.

    MUNG_REPO_ROOT                 repository root (default: parent of simple-php-backend)
    MUNG_MODELS_DIR                folder of the downloaded models (default: models/ in the repository)
    MUNG_SYMBOL_YOLO_WEIGHTS       YOLOv8L weights of the symbol detector
    MUNG_SYMBOL_RFDETR_WEIGHTS     RF-DETR checkpoint of the symbol detector
    MUNG_SYNTAX_MODEL_DIR          model folder of the syntax-link model
    MUNG_TIME_GROUP_MODEL          time-group model (.joblib)
    MUNG_PRECEDENCE_MODEL          precedence-link model (.joblib)
                                   (relative model paths are resolved against
                                   MUNG_MODELS_DIR; defaults in DEFAULT_MODEL_FILES)
    MUNG_SYMBOL_CATEGORIES         class list of the YOLOv8L model
                                   (default experiments/symbol_recognition/data/categories.json;
                                   relative to the repository root)
    MUNG_SYMBOL_SCORE_THRESHOLD    default detection score threshold (default 0.6)
    MUNG_MODEL_DEVICE              device of the symbol and syntax models (default cpu)
    MUNG_MODEL_PYTHON              Python interpreter of the model processes
                                   (default: the interpreter of the server)
    MUNG_SYMBOL_PYTHON, MUNG_SYNTAX_PYTHON, MUNG_TEMPORAL_PYTHON, MUNG_CONVERSION_PYTHON
                                   interpreter of one component (default MUNG_MODEL_PYTHON);
                                   relative paths are resolved against the repository root
    MUNG_MODEL_TIMEOUT             seconds before a model process is stopped (default 1800)
    MUNG_MODEL_MAX_CONCURRENT      model actions that may run at once (default 1)
    MUNG_ENABLE_INFERENCE          switch for the four model actions (default on)
    MUNG_ENABLE_SYMBOL_INFERENCE   switch for detect-symbols
    MUNG_ENABLE_RELATION_INFERENCE switch for the syntax, time-group and precedence actions
    """

    repo_root: Path
    models_dir: Path
    yolo_weights: Path
    rfdetr_weights: Path
    syntax_model_dir: Path
    time_group_model: Path
    precedence_model: Path
    symbol_categories: Path
    score_threshold: Optional[float]
    device: str
    python: dict
    timeout: float
    max_concurrent: int
    symbol_enabled: bool
    relation_enabled: bool

    @classmethod
    def from_env(cls, environ=None) -> "ModelConfig":
        environ = os.environ if environ is None else environ

        def get(name: str, default: str = "") -> str:
            return environ.get(name, "").strip() or default

        root = Path(get("MUNG_REPO_ROOT", str(DEFAULT_REPO_ROOT))).expanduser().resolve()
        models = _path(get("MUNG_MODELS_DIR", "models"), root)
        files = {name: _path(get(name, default), models)
                 for name, default in DEFAULT_MODEL_FILES.items()}
        threshold = get("MUNG_SYMBOL_SCORE_THRESHOLD")
        python = get("MUNG_MODEL_PYTHON", sys.executable)
        all_enabled = _env_flag(environ, "MUNG_ENABLE_INFERENCE", True)
        return cls(
            repo_root=root,
            models_dir=models,
            yolo_weights=files["MUNG_SYMBOL_YOLO_WEIGHTS"],
            rfdetr_weights=files["MUNG_SYMBOL_RFDETR_WEIGHTS"],
            syntax_model_dir=files["MUNG_SYNTAX_MODEL_DIR"],
            time_group_model=files["MUNG_TIME_GROUP_MODEL"],
            precedence_model=files["MUNG_PRECEDENCE_MODEL"],
            symbol_categories=_path(get("MUNG_SYMBOL_CATEGORIES", DEFAULT_SYMBOL_CATEGORIES), root),
            score_threshold=parse_threshold(threshold) if threshold else DEFAULT_SCORE_THRESHOLD,
            device=get("MUNG_MODEL_DEVICE", "cpu"),
            python={action: _interpreter(get(variable, python), root)
                    for action, variable in PYTHON_VARIABLES.items()},
            timeout=float(get("MUNG_MODEL_TIMEOUT", "1800")),
            max_concurrent=max(1, int(get("MUNG_MODEL_MAX_CONCURRENT", "1"))),
            symbol_enabled=_env_flag(environ, "MUNG_ENABLE_SYMBOL_INFERENCE", all_enabled),
            relation_enabled=_env_flag(environ, "MUNG_ENABLE_RELATION_INFERENCE", all_enabled),
        )

    def label(self, path: Path) -> str:
        """Model path relative to the models folder (used in responses)."""
        try:
            return path.relative_to(self.models_dir).as_posix()
        except ValueError:
            return path.name


def parse_threshold(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        threshold = float(value)
    except (TypeError, ValueError):
        raise InvalidModelRequest("The score threshold must be a number.")
    if not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise InvalidModelRequest("The score threshold must be between 0 and 1.")
    return threshold


def _require(path: Path, setting: str, directory: bool = False) -> None:
    exists = path.is_dir() if directory else path.is_file()
    if not exists:
        kind = "directory" if directory else "file"
        raise ModelUnavailable(f"{setting}: {kind} not found ({path.name}).")


def load_class_names(path: Path) -> list[str]:
    """Class names of categories.json ([{"id", "name"}, ...]) in id order."""
    with open(path, encoding="utf-8") as handle:
        categories = json.load(handle)
    try:
        return [c["name"] for c in sorted(categories, key=lambda c: c["id"])]
    except (TypeError, KeyError):
        raise ModelUnavailable(f"{path.name} is not a list of {{id, name}} categories.")


# --------------------------------------------------------------------------
# Request parsing


def parse_nodes(value: Any) -> list[dict]:
    """Convert the nodes sent by the editor into the dicts passed to the
    relation models, sorted by id.
    """
    if not isinstance(value, list) or len(value) > MAX_NODES:
        raise InvalidModelRequest(
            f"Nodes must be a list with at most {MAX_NODES} entries."
        )
    nodes = []
    seen = set()
    for item in value:
        if not isinstance(item, dict):
            raise InvalidModelRequest("Each node must be an object.")
        node_id = item.get("id")
        class_name = item.get("className")
        if type(node_id) is not int or node_id in seen:
            raise InvalidModelRequest("Node ids must be unique integers.")
        if not isinstance(class_name, str) or not class_name:
            raise InvalidModelRequest("Each node needs a class name.")
        box = []
        for key in ("left", "top", "width", "height"):
            number = item.get(key)
            if isinstance(number, bool) or not isinstance(number, (int, float)) \
                    or not math.isfinite(number):
                raise InvalidModelRequest(f"Node {node_id} has an invalid {key}.")
            box.append(number)
        if box[2] <= 0 or box[3] <= 0:
            raise InvalidModelRequest(f"Node {node_id} has an empty box.")
        seen.add(node_id)
        nodes.append({
            "id": node_id,
            "class_name": class_name,
            "left": box[0],
            "top": box[1],
            "width": box[2],
            "height": box[3],
        })
    nodes.sort(key=lambda n: n["id"])
    return nodes


def parse_region(value: Any, image_size: tuple[int, int]) -> Optional[list[int]]:
    """Return a region as [left, top, right, bottom], clipped to the page."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise InvalidModelRequest("The region must be an object.")
    try:
        left = float(value["left"])
        top = float(value["top"])
        width = float(value["width"])
        height = float(value["height"])
    except (KeyError, TypeError, ValueError):
        raise InvalidModelRequest("The region needs left, top, width and height.")
    if not all(math.isfinite(v) for v in (left, top, width, height)) \
            or width <= 0 or height <= 0:
        raise InvalidModelRequest("The region is empty.")
    page_width, page_height = image_size
    x1 = max(0, int(math.floor(left)))
    y1 = max(0, int(math.floor(top)))
    x2 = min(page_width, int(math.ceil(left + width)))
    y2 = min(page_height, int(math.ceil(top + height)))
    if x2 <= x1 or y2 <= y1:
        raise InvalidModelRequest("The region does not overlap the page.")
    return [x1, y1, x2, y2]


# --------------------------------------------------------------------------
# Output checks. The model outputs are passed on unchanged apart from the key
# names used by the editor.


def _number(value: Any, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) \
            or not math.isfinite(value):
        raise InvalidModelOutput(f"Invalid {what} in the model output.")
    return value


def _node_id(value: Any, allowed: set) -> int:
    if type(value) is not int or value not in allowed:
        raise InvalidModelOutput("The model output refers to an unknown node id.")
    return value


def convert_detections(raw: Any) -> list[dict]:
    """detect_symbols output (class_name, left, top, width, height, score)."""
    if not isinstance(raw, list):
        raise InvalidModelOutput("detect_symbols must return a list.")
    detections = []
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("class_name"), str):
            raise InvalidModelOutput("Each detection needs a class_name.")
        detections.append({
            "className": item["class_name"],
            **{key: _number(item.get(key), key)
               for key in ("left", "top", "width", "height")},
            "confidence": _number(item.get("score"), "score"),
        })
    return detections


def convert_links(raw: Any, node_ids: set) -> list[dict]:
    """Link output ({source_id, target_id, score} per link)."""
    if not isinstance(raw, list):
        raise InvalidModelOutput("A link model must return a list.")
    links = []
    for item in raw:
        if not isinstance(item, dict):
            raise InvalidModelOutput("Each link must be an object.")
        links.append({
            "source": _node_id(item.get("source_id"), node_ids),
            "target": _node_id(item.get("target_id"), node_ids),
            "score": _number(item.get("score"), "score"),
        })
    return links


def convert_groups(raw: Any, node_ids: set) -> list[list[int]]:
    """Time-group output (one list of node ids per group)."""
    if not isinstance(raw, list) or not all(isinstance(g, list) for g in raw):
        raise InvalidModelOutput("predict_time_groups must return a list of lists.")
    return [[_node_id(member, node_ids) for member in group] for group in raw]


# --------------------------------------------------------------------------
# Dispatch


@dataclass
class ModelActions:
    """Runs the model actions with one configuration."""

    config: ModelConfig = field(default_factory=ModelConfig.from_env)
    _semaphore: Optional[threading.BoundedSemaphore] = field(
        default=None, init=False, repr=False
    )

    def __post_init__(self):
        self._semaphore = threading.BoundedSemaphore(self.config.max_concurrent)

    # ---- availability --------------------------------------------------------

    def _check(self, action: str) -> None:
        c = self.config
        if action not in ACTIONS:
            raise InvalidModelRequest(f"Unknown model action {action!r}.")
        if action == "symbols" and not c.symbol_enabled:
            raise ModelUnavailable("Symbol detection is disabled on this server.")
        if action in ("syntaxLinks", "timeGroups", "precedence") and not c.relation_enabled:
            raise ModelUnavailable("Relation prediction is disabled on this server.")
        folder, module, _ = FUNCTIONS[action]
        code = c.repo_root / folder / (module if action == "conversion" else module + ".py")
        if not code.exists():
            raise ModelUnavailable(f"{(Path(folder) / code.name).as_posix()} was not found.")
        if action == "symbols":
            _require(c.yolo_weights, "MUNG_SYMBOL_YOLO_WEIGHTS")
            _require(c.rfdetr_weights, "MUNG_SYMBOL_RFDETR_WEIGHTS")
            _require(c.symbol_categories, "MUNG_SYMBOL_CATEGORIES")
        elif action == "syntaxLinks":
            _require(c.syntax_model_dir, "MUNG_SYNTAX_MODEL_DIR", directory=True)
        elif action == "timeGroups":
            _require(c.time_group_model, "MUNG_TIME_GROUP_MODEL")
        elif action == "precedence":
            _require(c.precedence_model, "MUNG_PRECEDENCE_MODEL")

    def availability(self) -> dict:
        result = {}
        for action in ACTIONS:
            try:
                self._check(action)
                result[action] = {"available": True, "label": LABELS[action]}
            except ModelUnavailable as exc:
                result[action] = {"available": False, "label": LABELS[action],
                                  "reason": str(exc)}
        return result

    # ---- model process -------------------------------------------------------

    def call(self, action: str, **kwargs) -> Any:
        """Run one function in a model process and return its result."""
        python = self.config.python[action]
        request = json.dumps({"action": action,
                              "repo_root": str(self.config.repo_root),
                              "kwargs": kwargs})
        if not self._semaphore.acquire(blocking=False):
            raise ModelBusy("Another model action is running. Please retry shortly.")
        try:
            with tempfile.TemporaryDirectory(prefix="mung-model-") as workdir:
                completed = subprocess.run(
                    [python, str(WORKER)], input=request, capture_output=True,
                    text=True, cwd=workdir, timeout=self.config.timeout,
                )
        except FileNotFoundError:
            raise ModelUnavailable(
                f"The Python interpreter of {PYTHON_VARIABLES[action]} was not found."
            )
        except subprocess.TimeoutExpired:
            raise ModelFailed(
                f"{LABELS[action]} did not finish within {self.config.timeout:g} s."
            )
        finally:
            self._semaphore.release()
        try:
            reply = json.loads(completed.stdout)
        except ValueError:
            reply = None
        if not isinstance(reply, dict) or ("result" not in reply and "error" not in reply):
            _log_tail(action, completed.stderr)
            raise ModelFailed(f"{LABELS[action]} stopped with exit code "
                              f"{completed.returncode}.")
        if "error" in reply:
            _log_tail(action, completed.stderr)
            message = f"{reply.get('type', 'Error')}: {reply['error']}"
            if reply.get("importError"):
                raise ModelUnavailable(
                    f"{LABELS[action]} cannot be loaded ({message}); "
                    f"install its requirements or set {PYTHON_VARIABLES[action]}."
                )
            if reply.get("valueError") and action == "conversion":
                raise ValueError(reply["error"])
            raise ModelFailed(message)
        return reply["result"]

    # ---- actions -------------------------------------------------------------

    def symbol_model_key(self) -> str:
        c = self.config
        return "+".join(f"{p.parent.name}/{p.name}" for p in (c.yolo_weights, c.rfdetr_weights))

    def detect_symbols(self, image_path: str, image_size: tuple[int, int],
                       region: Any = None, score_threshold: Any = None) -> dict:
        self._check("symbols")
        c = self.config
        page_region = parse_region(region, image_size)
        threshold = parse_threshold(score_threshold)
        if threshold is None:
            threshold = c.score_threshold
        raw = self.call(
            "symbols",
            image_path=str(image_path),
            yolo_weights=str(c.yolo_weights),
            rfdetr_weights=str(c.rfdetr_weights),
            class_names=load_class_names(c.symbol_categories),
            region=page_region,
            score_threshold=threshold,
            device=c.device,
        )
        width, height = image_size
        return {
            "model": self.symbol_model_key(),
            "image": {"width": width, "height": height},
            "region": None if page_region is None else {
                "left": page_region[0],
                "top": page_region[1],
                "width": page_region[2] - page_region[0],
                "height": page_region[3] - page_region[1],
            },
            "scoreThreshold": threshold,
            "predictions": convert_detections(raw),
        }

    def _relation(self, action: str, nodes: Any, image_size: tuple[int, int],
                  **kwargs) -> tuple[list[dict], Any]:
        self._check(action)
        model_nodes = parse_nodes(nodes)
        raw = self.call(action, nodes=model_nodes, image_size=list(image_size), **kwargs)
        return model_nodes, raw

    def predict_syntax_links(self, nodes: Any, image_size: tuple[int, int]) -> dict:
        c = self.config
        model_nodes, raw = self._relation("syntaxLinks", nodes, image_size,
                                          model_dir=str(c.syntax_model_dir),
                                          device=c.device)
        return {"model": c.label(c.syntax_model_dir),
                "links": convert_links(raw, {n["id"] for n in model_nodes})}

    def predict_time_groups(self, nodes: Any, image_size: tuple[int, int]) -> dict:
        c = self.config
        model_nodes, raw = self._relation("timeGroups", nodes, image_size,
                                          model_path=str(c.time_group_model))
        return {"model": c.label(c.time_group_model),
                "groups": convert_groups(raw, {n["id"] for n in model_nodes})}

    def predict_precedence(self, nodes: Any, image_size: tuple[int, int]) -> dict:
        c = self.config
        model_nodes, raw = self._relation("precedence", nodes, image_size,
                                          model_path=str(c.precedence_model))
        return {"model": c.label(c.precedence_model),
                "links": convert_links(raw, {n["id"] for n in model_nodes})}

    def convert_page(self, mung_xml_path: str, image_path: Optional[str] = None) -> Any:
        """Run conversion.convert_page; a page that cannot be converted raises ValueError."""
        self._check("conversion")
        return self.call("conversion", mung_xml_path=str(mung_xml_path),
                         image_path=None if image_path is None else str(image_path))


def _log_tail(action: str, stderr: str, lines: int = 20) -> None:
    tail = "\n".join((stderr or "").strip().splitlines()[-lines:])
    if tail:
        print(f"[model {action}] {tail}", file=sys.stderr)
