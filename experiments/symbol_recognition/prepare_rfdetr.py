"""RF-DETR training data (roboflow COCO layout: <out>/train and <out>/valid, each with _annotations.coco.json).

Targets are the symbols with L > 200. The branch learns every class that has at least one such target on the
training pages; the class list (model index order) is written to <out>/classes.json.

--mode strips   HandSchA: full-width strips of height 768 (stride 384); a symbol is a target of a strip when at
                least 90% of its area is visible in it (the box is clipped to the strip).
--mode pages    MUSCIMA++: whole pages; category ids of the source are kept.

usage:
  python prepare_rfdetr.py --mode strips --out work/rf_branch       # work/coco from make_coco.py, images in data/
  python prepare_rfdetr.py --mode pages --coco work/muscima_coco --images-root work/muscima_coco --out work/rf_branch/M
"""
import argparse
import collections
import json
import math
from pathlib import Path

from symbolrec.common import read_json, symbol_size, write_json
from symbolrec.geometry import MIN_VISIBILITY, clipped_xywh, strip_boxes

DATA = Path(__file__).resolve().parent / 'data'

LARGE = 200
MAX_TARGETS = 300  # queries of the HandSchA branch


def link(target, source, enabled=True):
    if enabled and not target.exists():
        target.symlink_to(Path(source).resolve())


def large_annotations(coco):
    """{page_id: [annotation with L > 200, in file order]} and {page_id: image}."""
    images = {im['id']: im for im in coco['images']}
    by_page = collections.defaultdict(list)
    for a in coco['annotations']:
        im = images[a['image_id']]
        x, y, w, h = a['bbox']
        box = [x, y, x + w, y + h]
        if symbol_size(box, im['width'], im['height']) > LARGE:
            by_page[str(im['page_id'])].append(dict(a, bbox=[box[0], box[1], box[2] - box[0], box[3] - box[1]]))
    return by_page, {str(im['page_id']): im for im in coco['images']}


def visible_targets(annotations, crop):
    """(annotation, crop-local xywh) of the annotations with at least 90% of their area inside the crop."""
    out = []
    for a in annotations:
        box, visible = clipped_xywh(a['bbox'], crop)
        if box is not None and visible + 1e-12 >= MIN_VISIBILITY:
            out.append((a, box))
    return out


def strip_classes(coco):
    """Category ids that have at least one strip target on the given pages."""
    by_page, page_of = large_annotations(coco)
    found = set()
    for pid, annotations in by_page.items():
        im = page_of[pid]
        for crop in strip_boxes(im['width'], im['height']):
            found.update(a['category_id'] for a, _ in visible_targets(annotations, crop))
    return found


def strips(coco, index, folder, images_root, write_images=True):
    """Strip images and their targets of one partition; index maps category id -> class index."""
    from PIL import Image
    by_page, page_of = large_annotations(coco)
    out = {'images': [], 'annotations': []}
    max_targets = 0
    for pid in sorted(page_of):
        im = page_of[pid]
        width, height = im['width'], im['height']
        annotations = [a for a in by_page[pid] if a['category_id'] in index]
        if len(annotations) > MAX_TARGETS:
            raise RuntimeError(f'More than {MAX_TARGETS} targets on page {pid}')
        original = None
        if write_images:
            with Image.open(images_root / im['file_name']) as source:
                original = source.convert('RGB')
            if original.size != (width, height):
                raise RuntimeError(f'Image size differs: {pid}')
        for crop in strip_boxes(width, height):
            name = f'{pid}__y{crop[1]:05d}.png'
            if original is not None and not (folder / name).exists():
                original.crop(crop).save(folder / name)
            image_id = len(out['images']) + 1
            out['images'].append({'id': image_id, 'file_name': name, 'width': crop[2] - crop[0], 'height': crop[3] - crop[1],
                                  'page_id': pid, 'y_origin': crop[1]})
            targets = visible_targets(annotations, crop)
            for a, box in targets:
                out['annotations'].append({'id': len(out['annotations']) + 1, 'image_id': image_id,
                                           'category_id': index[a['category_id']], 'bbox': box, 'area': box[2] * box[3],
                                           'iscrowd': 0, 'segmentation': []})
            max_targets = max(max_targets, len(targets))
    return out, max_targets


