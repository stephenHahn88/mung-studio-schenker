"""Prediction files and the merged page predictions of YOLOv8L + RF-DETR.

Format "symbol-predictions-v1" (gzip JSON):
  dataset, split, method, run, stage, checkpoint, class_names (index -> class name), kind, row_format, pages.
  kind "tile_candidates": rows [x1, y1, x2, y2, score, class_index, owned_by_center, touches_interior_tile_edge],
      all candidates of tiled inference before ownership filtering and suppression (YOLOv8L branch).
  kind "page": rows [x1, y1, x2, y2, score, class_index] in page coordinates: the raw predictions of all strips
      (or of the whole page) before suppression (RF-DETR branch).
Coordinates are float xyxy in original page pixels; row order is the order the model produced.
"""
from .common import read_json, write_json
from . import merge

FORMAT = 'symbol-predictions-v1'
TILE_ROW = ['x1', 'y1', 'x2', 'y2', 'score', 'class_index', 'owned_by_center', 'touches_interior_tile_edge']
PAGE_ROW = ['x1', 'y1', 'x2', 'y2', 'score', 'class_index']


def write_predictions(path, *, dataset, split, method, run, stage, checkpoint, class_names, kind, pages):
    assert kind in ('tile_candidates', 'page')
    write_json(path, {'format': FORMAT, 'dataset': dataset, 'split': split, 'method': method, 'run': run,
                      'stage': stage, 'checkpoint': checkpoint, 'class_names': list(class_names), 'kind': kind,
                      'row_format': TILE_ROW if kind == 'tile_candidates' else PAGE_ROW, 'pages': pages}, indent=None)


def read_predictions(path):
    data = read_json(path)
    assert data.get('format') == FORMAT, f'{path}: not a {FORMAT} file'
    return data


def rows(data, names):
    """Page rows as dicts with category_id taken from the evaluation vocabulary names {id: name}."""
    ids = {name: cid for cid, name in names.items()}
    classes = data['class_names']
    out = {}
    for pid, page_rows in data['pages'].items():
        converted = []
        for r in page_rows:
            name = classes[int(r[5])]
            row = {'box': [float(v) for v in r[:4]], 'score': float(r[4]), 'class_name': name, 'category_id': ids[name]}
            if data['kind'] == 'tile_candidates':
                row.update(owned_by_center=bool(r[6]), touches_interior_tile_edge=bool(r[7]))
            converted.append(row)
        out[pid] = converted
    return out


def merged_predictions(split, files, rule=merge.MERGE_RULE):
    """Page predictions of YOLOv8L + RF-DETR: files = (YOLOv8L tile candidates, RF-DETR branch page rows)."""
    names, pages, truth = split['names'], split['pages'], split['truth']
    loaded = [rows(read_predictions(f), names) for f in files]
    for page_rows in loaded:
        assert set(page_rows) == set(truth), 'prediction pages differ from the evaluation pages'
    small, large = loaded
    return {p: merge.merge_page(small[p], large[p], pages[p], rule) for p in truth}
