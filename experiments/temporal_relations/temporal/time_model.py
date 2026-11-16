"""Time groups: page loader, 13 pair features, a histogram gradient-boosting pair classifier, average-linkage
decoding and pooled pair counts.

Only the explicitly grouped noteheads of a page (target node_ids) are used. Candidates are notehead pairs with
|dx| <= 4 median notehead widths.
"""
import itertools
import json
import numpy as np
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import squareform
from sklearn.ensemble import HistGradientBoostingClassifier

HGB = dict(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, l2_regularization=1.0, early_stopping=False)
# average-linkage thresholds in search order
THRESHOLDS = np.r_[np.arange(0.05, 0.90, 0.05), np.arange(0.90, 0.995, 0.01)]
FEATURES = ['abs_dx_widths', 'abs_dy_heights', 'abs_dy_page_height', 'page_aspect_H_over_W', 'median_width_over_W',
            'median_height_over_H', 'same_stem', 'adjacent_pitch', 'noteheads_between', 'noteheads_in_column',
            'clefs_between', 'hollow_count', 'noteheads_on_page_over_100']


def touch(a, b, pad=3):
    """Boxes [left, top, width, height] overlap or lie within pad pixels of each other."""
    return not (a[0] + a[2] + pad < b[0] or b[0] + b[2] + pad < a[0] or a[1] + a[3] + pad < b[1] or b[1] + b[3] + pad < a[1])


def load(r, cats):
    """Explicitly grouped noteheads of one page with centers, median notehead width/height, page height,
    the shared-stem matrix (both noteheads touch the same stem box) and the annotated groups."""
    t = json.loads(open(r['target_path']).read()); a = json.loads(open(r['symbols_path']).read())
    by = {n['id']: n for n in a['nodes']}; elig = sorted(set(t['node_ids']))
    b = np.array([by[i]['bbox'] for i in elig], float); cx = b[:, 0] + b[:, 2] / 2; cy = b[:, 1] + b[:, 3] / 2
    w = np.median(np.maximum(b[:, 2], 1)); h = np.median(np.maximum(b[:, 3], 1))
    stems = [n['bbox'] for n in a['nodes'] if cats[n['class_id']].startswith('stem')]
    share = np.zeros((len(elig), len(elig)), bool)
    for s in stems:
        on = [k for k, i in enumerate(elig) if touch(by[i]['bbox'], s)]
        for p, q in itertools.combinations(on, 2): share[p, q] = share[q, p] = True
    true = [set(g) & set(elig) for g in t['groups']]; true = [g for g in true if g]
    return dict(ids=elig, cx=cx, cy=cy, w=w, h=h, H=a['image']['height'], share=share, true=true)


def pair_features(cx, cy, w, h, W, H, share, hollow, clef_y):
    """Candidate pairs (I, J) with I < J and |cx_I - cx_J| <= 4w, and their 13 features."""
    n = len(cx)
    I, J = np.nonzero(np.triu(np.abs(cx[:, None] - cx[None]) <= 4 * w, 1))
    X = []
    for i, j in zip(I, J):
        dx = (cx[j] - cx[i]) / w; dy = abs(cy[j] - cy[i]) / h; lo, hi = sorted((cx[i], cx[j])); ylo, yhi = sorted((cy[i], cy[j]))
        # other noteheads whose centers lie more than w/2 inside the horizontal interval and within 3h of the vertical range
        between = ((cx > lo + 0.5 * w) & (cx < hi - 0.5 * w) & (cy >= ylo - 3 * h) & (cy <= yhi + 3 * h)).sum()
        # noteheads within w/2 of the horizontal midpoint and strictly between the two vertically
        column = ((np.abs(cx - (cx[i] + cx[j]) / 2) <= 0.5 * w) & (cy > ylo) & (cy < yhi)).sum()
        # clefs whose center lies vertically between the two (any horizontal position)
        clefs = ((clef_y > ylo) & (clef_y < yhi)).sum() if len(clef_y) else 0
        X.append([abs(dx), dy, abs(cy[j] - cy[i]) / H, H / W, w / W, h / H, float(share[i, j]), float(abs(dx) <= 2 and dy <= 1.5),
                  between, column, clefs, hollow[i] + hollow[j], n / 100])
    return np.array(X, float).reshape(-1, 13), (I, J)


def page_feats(r, cats):
    """Features and labels of one annotated page. Returns (page, X, y, (I, J))."""
    p = load(r, cats); a = json.loads(open(r['symbols_path']).read())
    W, H = a['image']['width'], a['image']['height']
    clef_y = np.array([n['bbox'][1] + n['bbox'][3] / 2 for n in a['nodes'] if 'Clef' in cats[n['class_id']]])
    by = {n['id']: n for n in a['nodes']}; hollow = np.array([cats[by[i]['class_id']] == 'noteheadHalf' for i in p['ids']], float)
    X, (I, J) = pair_features(p['cx'], p['cy'], p['w'], p['h'], W, H, p['share'], hollow, clef_y)
    gid = {i: k for k, g in enumerate(p['true']) for i in g}
    y = np.array([int(p['ids'][i] in gid and gid.get(p['ids'][i]) == gid.get(p['ids'][j])) for i, j in zip(I, J)])
    return p, X, y, (I, J)


def fit(items, seed):
    X = np.concatenate([x[1] for x in items]); y = np.concatenate([x[2] for x in items])
    return HistGradientBoostingClassifier(random_state=seed, **HGB).fit(X, y)


def prep(items, model):
    return [(p, IJ, (model.predict_proba(X)[:, 1] if len(X) else np.zeros(0))) for p, X, y, IJ in items]


def average_linkage_groups(p, IJ, prob, thr):
    """Average-linkage clustering on distance 1 - p (1 for non-candidate pairs), cut where the average
    probability between two groups falls below thr."""
    n = len(p['ids'])
    if n < 2: return [{i} for i in p['ids']]
    D = np.ones((n, n)); I, J = IJ; D[I, J] = 1 - prob; D[J, I] = 1 - prob; np.fill_diagonal(D, 0)
    lab = fcluster(linkage(squareform(D, checks=False), 'average'), t=1 - thr + 1e-9, criterion='distance')
    G = {}
    for i, l in enumerate(lab): G.setdefault(l, set()).add(p['ids'][i])
    return list(G.values())


def pairs(gs):
    return {frozenset(q) for g in gs for q in itertools.combinations(sorted(g), 2)}


def pair_counts(pred_true):
    """Pooled TP, FP, FN over unordered same-group pairs; pred_true = [(predicted groups, true groups), ...]."""
    tp = fp = fn = 0
    for g, t in pred_true:
        a, b = pairs(g), pairs(t); tp += len(a & b); fp += len(a - b); fn += len(b - a)
    return tp, fp, fn


def counts(scored, thr):
    """Pooled pair TP, FP, FN of average linkage at threshold thr over pages scored by prep()."""
    return pair_counts([(average_linkage_groups(p, IJ, pr, thr), p['true']) for p, IJ, pr in scored])
