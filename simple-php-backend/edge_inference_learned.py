"""Production inference for the learned Schenkerian relation model.

The pipeline is deliberately model-only:

1. score every unordered node pair with the learned relation-proposal MLP;
2. score the retained learned proposals with the incidence-attention network;
3. orient predicted adjacencies with the learned direction classifier.

There is no class/distance candidate gate, ``edge_rules`` import, rule edge edit,
or hard degree/cardinality decoder.  The server-facing :func:`predict_edges`
function is read-only: it reads MuNG and image dimensions and returns JSON.  It
never writes a MuNG file.

The five-file bundle is immutable and hash-verified before deserialisation::

    proposal.pth
    incidence.pth
    direction.joblib
    vcnn.pth
    bundle.json

Set ``EDGE_LEARNED_BUNDLE_DIR`` to the versioned bundle directory.  The default
is ``models/edge_all9_production`` inside the MuNG Studio checkout.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import threading
from pathlib import Path
from typing import Any, Iterable

import joblib
import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUNDLE_DIR = PROJECT_ROOT / "models" / "edge_all9_production"
SCHENK_ROOT = Path(
    os.environ.get("SCHENK_ROOT", "/home/users/yh477/lab/Schenkerian_OMR")
).expanduser().resolve()
MODEL_FILES = ("proposal.pth", "incidence.pth", "direction.joblib", "vcnn.pth")
EXPECTED_TARGET_RECALL = 0.995
EXPECTED_INCIDENCE_THRESHOLD = 0.5
EXPECTED_TRAINING_PAGES = 9
MAX_ALL_PAIRS = int(os.environ.get("EDGE_LEARNED_MAX_PAIRS", "20000000"))
MAX_PROPOSALS = int(os.environ.get("EDGE_LEARNED_MAX_PROPOSALS", "500000"))
PROPOSAL_BATCH_SIZE = int(os.environ.get("EDGE_LEARNED_PROPOSAL_BATCH", "65536"))
VISUAL_BATCH_SIZE = int(os.environ.get("EDGE_LEARNED_VISUAL_BATCH", "256"))

_state_lock = threading.Lock()
_inference_lock = threading.Lock()
_state_cache: dict[tuple[str, str], dict[str, Any]] = {}


def _bundle_dir(override: str | os.PathLike[str] | None = None) -> Path:
    value = override or os.environ.get("EDGE_LEARNED_BUNDLE_DIR") or DEFAULT_BUNDLE_DIR
    return Path(value).expanduser().resolve()


def _device_name(torch) -> str:
    requested = os.environ.get("EDGE_LEARNED_DEVICE")
    if requested:
        return requested
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _artifact_record(manifest: dict[str, Any], filename: str) -> dict[str, Any]:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or filename not in artifacts:
        raise ValueError(f"manifest lacks artifacts.{filename}")
    record = artifacts[filename]
    if isinstance(record, str):
        record = {"sha256": record}
    if not isinstance(record, dict):
        raise ValueError(f"manifest artifacts.{filename} must be an object")
    return record


def _training_page_count(value: Any) -> int:
    if isinstance(value, (list, tuple)):
        return len(value)
    if isinstance(value, bool):
        return -1
    try:
        return int(value)
    except (TypeError, ValueError):
        return -1


def _verify_bundle(bundle: Path) -> tuple[dict[str, Any], dict[str, str]]:
    # ``bundle.json`` is the production trainer's canonical name.  The fallback
    # keeps the adapter compatible with the earlier documented contract.
    manifest_path = bundle / "bundle.json"
    if not manifest_path.is_file():
        manifest_path = bundle / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"learned-edge bundle.json not found under: {bundle}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("learned-edge manifest must contain a JSON object")
    schema = int(manifest.get("schema_version", 0))
    if schema != 1:
        raise ValueError(f"unsupported learned-edge manifest schema_version={schema}")
    if manifest.get("complete") is not True or not (bundle / "COMPLETE").is_file():
        raise ValueError("learned-edge bundle is incomplete (complete/COMPLETE missing)")

    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        raise ValueError("manifest lacks artifacts object")
    missing_required = [filename for filename in MODEL_FILES if filename not in artifacts]
    if missing_required:
        raise ValueError(f"manifest lacks required artifacts: {missing_required}")

    # Verify every declared artifact, including training-provenance files that
    # are not deserialized by inference (for example incidence_initialization).
    hashes: dict[str, str] = {}
    for filename in sorted(artifacts):
        if Path(filename).name != filename:
            raise ValueError(f"artifact key must be a safe basename: {filename!r}")
        path = bundle / filename
        if not path.is_file():
            raise FileNotFoundError(f"learned-edge artifact not found: {path}")
        record = _artifact_record(manifest, filename)
        if record.get("path", filename) != filename:
            raise ValueError(f"artifact path for {filename} must equal its basename")
        expected_bytes = record.get("bytes")
        if expected_bytes is not None and int(expected_bytes) != path.stat().st_size:
            raise ValueError(
                f"learned-edge artifact size mismatch for {filename}: "
                f"expected {expected_bytes}, got {path.stat().st_size}"
            )
        expected = str(record.get("sha256", "")).lower()
        if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
            raise ValueError(f"manifest has invalid SHA256 for {filename}")
        actual = _sha256(path)
        if actual != expected:
            raise ValueError(
                f"learned-edge artifact SHA256 mismatch for {filename}: "
                f"expected {expected}, got {actual}"
            )
        hashes[filename] = actual

    family = str(manifest.get("model_family", "")).lower()
    if family and "learned" not in family:
        raise ValueError(f"unexpected model_family={manifest.get('model_family')!r}")
    contract = manifest.get("inference_contract", {})
    if not isinstance(contract, dict):
        raise ValueError("manifest inference_contract must be an object")
    if contract.get("rules", manifest.get("rules_applied")) is not False:
        raise ValueError("manifest must certify inference_contract.rules=false")
    if contract.get("hard_graph_decoder", manifest.get("hard_decoder")) is not False:
        raise ValueError("manifest must certify inference_contract.hard_graph_decoder=false")
    if contract.get("rules_or_class_distance_gate") is not False:
        raise ValueError("manifest must certify rules_or_class_distance_gate=false")
    if str(contract.get("proposal_universe", "")).lower() != "all unordered node pairs":
        raise ValueError("manifest must certify proposal_universe=all unordered node pairs")
    allow_nonproduction = os.environ.get("EDGE_LEARNED_ALLOW_NONPRODUCTION") == "1"
    if not allow_nonproduction:
        if manifest.get("production_candidate") is not True:
            raise ValueError("bundle is not marked production_candidate=true")
        if manifest.get("smoke_nonproduction") is not False:
            raise ValueError("bundle is marked smoke/non-production")
        training_pages = manifest.get("training_dataset", {}).get("pages")
        if _training_page_count(training_pages) != EXPECTED_TRAINING_PAGES:
            raise ValueError("production bundle must certify nine training pages")
    return manifest, hashes


def _require_schenker_imports() -> None:
    if not SCHENK_ROOT.is_dir():
        raise FileNotFoundError(f"Schenkerian_OMR source tree not found: {SCHENK_ROOT}")
    root = str(SCHENK_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)


def _validate_proposal_checkpoint(
    checkpoint: dict[str, Any], manifest: dict[str, Any]
) -> tuple[dict[str, Any], float]:
    if not isinstance(checkpoint, dict) or "model" not in checkpoint:
        raise ValueError("proposal.pth lacks model state_dict")
    config = checkpoint.get("model_config")
    meta = checkpoint.get("meta") or checkpoint.get("production")
    bundle_meta = manifest.get("proposal", {})
    if not isinstance(config, dict) or not isinstance(meta, dict) or not isinstance(bundle_meta, dict):
        raise ValueError("proposal.pth/bundle lacks model_config/production metadata")
    required = ("vocab", "class_dim", "hidden", "dropout", "geometry_dim")
    missing = [key for key in required if key not in config]
    if missing:
        raise ValueError(f"proposal model_config lacks {missing}")
    if int(config["geometry_dim"]) != 36:
        raise ValueError("proposal geometry_dim must be 36")
    threshold = float(
        meta.get("proposal_threshold", meta.get("threshold", bundle_meta.get("threshold", float("nan"))))
    )
    if not math.isfinite(threshold) or not 0.0 < threshold <= 1.0:
        raise ValueError("proposal meta.proposal_threshold must be in (0,1]")
    target = float(meta.get("target_recall", bundle_meta.get("target_train_recall", float("nan"))))
    if not math.isclose(target, EXPECTED_TARGET_RECALL, abs_tol=1e-12):
        raise ValueError(
            f"proposal target_recall must be {EXPECTED_TARGET_RECALL}, got {target}"
        )
    pages = meta.get("training_pages", meta.get("pages", bundle_meta.get("pages")))
    if (
        os.environ.get("EDGE_LEARNED_ALLOW_NONPRODUCTION") != "1"
        and _training_page_count(pages) != EXPECTED_TRAINING_PAGES
    ):
        raise ValueError("proposal checkpoint must certify training_pages=9")
    if meta.get("rules_or_class_distance_gate", bundle_meta.get("rules_or_class_distance_gate")) is not False:
        raise ValueError("proposal metadata must certify rules_or_class_distance_gate=false")
    if meta.get("all_pairs_at_inference", bundle_meta.get("all_pairs_at_inference")) is not True:
        raise ValueError("proposal metadata must certify all_pairs_at_inference=true")
    return config, threshold


def _validate_incidence_checkpoint(
    checkpoint: dict[str, Any], proposal_threshold: float, manifest: dict[str, Any]
) -> dict[str, Any]:
    if not isinstance(checkpoint, dict) or "model" not in checkpoint:
        raise ValueError("incidence.pth lacks model state_dict")
    meta = checkpoint.get("meta")
    if not isinstance(meta, dict):
        raise ValueError("incidence.pth lacks meta")
    required = ("vocab", "hidden", "ports", "layers", "class_dim")
    missing = [key for key in required if key not in meta]
    if missing:
        raise ValueError(f"incidence meta lacks {missing}")
    bundle_meta = manifest.get("incidence", {})
    contract = manifest.get("inference_contract", {})
    threshold = float(
        meta.get(
            "threshold",
            meta.get("adjacency_threshold", contract.get("adjacency_threshold", float("nan"))),
        )
    )
    if not math.isclose(threshold, EXPECTED_INCIDENCE_THRESHOLD, abs_tol=1e-12):
        raise ValueError("incidence threshold must be fixed at 0.5")
    if str(meta.get("visual_ablation", "")).lower() not in {"zero-ink", "zero_ink"}:
        raise ValueError("incidence checkpoint must certify visual_ablation=zero-ink")
    inc_proposal_threshold = float(
        meta.get("proposal_threshold", contract.get("proposal_threshold", float("nan")))
    )
    if not math.isclose(inc_proposal_threshold, proposal_threshold, abs_tol=1e-9):
        raise ValueError("proposal/incidence bundle metadata disagree on proposal_threshold")
    if (
        os.environ.get("EDGE_LEARNED_ALLOW_NONPRODUCTION") != "1"
        and _training_page_count(meta.get("training_pages", bundle_meta.get("training_pages")))
        != EXPECTED_TRAINING_PAGES
    ):
        raise ValueError("incidence checkpoint must certify training_pages=9")
    inference = str(meta.get("inference", "")).lower()
    required_claims = ("learned proposal", "no rule", "no hard decoder")
    if any(claim not in inference for claim in required_claims):
        raise ValueError(
            "incidence meta.inference must certify learned proposals only, "
            "no rule edge edits, and no hard decoder"
        )
    normalized = dict(meta)
    normalized["threshold"] = threshold
    normalized["proposal_threshold"] = inc_proposal_threshold
    return normalized


def _validate_direction_payload(payload: Any) -> tuple[Any, dict[str, Any]]:
    if not isinstance(payload, dict) or "model" not in payload:
        raise ValueError("direction.joblib must contain {'model', 'meta'}")
    meta = payload.get("meta")
    if not isinstance(meta, dict):
        raise ValueError("direction.joblib lacks meta")
    if (
        os.environ.get("EDGE_LEARNED_ALLOW_NONPRODUCTION") != "1"
        and _training_page_count(meta.get("training_pages")) != EXPECTED_TRAINING_PAGES
    ):
        raise ValueError("direction model must certify training_pages=9")
    if meta.get("rules_or_direction_table") is not False:
        raise ValueError("direction model must certify rules_or_direction_table=false")
    threshold = float(meta.get("threshold", EXPECTED_INCIDENCE_THRESHOLD))
    if not math.isclose(threshold, EXPECTED_INCIDENCE_THRESHOLD, abs_tol=1e-12):
        raise ValueError("direction threshold must be 0.5")
    model = payload["model"]
    if not callable(getattr(model, "predict_proba", None)):
        raise ValueError("direction model does not implement predict_proba")
    return model, meta


def _get_state(bundle_override: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    _require_schenker_imports()
    import torch

    bundle = _bundle_dir(bundle_override)
    device = _device_name(torch)
    cache_key = (str(bundle), device)
    with _state_lock:
        if cache_key in _state_cache:
            return _state_cache[cache_key]

        manifest, hashes = _verify_bundle(bundle)
        # Hashes are checked before torch/joblib deserialize any artifact.
        proposal_ckpt = torch.load(bundle / "proposal.pth", map_location=device)
        incidence_ckpt = torch.load(bundle / "incidence.pth", map_location=device)
        vcnn_ckpt = torch.load(bundle / "vcnn.pth", map_location=device)
        direction_payload = joblib.load(bundle / "direction.joblib")

        # The research tree's constants module resolves its ontology XML from
        # the repository cwd at import time.  Import once under the model-load
        # lock, restore cwd immediately, and never chdir during inference.
        previous_cwd = os.getcwd()
        try:
            os.chdir(SCHENK_ROOT)
            from scripts.training.train_edges_incidence import IncidenceNet
            from scripts.training.train_edges_relation_proposal import RelationProposalMLP
            from scripts.training.train_edges_vcnn import PairCNN
            from utils.constants import get_classlist_and_classdict
        finally:
            os.chdir(previous_cwd)

        proposal_config, proposal_threshold = _validate_proposal_checkpoint(
            proposal_ckpt, manifest
        )
        incidence_meta = _validate_incidence_checkpoint(
            incidence_ckpt, proposal_threshold, manifest
        )
        direction_model, direction_meta = _validate_direction_payload(direction_payload)
        if not isinstance(vcnn_ckpt, dict) or "model" not in vcnn_ckpt:
            raise ValueError("vcnn.pth lacks model state_dict")

        proposal = RelationProposalMLP(
            vocab=int(proposal_config["vocab"]),
            class_dim=int(proposal_config["class_dim"]),
            hidden=int(proposal_config["hidden"]),
            dropout=float(proposal_config["dropout"]),
        ).to(device)
        proposal.load_state_dict(proposal_ckpt["model"], strict=True)
        proposal.eval()

        incidence = IncidenceNet(
            vocab=int(incidence_meta["vocab"]),
            hidden=int(incidence_meta["hidden"]),
            ports=int(incidence_meta["ports"]),
            layers=int(incidence_meta["layers"]),
            class_dim=int(incidence_meta["class_dim"]),
        ).to(device)
        incidence.load_state_dict(incidence_ckpt["model"], strict=True)
        incidence.eval()

        vcnn = PairCNN().to(device)
        vcnn.load_state_dict(vcnn_ckpt["model"], strict=True)
        vcnn.eval()

        _, class_dict = get_classlist_and_classdict("all")
        vocab_values = [int(value) for value in class_dict.values()]
        if not vocab_values:
            raise ValueError("shared class vocabulary is empty")
        required_vocab = max(vocab_values) + 1
        if int(proposal_config["vocab"]) < required_vocab:
            raise ValueError("proposal vocabulary is smaller than the shared class IDs")
        if int(incidence_meta["vocab"]) != int(proposal_config["vocab"]):
            raise ValueError("proposal and incidence vocabularies differ")

        state = {
            "torch": torch,
            "device": device,
            "bundle": bundle,
            "manifest": manifest,
            "hashes": hashes,
            "bundle_id": manifest.get("bundle_id")
            or "learned-edge-"
            + hashlib.sha256(
                "\n".join(f"{name}:{hashes[name]}" for name in sorted(hashes)).encode()
            ).hexdigest()[:16],
            "proposal": proposal,
            "proposal_threshold": proposal_threshold,
            "incidence": incidence,
            "incidence_threshold": float(incidence_meta["threshold"]),
            "vcnn": vcnn,
            "direction": direction_model,
            "direction_threshold": float(direction_meta.get("threshold", 0.5)),
            "class_dict": dict(class_dict),
        }
        _state_cache[cache_key] = state
        return state


def _read_page(mung_path: str | os.PathLike[str], image_path: str | os.PathLike[str]):
    _require_schenker_imports()
    from mung.io import read_nodes_from_file
    from PIL import Image

    mung = Path(mung_path)
    image = Path(image_path)
    if not mung.is_file():
        raise FileNotFoundError(f"MuNG file not found: {mung}")
    if not image.is_file():
        raise FileNotFoundError(f"page image not found: {image}")
    nodes = list(read_nodes_from_file(str(mung)))
    ids = [int(node.id) for node in nodes]
    if len(ids) != len(set(ids)):
        raise ValueError("MuNG document contains duplicate node IDs")
    with Image.open(image) as page_image:
        width, height = map(int, page_image.size)
    if width <= 0 or height <= 0:
        raise ValueError(f"invalid page dimensions {width}x{height}")
    return mung.parent.name, nodes, width, height


def _make_page_data(name: str, nodes: list, width: int, height: int, class_dict: dict):
    from scripts.training.train_all_edges import map_name
    from scripts.training.train_edges_relation_proposal import PageData

    classes = np.asarray(
        [class_dict[map_name(node.class_name, class_dict)] for node in nodes],
        dtype=np.int64,
    )
    boxes = np.asarray(
        [[node.left, node.top, node.right, node.bottom] for node in nodes],
        dtype=np.float32,
    ).reshape(-1, 4)
    if not np.all(np.isfinite(boxes)):
        raise ValueError("MuNG document contains a non-finite bounding box")
    return PageData(
        name=name,
        ids=np.asarray([node.id for node in nodes], dtype=np.int64),
        classes=classes,
        boxes=boxes,
        width=float(width),
        height=float(height),
        truth_codes=np.empty((0,), dtype=np.int64),
    )


def _learned_proposals(state: dict[str, Any], page) -> tuple[np.ndarray, np.ndarray]:
    torch = state["torch"]
    from scripts.training.train_edges_relation_proposal import (
        geometry_features,
        iter_pair_indices,
    )

    if page.pair_count > MAX_ALL_PAIRS:
        raise RuntimeError(
            f"page has {page.pair_count:,} unordered pairs, exceeding the operational "
            f"limit {MAX_ALL_PAIRS:,}; no annotation was changed"
        )
    rows: list[np.ndarray] = []
    scores: list[np.ndarray] = []
    model = state["proposal"]
    threshold = state["proposal_threshold"]
    device = state["device"]
    with torch.inference_mode():
        for ia, ib in iter_pair_indices(page.n, PROPOSAL_BATCH_SIZE):
            ca = torch.from_numpy(page.classes[ia]).to(device)
            cb = torch.from_numpy(page.classes[ib]).to(device)
            geo = torch.from_numpy(geometry_features(page, ia, ib)).to(device)
            probability = torch.sigmoid(model(ca, cb, geo)).cpu().numpy()
            keep = probability >= threshold
            if np.any(keep):
                rows.append(np.column_stack((ia[keep], ib[keep])).astype(np.int64, copy=False))
                scores.append(probability[keep].astype(np.float32, copy=False))
    edges = np.concatenate(rows, axis=0) if rows else np.empty((0, 2), dtype=np.int64)
    proposal_scores = (
        np.concatenate(scores, axis=0) if scores else np.empty((0,), dtype=np.float32)
    )
    if len(edges) > MAX_PROPOSALS:
        raise RuntimeError(
            f"learned proposal emitted {len(edges):,} candidates, exceeding the operational "
            f"limit {MAX_PROPOSALS:,}; no annotation was changed"
        )
    return edges, proposal_scores


def _build_incidence_graph(
    name: str,
    nodes: list,
    width: int,
    height: int,
    edges: np.ndarray,
    class_dict: dict,
):
    from scripts.training.train_all_edges import map_name
    from scripts.training.train_edges_incidence import (
        EDGE_GEO_DIM,
        INC_GEO_DIM,
        PageGraph,
        directed_geometry,
        node_geometry,
        pair_geometry,
        relation_group,
    )

    mapped = [map_name(node.class_name, class_dict) for node in nodes]
    node_cls = np.asarray([class_dict[value] for value in mapped], dtype=np.int64)
    edge_geo = (
        np.stack([pair_geometry(nodes[i], nodes[j], width, height) for i, j in edges])
        .astype(np.float32)
        if len(edges)
        else np.zeros((0, EDGE_GEO_DIM), dtype=np.float32)
    )
    forward = (
        np.stack([directed_geometry(nodes[i], nodes[j], width, height) for i, j in edges])
        .astype(np.float32)
        if len(edges)
        else np.zeros((0, INC_GEO_DIM), dtype=np.float32)
    )
    reverse = (
        np.stack([directed_geometry(nodes[j], nodes[i], width, height) for i, j in edges])
        .astype(np.float32)
        if len(edges)
        else np.zeros((0, INC_GEO_DIM), dtype=np.float32)
    )
    return PageGraph(
        name=name,
        nodes=nodes,
        node_cls=node_cls,
        node_geo=node_geometry(nodes, width, height),
        edges=np.asarray(edges, dtype=np.int64).reshape(-1, 2),
        edge_geo=edge_geo,
        incidence_geo=np.concatenate((forward, reverse), axis=0),
        labels=np.zeros((len(edges),), dtype=np.float32),
        edge_types=[
            tuple(sorted((relation_group(mapped[i]), relation_group(mapped[j]))))
            for i, j in edges
        ],
        missed_edges=np.empty((0, 2), dtype=np.int64),
        missed_types={},
    )


def _zero_ink_crop(a, b, width: int, height: int) -> np.ndarray:
    """Exactly reproduce pair_crop's two masks without reading page pixels."""
    crop_w, crop_h, margin = 256, 128, 0.15
    x0, x1 = min(a.left, b.left), max(a.right, b.right)
    y0, y1 = min(a.top, b.top), max(a.bottom, b.bottom)
    mw = max(int((x1 - x0) * margin), 8)
    mh = max(int((y1 - y0) * margin), 8)
    cx0, cx1 = max(0, x0 - mw), min(width, x1 + mw)
    cy0, cy1 = max(0, y0 - mh), min(height, y1 + mh)
    cw, ch = cx1 - cx0, cy1 - cy0
    if cw <= 0 or ch <= 0:
        cw = ch = 8
        cx0 = cy0 = 0
    sx, sy = crop_w / max(cw, 1), crop_h / max(ch, 1)

    def mask(node) -> np.ndarray:
        result = np.zeros((crop_h, crop_w), dtype=np.float32)
        bx0 = int((node.left - cx0) * sx)
        bx1 = int((node.right - cx0) * sx)
        by0 = int((node.top - cy0) * sy)
        by1 = int((node.bottom - cy0) * sy)
        result[
            max(0, by0) : min(crop_h, by1 + 1),
            max(0, bx0) : min(crop_w, bx1 + 1),
        ] = 1.0
        return result

    return np.stack((np.zeros((crop_h, crop_w), np.float32), mask(a), mask(b)))


