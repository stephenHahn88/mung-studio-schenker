"""
Small-symbol edge (notation-assembly) inference for the MuNG Studio backend.

Loads the trained MLPwithSoftClass edge model (from the Schenkerian_OMR repo)
lazily, and predicts syntax edges among the SMALL symbols of a document:
for every pair of small symbols within 200px, runs the model and returns the
pairs whose edge probability exceeds a threshold.

Self-contained: can be run directly to test on one document, e.g.
    python edge_inference.py /path/to/documents/<doc>
"""
import os
import sys
import threading

import numpy as np

SCHENK_ROOT = os.environ.get("SCHENK_ROOT", "/home/users/yh477/lab/Schenkerian_OMR")
EDGE_MODEL_PATH = os.environ.get(
    "EDGE_MODEL_PATH",
    os.path.join(SCHENK_ROOT, "outputs/assembly/best_models/small_edge_pw1.5_lr2e3.pth"),
)
EDGE_CONFIG_PATH = os.environ.get(
    "EDGE_CONFIG_PATH",
    os.path.join(SCHENK_ROOT, "outputs/assembly/pretrain_small/config.yaml"),
)
MAX_DIST = float(os.environ.get("EDGE_MAX_DISTANCE", "200.0"))
DEFAULT_THRESHOLD = float(os.environ.get("EDGE_THRESHOLD", "0.5"))

# Schenkerian -> MUSCIMA class-name mapping (same as training).
SCHENKER_TO_MUSCIMA = {
    "noteheadBlack": "noteheadFull",
    "stemStructural": "stem",
    "slurStructuralUp": "slur", "slurStructuralDown": "slur",
    "slurStructuralUpDashed": "slur",
    "beamStructural": "beam", "beamStructuralPartialLeft": "beam",
    "beamStructuralPartialMiddle": "beam", "beamStructuralPartialRight": "beam",
    "beamStructuralUnfoldingUp": "beam", "beamStructuralUnfoldingDown": "beam",
    "flagStructuralUp": "flag8thUp", "flagStructuralDown": "flag8thDown",
}


def _map_name(name):
    return SCHENKER_TO_MUSCIMA.get(name, name)


_state = None
_lock = threading.Lock()


def _get_state():
    """Lazily load model, config, class dict and the small-class set."""
    global _state
    with _lock:
        if _state is not None:
            return _state
        import torch
        if SCHENK_ROOT not in sys.path:
            sys.path.insert(0, SCHENK_ROOT)
        # constants.py reads the MUSCIMA class XML via a RELATIVE path, so import
        # it with cwd set to the repo root, then restore.
        prev = os.getcwd()
        try:
            os.chdir(SCHENK_ROOT)
            from utils.constants import CLASS_DICT_ALL, CLASS_LIST_SMALL
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

        _state = {
            "torch": torch,
            "model": model,
            "device": device,
            "class_dict": dict(CLASS_DICT_ALL),
            "small_set": set(CLASS_LIST_SMALL),
            "vocab_dim": int(cfg.MODEL.VOCAB_DIM),
        }
        return _state


def predict_edges(mung_path, image_path, threshold=None):
    """Return a list of {source, target, confidence} edges for SMALL symbols.

    source/target are node ids; the edge is undirected (added as a syntax link).
    """
    if threshold is None:
        threshold = DEFAULT_THRESHOLD
    st = _get_state()
    torch = st["torch"]
    model = st["model"]
    device = st["device"]
    class_dict = st["class_dict"]
    small_set = st["small_set"]
    vocab = st["vocab_dim"]

    from mung.io import read_nodes_from_file
    from PIL import Image

    nodes = read_nodes_from_file(mung_path)
    small = [n for n in nodes if _map_name(n.class_name) in small_set]
    if len(small) < 2:
        return {"edges": [], "nodeCount": len(nodes), "smallCount": len(small),
                "pairCount": 0}

    w, h = Image.open(image_path).size  # (width, height)

    # candidate undirected pairs within MAX_DIST (center-to-center)
    pairs = []
    for i in range(len(small)):
        ni = small[i]; ciy = (ni.top + ni.bottom) / 2.0; cix = (ni.left + ni.right) / 2.0
        for j in range(i + 1, len(small)):
            nj = small[j]; cjy = (nj.top + nj.bottom) / 2.0; cjx = (nj.left + nj.right) / 2.0
            if ((ciy - cjy) ** 2 + (cix - cjx) ** 2) ** 0.5 <= MAX_DIST:
                pairs.append((i, j))
    if not pairs:
        return {"edges": [], "nodeCount": len(nodes), "smallCount": len(small),
                "pairCount": 0}

    edges = []
    bs = 8192
    with torch.no_grad():
        for s in range(0, len(pairs), bs):
            chunk = pairs[s:s + bs]
            sb = np.array([[small[i].left / w, small[i].top / h,
                            small[i].right / w, small[i].bottom / h] for i, _ in chunk],
                          dtype=np.float32)
            tb = np.array([[small[j].left / w, small[j].top / h,
                            small[j].right / w, small[j].bottom / h] for _, j in chunk],
                          dtype=np.float32)
            n = len(chunk)
            sc = torch.zeros(n, vocab, device=device)
            tc = torch.zeros(n, vocab, device=device)
            si = torch.tensor([class_dict.get(_map_name(small[i].class_name), 0) for i, _ in chunk])
            ti = torch.tensor([class_dict.get(_map_name(small[j].class_name), 0) for _, j in chunk])
            sc[torch.arange(n), si] = 1.0
            tc[torch.arange(n), ti] = 1.0
            batch = {
                "source_bbox": torch.tensor(sb, device=device),
                "target_bbox": torch.tensor(tb, device=device),
                "source_class": sc, "target_class": tc,
            }
            probs = torch.sigmoid(model(batch)).squeeze(-1).cpu().numpy()
            for k, (i, j) in enumerate(chunk):
                p = float(probs[k])
                if p > threshold:
                    edges.append({"source": int(small[i].id),
                                  "target": int(small[j].id),
                                  "confidence": round(p, 4)})
    edges.sort(key=lambda e: -e["confidence"])
    return {"edges": edges, "nodeCount": len(nodes), "smallCount": len(small),
            "pairCount": len(pairs), "edgeCount": len(edges), "threshold": threshold}


if __name__ == "__main__":
    import json
    doc_dir = sys.argv[1]
    mung = os.path.join(doc_dir, "mung.xml")
    img = None
    for ext in ("png", "jpg", "jpeg"):
        p = os.path.join(doc_dir, f"image.{ext}")
        if os.path.exists(p):
            img = p; break
    res = predict_edges(mung, img)
    # quick GT comparison
    from mung.io import read_nodes_from_file
    nodes = {n.id: n for n in read_nodes_from_file(mung)}
    gt = set()
    for n in nodes.values():
        for o in n.outlinks:
            if o in nodes:
                gt.add(tuple(sorted((n.id, o))))
    pred = set(tuple(sorted((e["source"], e["target"]))) for e in res["edges"])
    tp = len(pred & gt)
    print(json.dumps({k: v for k, v in res.items() if k != "edges"}, indent=2))
    print(f"predicted_edges={len(pred)} gt_edges(small-small subset N/A here, all)={len(gt)} "
          f"overlap_with_any_gt={tp}")
    print("sample edges:", res["edges"][:5])
