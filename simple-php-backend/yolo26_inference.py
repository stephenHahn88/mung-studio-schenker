"""Symbol detection for MuNG Studio.

This module wraps Schenkerian OMR symbol detectors:
- a full-width horizontal-strip detector for large symbols
- a tiled detector for smaller symbols

The output is JSON-friendly bounding boxes that the MuNG Studio frontend can
insert as editable MuNG nodes.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


MODEL_NAME = "symbol-detector"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODELS_DIR = PROJECT_ROOT / "models"
MODELS_DIR = Path(os.environ.get("YOLO26_MODELS_DIR", DEFAULT_MODELS_DIR)).expanduser()
if not MODELS_DIR.is_absolute():
    MODELS_DIR = PROJECT_ROOT / MODELS_DIR
MODELS_DIR = MODELS_DIR.resolve()

DEFAULT_LARGE_MODEL = MODELS_DIR / "yolo26l_large_fullwidth_7pages_pre.pt"
DEFAULT_TILED_MODEL = MODELS_DIR / "yolo26l_tiled_7pages_pre.pt"

LOCAL_YOLO26_LARGE_9PAGES_EP300_MODEL = (
    MODELS_DIR / "yolo26l_large_fullwidth_9pages_pre_ep300.pt"
)
LOCAL_YOLO26_TILED_9PAGES_EP300_MODEL = (
    MODELS_DIR / "yolo26l_tiled_9pages_pre_ep300.pt"
)
LOCAL_DETR_LARGE_9PAGES_PLUS50_MODEL = (
    MODELS_DIR / "detr_large_9pages_plus50" / "model"
)
LOCAL_DETR_TILED_9PAGES_PLUS50_MODEL = (
    MODELS_DIR / "detr_tiled_9pages_plus50" / "model"
)

REMOTE_YOLO26_LARGE_9PAGES_EP300_MODEL = Path(
    "/home/users/yh477/lab/Schenkerian_OMR/trained_models/yolo26l_large_fullwidth_9pages_pre_ep300.pt"
)
REMOTE_YOLO26_TILED_9PAGES_EP300_MODEL = Path(
    "/home/users/yh477/lab/Schenkerian_OMR/trained_models/yolo26l_tiled_9pages_pre_ep300.pt"
)
REMOTE_DETR_LARGE_9PAGES_PLUS50_MODEL = Path(
    "/home/users/yh477/lab/Schenkerian_OMR/outputs/mdetr_style_9pages_final_plus50_from_large150_tiled120_pre/large_fullwidth_strips_9pages_pre/model"
)
REMOTE_DETR_TILED_9PAGES_PLUS50_MODEL = Path(
    "/home/users/yh477/lab/Schenkerian_OMR/outputs/mdetr_style_9pages_final_plus50_from_large150_tiled120_pre/tiled_9pages_pre/model"
)

YOLO26_LARGE_9PAGES_EP300_MODEL = Path(
    os.environ.get(
        "YOLO26_LARGE_9PAGES_EP300_MODEL",
        LOCAL_YOLO26_LARGE_9PAGES_EP300_MODEL,
    )
)
YOLO26_TILED_9PAGES_EP300_MODEL = Path(
    os.environ.get(
        "YOLO26_TILED_9PAGES_EP300_MODEL",
        LOCAL_YOLO26_TILED_9PAGES_EP300_MODEL,
    )
)
DETR_LARGE_9PAGES_PLUS50_MODEL = Path(
    os.environ.get(
        "DETR_LARGE_9PAGES_PLUS50_MODEL",
        LOCAL_DETR_LARGE_9PAGES_PLUS50_MODEL,
    )
)
DETR_TILED_9PAGES_PLUS50_MODEL = Path(
    os.environ.get(
        "DETR_TILED_9PAGES_PLUS50_MODEL",
        LOCAL_DETR_TILED_9PAGES_PLUS50_MODEL,
    )
)

DEFAULT_LARGE_MODEL_KEY = os.environ.get(
    "SYMBOL_DETECTOR_DEFAULT_LARGE_MODEL",
    "yolo26l_large_fullwidth_9pages_ep300",
)
DEFAULT_SMALL_MODEL_KEY = os.environ.get(
    "SYMBOL_DETECTOR_DEFAULT_SMALL_MODEL",
    "yolo26l_tiled_9pages_ep300",
)

LARGE_CONF = float(os.environ.get("YOLO26_LARGE_CONF", "0.4"))
LARGE_IMGSZ = int(os.environ.get("YOLO26_LARGE_IMGSZ", "3072"))
STRIP_WIDTH = int(os.environ.get("YOLO26_STRIP_WIDTH", "0"))
STRIP_HEIGHT = int(os.environ.get("YOLO26_STRIP_HEIGHT", "768"))
STRIP_STEP_X = int(os.environ.get("YOLO26_STRIP_STEP_X", "1"))
STRIP_STEP_Y = int(os.environ.get("YOLO26_STRIP_STEP_Y", "384"))

TILE_CONF = float(os.environ.get("YOLO26_TILE_CONF", "0.15"))
PATCH = int(os.environ.get("YOLO26_TILE_PATCH", "1216"))
STEP = int(os.environ.get("YOLO26_TILE_STEP", "960"))
MARGIN = int(os.environ.get("YOLO26_TILE_MARGIN", "128"))

SAME_CLASS_IOU = 0.3
SAME_CLASS_AREA_RATIO = 0.5
XCLASS_IOU = 0.75
XCLASS_AREA_RATIO = 0.7

SCHENKER_TO_MUSCIMA = {
    "noteheadBlack": "noteheadFull",
    "stemStructural": "stem",
    "slurStructuralUp": "slur",
    "slurStructuralDown": "slur",
    "beamStructural": "beam",
    "beamStructuralPartialLeft": "beam",
    "beamStructuralPartialMiddle": "beam",
    "beamStructuralPartialRight": "beam",
    "beamStructuralUnfoldingUp": "beam",
    "beamStructuralUnfoldingDown": "beam",
    "flagStructuralUp": "flag8thUp",
    "flagStructuralDown": "flag8thDown",
}

MUSCIMA_TO_SCHENKER = {
    "stem": "stemStructural",
    "noteheadFull": "noteheadBlack",
    "slur": "slurStructuralUp",
    "tie": "slurStructuralDown",
    "beam": "beamStructural",
    "flag8thUp": "flagStructuralUp",
    "flag8thDown": "flagStructuralDown",
    "augmentationDot": "noteheadBlack",
    "tuple": "tuplet",
    "tupleBracket": "tupletBracket",
    "graceNoteAcciaccatura": "graceNoteSlashStemUp",
}

IGNORED_MODEL_CLASS_NAMES = {"", "NA", "na", "None", "none"}


@dataclass(frozen=True)
class Yolo26Options:
    large_model_key: str = DEFAULT_LARGE_MODEL_KEY
    small_model_key: str = DEFAULT_SMALL_MODEL_KEY
    run_large: bool = True
    run_small: bool = True
    deduplicate: bool = False
    roi_left: int | None = None
    roi_top: int | None = None
    roi_width: int | None = None
    roi_height: int | None = None
    large_conf: float = LARGE_CONF
    large_imgsz: int = LARGE_IMGSZ
    strip_width: int = STRIP_WIDTH
    strip_height: int = STRIP_HEIGHT
    strip_step_x: int = STRIP_STEP_X
    strip_step_y: int = STRIP_STEP_Y
    tile_conf: float = TILE_CONF
    tile_patch: int = PATCH
    tile_step: int = STEP
    tile_margin: int = MARGIN
    same_class_iou: float = SAME_CLASS_IOU
    same_class_area_ratio: float = SAME_CLASS_AREA_RATIO
    xclass_iou: float = XCLASS_IOU
    xclass_area_ratio: float = XCLASS_AREA_RATIO

    @classmethod
    def from_mapping(cls, values: dict[str, Any] | None) -> "Yolo26Options":
        if values is None:
            return cls()

        defaults = cls()
        return cls(
            large_model_key=_read_string(
                values, "largeModelKey", defaults.large_model_key
            ),
            small_model_key=_read_string(
                values, "smallModelKey", defaults.small_model_key
            ),
            run_large=_read_bool(values, "runLarge", defaults.run_large),
            run_small=_read_bool(values, "runSmall", defaults.run_small),
            deduplicate=_read_bool(values, "deduplicate", defaults.deduplicate),
            roi_left=_read_optional_int(values, "roiLeft", 0, 20000),
            roi_top=_read_optional_int(values, "roiTop", 0, 20000),
            roi_width=_read_optional_int(values, "roiWidth", 1, 200_000),
            roi_height=_read_optional_int(values, "roiHeight", 1, 20_000),
            large_conf=_read_float(values, "largeConf", defaults.large_conf, 0.0, 1.0),
            large_imgsz=_read_int(values, "largeImgsz", defaults.large_imgsz, 32, 12000),
            strip_width=_read_int(values, "stripWidth", defaults.strip_width, 0, 20000),
            strip_height=_read_int(values, "stripHeight", defaults.strip_height, 32, 12000),
            strip_step_x=_read_int(values, "stripStepX", defaults.strip_step_x, 1, 12000),
            strip_step_y=_read_int(values, "stripStepY", defaults.strip_step_y, 1, 12000),
            tile_conf=_read_float(values, "tileConf", defaults.tile_conf, 0.0, 1.0),
            tile_patch=_read_int(values, "tilePatch", defaults.tile_patch, 32, 12000),
            tile_step=_read_int(values, "tileStep", defaults.tile_step, 1, 12000),
            tile_margin=_read_int(values, "tileMargin", defaults.tile_margin, 0, 6000),
            same_class_iou=_read_float(
                values, "sameClassIou", defaults.same_class_iou, 0.0, 1.0
            ),
            same_class_area_ratio=_read_float(
                values,
                "sameClassAreaRatio",
                defaults.same_class_area_ratio,
                0.0,
                1.0,
            ),
            xclass_iou=_read_float(values, "xclassIou", defaults.xclass_iou, 0.0, 1.0),
            xclass_area_ratio=_read_float(
                values, "xclassAreaRatio", defaults.xclass_area_ratio, 0.0, 1.0
            ),
        )

    def to_json(self) -> dict[str, int | float | str | bool]:
        return {
            "largeModelKey": self.large_model_key,
            "smallModelKey": self.small_model_key,
            "runLarge": self.run_large,
            "runSmall": self.run_small,
            "deduplicate": self.deduplicate,
            "roiLeft": self.roi_left,
            "roiTop": self.roi_top,
            "roiWidth": self.roi_width,
            "roiHeight": self.roi_height,
            "largeConf": self.large_conf,
            "largeImgsz": self.large_imgsz,
            "stripWidth": self.strip_width,
            "stripHeight": self.strip_height,
            "stripStepX": self.strip_step_x,
            "stripStepY": self.strip_step_y,
            "tileConf": self.tile_conf,
            "tilePatch": self.tile_patch,
            "tileStep": self.tile_step,
            "tileMargin": self.tile_margin,
            "sameClassIou": self.same_class_iou,
            "sameClassAreaRatio": self.same_class_area_ratio,
            "xclassIou": self.xclass_iou,
            "xclassAreaRatio": self.xclass_area_ratio,
        }


def _read_string(values: dict[str, Any], key: str, default: str) -> str:
    if key not in values or values[key] in {"", None}:
        return default
    return str(values[key])


def _read_bool(values: dict[str, Any], key: str, default: bool) -> bool:
    if key not in values or values[key] in {"", None}:
        return default
    value = values[key]
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _read_float(
    values: dict[str, Any],
    key: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    if key not in values or values[key] in {"", None}:
        return default
    value = float(values[key])
    return max(minimum, min(value, maximum))


def _read_int(
    values: dict[str, Any],
    key: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    if key not in values or values[key] in {"", None}:
        return default
    value = int(round(float(values[key])))
    return max(minimum, min(value, maximum))


def _read_optional_int(
    values: dict[str, Any],
    key: str,
    minimum: int,
    maximum: int,
) -> int | None:
    if key not in values or values[key] in {"", None, "undefined", "null"}:
        return None
    value = int(round(float(values[key])))
    return max(minimum, min(value, maximum))


@dataclass(frozen=True)
class Detection:
    left: int
    top: int
    width: int
    height: int
    class_id: int
    raw_class_name: str
    class_name: str
    confidence: float
    source: str
    model_key: str
    model_label: str
    backend: str

    def to_json(self) -> dict[str, Any]:
        return {
            "left": self.left,
            "top": self.top,
            "width": self.width,
            "height": self.height,
            "classId": self.class_id,
            "rawClassName": self.raw_class_name,
            "className": self.class_name,
            "confidence": self.confidence,
            "source": self.source,
            "modelKey": self.model_key,
            "modelLabel": self.model_label,
            "backend": self.backend,
        }


def _default_device() -> str:
    if "YOLO26_DEVICE" in os.environ:
        return os.environ["YOLO26_DEVICE"]
    try:
        import torch

        return "0" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return float(inter / max(union, 1e-6))


def _area_ratio(a: np.ndarray, b: np.ndarray) -> float:
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    return float(min(area_a, area_b) / max(area_a, area_b, 1e-6))


def _same_class_nms(
    boxes: np.ndarray,
    scores: np.ndarray,
    classes: np.ndarray,
    iou_thr: float = SAME_CLASS_IOU,
    area_ratio_thr: float = SAME_CLASS_AREA_RATIO,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    boxes = np.asarray(boxes)
    scores = np.asarray(scores)
    classes = np.asarray(classes)
    if len(boxes) == 0:
        return np.zeros((0, 4)), np.array([]), np.array([], dtype=int)

    order = np.argsort(-scores)
    used = np.zeros(len(boxes), dtype=bool)
    keep: list[int] = []

    for i in order:
        if used[i]:
            continue
        keep.append(i)
        for j in order:
            if i == j or used[j]:
                continue
            if classes[j] != classes[i]:
                continue
            if _iou(boxes[i], boxes[j]) < iou_thr:
                continue
            if _area_ratio(boxes[i], boxes[j]) < area_ratio_thr:
                continue
            used[j] = True
        used[i] = True

    return boxes[keep], scores[keep], classes[keep]


def _cross_class_dedup(
    boxes: np.ndarray,
    scores: np.ndarray,
    classes: np.ndarray,
    iou_thr: float = XCLASS_IOU,
    area_ratio_thr: float = XCLASS_AREA_RATIO,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    boxes = np.asarray(boxes)
    scores = np.asarray(scores)
    classes = np.asarray(classes)
    if len(boxes) == 0:
        return boxes, scores, classes

    order = np.argsort(-scores)
    used = np.zeros(len(boxes), dtype=bool)
    keep: list[int] = []

    for i in order:
        if used[i]:
            continue
        keep.append(i)
        for j in order:
            if i == j or used[j]:
                continue
            if classes[j] == classes[i]:
                continue
            if _iou(boxes[i], boxes[j]) < iou_thr:
                continue
            if _area_ratio(boxes[i], boxes[j]) < area_ratio_thr:
                continue
            used[j] = True
        used[i] = True

    return boxes[keep], scores[keep], classes[keep]


def _crop_positions(length: int, crop: int, step: int) -> list[int]:
    if crop >= length:
        return [0]
    positions = list(range(0, max(length - crop, 0) + 1, step))
    if not positions or positions[-1] + crop < length:
        positions.append(length - crop)
    return sorted(set(positions))


def _tile_positions(length: int, patch: int, step: int) -> list[int]:
    positions = list(range(0, max(length - patch, 0) + 1, step))
    if not positions or positions[-1] + patch < length:
        positions.append(max(length - patch, 0))
    return sorted(set(positions))


def _empty_prediction() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    return np.zeros((0, 4)), np.array([]), np.array([], dtype=int)


def _resolve_model_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


@dataclass(frozen=True)
class DetectionModelSpec:
    key: str
    label: str
    role: str
    backend: str
    path: Path
    fallback_paths: tuple[Path, ...] = ()


DETECTION_MODEL_SPECS = [
    DetectionModelSpec(
        key="yolo26l_large_fullwidth_7pages_pre",
        label="YOLO26L, 7 pages",
        role="large",
        backend="yolo",
        path=Path(os.environ.get("YOLO26_LARGE_MODEL", DEFAULT_LARGE_MODEL)),
    ),
    DetectionModelSpec(
        key="yolo26l_tiled_7pages_pre",
        label="YOLO26L, 7 pages",
        role="small",
        backend="yolo",
        path=Path(os.environ.get("YOLO26_TILED_MODEL", DEFAULT_TILED_MODEL)),
    ),
    DetectionModelSpec(
        key="yolo26l_large_fullwidth_9pages_ep300",
        label="YOLO26L, 9 pages, 300 epochs",
        role="large",
        backend="yolo",
        path=YOLO26_LARGE_9PAGES_EP300_MODEL,
        fallback_paths=(REMOTE_YOLO26_LARGE_9PAGES_EP300_MODEL,),
    ),
    DetectionModelSpec(
        key="yolo26l_tiled_9pages_ep300",
        label="YOLO26L, 9 pages, 300 epochs",
        role="small",
        backend="yolo",
        path=YOLO26_TILED_9PAGES_EP300_MODEL,
        fallback_paths=(REMOTE_YOLO26_TILED_9PAGES_EP300_MODEL,),
    ),
    DetectionModelSpec(
        key="detr_large_9pages_plus50",
        label="DETR, 9 pages, 200 epochs",
        role="large",
        backend="detr",
        path=DETR_LARGE_9PAGES_PLUS50_MODEL,
        fallback_paths=(REMOTE_DETR_LARGE_9PAGES_PLUS50_MODEL,),
    ),
    DetectionModelSpec(
        key="detr_tiled_9pages_plus50",
        label="DETR, 9 pages, 170 epochs",
        role="small",
        backend="detr",
        path=DETR_TILED_9PAGES_PLUS50_MODEL,
        fallback_paths=(REMOTE_DETR_TILED_9PAGES_PLUS50_MODEL,),
    ),
]

DETECTION_MODEL_SPECS_BY_KEY = {
    spec.key: spec
    for spec in DETECTION_MODEL_SPECS
}


def list_detection_models() -> list[dict[str, Any]]:
    return [
        {
            "key": spec.key,
            "label": spec.label,
            "role": spec.role,
            "backend": spec.backend,
            "path": str(_resolve_model_spec_path(spec)),
            "available": _resolve_model_spec_path(spec).exists(),
            "candidatePaths": [
                str(path)
                for path in _candidate_model_paths(spec)
            ],
        }
        for spec in DETECTION_MODEL_SPECS
    ]


def _candidate_model_paths(spec: DetectionModelSpec) -> list[Path]:
    return [
        _resolve_model_path(path)
        for path in (spec.path, *spec.fallback_paths)
    ]


def _resolve_model_spec_path(spec: DetectionModelSpec) -> Path:
    paths = _candidate_model_paths(spec)
    for path in paths:
        if path.exists():
            return path
    return paths[0]


def _model_names_to_dict(names: Any) -> dict[int, str]:
    if isinstance(names, dict):
        return {int(idx): str(name) for idx, name in names.items()}
    return {idx: str(name) for idx, name in enumerate(names)}


def _merge_model_names(*name_sets: Any) -> dict[int, str]:
    merged: dict[int, str] = {}
    for names in name_sets:
        for idx, name in _model_names_to_dict(names).items():
            if idx not in merged or merged[idx] in IGNORED_MODEL_CLASS_NAMES:
                merged[idx] = name
    return merged


def _predict_boxes(model: Any, image: Image.Image, imgsz: int, conf: float, device: str):
    preds = model.predict(image, imgsz=imgsz, conf=conf, device=device, verbose=False)
    boxes = preds[0].boxes
    if len(boxes) == 0:
        return _empty_prediction()
    return (
        boxes.xyxy.cpu().numpy(),
        boxes.conf.cpu().numpy(),
        boxes.cls.cpu().numpy().astype(int),
    )


def _read_allowed_class_ids(model_names: dict[int, str]) -> set[int]:
    explicit_ids = os.environ.get("YOLO26_ALLOWED_CLASS_IDS")
    if explicit_ids:
        return {
            int(value.strip())
            for value in explicit_ids.split(",")
            if value.strip()
        }

    explicit_names = os.environ.get("YOLO26_ALLOWED_CLASS_NAMES")
    if explicit_names:
        allowed_names = {
            SCHENKER_TO_MUSCIMA.get(value.strip(), value.strip())
            for value in explicit_names.split(",")
            if value.strip()
        }
        return {
            idx
            for idx, name in model_names.items()
            if name in allowed_names
        }

    if os.environ.get("YOLO26_USE_ALLOWED_CLASSES", "1") in {"0", "false", "False"}:
        return set(model_names.keys())

    return {
        idx
        for idx, name in model_names.items()
        if name not in IGNORED_MODEL_CLASS_NAMES
    }


def _filter_allowed(
    boxes: np.ndarray,
    scores: np.ndarray,
    classes: np.ndarray,
    allowed: set[int],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if len(classes) == 0:
        return boxes, scores, classes
    mask = np.array([int(cls_id) in allowed for cls_id in classes])
    return boxes[mask], scores[mask], classes[mask]


class DetectionModelAdapter:
    def __init__(self, spec: DetectionModelSpec, path: Path) -> None:
        self.spec = spec
        self.path = path
        self.names: dict[int, str] = {}

    def predict_boxes(
        self,
        image: Image.Image,
        imgsz: int,
        conf: float,
        device: str,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        raise NotImplementedError

    def get_raw_class_name(self, class_id: int) -> str:
        return self.names.get(int(class_id), str(int(class_id)))


class YoloModelAdapter(DetectionModelAdapter):
    def __init__(self, spec: DetectionModelSpec, path: Path) -> None:
        super().__init__(spec, path)
        from ultralytics import YOLO

        self.model = YOLO(str(path))
        self.names = _model_names_to_dict(self.model.names)

    def predict_boxes(
        self,
        image: Image.Image,
        imgsz: int,
        conf: float,
        device: str,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        return _predict_boxes(self.model, image, imgsz, conf, device)


class DetrModelAdapter(DetectionModelAdapter):
    def __init__(self, spec: DetectionModelSpec, path: Path, device: str) -> None:
        super().__init__(spec, path)
        try:
            import torch
            from transformers import AutoImageProcessor, AutoModelForObjectDetection
        except Exception as exc:
            raise RuntimeError(
                "DETR models require torch and transformers. "
                "Install the detection backend requirements before using DETR."
            ) from exc

        self.torch = torch
        self.device = _torch_device_name(device)
        self.processor = AutoImageProcessor.from_pretrained(str(path))
        self.model = AutoModelForObjectDetection.from_pretrained(str(path))
        self.model.to(self.device)
        self.model.eval()
        id_to_label = getattr(self.model.config, "id2label", {}) or {}
        self.names = {int(idx): str(name) for idx, name in id_to_label.items()}

    def predict_boxes(
        self,
        image: Image.Image,
        imgsz: int,
        conf: float,
        device: str,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        inputs = self.processor(images=image, return_tensors="pt")
        inputs = {
            key: value.to(self.device)
            for key, value in inputs.items()
        }
        target_sizes = self.torch.tensor(
            [[image.height, image.width]],
            device=self.device,
        )
        with self.torch.no_grad():
            outputs = self.model(**inputs)
        results = self.processor.post_process_object_detection(
            outputs,
            threshold=conf,
            target_sizes=target_sizes,
        )[0]
        boxes = results["boxes"].detach().cpu().numpy()
        scores = results["scores"].detach().cpu().numpy()
        classes = results["labels"].detach().cpu().numpy().astype(int)
        if len(boxes) == 0:
            return _empty_prediction()
        return boxes, scores, classes


def _torch_device_name(device: str) -> str:
    if device.isdigit():
        return f"cuda:{device}"
    if device == "cuda":
        return "cuda:0"
    return device


class Yolo26CombinedDetector:
    def __init__(self) -> None:
        self.device = _default_device()
        self.model_cache: dict[str, DetectionModelAdapter] = {}
        self.explicit_allowed_class_ids = self._read_explicit_allowed_class_ids()
        self.explicit_allowed_class_names = self._read_explicit_allowed_class_names()
        self.use_allowed_classes = os.environ.get(
            "YOLO26_USE_ALLOWED_CLASSES", "1"
        ) not in {"0", "false", "False"}

    def run_large_strips(
        self,
        canvas: Image.Image,
        model_key: str,
        options: Yolo26Options,
    ) -> list[Detection]:
        adapter = self.get_model(model_key, "large")
        width, height = canvas.size
        crop_w = width if options.strip_width <= 0 else min(options.strip_width, width)
        crop_h = min(options.strip_height, height)
        x_positions = _crop_positions(width, crop_w, options.strip_step_x)
        y_positions = _crop_positions(height, crop_h, options.strip_step_y)
        detections: list[Detection] = []

        for x0 in x_positions:
            for y0 in y_positions:
                crop = canvas.crop((x0, y0, x0 + crop_w, y0 + crop_h))
                boxes, scores, classes = adapter.predict_boxes(
                    crop,
                    options.large_imgsz,
                    options.large_conf,
                    self.device,
                )
                for box, score, cls_id in zip(boxes, scores, classes):
                    left, top, right, bottom = box
                    detection = self.to_detection(
                        box=[left + x0, top + y0, right + x0, bottom + y0],
                        score=float(score),
                        cls_id=int(cls_id),
                        adapter=adapter,
                        source="large",
                        image_size=canvas.size,
                    )
                    if detection is not None:
                        detections.append(detection)

        return self.postprocess_detections(detections, options)

    def run_tiled(
        self,
        canvas: Image.Image,
        model_key: str,
        options: Yolo26Options,
    ) -> list[Detection]:
        adapter = self.get_model(model_key, "small")
        width, height = canvas.size
        x_positions = _tile_positions(width, options.tile_patch, options.tile_step)
        y_positions = _tile_positions(height, options.tile_patch, options.tile_step)
        detections: list[Detection] = []

        for xi, x0 in enumerate(x_positions):
            for yi, y0 in enumerate(y_positions):
                tile = canvas.crop(
                    (x0, y0, x0 + options.tile_patch, y0 + options.tile_patch)
                )
                boxes, scores, classes = adapter.predict_boxes(
                    tile,
                    options.tile_patch,
                    options.tile_conf,
                    self.device,
                )
                for box, score, cls_id in zip(boxes, scores, classes):
                    left, top, right, bottom = box
                    if xi != 0 and left < options.tile_margin:
                        continue
                    if (
                        xi != len(x_positions) - 1
                        and right > options.tile_patch - options.tile_margin
                    ):
                        continue
                    if yi != 0 and top < options.tile_margin:
                        continue
                    if (
                        yi != len(y_positions) - 1
                        and bottom > options.tile_patch - options.tile_margin
                    ):
                        continue
                    detection = self.to_detection(
                        box=[left + x0, top + y0, right + x0, bottom + y0],
                        score=float(score),
                        cls_id=int(cls_id),
                        adapter=adapter,
                        source="small",
                        image_size=canvas.size,
                    )
                    if detection is not None:
                        detections.append(detection)

        return self.postprocess_detections(detections, options)

    def detect(
        self,
        image: Image.Image,
        options: Yolo26Options | None = None,
    ) -> dict[str, Any]:
        options = options or Yolo26Options()
        full_canvas = image.convert("RGB")
        full_size = full_canvas.size
        roi = self.resolve_roi(full_size, options)
        if roi is None:
            canvas = full_canvas
            offset_x = 0
            offset_y = 0
        else:
            offset_x, offset_y, roi_width, roi_height = roi
            canvas = full_canvas.crop(
                (offset_x, offset_y, offset_x + roi_width, offset_y + roi_height)
            )
        large = (
            self.run_large_strips(canvas, options.large_model_key, options)
            if options.run_large
            else []
        )
        tiled = (
            self.run_tiled(canvas, options.small_model_key, options)
            if options.run_small
            else []
        )
        detections = large + tiled
        if options.deduplicate:
            detections = self.deduplicate_detections(detections, options)
        if offset_x != 0 or offset_y != 0:
            detections = [
                self.offset_detection(detection, offset_x, offset_y, full_size)
                for detection in detections
            ]
        detections.sort(key=lambda d: (d.top, d.left, d.class_name, -d.confidence))

        return {
            "model": MODEL_NAME,
            "device": str(self.device),
            "options": options.to_json(),
            "models": {
                "large": self.model_metadata(options.large_model_key),
                "small": self.model_metadata(options.small_model_key),
            },
            "largeCount": len(large),
            "tiledCount": len(tiled),
            "count": len(detections),
            "image": {
                "width": int(full_size[0]),
                "height": int(full_size[1]),
            },
            "region": (
                None
                if roi is None
                else {
                    "left": int(offset_x),
                    "top": int(offset_y),
                    "width": int(roi[2]),
                    "height": int(roi[3]),
                }
            ),
            "predictions": [detection.to_json() for detection in detections],
        }

    def resolve_roi(
        self,
        image_size: tuple[int, int],
        options: Yolo26Options,
    ) -> tuple[int, int, int, int] | None:
        if (
            options.roi_left is None
            or options.roi_top is None
            or options.roi_width is None
            or options.roi_height is None
        ):
            return None

        image_width, image_height = image_size
        left = max(0, min(options.roi_left, image_width - 1))
        top = max(0, min(options.roi_top, image_height - 1))
        right = max(left + 1, min(left + options.roi_width, image_width))
        bottom = max(top + 1, min(top + options.roi_height, image_height))
        return left, top, right - left, bottom - top

    def get_model(self, model_key: str, expected_role: str) -> DetectionModelAdapter:
        if model_key not in DETECTION_MODEL_SPECS_BY_KEY:
            known = ", ".join(sorted(DETECTION_MODEL_SPECS_BY_KEY))
            raise ValueError(f"Unknown detection model '{model_key}'. Known models: {known}")

        spec = DETECTION_MODEL_SPECS_BY_KEY[model_key]
        if spec.role != expected_role:
            raise ValueError(
                f"Model '{spec.label}' is registered for {spec.role} symbols, "
                f"not {expected_role} symbols."
            )

        if model_key in self.model_cache:
            return self.model_cache[model_key]

        path = _resolve_model_spec_path(spec)
        if not path.exists():
            raise FileNotFoundError(f"Missing {spec.label} model: {path}")

        if spec.backend == "yolo":
            adapter = YoloModelAdapter(spec, path)
        elif spec.backend == "detr":
            adapter = DetrModelAdapter(spec, path, self.device)
        else:
            raise ValueError(f"Unsupported detection backend: {spec.backend}")

        self.model_cache[model_key] = adapter
        return adapter

    def model_metadata(self, model_key: str) -> dict[str, Any] | None:
        spec = DETECTION_MODEL_SPECS_BY_KEY.get(model_key)
        if spec is None:
            return None
        path = _resolve_model_spec_path(spec)
        return {
            "key": spec.key,
            "label": spec.label,
            "role": spec.role,
            "backend": spec.backend,
            "path": str(path),
            "available": path.exists(),
            "candidatePaths": [
                str(candidate_path)
                for candidate_path in _candidate_model_paths(spec)
            ],
        }

    def to_detection(
        self,
        box: list[float] | tuple[float, float, float, float],
        score: float,
        cls_id: int,
        adapter: DetectionModelAdapter,
        source: str,
        image_size: tuple[int, int],
    ) -> Detection | None:
        image_width, image_height = image_size
        raw_name = adapter.get_raw_class_name(int(cls_id))
        if not self.is_allowed_class(int(cls_id), raw_name):
            return None

        class_name = MUSCIMA_TO_SCHENKER.get(raw_name, raw_name)
        left = int(round(float(box[0])))
        top = int(round(float(box[1])))
        right = int(round(float(box[2])))
        bottom = int(round(float(box[3])))
        left = max(0, min(left, image_width - 1))
        top = max(0, min(top, image_height - 1))
        right = max(left + 1, min(right, image_width))
        bottom = max(top + 1, min(bottom, image_height))

        return Detection(
            left=left,
            top=top,
            width=right - left,
            height=bottom - top,
            class_id=int(cls_id),
            raw_class_name=raw_name,
            class_name=class_name,
            confidence=float(score),
            source=source,
            model_key=adapter.spec.key,
            model_label=adapter.spec.label,
            backend=adapter.spec.backend,
        )

    def offset_detection(
        self,
        detection: Detection,
        offset_x: int,
        offset_y: int,
        image_size: tuple[int, int],
    ) -> Detection:
        image_width, image_height = image_size
        left = max(0, min(detection.left + offset_x, image_width - 1))
        top = max(0, min(detection.top + offset_y, image_height - 1))
        right = max(left + 1, min(left + detection.width, image_width))
        bottom = max(top + 1, min(top + detection.height, image_height))

        return Detection(
            left=left,
            top=top,
            width=right - left,
            height=bottom - top,
            class_id=detection.class_id,
            raw_class_name=detection.raw_class_name,
            class_name=detection.class_name,
            confidence=detection.confidence,
            source=detection.source,
            model_key=detection.model_key,
            model_label=detection.model_label,
            backend=detection.backend,
        )

    def postprocess_detections(
        self,
        detections: list[Detection],
        options: Yolo26Options,
    ) -> list[Detection]:
        if options.deduplicate:
            detections = self.deduplicate_detections(detections, options)
        return detections

    def deduplicate_detections(
        self,
        detections: list[Detection],
        options: Yolo26Options,
    ) -> list[Detection]:
        detections = self.remove_duplicate_detections(
            detections,
            same_class=True,
            iou_thr=options.same_class_iou,
            area_ratio_thr=options.same_class_area_ratio,
        )
        detections = self.remove_duplicate_detections(
            detections,
            same_class=False,
            iou_thr=options.xclass_iou,
            area_ratio_thr=options.xclass_area_ratio,
        )
        return detections

    def remove_duplicate_detections(
        self,
        detections: list[Detection],
        same_class: bool,
        iou_thr: float,
        area_ratio_thr: float,
    ) -> list[Detection]:
        keep: list[Detection] = []
        for candidate in sorted(detections, key=lambda d: -d.confidence):
            should_drop = False
            for kept in keep:
                is_same_class = candidate.class_name == kept.class_name
                if is_same_class != same_class:
                    continue
                if _iou(self.detection_box(candidate), self.detection_box(kept)) < iou_thr:
                    continue
                if (
                    _area_ratio(self.detection_box(candidate), self.detection_box(kept))
                    < area_ratio_thr
                ):
                    continue
                should_drop = True
                break
            if not should_drop:
                keep.append(candidate)
        return keep

    def detection_box(self, detection: Detection) -> np.ndarray:
        return np.array(
            [
                detection.left,
                detection.top,
                detection.left + detection.width,
                detection.top + detection.height,
            ],
            dtype=float,
        )

    def is_allowed_class(self, class_id: int, raw_name: str) -> bool:
        if self.explicit_allowed_class_ids is not None:
            return int(class_id) in self.explicit_allowed_class_ids
        if self.explicit_allowed_class_names is not None:
            return raw_name in self.explicit_allowed_class_names
        if not self.use_allowed_classes:
            return True
        return raw_name not in IGNORED_MODEL_CLASS_NAMES

    def _read_explicit_allowed_class_ids(self) -> set[int] | None:
        explicit_ids = os.environ.get("YOLO26_ALLOWED_CLASS_IDS")
        if not explicit_ids:
            return None
        return {
            int(value.strip())
            for value in explicit_ids.split(",")
            if value.strip()
        }

    def _read_explicit_allowed_class_names(self) -> set[str] | None:
        explicit_names = os.environ.get("YOLO26_ALLOWED_CLASS_NAMES")
        if not explicit_names:
            return None
        return {
            SCHENKER_TO_MUSCIMA.get(value.strip(), value.strip())
            for value in explicit_names.split(",")
            if value.strip()
        }


_detector: Yolo26CombinedDetector | None = None
_detector_lock = threading.Lock()


def get_detector() -> Yolo26CombinedDetector:
    global _detector
    with _detector_lock:
        if _detector is None:
            _detector = Yolo26CombinedDetector()
        return _detector


def detect_image(
    image: Image.Image,
    options: dict[str, Any] | Yolo26Options | None = None,
) -> dict[str, Any]:
    if not isinstance(options, Yolo26Options):
        options = Yolo26Options.from_mapping(options)
    return get_detector().detect(image, options)