def _attach_zero_ink_visual(state: dict[str, Any], graph, width: int, height: int) -> None:
    torch = state["torch"]
    vcnn = state["vcnn"]
    device = state["device"]
    visual: list[np.ndarray] = []
    logits: list[np.ndarray] = []
    with torch.inference_mode():
        for start in range(0, len(graph.edges), VISUAL_BATCH_SIZE):
            edge_rows = graph.edges[start : start + VISUAL_BATCH_SIZE]
            crops = np.stack(
                [
                    _zero_ink_crop(graph.nodes[i], graph.nodes[j], width, height)
                    for i, j in edge_rows
                ]
            )
            batch = torch.from_numpy(crops).to(device)
            feat = vcnn.features(batch).mean(dim=(2, 3))
            swapped = batch[:, [0, 2, 1]]
            feat = 0.5 * (feat + vcnn.features(swapped).mean(dim=(2, 3)))
            visual.append(feat.cpu().numpy().astype(np.float32))
            logits.append(vcnn.head(feat).squeeze(-1).cpu().numpy().astype(np.float32))
    graph.visual = np.concatenate(visual, axis=0) if visual else np.zeros((0, 128), np.float32)
    graph.vcnn_logit = np.concatenate(logits, axis=0) if logits else np.zeros((0,), np.float32)


