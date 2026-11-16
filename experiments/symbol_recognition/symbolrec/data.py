"""Evaluation and training inputs from per-split COCO files.

HandSchA: the per-split files written by make_coco.py from a split file (train/val/test.coco.json, image file names
relative to the data folder). MUSCIMA++: the files written by muscima/convert_muscima.py.

Ground truth of a page = its annotated symbols (the "eligible" boxes, in file order) plus ignore regions.
Ignore regions are the HandSchA MuNG nodes whose class is empty, "unknown" or "unclassified" (29 boxes on 9
pages, data/ignore_regions.json); they are not symbols and are excluded from the 30,780 annotations. A prediction
that is not matched to a symbol but overlaps an ignore region at the IoU threshold is not counted as a false
positive. MUSCIMA++ has no ignore regions.
"""
import xml.etree.ElementTree as ET
from pathlib import Path

from .common import read_json

IGNORED_CLASS_NAMES = ('', 'unknown', 'unclassified')


def load_coco(coco_dir, stage):
    return read_json(Path(coco_dir) / f'{stage}.coco.json')


def ignore_regions(mung_path, width, height):
    regions = []
    for node in ET.parse(mung_path).getroot().iter('Node'):
        if (node.findtext('ClassName') or '').strip().lower() not in IGNORED_CLASS_NAMES:
            continue
        left, top, w, h = [float(node.findtext(key)) for key in ('Left', 'Top', 'Width', 'Height')]
        box = [max(0, left), max(0, top), min(width, left + w), min(height, top + h)]
        if box[2] > box[0] and box[3] > box[1]:
            regions.append({'box': box})
    return regions


def load_split(coco_dir, stage, dataset_root=None, mung_name='mung/symbols.xml'):
    """Return dict(names={id: name}, pages={page_id: {width, height, image}}, truth={page_id: {eligible, ignored}}).

    With dataset_root (HandSchA) image paths are resolved against dataset_root, and the ignore regions are read
    from <dataset_root>/ignore_regions.json (the data folder of this component) or, if that file does not exist,
    from <dataset_root>/pages/<page_id>/<mung_name> (the repository's dataset folder).
    """
    coco = load_coco(coco_dir, stage)
    names = {int(c['id']): c['name'] for c in coco['categories']}
    images = {im['id']: im for im in coco['images']}
    listed = None
    if dataset_root is not None and (Path(dataset_root) / 'ignore_regions.json').exists():
        listed = read_json(Path(dataset_root) / 'ignore_regions.json')['pages']
    pages, truth = {}, {}
    for im in coco['images']:
        pid = str(im['page_id'])
        image = Path(im['file_name'])
        if dataset_root is not None and not image.is_absolute():
            image = Path(dataset_root) / image
        pages[pid] = {'width': im['width'], 'height': im['height'], 'image': str(image)}
        ignored = []
        if listed is not None:
            ignored = [{'box': [float(v) for v in r['box']]} for r in listed.get(pid, [])]
        elif dataset_root is not None:
            ignored = ignore_regions(Path(dataset_root) / 'pages' / pid / mung_name, im['width'], im['height'])
        truth[pid] = {'eligible': [], 'ignored': ignored}
    for a in coco['annotations']:
        x, y, w, h = a['bbox']
        pid = str(images[a['image_id']]['page_id'])
        truth[pid]['eligible'].append({'box': [x, y, x + w, y + h], 'class_name': names[a['category_id']]})
    return {'names': names, 'pages': pages, 'truth': truth}
