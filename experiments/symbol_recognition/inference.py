"""Page-level symbol detection with YOLOv8L + RF-DETR.

    from inference import detect_symbols
    M = '../../models/symbol_recognition/'
    symbols = detect_symbols('page.jpg', M + 'yolov8l/HandSchA_seed20261021.pt', M + 'rfdetr_branch/HandSchA_seed43.pth', class_names)

YOLOv8L runs on overlapping tiles and RF-DETR on overlapping full-width strips; the two outputs are merged with
symbolrec/merge.py.

class_names: the YOLOv8L vocabulary in model index order (data/categories.json for HandSchA). The RF-DETR class
names, read from its checkpoint, must be a subset.
region: optional (left, top, right, bottom) in page pixels; only that region is searched.
score_threshold: optional minimum confidence of the returned boxes.

Returns a list of dicts: class_name, left, top, width, height, score (page pixels), in descending confidence order.
"""
from pathlib import Path

from symbolrec import branches, merge


def _rfdetr_class_names(checkpoint):
    import torch
    payload = torch.load(str(checkpoint), map_location='cpu', weights_only=False, mmap=True)
    args = payload['args']
    names = args.get('class_names') if isinstance(args, dict) else getattr(args, 'class_names', None)
    if not names:
        raise ValueError('RF-DETR checkpoint does not record its class names')
    return list(names)


def detect_symbols(image_path, yolo_weights, rfdetr_weights, class_names, region=None, score_threshold=None,
                   device='cpu', rule=merge.MERGE_RULE, rf_num_queries=300, rf_num_select=300):
    image = branches.open_rgb(image_path)
    page = {'width': image.size[0], 'height': image.size[1]}
    x0, y0 = 0, 0
    if region is not None:
        left, top, right, bottom = [int(round(v)) for v in region]
        left, top = max(0, left), max(0, top)
        right, bottom = min(page['width'], right), min(page['height'], bottom)
        if right <= left or bottom <= top:
            raise ValueError('Empty region')
        image = image.crop((left, top, right, bottom))
        x0, y0 = left, top
    ids = {name: i for i, name in enumerate(class_names)}

    yolo = branches.load_yolo(yolo_weights)
    yolo_names = [yolo.names[i] for i in range(len(yolo.names))]
    if yolo_names != list(class_names):
        raise ValueError('class_names must be the YOLOv8L class order')
    small = []
    for r in branches.yolo_candidates(yolo, image, device=device, page_float32=True):
        name = class_names[r['class_index']]
        small.append(dict(r, box=_shift(r['box'], x0, y0), class_name=name, category_id=ids[name]))

    rf_names = _rfdetr_class_names(rfdetr_weights)
    unknown = sorted(set(rf_names) - set(class_names))
    if unknown:
        raise ValueError(f'RF-DETR classes not in class_names: {unknown}')
    rf = branches.load_rfdetr(rfdetr_weights, len(rf_names), rf_num_queries, rf_num_select, device=device)
    large = []
    for r in branches.rfdetr_candidates(rf, image, len(rf_names), strips=True):
        name = rf_names[r['class_index']]
        large.append(dict(r, box=_shift(r['box'], x0, y0), class_name=name, category_id=ids[name]))

    rows = merge.merge_page(small, large, page, rule)
    out = []
    for r in rows:
        if score_threshold is not None and r['score'] < score_threshold:
            continue
        l, t, rr, b = r['box']
        out.append({'class_name': r['class_name'], 'left': l, 'top': t, 'width': rr - l, 'height': b - t, 'score': r['score']})
    return out


def _shift(box, x0, y0):
    if not x0 and not y0:
        return box
    return [box[0] + x0, box[1] + y0, box[2] + x0, box[3] + y0]


def main():
    import argparse
    import json
    from symbolrec.common import read_json
    parser = argparse.ArgumentParser(description='Detect symbols on one page image; prints JSON.')
    parser.add_argument('image')
    parser.add_argument('--yolo', required=True, help='YOLOv8L weights (.pt)')
    parser.add_argument('--rfdetr', required=True, help='RF-DETR branch checkpoint (.pth)')
    parser.add_argument('--categories', default=str(Path(__file__).resolve().parent / 'data' / 'categories.json'),
                        help='categories.json of the YOLOv8L vocabulary ([{id, name}]; default data/categories.json)')
    parser.add_argument('--region', type=float, nargs=4, metavar=('LEFT', 'TOP', 'RIGHT', 'BOTTOM'))
    parser.add_argument('--score-threshold', type=float)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    names = [c['name'] for c in sorted(read_json(args.categories), key=lambda c: c['id'])]
    result = detect_symbols(args.image, args.yolo, args.rfdetr, names, args.region, args.score_threshold, args.device)
    text = json.dumps(result, indent=1)
    if args.out:
        args.out.write_text(text + '\n')
    else:
        print(text)


if __name__ == '__main__':
    main()
