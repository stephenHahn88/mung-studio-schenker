"""Shared data access, 64-nearest-neighbour candidates and the pooled validation metrics.

A task folder holds ``categories.json`` and ``pages/<page_id>/{input.json,target.json}``.
``input.json`` has the page size and the symbols (``id``, ``class_id``, ``bbox`` = x, y, w, h);
``target.json`` has the directed syntax links (``directed_edges`` = [[source_id, target_id], ...]).
A split file lists page ids for ``train``, ``val`` and ``test``.
"""
from pathlib import Path
import hashlib
import json
import os
import tempfile
import numpy as np

K_NEIGHBOURS = 64
THRESHOLDS = np.arange(1, 100, dtype=np.float64) / 100


def require(test, message):
    if not test:
        raise ValueError(message)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def read(path):
    with Path(path).open() as f:
        return json.load(f)


def write(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', dir=path.parent, delete=False) as f:
        json.dump(payload, f, indent=2, sort_keys=True, allow_nan=False)
        f.write('\n')
        name = f.name
    os.replace(name, path)


def save_npz(path, **arrays):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('wb', dir=path.parent, delete=False) as f:
        np.savez_compressed(f, **arrays)
        name = f.name
    os.replace(name, path)


def categories_list(path):
    categories = read(path)
    categories = categories if isinstance(categories, list) else categories['categories']
    require([c['id'] for c in categories] == list(range(len(categories))), 'Category ids must be 0..n-1')
    require(len({c['name'] for c in categories}) == len(categories), 'Duplicate category names')
    return categories


def split_rows(split_file, data_dir):
    """Return {'train': rows, 'val': rows, 'test': rows}; each row has page_id, input_path, target_path."""
    split, data_dir = read(split_file), Path(data_dir)
    out = {}
    for part in ('train', 'val', 'test'):
        ids = [str(p) for p in split[part]]
        require(len(set(ids)) == len(ids), 'Repeated page id in ' + part)
        out[part] = [{'page_id': p, 'input_path': str(data_dir / 'pages' / p / 'input.json'),
                      'target_path': str(data_dir / 'pages' / p / 'target.json')} for p in ids]
    for a, b in (('train', 'val'), ('train', 'test'), ('val', 'test')):
        require(not {r['page_id'] for r in out[a]} & {r['page_id'] for r in out[b]}, f'{a}/{b} page overlap')
    return out


def input_graph(row):
    x = read(row['input_path'])
    require(str(x['page_id']) == str(row['page_id']), 'Page id mismatch')
    require(not any(k in x for k in ['directed_edges', 'edges', 'targets', 'labels']), 'Input contains links')
    ids = np.array([n['id'] for n in x['nodes']], dtype=np.int64)
    cls = np.array([n['class_id'] for n in x['nodes']], dtype=np.int64)
    box = np.array([n['bbox'] for n in x['nodes']], dtype=np.float32).reshape(-1, 4)
    require(len(set(ids.tolist())) == len(ids), 'Duplicate symbol id')
    require((cls >= 0).all(), 'Negative class id')
    require(np.isfinite(box).all() and (box[:, 2:] >= 0).all(), 'Invalid boxes')
    require(x['image']['width'] > 0 and x['image']['height'] > 0, 'Invalid image size')
    return x, ids, cls, box


def candidates(ids, boxes, width, height):
    """Union of each symbol's 64 nearest neighbours by box gap (ties: centre distance, then id); both directions."""
    n = len(ids)
    right = boxes[:, 0] + boxes[:, 2]
    bottom = boxes[:, 1] + boxes[:, 3]
    cx = boxes[:, 0] + boxes[:, 2] / 2
    cy = boxes[:, 1] + boxes[:, 3] / 2
    pairs = set()
    for i in range(n):
        gx = np.maximum(np.maximum(boxes[i, 0] - right, boxes[:, 0] - right[i]), 0)
        gy = np.maximum(np.maximum(boxes[i, 1] - bottom, boxes[:, 1] - bottom[i]), 0)
        gap2 = gx * gx + gy * gy
        gap2[i] = np.inf
        dist2 = (cx - cx[i]) ** 2 + (cy - cy[i]) ** 2
        order = np.lexsort((ids, dist2, gap2))[:min(K_NEIGHBOURS, max(0, n - 1))]
        for j in order:
            if i != j:
                pairs.add((min(i, int(j)), max(i, int(j))))
    undirected = sorted(pairs)
    result = np.array(sorted([p for i, j in undirected for p in [(i, j), (j, i)]]), dtype=np.int64).reshape(-1, 2)
    require(len(result) <= 2 * n * min(K_NEIGHBOURS, max(0, n - 1)), 'Candidate count exceeds the k-NN bound')
    require(len(result) <= 2_000_000, 'Candidate graph exceeds 2M pairs')
    return result


def load_page(row, with_targets=False, cache_dir=None):
    """Candidate graph of one page. Labels are 1 for candidates that are annotated directed links."""
    x, ids, cls, box = input_graph(row)
    width, height = x['image']['width'], x['image']['height']
    input_sha256 = sha(row['input_path'])
    cache = Path(cache_dir) / f'{input_sha256}_k{K_NEIGHBOURS}.npz' if cache_dir else None
    if cache and cache.exists():
        with np.load(cache, allow_pickle=False) as a:
            pairs = a['pairs']
    else:
        pairs = candidates(ids, box, width, height)
        if cache:
            save_npz(cache, pairs=pairs)
    g = {'page_id': str(row['page_id']), 'input_sha256': input_sha256, 'ids': ids, 'classes': cls,
         'pairs': pairs, 'image': x['image']}
    if with_targets:
        target = read(row['target_path'])
        require(str(target['page_id']) == g['page_id'], 'Target page mismatch')
        truth = {tuple(map(int, e)) for e in target['directed_edges']}
        require(all(a in ids and b in ids for a, b in truth), 'Invalid link endpoint')
        lookup = {(int(ids[a]), int(ids[b])) for a, b in pairs}
        g.update(labels=np.array([(int(ids[a]), int(ids[b])) in truth for a, b in pairs], dtype=np.float32),
                 truth=truth, gt_count=len(truth), candidate_gt=len(truth & lookup))
    return g


def counts(tp, pred, total):
    precision = tp / max(pred, 1)
    recall = tp / max(total, 1)
    return {'tp': int(tp), 'fp': int(pred - tp), 'fn': int(total - tp), 'predicted': int(pred),
            'ground_truth': int(total), 'precision': precision, 'recall': recall, 'f1': 2 * tp / max(pred + total, 1)}


def pooled_metrics(graphs, scores, threshold=None):
    """Directed-link metrics pooled over pages; every annotated link is in the recall denominator.

    Without a threshold, the threshold in 0.01..0.99 with the highest F1 is chosen
    (ties: higher recall, then higher threshold). ``auprc`` is the non-interpolated
    average precision used for checkpoint selection.
    """
    labels = np.concatenate([g['labels'] for g in graphs]) if graphs else np.array([])
    p = np.concatenate(scores) if scores else np.array([])
    require(len(graphs) == len(scores), 'Score page count mismatch')
    require(all(np.asarray(s).shape == (len(g['labels']),) for g, s in zip(graphs, scores)), 'Score shape mismatch')
    require(len(labels) == len(p) and np.isfinite(p).all() and ((p >= 0) & (p <= 1)).all(), 'Invalid scores')
    total = sum(g['gt_count'] for g in graphs)
    covered = int(labels.sum())
    order = np.argsort(-p, kind='stable')
    p = p[order]
    y = labels[order]
    if len(p):
        ends = np.r_[np.flatnonzero(p[:-1] != p[1:]), len(p) - 1]
        cumulative = np.cumsum(y)
        tp = cumulative[ends]
        num = ends + 1
        ap = float(np.sum(np.diff(np.r_[0, tp]) * tp / num) / max(total, 1))
    else:
        ap = 0.
    result = {'auprc': ap, 'candidate_recall': covered / max(total, 1), 'candidate_positives': covered,
              'candidate_count': len(p), 'ground_truth': total}
    if threshold is None:
        options = []
        for t in THRESHOLDS:
            n = int(np.searchsorted(-p, -t, side='right'))
            tp = int(cumulative[n - 1]) if n else 0
            options.append({'threshold': float(t), **counts(tp, n, total)})
        selected = max(options, key=lambda m: (m['f1'], m['recall'], m['threshold']))
    else:
        n = int(np.searchsorted(-p, -threshold, side='right'))
        tp = int(cumulative[n - 1]) if n else 0
        selected = {'threshold': float(threshold), **counts(tp, n, total)}
    return {**result, **selected}
