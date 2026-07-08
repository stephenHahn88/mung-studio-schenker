"""ALL-symbol edge (notation-assembly) inference for the MuNG Studio backend. v3.

v1 (small-symbol-only, center-distance gate, 5-Rachmaninov-page training) failed on
new pages: the center<=200px gate alone discards 16.5% of true edges, small-only
ignores the slur/beam links that carry Schenkerian syntax, and one-piece training
did not generalize. v2 loads the all-symbol model (MUSCIMA++ 140-page pretrain ->
9-page two-piece fine-tune) and its learned per-class-pair BBOX-GAP candidate gates.
v3 is a RULES+MODEL HYBRID: geometric rules (edge_rules.py) decide the well-defined
attachment/slur types (~90% of edges, held-out-validated far above the model:
slur-NH 0.90 vs 0.54, beam-NH 0.85 vs 0.14); the model handles only the remaining
types (numerals, text, long-range). Hybrid aggregate ~0.87 vs 0.632 model-only.

Self-contained test:
    python edge_inference.py /path/to/documents/<doc> [threshold]
"""
import json
import os
import sys
import threading

import numpy as np

SCHENK_ROOT = os.environ.get("SCHENK_ROOT", "/home/users/yh477/lab/Schenkerian_OMR")
EDGE_DEPLOY_DIR = os.environ.get(
    "EDGE_DEPLOY_DIR", os.path.join(SCHENK_ROOT, "outputs/assembly/all_edges_deploy"))
EDGE_MODEL_PATH = os.environ.get(
    "EDGE_MODEL_PATH", os.path.join(EDGE_DEPLOY_DIR, "model_final.pth"))
# optional second ensemble member (2-init ensemble); averaged if present
EDGE_MODEL_PATH_B = os.environ.get(
    "EDGE_MODEL_PATH_B", os.path.join(EDGE_DEPLOY_DIR, "model_final_b.pth"))
EDGE_CONFIG_PATH = os.environ.get(
    "EDGE_CONFIG_PATH", os.path.join(EDGE_DEPLOY_DIR, "config.yaml"))
EDGE_GATES_PATH = os.environ.get(
    "EDGE_GATES_PATH", os.path.join(EDGE_DEPLOY_DIR, "gates.json"))
GATE_DEFAULT = float(os.environ.get("EDGE_GATE_DEFAULT", "60.0"))
DEFAULT_THRESHOLD = float(os.environ.get("EDGE_THRESHOLD", "0.5"))

# Schenkerian -> MUSCIMA class-name mapping (MUST mirror train_all_edges.py).
SCHENKER_TO_MUSCIMA = {
    "noteheadBlack": "noteheadFull",
    "stemStructural": "stem",
    "slurStructuralUp": "slur", "slurStructuralDown": "slur",
    "slurStructuralUpDashed": "slur", "slurStructuralDownDashed": "slur",
    "beamStructural": "beam", "beamStructuralPartialLeft": "beam",
    "beamStructuralPartialMiddle": "beam", "beamStructuralPartialRight": "beam",
    "beamStructuralUnfoldingUp": "beam", "beamStructuralUnfoldingDown": "beam",
    "flagStructuralUp": "flag8thUp", "flagStructuralDown": "flag8thDown",
    "measureNumber": "otherNumericSign",
    "scaleDegreeMark": "otherText",
    "voiceExchangeUp": "slur", "voiceExchangeDown": "slur",
    "characterHyphen": "otherText",
}

_state = None
_lock = threading.Lock()


def _get_state():
    global _state
    with _lock:
        if _state is not None:
            return _state
        import torch
        if SCHENK_ROOT not in sys.path:
            sys.path.insert(0, SCHENK_ROOT)
        prev = os.getcwd()
        try:
            os.chdir(SCHENK_ROOT)
            from utils.constants import CLASS_DICT_ALL
            from configs.assembler.default import get_cfg_defaults
            from model.model import MLPwithSoftClass
        finally:
            os.chdir(prev)

        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        cfg = get_cfg_defaults()
        cfg.merge_from_file(EDGE_CONFIG_PATH)
        model = MLPwithSoftClass(cfg).to(device)
        ckpt = torch.load(EDGE_MODEL_PATH, map_location=device)
        model.load_state_dict(ckpt["model"])
        model.eval()
        models = [model]
        if os.path.isfile(EDGE_MODEL_PATH_B):
            model_b = MLPwithSoftClass(cfg).to(device)
            model_b.load_state_dict(
                torch.load(EDGE_MODEL_PATH_B, map_location=device)["model"])
            model_b.eval()
            models.append(model_b)
        gates = json.loads(open(EDGE_GATES_PATH).read())

        _state = {
            "torch": torch,
            "model": model,
            "models": models,
            "device": device,
            "class_dict": dict(CLASS_DICT_ALL),
            "gates": gates,
            "vocab_dim": int(cfg.MODEL.VOCAB_DIM),
        }
        return _state


def _map_name(name, class_dict):
    m = SCHENKER_TO_MUSCIMA.get(name, name)
    if m in class_dict:
        return m
    if name.startswith("numeralRoman") or name.startswith("parensImplied") \
            or name.startswith("keyAnalysis"):
        return "otherText"
    return m if m in class_dict else "otherText"


