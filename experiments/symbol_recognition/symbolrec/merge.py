"""Merging the YOLOv8L and RF-DETR branches (Section V-A).

Inputs are page-coordinate rows {box: [x1, y1, x2, y2], score, category_id, class_name, ...}. YOLOv8L rows
(branch "small") also carry owned_by_center and touches_interior_tile_edge from tiled inference; rows that are
not owned by their tile are dropped. RF-DETR rows (branch "large") are the raw strip predictions mapped to page
coordinates, pooled over all strips of the page. All suppression is class-wise and uses a fully specified tie
order (see _key).

Merge rule (configs/merge_rule.json):
  1. keep YOLOv8L rows with score >= 0.001 and RF-DETR rows with score >= 0.2; class-wise NMS at IoU 0.5
     within each branch;
  2. drop a YOLOv8L row that touches an interior tile edge when at least 80% of its area lies inside an
     RF-DETR row of the same class with L > 400 and its area is at most 80% of that row's area;
  3. class-wise NMS at IoU 0.5 over the rows of both branches together.
"""
import math

import numpy as np

from .common import symbol_size

MERGE_RULE = {'score_floor': 0.001, 'rf_min_score': 0.2, 'branch_nms_iou': 0.5, 'fragment_min_side': 400, 'fragment_coverage': 0.8,
              'fragment_max_area_ratio': 0.8, 'nms_iou': 0.5}


def _key(row):
    return (-float(row['score']), int(row['category_id']), *map(float, row['box']), str(row['source_branch']),
            int(row.get('fusion_input_index', 0)))


def prepare(rows, branch, floor):
    """Validate rows, drop non-owned YOLOv8L rows and rows below the score floor; tag the branch."""
    result = []
    for i, row in enumerate(rows):
        if branch == 'small' and not bool(row.get('owned_by_center', True)):
            continue
        box = np.asarray(row['box'], dtype=np.float64)
        score = float(row['score'])
        if box.shape != (4,) or not np.isfinite(box).all() or not math.isfinite(score):
            raise ValueError('Finite xyxy boxes and scores are required')
        if score < 0 or score > 1:
            raise ValueError('Scores must be in [0, 1]')
        if box[2] <= box[0] or box[3] <= box[1]:
            raise ValueError('Positive-area xyxy boxes are required')
        if score < floor:
            continue
        item = dict(row)
        item.update(box=box.tolist(), score=score, category_id=int(row['category_id']), source_branch=branch,
                    fusion_input_index=i)
        result.append(item)
    return result


def _boxes(rows):
    return np.asarray([r['box'] for r in rows], dtype=np.float64).reshape(-1, 4)


def _area(boxes):
    return (boxes[..., 2] - boxes[..., 0]) * (boxes[..., 3] - boxes[..., 1])


def _ious(one, boxes):
    wh = np.maximum(0, np.minimum(one[2:], boxes[:, 2:]) - np.maximum(one[:2], boxes[:, :2]))
    inter = wh[:, 0] * wh[:, 1]
    return inter / np.maximum(_area(one) + _area(boxes) - inter, 1e-12)


def _by_class(rows):
    result = {}
    for row in rows:
        result.setdefault(int(row['category_id']), []).append(row)
    return result


def nms(rows, iou):
    """Greedy class-wise non-maximum suppression; output grouped by class id."""
    result = []
    for _, group in sorted(_by_class(rows).items()):
        ordered = sorted(group, key=_key)
        boxes = _boxes(ordered)
        remaining = np.arange(len(ordered))
        while len(remaining):
            first = int(remaining[0])
            result.append(ordered[first])
            others = remaining[1:]
            remaining = others[_ious(boxes[first], boxes[others]) < iou]
    return result


def drop_fragments(small, large, page, rule):
    selected = [r for r in large if symbol_size(r['box'], page['width'], page['height']) > float(rule['fragment_min_side'])]
    large_groups = {cls: _boxes(rows) for cls, rows in _by_class(selected).items()}
    result = []
    for s in small:
        same = large_groups.get(s['category_id'])
        if not s.get('touches_interior_tile_edge', False) or same is None:
            result.append(s)
            continue
        b = np.asarray(s['box'])
        wh = np.maximum(0, np.minimum(b[2:], same[:, 2:]) - np.maximum(b[:2], same[:, :2]))
        coverage = wh.prod(axis=1) / max(float(_area(b)), 1e-12)
        ratio = _area(b) / np.maximum(_area(same), 1e-12)
        if not np.any((coverage >= float(rule['fragment_coverage'])) & (ratio <= float(rule['fragment_max_area_ratio']))):
            result.append(s)
    return result


def merge_page(small, large, page, rule=MERGE_RULE):
    """YOLOv8L + RF-DETR page predictions under the merge rule; page = {width, height}."""
    if float(page['width']) <= 0 or float(page['height']) <= 0:
        raise ValueError('Positive page dimensions are required')
    floor = float(rule['score_floor'])
    ss = prepare(small, 'small', floor)
    ll = prepare(large, 'large', max(floor, float(rule['rf_min_score'])))
    ss = nms(ss, float(rule['branch_nms_iou']))
    ll = nms(ll, float(rule['branch_nms_iou']))
    ss = drop_fragments(ss, ll, page, rule)
    rows = nms(ss + ll, float(rule['nms_iou']))
    return sorted(rows, key=_key)