def pages(coco, selected, folder, images_root, write_links=True):
    """Whole pages and their targets of one partition (source category ids)."""
    images = {im['id']: im for im in coco['images']}
    result = {'images': [], 'annotations': []}
    for im in coco['images']:
        name = f'{int(im["id"]):09d}{Path(im["file_name"]).suffix.lower()}'
        link(folder / name, images_root / im['file_name'], write_links)
        result['images'].append({'id': im['id'], 'file_name': name, 'width': im['width'], 'height': im['height'], 'page_id': im['page_id']})
    per_image = collections.Counter()
    for a in coco['annotations']:  # source order
        im = images[a['image_id']]
        w, h = a['bbox'][2], a['bbox'][3]
        if a['category_id'] in selected and max(w * 5100 / im['width'], h * 3509 / im['height']) > LARGE:
            result['annotations'].append({**a, 'iscrowd': a.get('iscrowd', 0), 'area': a.get('area', w * h)})
            per_image[a['image_id']] += 1
    return result, max(per_image.values(), default=0)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--mode', choices=['strips', 'pages'], required=True)
    parser.add_argument('--coco', type=Path, default=Path('work/coco'), help='output folder of make_coco.py (default work/coco)')
    parser.add_argument('--images-root', type=Path, default=DATA, help='folder that image file names are relative to (default data/)')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--labels-only', action='store_true', help='write annotation files but no strip images or links')
    args = parser.parse_args()
    out = args.out.resolve()
    sources = {'train': read_json(args.coco / 'train.coco.json'), 'valid': read_json(args.coco / 'val.coco.json')}
    categories = sorted(sources['train']['categories'], key=lambda c: c['id'])
    if args.mode == 'strips':
        found = strip_classes(sources['train'])
        selected = [c['id'] for c in categories if c['id'] in found]
        index = {cid: i for i, cid in enumerate(selected)}
        out_categories = [{'id': i, 'name': c['name'], 'supercategory': 'symbol'}
                          for i, c in enumerate(c for c in categories if c['id'] in found)]
    else:
        train_images = {im['id']: im for im in sources['train']['images']}
        found = {a['category_id'] for a in sources['train']['annotations']
                 if max(a['bbox'][2] * 5100 / train_images[a['image_id']]['width'],
                        a['bbox'][3] * 3509 / train_images[a['image_id']]['height']) > LARGE}
        selected = [c['id'] for c in categories if c['id'] in found]
        out_categories = [{'id': c['id'], 'name': c['name'], 'supercategory': 'symbol'} for c in categories if c['id'] in found]
    names = [c['name'] for c in out_categories]
    summary = {'mode': args.mode, 'class_names': names}
    for part, coco in sources.items():
        folder = out / part
        folder.mkdir(parents=True, exist_ok=True)
        if args.mode == 'strips':
            result, max_targets = strips(coco, index, folder, args.images_root, not args.labels_only)
        else:
            result, max_targets = pages(coco, set(selected), folder, args.images_root, not args.labels_only)
        result['categories'] = out_categories
        result.update(info={}, licenses=[])
        write_json(folder / '_annotations.coco.json', result, indent=None)
        summary[part] = {'images': len(result['images']), 'annotations': len(result['annotations']), 'max_targets_per_view': max_targets}
    if args.mode == 'pages':
        summary['num_queries'] = max(300, math.ceil(1.25 * summary['train']['max_targets_per_view'] / 256) * 256)
    write_json(out / 'classes.json', names)
    write_json(out / 'prepared.json', summary)
    print(json.dumps({k: v for k, v in summary.items() if k != 'class_names'} | {'classes': len(names)}))


if __name__ == '__main__':
    main()
