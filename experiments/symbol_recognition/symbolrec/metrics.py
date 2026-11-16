"""The eight symbol-detection metrics.

All symbols: at each IoU threshold in 0.50:0.05:0.95 the Ultralytics matcher (BaseValidator.match_predictions)
pairs predictions with ground-truth boxes of the same class; Ultralytics ap_per_class integrates each class's
precision-recall curve over 101 recall points. mAP is the mean over classes with ground truth; w-mAP weights each
class by its number of instances.

Size subsets (L > 400 and L > 800): COCO-style matching in events(); AP50 over classes with in-range ground truth.

Ignore regions (see data.py) remove unmatched predictions that overlap them at the IoU threshold.
"""
from collections import Counter, defaultdict
from types import SimpleNamespace

import numpy as np
import torch
from ultralytics.engine.validator import BaseValidator
from ultralytics.utils.metrics import ap_per_class, box_iou

from .common import symbol_size

IOU = np.arange(50, 96, 5) / 100
FIELDS = ['all_macro_ap50', 'all_weighted_ap50', 'all_macro_ap50_95', 'all_weighted_ap50_95',
          'gt400_macro_ap50', 'gt400_weighted_ap50', 'gt800_macro_ap50', 'gt800_weighted_ap50']
COLUMNS = ['mAP50', 'w-mAP50', 'mAP50:95', 'w-mAP50:95', 'L>400 mAP50', 'L>400 w-mAP50', 'L>800 mAP50', 'L>800 w-mAP50']


def native_metrics(predictions, truth, names):
    """All-symbol mAP50, w-mAP50, mAP50:95 and w-mAP50:95 (fractions) with ignore regions."""
    categories = {name: cid for cid, name in names.items()}
    holder = SimpleNamespace(iouv=torch.tensor(IOU, dtype=torch.float64))
    targets, confidence, classes, correct, keep = [], [], [], [], []
    for pid in sorted(truth):
        pred = sorted(predictions[pid], key=lambda row: -row['score'])
        gt = truth[pid]['eligible']
        tc = torch.tensor([categories[r['class_name']] for r in gt], dtype=torch.int64)
        pc = torch.tensor([categories[r['class_name']] for r in pred], dtype=torch.int64)
        gb = torch.tensor([r['box'] for r in gt], dtype=torch.float64).reshape(-1, 4)
        pb = torch.tensor([r['box'] for r in pred], dtype=torch.float64).reshape(-1, 4)
        matched = BaseValidator.match_predictions(holder, pc, tc, box_iou(gb, pb)).numpy()
        unknown = truth[pid]['ignored']
        if unknown and pred:
            ub = torch.tensor([r['box'] for r in unknown], dtype=torch.float64).reshape(-1, 4)
            max_unknown = box_iou(ub, pb).max(dim=0).values.numpy()
            retained = matched | (max_unknown[:, None] < IOU[None, :])
        else:
            retained = np.ones(matched.shape, dtype=bool)
        correct.append(matched); keep.append(retained)
        targets.extend(tc.tolist()); classes.extend(pc.tolist()); confidence.extend(r['score'] for r in pred)
    tp = np.concatenate(correct); retained = np.concatenate(keep)
    confidence, classes, targets = map(np.asarray, (confidence, classes, targets))
    supports = Counter(map(int, targets))
    ids = np.array(sorted(supports), dtype=int)
    weights = np.array([supports[int(cid)] for cid in ids])
    ap = np.zeros((len(ids), len(IOU)))
    for index in range(len(IOU)):
        mask = retained[:, index]
        result = ap_per_class(tp[mask, index:index + 1], confidence[mask], classes[mask], targets, plot=False, names=names)
        assert np.array_equal(result[6], ids)
        ap[:, index] = result[5][:, 0]
    macro = ap.mean(axis=0); weighted = np.average(ap, axis=0, weights=weights)
    return dict(macro_ap50=float(macro[0]), weighted_ap50=float(weighted[0]),
                macro_ap50_95=float(macro.mean()), weighted_ap50_95=float(weighted.mean()),
                ground_truth=int(weights.sum()), gt_present_classes=len(ids),
                per_class={names[int(c)]: dict(ground_truth=int(weights[i]), ap50=float(ap[i, 0]), ap50_95=float(ap[i].mean()))
                           for i, c in enumerate(ids)})


def _iou(a, boxes):
    b = np.asarray(boxes, dtype=np.float64).reshape(-1, 4)
    x0, y0 = np.maximum(a[0], b[:, 0]), np.maximum(a[1], b[:, 1])
    x1, y1 = np.minimum(a[2], b[:, 2]), np.minimum(a[3], b[:, 3])
    inter = np.clip(x1 - x0, 0, None) * np.clip(y1 - y0, 0, None)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1]) - inter
    return inter / union