def _direct_edges(
    state: dict[str, Any],
    nodes: list,
    width: int,
    height: int,
    edges: np.ndarray,
    probabilities: np.ndarray,
    proposal_scores: np.ndarray,
    adjacency_threshold: float,
) -> list[dict[str, Any]]:
    from scripts.training.train_edges_direction import pair_features

    selected = np.flatnonzero(probabilities >= adjacency_threshold)
    if not len(selected):
        return []
    features: list[np.ndarray] = []
    canonical: list[tuple[Any, Any]] = []
    for edge_index in selected:
        i, j = map(int, edges[edge_index])
        feature, a, b = pair_features(
            nodes[i], nodes[j], width, height, state["class_dict"]
        )
        features.append(feature)
        canonical.append((a, b))
    direction_probability = state["direction"].predict_proba(np.stack(features))[:, 1]
    out = []
    for edge_index, (a, b), direction_prob in zip(
        selected, canonical, direction_probability
    ):
        if float(direction_prob) >= state["direction_threshold"]:
            source, target = a, b
        else:
            source, target = b, a
        out.append(
            {
                "source": int(source.id),
                "target": int(target.id),
                "confidence": round(float(probabilities[edge_index]), 6),
                "proposalConfidence": round(float(proposal_scores[edge_index]), 6),
                "directionConfidence": round(
                    max(float(direction_prob), 1.0 - float(direction_prob)), 6
                ),
            }
        )
    out.sort(key=lambda item: (-item["confidence"], item["source"], item["target"]))
    return out


