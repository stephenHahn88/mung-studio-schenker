"""YOLOv8L training and validation tiles (Table XI: 1216 x 1216 tiles, stride 960, fully contained targets).

Every training and validation page is cut into the tiles of symbolrec/geometry.py (black padding beyond the page).
A symbol is a target of a tile only if its whole box lies inside the tile (and both sides are at least 1 pixel);
this applies to all classes, so symbols longer than a tile are never YOLOv8L targets.

Training list: each tile with at least one target is repeated by the rarest class it contains,
min(4, max(1, ceil(sqrt(64 / n)))) times, where n is the number of training-page instances of that class; empty
tiles are added up to 15% of the number of non-empty tiles; the list is shuffled. All validation tiles are used once.
The sampler is seeded with --sampler-seed (HandSchA: 20261021 for every run; MUSCIMA++: the training seed).
--dataset only selects the as-run tile naming and validation order, which affect the shuffled training order.

usage:
  python prepare_yolo.py --dataset HandSchA --out work/tiles      # work/coco from make_coco.py, images in data/
  python prepare_yolo.py --dataset MUSCIMA++ --coco work/muscima_coco --images-root work/muscima_coco --out work/tiles/M_seed20261027 --sampler-seed 20261027
"""
import argparse
import collections
import json
import math
import random
from pathlib import Path

from symbolrec.common import read_json, write_json
from symbolrec.geometry import PATCH, STEP, tile_positions

DATA = Path(__file__).resolve().parent / 'data'


def tile_targets(annotations, x0, y0, class_index):
    """YOLO label lines and class indices of the fully contained targets of one tile."""
    lines, classes = [], []
    for a in annotations:
        left, top, w, h = a['bbox']
        right, bottom = left + w, top + h
        cl, ct, cr, cb = max(left, x0), max(top, y0), min(right, x0 + PATCH), min(bottom, y0 + PATCH)
        cw, ch = cr - cl, cb - ct
        if min(cw, ch) < 1 or cw * ch / (w * h) + 1e-12 < .5:
            continue
        if not (left >= x0 and top >= y0 and right <= x0 + PATCH and bottom <= y0 + PATCH):
            continue
        cls = class_index[a['category_id']]
        values = [((cl + cr) / 2 - x0) / PATCH, ((ct + cb) / 2 - y0) / PATCH, cw / PATCH, ch / PATCH]
        if not all(0 <= v <= 1 for v in values):
            raise RuntimeError('Invalid normalized tile box')
        lines.append(f'{cls} ' + ' '.join(f'{v:.8f}' for v in values))
        classes.append(cls)
    return lines, classes


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dataset', choices=['HandSchA', 'MUSCIMA++'], required=True)
    parser.add_argument('--coco', type=Path, default=Path('work/coco'), help='output folder of make_coco.py (default work/coco)')
    parser.add_argument('--images-root', type=Path, default=DATA, help='folder that image file names are relative to (default data/)')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--sampler-seed', type=int, default=20261021)
    parser.add_argument('--labels-only', action='store_true', help='write labels and lists but no tile images')
    args = parser.parse_args()
    out = args.out.resolve()
    (out / 'images').mkdir(parents=True, exist_ok=True); (out / 'labels').mkdir(exist_ok=True)
    train, val = read_json(args.coco / 'train.coco.json'), read_json(args.coco / 'val.coco.json')
    categories = sorted(train['categories'], key=lambda c: c['id'])
    names = [c['name'] for c in categories]
    class_index = {c['id']: i for i, c in enumerate(categories)}
    counts = collections.Counter(a['category_id'] for a in train['annotations'])
    padded = args.dataset == 'HandSchA'
    tiles = []
    from PIL import Image
    for stage, coco in (('train', train), ('val', val)):
        by_image = collections.defaultdict(list)
        for a in coco['annotations']:
            by_image[a['image_id']].append(a)
        for im in sorted(coco['images'], key=lambda im: str(im['page_id'])):
            pid = str(im['page_id'])
            image = None
            if not args.labels_only:
                with Image.open(args.images_root / im['file_name']) as source:
                    image = source.convert('RGB')
                if image.size != (im['width'], im['height']):
                    raise RuntimeError(f'Image size differs: {pid}')
            for xi, x0 in enumerate(tile_positions(im['width'])):
                for yi, y0 in enumerate(tile_positions(im['height'])):
                    tile_id = f'{pid}__x{xi:02d}_{x0}__y{yi:02d}_{y0}' if padded else f'{pid}__x{xi}_{x0}__y{yi}_{y0}'
                    lines, classes = tile_targets(by_image[im['id']], x0, y0, class_index)
                    image_path = out / 'images' / f'{tile_id}.png'
                    if image is not None:
                        image.crop((x0, y0, x0 + PATCH, y0 + PATCH)).save(image_path)
                    (out / 'labels' / f'{tile_id}.txt').write_text('\n'.join(lines) + ('\n' if lines else ''))
                    tiles.append({'tile_id': tile_id, 'page_id': pid, 'stage': stage, 'image': str(image_path),
                                  'origin': [x0, y0], 'class_ids': sorted(set(classes)), 'labels': len(lines)})
    train_tiles = [t for t in tiles if t['stage'] == 'train']
    positives = sorted([t for t in train_tiles if t['labels']], key=lambda t: t['tile_id'])
    negatives = sorted([t for t in train_tiles if not t['labels']], key=lambda t: t['tile_id'])
    rng = random.Random(args.sampler_seed)
    rng.shuffle(negatives)
    negatives = negatives[:math.ceil(len(positives) * .15)]
    entries = []
    for tile in positives:
        tile['repeats'] = max(min(4, max(1, math.ceil(math.sqrt(64 / max(1, counts[categories[c]['id']])))))
                              for c in tile['class_ids'])
        entries += [tile['image']] * tile['repeats']
    entries += [t['image'] for t in negatives]
    rng.shuffle(entries)
    val_tiles = [t for t in tiles if t['stage'] == 'val']
    if padded:
        val_tiles = sorted(val_tiles, key=lambda t: t['tile_id'])
    val_entries = [t['image'] for t in val_tiles]
    (out / 'train.txt').write_text('\n'.join(entries) + '\n')
    (out / 'val.txt').write_text('\n'.join(val_entries) + '\n')
    (out / 'dataset.yaml').write_text(json.dumps({'path': str(out), 'train': str(out / 'train.txt'), 'val': str(out / 'val.txt'),
                                                  'names': names, 'nc': len(names)}, indent=1) + '\n')
    write_json(out / 'tiles.json', {'dataset': args.dataset, 'sampler_seed': args.sampler_seed, 'tile': PATCH, 'stride': STEP,
                                    'train_entries': len(entries), 'val_entries': len(val_entries),
                                    'train_positive_tiles': len(positives), 'train_empty_tiles': len(negatives), 'tiles': tiles})
    print(json.dumps({'out': str(out), 'train_entries': len(entries), 'val_entries': len(val_entries)}))


if __name__ == '__main__':
    main()
