#!/usr/bin/env python3
"""Page-level syntax-link prediction with a trained model folder.

A model folder (written by train_incidence.py) holds ``incidence.pt`` (incidence-model weights,
selected epoch and threshold), ``direction.pkl`` (direction classifier), ``pair_cnn.pth`` (frozen
PairCNN), ``categories.json`` and ``model.json`` (threshold and the SHA-256 of the CNN, which is
checked before use).

  from inference import predict_syntax_links
  links = predict_syntax_links(nodes, (width, height), '../../models/syntax_links/incidence/handscha/heldout/seed_42')

  python inference.py --input data/pages/<page_id>/input.json [--model-dir M]
"""
import argparse
import json
import math
import pickle
from pathlib import Path
import numpy as np
import torch
import common
import graph as G
import model as core

HERE = Path(__file__).resolve().parent
DEFAULT_MODEL = HERE.parents[1] / 'models/syntax_links/incidence/handscha/heldout/seed_42'
_LOADED = {}


def load_model(model_dir, device='cpu'):
    key = (str(Path(model_dir).resolve()), device)
    if key in _LOADED:
        return _LOADED[key]
    model_dir = Path(model_dir)
    spec = common.read(model_dir / 'model.json')
    cnn_path = model_dir / spec['pair_cnn']['file']
    common.require(common.sha(cnn_path) == spec['pair_cnn']['sha256'], 'PairCNN checkpoint hash mismatch')
    categories = common.categories_list(model_dir / 'categories.json')
    net = G.make_model(len(categories)).to(device)
    net.load_state_dict(torch.load(model_dir / 'incidence.pt', map_location=device, weights_only=False)['model'])
    net.eval()
    loaded = {'spec': spec, 'categories': categories, 'net': net, 'cnn': core.load_pair_cnn(str(cnn_path), device),
              'direction': pickle.loads((model_dir / 'direction.pkl').read_bytes()),
              'class_ids': G.class_dictionary(categories)}
    _LOADED[key] = loaded
    return loaded


def page_input(nodes, image_size, class_ids):
    """Integer boxes clipped to the page; symbols of unknown classes or with empty boxes are skipped."""
    width, height = int(image_size[0]), int(image_size[1])
    out = []
    for n in nodes:
        if n['class_name'] not in class_ids:
            continue
        x1 = max(0, int(math.floor(n['left'])))
        y1 = max(0, int(math.floor(n['top'])))
        x2 = min(width, int(math.ceil(n['left'] + n['width'])))
        y2 = min(height, int(math.ceil(n['top'] + n['height'])))
        if x2 <= x1 or y2 <= y1:
            continue
        out.append({'bbox': [x1, y1, x2 - x1, y2 - y1], 'class_id': class_ids[n['class_name']], 'id': int(n['id'])})
    return {'image': {'width': width, 'height': height}, 'nodes': out, 'page_id': 'page'}


@torch.inference_mode()
def predict_syntax_links(nodes, image_size, model_dir, device='cpu', threshold=None, workers=0):
    """Predict directed syntax links of one page.

    nodes: list of dict(id, class_name, left, top, width, height); image_size: (width, height).
    Returns the links whose score reaches the model's validation threshold (or ``threshold``),
    as a list of dict(source_id, target_id, score).
    """
    m = load_model(model_dir, device)
    threshold = m['spec']['threshold'] if threshold is None else threshold
    page = page_input(nodes, image_size, m['class_ids'])
    ids = np.array([n['id'] for n in page['nodes']], dtype=np.int64)
    common.require(len(set(ids.tolist())) == len(ids), 'Duplicate symbol id')
    if len(ids) < 2:
        return []
    classes = np.array([n['class_id'] for n in page['nodes']], dtype=np.int64)
    boxes = np.array([n['bbox'] for n in page['nodes']], dtype=np.float32)
    pairs = common.candidates(ids, boxes, page['image']['width'], page['image']['height'])
    g = {'page_id': page['page_id'], 'input_sha256': '', 'ids': ids, 'classes': classes, 'pairs': pairs}
    graph = G.build_graph(g, page, m['categories'])
    visual, logit = core.encode_pairs(m['cnn'], graph, page['image']['height'], page['image']['width'], device,
                                      batch_size=256, workers=workers)
    graph.visual = visual.astype(np.float32)
    graph.cnn_logit = logit.astype(np.float32)
    logits, _ = m['net'](core.graph_to_device(graph, device))
    mask = G.direction_mask(graph, m['direction'], m['categories'])
    scores = G.directed_scores(graph, logits.sigmoid().cpu().numpy(), mask)
    keep = scores >= threshold
    return [{'source_id': int(a), 'target_id': int(b), 'score': float(s)}
            for (a, b), s in zip(ids[pairs[keep]], scores[keep])]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--model-dir', default=str(DEFAULT_MODEL))
    p.add_argument('--input', required=True, help='input.json of a task folder (page size and symbols)')
    p.add_argument('--device', default='cpu')
    a = p.parse_args()
    x = common.read(a.input)
    names = {c['id']: c['name'] for c in common.categories_list(Path(a.model_dir) / 'categories.json')}
    nodes = [{'id': n['id'], 'class_name': names[n['class_id']], 'left': n['bbox'][0], 'top': n['bbox'][1],
              'width': n['bbox'][2], 'height': n['bbox'][3]} for n in x['nodes']]
    links = predict_syntax_links(nodes, (x['image']['width'], x['image']['height']), a.model_dir, a.device)
    print(json.dumps(links))


if __name__ == '__main__':
    main()