def _partition_classified_nodes(nodes: list) -> tuple[list, list[int]]:
    """Return the inference-safe node view without changing the MuNG objects.

    ``mung.io`` represents an empty ``<ClassName/>`` as ``None``.  The learned
    models require a semantic class, so an unclassified node cannot be scored
    safely.  Exclude only those malformed nodes from this inference request and
    report their IDs to the caller; non-empty unseen classes remain eligible and
    continue through the normal ``otherText`` fallback.
    """
    classified = []
    skipped_ids: list[int] = []
    for node in nodes:
        class_name = getattr(node, "class_name", None)
        if isinstance(class_name, str) and class_name.strip():
            classified.append(node)
        else:
            skipped_ids.append(int(node.id))
    return classified, skipped_ids


def _predict_page(
    state: dict[str, Any],
    name: str,
    nodes: list,
    width: int,
    height: int,
    threshold: float | None,
) -> dict[str, Any]:
    if threshold is None:
        adjacency_threshold = state["incidence_threshold"]
    else:
        adjacency_threshold = float(threshold)
        if not math.isfinite(adjacency_threshold) or not 0.0 < adjacency_threshold <= 1.0:
            raise ValueError("edge threshold must be in (0,1]")
    input_node_count = len(nodes)
    nodes, skipped_invalid_node_ids = _partition_classified_nodes(nodes)
    all_pairs = len(nodes) * (len(nodes) - 1) // 2
    node_diagnostics = {
        "nodeCount": input_node_count,
        "eligibleNodeCount": len(nodes),
        "smallCount": len(nodes),
        "skippedInvalidNodeCount": len(skipped_invalid_node_ids),
        "skippedInvalidNodeIds": skipped_invalid_node_ids,
    }
    if len(nodes) < 2:
        return {
            "edges": [],
            **node_diagnostics,
            "pairCount": all_pairs,
            "proposalCount": 0,
            "edgeCount": 0,
            "threshold": adjacency_threshold,
            "proposalThreshold": state["proposal_threshold"],
            "directed": True,
            "rulesApplied": False,
            "hardDecoder": False,
            "visualAblation": "zero-ink",
            "modelFamily": state["manifest"].get(
                "model_family", "learned-proposal-incidence-direction"
            ),
            "bundleId": state["bundle_id"],
        }

    page = _make_page_data(name, nodes, width, height, state["class_dict"])
    candidate_edges, proposal_scores = _learned_proposals(state, page)
    if not len(candidate_edges):
        probabilities = np.empty((0,), dtype=np.float32)
        directed_edges: list[dict[str, Any]] = []
    else:
        graph = _build_incidence_graph(
            name, nodes, width, height, candidate_edges, state["class_dict"]
        )
        _attach_zero_ink_visual(state, graph, width, height)
        from scripts.training.train_edges_incidence import predict_graph

        probabilities = predict_graph(state["incidence"], graph, state["device"])
        if len(probabilities) != len(candidate_edges) or not np.all(np.isfinite(probabilities)):
            raise RuntimeError("incidence model returned invalid probabilities")
        directed_edges = _direct_edges(
            state,
            nodes,
            width,
            height,
            candidate_edges,
            probabilities,
            proposal_scores,
            adjacency_threshold,
        )
    return {
        "edges": directed_edges,
        **node_diagnostics,
        "pairCount": all_pairs,
        "proposalCount": len(candidate_edges),
        "edgeCount": len(directed_edges),
        "threshold": adjacency_threshold,
        "proposalThreshold": state["proposal_threshold"],
        "directed": True,
        "rulesApplied": False,
        "hardDecoder": False,
        "visualAblation": "zero-ink",
        "modelFamily": state["manifest"].get(
            "model_family", "learned-proposal-incidence-direction"
        ),
        "bundleId": state["bundle_id"],
    }