def _bbox_gap(a, b):
    dx = max(0, max(a.left, b.left) - min(a.right, b.right))
    dy = max(0, max(a.top, b.top) - min(a.bottom, b.bottom))
    return (dx * dx + dy * dy) ** 0.5


def predict_edges(mung_path, image_path, threshold=None):
    """Return {source, target, confidence} edges among ALL symbols (undirected)."""
    if threshold is None:
        threshold = DEFAULT_THRESHOLD
    st = _get_state()
    torch = st["torch"]
    models, device = st["models"], st["device"]
    class_dict, gates, vocab = st["class_dict"], st["gates"], st["vocab_dim"]

    from mung.io import read_nodes_from_file
    from PIL import Image

    nodes = read_nodes_from_file(mung_path)
    if len(nodes) < 2:
        return {"edges": [], "nodeCount": len(nodes), "smallCount": len(nodes),
                "pairCount": 0, "edgeCount": 0, "threshold": threshold}
    w, h = Image.open(image_path).size
    mapped = [_map_name(n.class_name, class_dict) for n in nodes]

    # geometric rules decide their types outright (confidence 0.99)
    from edge_rules import rule_edges, is_rule_pair
    edges = [{"source": int(a), "target": int(b), "confidence": 0.99}
             for a, b in sorted(rule_edges(nodes))]
    rule_count = len(edges)

    pairs = []
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            if is_rule_pair(nodes[i].class_name, nodes[j].class_name):
                continue                      # rule-owned type: model must skip
            gate = gates.get("|".join(sorted([mapped[i], mapped[j]])), GATE_DEFAULT)
            if _bbox_gap(nodes[i], nodes[j]) <= gate:
                pairs.append((i, j))
    if not pairs:
        edges.sort(key=lambda e: -e["confidence"])
        return {"edges": edges, "nodeCount": len(nodes), "smallCount": len(nodes),
                "pairCount": 0, "edgeCount": len(edges), "threshold": threshold,
                "ruleEdgeCount": rule_count}
    bs = 8192
    with torch.no_grad():
        for s in range(0, len(pairs), bs):
            chunk = pairs[s:s + bs]
            sb = np.array([[nodes[i].left / w, nodes[i].top / h,
                            nodes[i].right / w, nodes[i].bottom / h] for i, _ in chunk],
                          dtype=np.float32)
            tb = np.array([[nodes[j].left / w, nodes[j].top / h,
                            nodes[j].right / w, nodes[j].bottom / h] for _, j in chunk],
                          dtype=np.float32)
            n = len(chunk)
            sc = torch.zeros(n, vocab, device=device)
            tc = torch.zeros(n, vocab, device=device)
            si = torch.tensor([class_dict[mapped[i]] for i, _ in chunk])
            tj = torch.tensor([class_dict[mapped[j]] for _, j in chunk])
            sc[torch.arange(n), si] = 1.0
            tc[torch.arange(n), tj] = 1.0
            batch = {
                "source_bbox": torch.tensor(sb, device=device),
                "target_bbox": torch.tensor(tb, device=device),
                "source_class": sc, "target_class": tc,
            }
            member_probs = [torch.sigmoid(m(batch)).squeeze(-1).cpu().numpy()
                            for m in models]
            probs = np.mean(member_probs, axis=0)
            for k, (i, j) in enumerate(chunk):
                p = float(probs[k])
                if p > threshold:
                    edges.append({"source": int(nodes[i].id),
                                  "target": int(nodes[j].id),
                                  "confidence": round(p, 4)})
    edges.sort(key=lambda e: -e["confidence"])
    # smallCount kept for API compatibility (frontend displays it); now = all nodes
    return {"edges": edges, "nodeCount": len(nodes), "smallCount": len(nodes),
            "pairCount": len(pairs), "edgeCount": len(edges), "threshold": threshold,
            "ruleEdgeCount": rule_count}


if __name__ == "__main__":
    doc_dir = sys.argv[1]
    mung = os.path.join(doc_dir, "mung.xml")
    img = None
    for ext in ("png", "jpg", "jpeg"):
        p = os.path.join(doc_dir, f"image.{ext}")
        if os.path.exists(p):
            img = p
            break
    res = predict_edges(mung, img, threshold=float(sys.argv[2]) if len(sys.argv) > 2 else None)
    from mung.io import read_nodes_from_file
    nodes = {n.id: n for n in read_nodes_from_file(mung)}
    gt = set()
    for n in nodes.values():
        for o in n.outlinks:
            if o in nodes:
                gt.add(tuple(sorted((n.id, o))))
    pred = set(tuple(sorted((e["source"], e["target"]))) for e in res["edges"])
    tp = len(gt & pred)
    print(f"nodes={res['nodeCount']} pairs={res['pairCount']} "
          f"pred_edges={len(pred)} gt_edges={len(gt)}")
    if gt:
        pr = tp / max(len(pred), 1)
        rc = tp / len(gt)
        print(f"vs GT: P={pr:.3f} R={rc:.3f} F1={2*pr*rc/max(pr+rc,1e-9):.3f}")
