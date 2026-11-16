"""Precedence links: rightward same-family candidates, 19 pair features, a histogram gradient-boosting pair
classifier, and successor selection with two thresholds.

Families used for the candidates (family()): all notehead classes, all stem classes (stemStructural), Arabic
numerals (numeral1-9), Roman numerals (numeralRoman*), letters (character*) and accidentals (accidental*) each form
one family, and every other class is its own family. Every symbol of a page gets candidates. Annotated links between
different families are never candidates and count as false negatives.

The rank features use NumPy's default (unstable) argsort. Symbols of one family can share an exact center x, and the
order of such ties depends on the SIMD sort kernels NumPy selects for the CPU, so results can differ slightly between
CPUs with and without AVX-512.
"""
import collections
import json
import re
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

HGB = dict(max_iter=400, learning_rate=0.05, max_leaf_nodes=31, l2_regularization=1.0, early_stopping=False)
FEATURES = ['dx_widths', 'dy_heights', 'abs_dy_heights', 'rank_of_target_among_source_candidates',
            'rank_of_source_among_target_predecessors', 'dx_minus_min_dx', 'euclidean_rank', 'same_family_between',
            'beams_slurs_spanning', 'stem_direction_source', 'stem_direction_target', 'stem_direction_product',
            'family_code', 'source_hollow', 'target_hollow', 'source_height_over_h', 'target_height_over_h',
            'page_aspect_H_over_W', 'symbols_on_page_over_100']


def family(name):
    if name.startswith('notehead'): return 'notehead'
    if name.startswith('stem'): return 'stem'
    if name.startswith('numeralRoman'): return 'roman'
    if re.match(r'numeral\d', name): return 'numeral'
    if name.startswith('character'): return 'character'
    if name.startswith('accidental'): return 'accidental'
    return name


def page(ids, boxes, names, W, H, truth=frozenset(), page_id=None):
    """Page record from node ids, boxes [left, top, width, height] and class names."""
    b = np.asarray(boxes, float).reshape(-1, 4)
    return dict(page_id=page_id, ids=np.asarray(ids), box=b, cx=b[:, 0] + b[:, 2] / 2, cy=b[:, 1] + b[:, 3] / 2, names=list(names),
                fam=np.array([family(n) for n in names]), W=W, H=H, truth=set(truth))


def load(r, cats):
    x = json.loads(open(r['symbols_path']).read()); t = json.loads(open(r['target_path']).read())
    N = x['nodes']
    return page([n['id'] for n in N], [n['bbox'] for n in N], [cats[n['class_id']] for n in N], x['image']['width'], x['image']['height'],
                {tuple(map(int, e)) for e in t['directed_edges']}, r['page_id'])


def touch(a, b, pad=3):
    return not (a[0] + a[2] + pad < b[0] or b[0] + b[2] + pad < a[0] or a[1] + a[3] + pad < b[1] or b[1] + b[3] + pad < a[1])


