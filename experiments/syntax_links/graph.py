"""Unordered candidate graphs for the incidence model, cached CNN features, and link direction."""
from pathlib import Path
from types import SimpleNamespace
import json
import numpy as np
import model as core


def class_dictionary(categories):
    if isinstance(categories, (str, Path)):
        categories = json.loads(Path(categories).read_text())
    return {r['name']: int(r['id']) for r in categories}


def build_graph(g, input_json, categories):
    """Turn the directed 64-NN candidate graph ``g`` of common.load_page into one candidate per symbol pair.

    Each candidate keeps the endpoint order of ``model.canonical_pair``. ``directed_to_unordered``
    maps every directed candidate of ``g`` to its unordered candidate.
    """
    if isinstance(input_json, (str, Path)):
        input_json = json.loads(Path(input_json).read_text())
    cd = class_dictionary(categories)
    names = {v: k for k, v in cd.items()}
    truth = g.get('truth', set())
    by_id = {int(i): [] for i in g['ids']}
    for a, b in truth:
        by_id[int(a)].append(int(b))
    nodes = []
    for node in input_json['nodes']:
        x, y, w, h = node['bbox']
        if any(int(v) != v for v in [x, y, w, h]):
            raise ValueError('Box coordinates must be integers')
        nodes.append(SimpleNamespace(id=int(node['id']), class_name=names[int(node['class_id'])], left=int(x), top=int(y),
                                     right=int(x + w), bottom=int(y + h), outlinks=by_id[int(node['id'])]))
    undirected = sorted({tuple(sorted(map(int, p))) for p in g['pairs']})
    edges = []
    for i, j in undirected:
        a, b = core.canonical_pair(nodes[i], nodes[j], cd)
        edges.append((i, j) if a is nodes[i] else (j, i))
    edges = np.asarray(edges, np.int64).reshape(-1, 2)
    lookup = {tuple(sorted(map(int, p))): k for k, p in enumerate(edges)}
    mapping = np.array([lookup[tuple(sorted(map(int, p)))] for p in g['pairs']], np.int64)
    is_ab = np.array([tuple(map(int, p)) == tuple(map(int, edges[k])) for p, k in zip(g['pairs'], mapping)])
    width = input_json['image']['width']
    height = input_json['image']['height']
    labels = np.array([((nodes[i].id, nodes[j].id) in truth or (nodes[j].id, nodes[i].id) in truth)
                       for i, j in edges], np.float32)
    edge_geo = np.stack([core.pair_geometry(nodes[i], nodes[j], width, height) for i, j in edges]).astype(np.float32)
    inc = np.concatenate([
        np.stack([core.directed_geometry(nodes[i], nodes[j], width, height) for i, j in edges]),
        np.stack([core.directed_geometry(nodes[j], nodes[i], width, height) for i, j in edges])]).astype(np.float32)
    graph = core.PageGraph(name=g['page_id'], nodes=nodes, node_cls=g['classes'].copy(),
                           node_geo=core.node_geometry(nodes, width, height), edges=edges, edge_geo=edge_geo,
                           incidence_geo=inc, labels=labels)
    graph.directed_to_unordered = mapping
    graph.directed_is_ab = is_ab
    graph.width = width
    graph.height = height
    graph.input_sha256 = g['input_sha256']
    return graph


def feature_path(features_dir, graph):
    return Path(features_dir) / (graph.name + '.npz')


def save_features(features_dir, graph, visual, logit, cnn_sha256):
    path = feature_path(features_dir, graph)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp.npz')
    np.savez(tmp, edges=graph.edges, visual=visual.astype(np.float16), cnn_logit=logit.astype(np.float32),
             input_sha256=np.array(graph.input_sha256), cnn_sha256=np.array(cnn_sha256))
    tmp.replace(path)
    return path


def attach_features(graph, features_dir, cnn_sha256):
    """Attach stored CNN features after checking the candidate order, the page input and the CNN."""
    with np.load(feature_path(features_dir, graph), allow_pickle=False) as f:
        if not np.array_equal(f['edges'], graph.edges):
            raise ValueError('Visual candidate order mismatch')
        if str(f['input_sha256'].item()) != graph.input_sha256:
            raise ValueError('Visual input hash mismatch')
        if str(f['cnn_sha256'].item()) != cnn_sha256:
            raise ValueError('Visual CNN hash mismatch')
        graph.visual = f['visual'].astype(np.float32)
        graph.cnn_logit = f['cnn_logit'].astype(np.float32)
    return graph


def make_model(vocab):
    return core.IncidenceNet(vocab=int(vocab), hidden=128, ports=4, layers=2, class_dim=32)


def fit_direction(train_graphs, categories, seed):
    """Direction classifier fitted on the training links that have one annotated direction."""
    cd = class_dictionary(categories)
    rows = []
    for g in train_graphs:
        rows.extend(core.directed_rows((g.name, g.nodes, g.width, g.height), cd))
    x = np.stack([r[0] for r in rows])
    y = np.array([r[1] for r in rows], np.int8)
    if len(np.unique(y)) != 2:
        raise ValueError('Direction training must have both orientations')
    classifier = core.make_classifier(seed)
    classifier.fit(x, y)
    return classifier


def direction_probabilities(graph, classifier, categories):
    cd = class_dictionary(categories)
    x = np.stack([core.pair_features(graph.nodes[i], graph.nodes[j], graph.width, graph.height, cd)[0]
                  for i, j in graph.edges])
    return classifier.predict_proba(x)[:, list(classifier.classes_).index(1)].astype(np.float32)


def direction_mask(graph, classifier, categories):
    """1 for the directed candidate that the classifier chooses (probability >= 0.5 means first -> second)."""
    ab = direction_probabilities(graph, classifier, categories) >= .5
    return (graph.directed_is_ab == ab[graph.directed_to_unordered]).astype(np.float32)


def directed_scores(graph, adjacency_probabilities, mask):
    return np.asarray(adjacency_probabilities, np.float32)[graph.directed_to_unordered] * mask
