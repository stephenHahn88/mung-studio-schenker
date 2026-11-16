"""Page inference of the two branches, producing the rows that merge.py and the prediction files use.

YOLOv8L: every 1216 x 1216 tile (black padding beyond the page) is predicted with confidence floor 0.001, within-tile
class-aware NMS at IoU 0.7 and at most 3000 boxes per tile. Rows keep all candidates with their ownership and
interior-edge flags. page_float32=True adds the tile offset in float32 before conversion to Python floats.

RF-DETR: each full-width strip (or the whole page) is resized to 2048 x 2048 and predicted with confidence floor
0.001. Boxes are translated back to the page, and the predictions of all strips are pooled.
"""
import math

from PIL import Image

from .common import symbol_size
from .geometry import PATCH, owned, responsibility_bounds, strip_boxes, tile_positions, touches_interior_tile_edge

YOLO_FLOOR, YOLO_TILE_NMS_IOU, YOLO_MAX_DET = 0.001, 0.7, 3000
RF_RESOLUTION, RF_FLOOR = 2048, 0.001


def load_yolo(weights):
    from ultralytics import YOLO
    model = YOLO(str(weights))
    model.overrides['max_det'] = YOLO_MAX_DET
    model.overrides['iou'] = YOLO_TILE_NMS_IOU
    return model


def yolo_candidates(model, image, device='cpu', page_float32=True):
    """Tile candidates of one RGB page image: dicts with box, score, class_index, owned_by_center, touches_interior_tile_edge."""
    width, height = image.size
    xs, ys = tile_positions(width), tile_positions(height)
    xb, yb = responsibility_bounds(xs, width), responsibility_bounds(ys, height)
    rows = []
    for xi, x0 in enumerate(xs):
        for yi, y0 in enumerate(ys):
            tile = image.crop((x0, y0, x0 + PATCH, y0 + PATCH))
            result = model.predict(tile, imgsz=PATCH, conf=YOLO_FLOOR, iou=YOLO_TILE_NMS_IOU, max_det=YOLO_MAX_DET,
                                   agnostic_nms=False, device=device, verbose=False)[0]
            boxes = result.boxes.xyxy.cpu().numpy()
            scores = result.boxes.conf.cpu().numpy()
            classes = result.boxes.cls.cpu().numpy().astype(int)
            for box, score, cls in zip(boxes, scores, classes):
                if page_float32:
                    left, top, right, bottom = box
                    shifted = [left + x0, top + y0, right + x0, bottom + y0]  # float32 arithmetic
                    cx, cy = (shifted[0] + shifted[2]) / 2, (shifted[1] + shifted[3]) / 2
                    page = [float(v) for v in shifted]
                else:
                    left, top, right, bottom = map(float, box)
                    page = [left + x0, top + y0, right + x0, bottom + y0]
                    cx, cy = (page[0] + page[2]) / 2, (page[1] + page[3]) / 2
                if not all(math.isfinite(v) for v in [*page, float(score)]):
                    raise RuntimeError('Nonfinite prediction')
                rows.append({'box': page, 'score': float(score), 'class_index': int(cls),
                             'owned_by_center': bool(owned(cx, xb, xi) and owned(cy, yb, yi)),
                             'touches_interior_tile_edge': touches_interior_tile_edge((left, top, right, bottom), x0, y0, width, height)})
    return rows


def load_rfdetr(checkpoint, num_classes, num_queries, num_select, group_detr=None, device='cpu'):
    from rfdetr import RFDETRMedium
    kwargs = dict(pretrain_weights=str(checkpoint), resolution=RF_RESOLUTION, num_classes=num_classes,
                  num_queries=num_queries, num_select=num_select, device=device)
    if group_detr is not None:
        kwargs['group_detr'] = group_detr
    return RFDETRMedium(**kwargs)


def rfdetr_candidates(model, image, num_classes, strips=True, min_size=None):
    """Raw RF-DETR rows of one RGB page image: dicts with box, score, class_index (strip predictions pooled).

    min_size: if given, keep only boxes with L > min_size.
    """
    width, height = image.size
    crops = strip_boxes(width, height) if strips else [(0, 0, width, height)]
    rows = []
    for crop in crops:
        view = image.crop(crop) if strips else image
        pred = model.predict(view.convert('RGB'), threshold=RF_FLOOR, shape=(RF_RESOLUTION, RF_RESOLUTION),
                             include_source_image=False)
        for box, score, cid in zip(pred.xyxy.tolist(), pred.confidence.tolist(), pred.class_id.tolist()):
            cid, score, box = int(cid), float(score), [float(v) for v in box]
            if cid >= num_classes or box[2] <= box[0] or box[3] <= box[1]:
                continue  # background slot or degenerate box
            page = [box[0] + crop[0], box[1] + crop[1], box[2] + crop[0], box[3] + crop[1]]
            if min_size is not None and symbol_size(page, width, height) <= min_size:
                continue
            rows.append({'box': page, 'score': score, 'class_index': cid})
    return rows


def open_rgb(path):
    with Image.open(path) as source:
        return source.convert('RGB')


def as_file_rows(rows, tiles):
    """Rows in the prediction-file layout (see predictions.py)."""
    if tiles:
        return [[*r['box'], r['score'], r['class_index'], r['owned_by_center'], r['touches_interior_tile_edge']] for r in rows]
    return [[*r['box'], r['score'], r['class_index']] for r in rows]