def featurize(p):
    """Candidates (I, J): every symbol i and every symbol j of the same family with a larger center x."""
    n = len(p['ids']); cx, cy, box, fam, names = p['cx'], p['cy'], p['box'], p['fam'], p['names']
    heads = [k for k in range(n) if fam[k] == 'notehead']
    w = np.median(np.maximum(box[heads, 2], 1)) if heads else 20.; h = np.median(np.maximum(box[heads, 3], 1)) if heads else 20.
    stems = [k for k in range(n) if fam[k] == 'stem']
    # stem direction of each notehead: +1 stem above, -1 below, 0 none; for stems: +1 if its attached head is at the bottom
    sdir = np.zeros(n)
    for k in heads:
        for s in stems:
            if touch(box[k], box[s]): sdir[k] = 1 if cy[s] < cy[k] else -1; break
    for s in stems:
        att = [k for k in heads if touch(box[k], box[s])]
        if att: sdir[s] = 1 if cy[s] < np.mean(cy[att]) else -1
    span = [k for k in range(n) if names[k].startswith('beam') or names[k].startswith('slur')]
    I = []; J = []
    for i in range(n):
        js = np.flatnonzero((fam == fam[i]) & (cx > cx[i]))
        I += [i] * len(js); J += list(js)
    I = np.array(I, int); J = np.array(J, int)
    if len(I) == 0: return np.zeros((0, 1)), I, J
    dx = (cx[J] - cx[I]) / w; dy = (cy[J] - cy[I]) / h
    # rank of j among i's candidates (by dx) and of i among j's predecessors (by dx)
    rank_s = np.zeros(len(I)); rank_t = np.zeros(len(I)); dxmin_s = np.zeros(len(I)); eu_rank = np.zeros(len(I))
    bys = collections.defaultdict(list); byt = collections.defaultdict(list)
    for e, (i, j) in enumerate(zip(I, J)): bys[i].append(e); byt[j].append(e)
    for es in bys.values():
        es = np.array(es); o = np.argsort(dx[es]); rank_s[es[o]] = np.arange(1, len(es) + 1); dxmin_s[es] = dx[es] - dx[es].min()
        o2 = np.argsort(np.hypot(dx[es], dy[es])); eu_rank[es[o2]] = np.arange(1, len(es) + 1)
    for es in byt.values():
        es = np.array(es); o = np.argsort(dx[es]); rank_t[es[o]] = np.arange(1, len(es) + 1)
    between = np.zeros(len(I)); cover = np.zeros(len(I))
    for e, (i, j) in enumerate(zip(I, J)):
        lo, hi = cx[i], cx[j]; ylo, yhi = min(cy[i], cy[j]) - 2 * h, max(cy[i], cy[j]) + 2 * h
        between[e] = ((fam == fam[i]) & (cx > lo) & (cx < hi) & (cy >= ylo) & (cy <= yhi)).sum()
        for s in span:
            x0, y0, bw, bh = box[s]
            if x0 <= lo + 0.5 * w and x0 + bw >= hi - 0.5 * w and y0 <= yhi and y0 + bh >= ylo: cover[e] += 1
    famcode = {'notehead': 0, 'stem': 1}
    X = np.column_stack([dx, dy, np.abs(dy), rank_s, rank_t, dxmin_s, eu_rank, between, cover, sdir[I], sdir[J], sdir[I] * sdir[J],
                         [famcode.get(fam[i], 2) for i in I], [names[i] == 'noteheadHalf' for i in I], [names[j] == 'noteheadHalf' for j in J],
                         box[I, 3] / h, box[J, 3] / h, np.full(len(I), p['H'] / p['W']), np.full(len(I), n / 100)]).astype(float)
    return X, I, J


def labels(p, I, J):
    return np.array([(int(p['ids'][i]), int(p['ids'][j])) in p['truth'] for i, j in zip(I, J)], int)


def fit(feats, seed):
    """feats = [(page, X, I, J), ...] of the training pages."""
    X = np.concatenate([f[1] for f in feats if len(f[2])]); y = np.concatenate([labels(f[0], f[2], f[3]) for f in feats if len(f[2])])
    return HistGradientBoostingClassifier(random_state=seed, **HGB).fit(X, y)


def decode(p, I, J, prob, t1, t2):
    """Successor selection: for each source keep its highest-scoring candidate if its probability >= t1, and any
    further candidate whose probability >= t2 (t2 = 1.01 admits none)."""
    keep = np.zeros(len(I), bool); bys = collections.defaultdict(list)
    for e, i in enumerate(I): bys[i].append(e)
    for es in bys.values():
        es = np.array(es); o = es[np.argsort(-prob[es])]
        if prob[o[0]] >= t1: keep[o[0]] = True
        keep[o[1:][prob[o[1:]] >= t2]] = True
    return {(int(p['ids'][I[e]]), int(p['ids'][J[e]])) for e in np.flatnonzero(keep)}


def counts(items, t1, t2):
    """Pooled directed-edge TP, FP, FN; items = [(page, I, J, prob), ...]. Annotated links that are not candidates
    are false negatives."""
    tp = fp = fn = 0
    for p, I, J, prob in items:
        P = decode(p, I, J, prob, t1, t2); tp += len(P & p['truth']); fp += len(P - p['truth']); fn += len(p['truth'] - P)
    return tp, fp, fn


def grid():
    """Decoding grid (t1, t2) in search order; validation ties go to the first entry."""
    ts = list(np.arange(0.05, 0.95, 0.05)) + [0.97, 0.99]
    return [(a, b) for a in ts for b in (0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1.01) if b >= a]