def predict_edges(
    mung_path: str | os.PathLike[str],
    image_path: str | os.PathLike[str],
    threshold: float | None = None,
    *,
    bundle_dir: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    """Return learned directed edges without modifying the input document."""
    state = _get_state(bundle_dir)
    page = _read_page(mung_path, image_path)
    # Serialize GPU work across the threaded backend to keep VRAM bounded.
    with _inference_lock:
        return _predict_page(state, *page, threshold)


def get_model_info(
    *,
    bundle_dir: str | os.PathLike[str] | None = None,
    load_models: bool = False,
) -> dict[str, Any]:
    """Read-only deployment health metadata; never reads or writes annotations."""
    bundle = _bundle_dir(bundle_dir)
    try:
        if load_models:
            state = _get_state(bundle)
            manifest, hashes = state["manifest"], state["hashes"]
            loaded, device = True, state["device"]
        else:
            manifest, hashes = _verify_bundle(bundle)
            loaded, device = False, None
        return {
            "ok": True,
            "bundle": str(bundle),
            "bundleId": (
                state["bundle_id"]
                if load_models
                else manifest.get("bundle_id")
                or "learned-edge-"
                + hashlib.sha256(
                    "\n".join(f"{name}:{hashes[name]}" for name in sorted(hashes)).encode()
                ).hexdigest()[:16]
            ),
            "modelFamily": manifest.get(
                "model_family", "learned-proposal-incidence-direction"
            ),
            "schemaVersion": manifest.get("schema_version"),
            "artifactSha256": hashes,
            "loaded": loaded,
            "device": device,
            "directed": True,
            "allPairsLearnedProposal": True,
            "rulesApplied": False,
            "hardDecoder": False,
            "visualAblation": "zero-ink",
            "writesAnnotations": False,
        }
    except Exception as exc:
        return {
            "ok": False,
            "bundle": str(bundle),
            "loaded": False,
            "error": str(exc),
            "writesAnnotations": False,
        }


def _find_image(doc_dir: Path) -> Path:
    for extension in ("png", "jpg", "jpeg"):
        path = doc_dir / f"image.{extension}"
        if path.is_file():
            return path
    raise FileNotFoundError(f"no image.png/jpg/jpeg under {doc_dir}")


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", nargs="?", help="read-only document directory smoke test")
    parser.add_argument("--bundle", default=None, help="versioned learned-edge bundle")
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--info", action="store_true", help="verify hashes and print metadata")
    parser.add_argument(
        "--load-models", action="store_true", help="with --info, also deserialize all models"
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.info:
        info = get_model_info(bundle_dir=args.bundle, load_models=args.load_models)
        print(json.dumps(info, indent=2, sort_keys=True))
        return 0 if info["ok"] else 1
    if not args.document:
        parser.error("document is required unless --info is used")
    doc_dir = Path(args.document).expanduser().resolve()
    result = predict_edges(
        doc_dir / "mung.xml",
        _find_image(doc_dir),
        threshold=args.threshold,
        bundle_dir=args.bundle,
    )
    # Print only the read-only smoke summary, not a potentially huge edge list.
    summary = {key: value for key, value in result.items() if key != "edges"}
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