def events(pred, gt, page, minimum, unknown=()):
    """COCO-style matching for one page and one size cutoff.

    Predictions are taken in descending confidence and matched to the unused same-class ground truth with the
    greatest IoU of at least 0.5, in-range ground truth first. Matches to out-of-range ground truth are ignored.
    An unmatched prediction is a false positive only if its own L exceeds the cutoff and it does not overlap an
    ignore region at IoU 0.5. Returns rows [score, class, is_tp] and the number of in-range ground truth boxes.
    """
    size = lambda box: symbol_size(box, page['width'], page['height'])
    ordered = sorted(enumerate(pred), key=lambda p: (-p[1]['score'], p[0]))
    by_class = defaultdict(list)
    for j, g in enumerate(gt):
        by_class[int(g['category_id'])].append(j)
    eligible = [size(g['box']) > minimum for g in gt]
    used, rows = set(), []
    for _, p in ordered:
        cls = int(p['category_id']); idx = by_class[cls]
        ov = _iou(p['box'], [gt[j]['box'] for j in idx]) if idx else []
        choices = [(j, o) for j, o in zip(idx, ov) if j not in used and o >= .5]
        choices = [c for c in choices if eligible[c[0]]] or choices
        if choices:
            winner = max(choices, key=lambda item: (item[1], item[0]))[0]; used.add(winner)
            if eligible[winner]:
                rows.append([p['score'], cls, 1.])
        elif size(p['box']) > minimum:
            if not (len(unknown) and _iou(p['box'], [u['box'] for u in unknown]).max() >= .5):
                rows.append([p['score'], cls, 0.])
    return rows, sum(eligible)


def size_subset(pred, truth, names, pages, minimum):
    """mAP50 and w-mAP50 (fractions) over symbols with L > minimum."""
    ids = {name: cid for cid, name in names.items()}
    rows, targets = [], []
    for pid in sorted(truth):
        page = pages[pid]
        gt = [dict(box=r['box'], category_id=ids[r['class_name']]) for r in truth[pid]['eligible']]
        pr = [dict(box=r['box'], category_id=ids[r['class_name']], score=r['score']) for r in pred[pid]]
        ev, _ = events(pr, gt, page, minimum, truth[pid]['ignored'])
        rows += ev
        targets += [g['category_id'] for g in gt if symbol_size(g['box'], page['width'], page['height']) > minimum]
    ev = np.asarray(rows, dtype=np.float64).reshape(-1, 3); tg = np.asarray(targets, dtype=np.int64)
    out = ap_per_class(ev[:, 2:3].astype(bool), ev[:, 0], ev[:, 1].astype(np.int64), tg, plot=False, names=names)
    ap, cls = out[5][:, 0], out[6]; support = Counter(map(int, tg))
    assert list(map(int, cls)) == sorted(support)
    w = np.asarray([support[int(c)] for c in cls])
    return dict(macro_ap50=float(ap.mean()), weighted_ap50=float(np.dot(ap, w) / w.sum()), ground_truth=len(tg),
                gt_present_classes=len(cls),
                per_class={names[int(c)]: dict(ground_truth=int(n), ap50=float(a)) for c, n, a in zip(cls, w, ap)})


def table_metrics(pred, split):
    """The eight metrics in percent for page predictions {page_id: [{box, class_name, score}, ...]}.

    `split` is the dict returned by data.load_split. For the all-symbol metrics, predictions with L <= 0 (degenerate
    boxes) are left out. A size subset is NaN if the test pages have no symbol above that size.
    """
    names, truth, pages = split['names'], split['truth'], split['pages']
    rows = {p: [dict(box=[float(v) for v in r['box']], class_name=r['class_name'], score=float(r['score']))
                for r in pred.get(p, [])] for p in truth}
    positive = {p: [r for r in rows[p] if symbol_size(r['box'], pages[p]['width'], pages[p]['height']) > 0] for p in truth}
    al = native_metrics(positive, truth, names)

    def sized(minimum):
        n = sum(symbol_size(r['box'], pages[p]['width'], pages[p]['height']) > minimum for p in truth for r in truth[p]['eligible'])
        if not n:
            return float('nan'), float('nan')
        m = size_subset(rows, truth, names, pages, minimum)
        return m['macro_ap50'], m['weighted_ap50']

    a4, a8 = sized(400), sized(800)
    return [100 * v for v in (al['macro_ap50'], al['weighted_ap50'], al['macro_ap50_95'], al['weighted_ap50_95'], *a4, *a8)]
