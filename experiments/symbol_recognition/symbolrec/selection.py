"""Checkpoint selection on validation pages.

RF-DETR branch (HandSchA): each candidate checkpoint predicts the whole validation pages (strips pooled).
Its rows (score >= 0.001) are rounded to integer pixel boxes clamped to the page and passed twice through a greedy
duplicate removal (in descending confidence: drop a box whose IoU with a kept box of the same class is >= 0.3 and
whose area ratio to it is >= 0.5, then drop a box whose IoU with a kept box of another class is >= 0.75 and whose
area ratio is >= 0.7). The score is the pooled AP50 over the branch classes and symbols with L > 200: every
prediction of the validation pages enters one precision-recall curve (descending confidence; ties share one
point), integrated over 101 recall points. Matching is one-to-one within a page and class (the unmatched ground
truth box with the highest IoU, the last one on equal IoU, at IoU >= 0.5); an unmatched prediction that overlaps
an ignore region or an out-of-scope ground truth box at IoU >= 0.5 is skipped. The highest score wins; ties go to
the earlier epoch.
"""
from collections import defaultdict
from itertools import groupby

from .common import symbol_size


def _iou_service(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return float(inter / max(union, 1e-6))


def _area_ratio(a, b):
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    return float(min(area_a, area_b) / max(area_a, area_b, 1e-6))


def _remove_duplicates(rows, same_class, iou_thr, ratio_thr):
    keep = []
    for candidate in sorted(rows, key=lambda r: -r['score']):
        drop = False
        for kept in keep:
            if (candidate['class_name'] == kept['class_name']) != same_class:
                continue
            if _iou_service(candidate['box'], kept['box']) < iou_thr:
                continue
            if _area_ratio(candidate['box'], kept['box']) < ratio_thr:
                continue
            drop = True
            break
        if not drop:
            keep.append(candidate)
    return keep


def _deduplicate(rows):
    return _remove_duplicates(_remove_duplicates(rows, True, .30, .50), False, .75, .70)


def integer_dedup(rows, width, height, floor=.001):
    """Rounded, clamped and de-duplicated page rows (dicts with box, score, class_name), sorted by top, left."""
    out = []
    for r in rows:
        if float(r['score']) < floor:
            continue
        left, top, right, bottom = [int(round(float(v))) for v in r['box']]
        left = max(0, min(left, width - 1)); top = max(0, min(top, height - 1))
        right = max(left + 1, min(right, width)); bottom = max(top + 1, min(bottom, height))
        out.append({'box': [float(left), float(top), float(right), float(bottom)], 'score': float(r['score']),
                    'class_name': r['class_name']})
    out = _deduplicate(_deduplicate(out))
    out.sort(key=lambda d: (d['box'][1], d['box'][0], d['class_name'], -d['score']))
    return out


def _iou(a, b):
    left, top, right, bottom = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    if intersection <= 0.0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    return intersection / max(area_a + area_b - intersection, 1e-12)


def _best_unmatched(prediction, gt_rows, matched, threshold):
    best_index, best_iou = None, -1.0
    for index, gt in enumerate(gt_rows):
        if matched[index] or gt['class_name'] != prediction['class_name']:
            continue
        value = _iou(prediction['box'], gt['box'])
        if value >= best_iou:
            best_iou, best_index = value, index
    if best_index is None or best_iou < threshold:
        return None
    return best_index


def pooled_ap(predictions, truth, iou=.5):
    """Instance-pooled AP over all pages (predictions carry an '_ordinal' tie-break within a page)."""
    gt_total = sum(len(page['eligible']) for page in truth.values())
    events = []
    for pid in sorted(truth):
        by_class = defaultdict(list)
        for row in truth[pid]['eligible']:
            by_class[row['class_name']].append(row)
        matched = {k: [False] * len(v) for k, v in by_class.items()}
        for row in sorted(predictions.get(pid, []), key=lambda x: (-x['score'], x['_ordinal'])):
            label = row['class_name']
            hit = _best_unmatched(row, by_class.get(label, []), matched.get(label, []), iou)
            if hit is not None:
                matched[label][hit] = True
                is_tp = 1
            elif any(_iou(row['box'], ignored['box']) >= iou for ignored in truth[pid]['ignored']):
                continue
            else:
                is_tp = 0
            events.append((row['score'], pid, row['_ordinal'], is_tp))
    events.sort(key=lambda x: (-x[0], x[1], x[2]))
    tp = fp = 0
    points = []
    for _, group in groupby(events, key=lambda x: x[0]):
        group = list(group)
        hits = sum(e[3] for e in group)
        tp += hits; fp += len(group) - hits
        points.append((tp / gt_total, tp / (tp + fp)))
    return sum(max((p for r, p in points if r >= k / 100), default=0.0) for k in range(101)) / 101


def branch_score(rows_by_page, split, classes, minimum=200):
    """Validation score of a branch checkpoint with the given classes; rows_by_page: {page_id: [{box, score, class_name}]}."""
    classes = set(classes)
    preds, truth = {}, {}
    for pid, gt in split['truth'].items():
        page = split['pages'][pid]
        keep = lambda r: r['class_name'] in classes and symbol_size(r['box'], page['width'], page['height']) > minimum
        rows = integer_dedup(rows_by_page.get(pid, []), page['width'], page['height'])
        preds[pid] = [dict(r, _ordinal=i) for i, r in enumerate(rows) if keep(r)]
        truth[pid] = {'eligible': [r for r in gt['eligible'] if keep(r)],
                      'ignored': gt['ignored'] + [r for r in gt['eligible'] if not keep(r)]}
    return pooled_ap(preds, truth, .5)
