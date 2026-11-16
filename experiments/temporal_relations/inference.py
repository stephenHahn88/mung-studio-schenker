"""Page-level inference with the saved time-group and precedence classifiers.

A node is a dict with keys id (int), class_name, left, top, width, height (pixels). image_size is (width, height).
The decoding thresholds are read from the model file.

  predict_time_groups(nodes, image_size, model_path) -> [[node_id, ...], ...]
      Time groups over the nodes whose class starts with 'notehead' (singletons included). Stems ('stem*') and
      clefs ('*Clef*') among the nodes are used as features.
  predict_precedence(nodes, image_size, model_path) -> [{'source_id', 'target_id', 'score'}, ...]
      Directed precedence links among all nodes; score is the classifier probability of the link.

Ties follow the order of the input nodes; give the nodes in a fixed order (e.g. sorted by id).

Command line:
  python inference.py time|precedence --model MODEL.joblib --page PAGE.json
  PAGE.json = {"image": {"width": W, "height": H}, "nodes": [{"id": ..., "class_name": ..., "left": ..., ...}, ...]}
  or a page file of data/ (data/precedence/<page_id>/input.json: nodes with id, class_id, bbox).
"""
import argparse
import itertools
import json
import sys
from pathlib import Path

import joblib
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from temporal import data, time_model as tm, precedence_model as pm  # noqa: E402

_CACHE = {}


def _model(path, task):
    key = str(Path(path).resolve())
    if key not in _CACHE:
        _CACHE[key] = joblib.load(path)
    m = _CACHE[key]
    if m['task'] != task:
        raise ValueError(f'{path} is a {m["task"]} model, not {task}')
    return m


def _size(image_size):
    if isinstance(image_size, dict):
        return image_size['width'], image_size['height']
    return image_size[0], image_size[1]


def _box(n):
    return [n['left'], n['top'], n['width'], n['height']]


def predict_time_groups(nodes, image_size, model_path):
    m = _model(model_path, 'time_groups')
    W, H = _size(image_size)
    heads = [n for n in nodes if n['class_name'].startswith('notehead')]
    if not heads:
        return []
    ids = [n['id'] for n in heads]
    b = np.array([_box(n) for n in heads], float).reshape(-1, 4)
    cx = b[:, 0] + b[:, 2] / 2; cy = b[:, 1] + b[:, 3] / 2
    w = np.median(np.maximum(b[:, 2], 1)); h = np.median(np.maximum(b[:, 3], 1))
    share = np.zeros((len(ids), len(ids)), bool)
    for s in [_box(n) for n in nodes if n['class_name'].startswith('stem')]:
        on = [k for k in range(len(ids)) if tm.touch(b[k], s)]
        for x, y in itertools.combinations(on, 2): share[x, y] = share[y, x] = True
    clef_y = np.array([n['top'] + n['height'] / 2 for n in nodes if 'Clef' in n['class_name']])
    hollow = np.array([n['class_name'] == 'noteheadHalf' for n in heads], float)
    X, IJ = tm.pair_features(cx, cy, w, h, W, H, share, hollow, clef_y)
    prob = m['model'].predict_proba(X)[:, 1] if len(X) else np.zeros(0)
    groups = tm.average_linkage_groups({'ids': ids}, IJ, prob, m['average_linkage_threshold'])
    return sorted(sorted(g) for g in groups)


def predict_precedence(nodes, image_size, model_path):
    m = _model(model_path, 'precedence')
    W, H = _size(image_size)
    if not nodes:
        return []
    p = pm.page([n['id'] for n in nodes], [_box(n) for n in nodes], [n['class_name'] for n in nodes], W, H)
    X, I, J = pm.featurize(p)
    if not len(I):
        return []
    prob = m['model'].predict_proba(X)[:, 1]
    score = {(int(p['ids'][i]), int(p['ids'][j])): float(q) for i, j, q in zip(I, J, prob)}
    t1, t2 = m['successor_thresholds']
    edges = pm.decode(p, I, J, prob, t1, t2)
    return [{'source_id': s, 'target_id': t, 'score': score[(s, t)]} for s, t in sorted(edges)]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('task', choices=['time', 'precedence'])
    ap.add_argument('--model', type=Path, required=True)
    ap.add_argument('--page', type=Path, required=True)
    a = ap.parse_args()
    page = json.loads(a.page.read_text())
    nodes = page['nodes']
    if nodes and 'class_id' in nodes[0]:
        cats = data.categories()
        nodes = [{'id': n['id'], 'class_name': cats[n['class_id']], 'left': n['bbox'][0], 'top': n['bbox'][1],
                  'width': n['bbox'][2], 'height': n['bbox'][3]} for n in sorted(nodes, key=lambda n: n['id'])]
    if a.task == 'time':
        out = predict_time_groups(nodes, page['image'], a.model)
    else:
        out = predict_precedence(nodes, page['image'], a.model)
    print(json.dumps(out))


if __name__ == '__main__':
    main()
