"""Write the per-split COCO files that the training, prediction and scoring scripts read.

The split is a JSON file with three lists of page ids (data/split.json is the split of the released models):

  {"train": ["<page_id>", ...], "val": ["<page_id>", ...], "test": ["<page_id>", ...]}

For each partition P in train/val/test this writes <out>/<P>.coco.json: the images of the partition (sorted by
image id, i.e. by page id) and their annotations from data/symbols.coco.json, with annotation ids renumbered from 1
inside the file. Image file names stay relative to the data folder.

usage:
  python make_coco.py                                   # data/split.json -> work/coco
  python make_coco.py --split-file my_split.json --out work/coco_my_split
"""
import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PARTS = ('train', 'val', 'test')


def split_files(coco, pages):
    """COCO dicts for train/val/test of one split, given page-id lists."""
    image_of = {im['page_id']: im for im in coco['images']}
    by_image = {}
    for ann in coco['annotations']:
        by_image.setdefault(ann['image_id'], []).append(ann)
    files = {}
    for part in PARTS:
        images = sorted((image_of[p] for p in pages[part]), key=lambda im: im['id'])
        anns = []
        for im in images:
            for ann in by_image.get(im['id'], []):
                anns.append(dict(ann, id=len(anns) + 1))
        files[part] = {'images': images, 'annotations': anns, 'categories': coco['categories']}
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--data', type=Path, default=HERE / 'data', help='folder with symbols.coco.json')
    parser.add_argument('--split-file', type=Path, default=HERE / 'data' / 'split.json')
    parser.add_argument('--out', type=Path, default=Path('work/coco'))
    args = parser.parse_args()
    coco = json.loads((args.data / 'symbols.coco.json').read_text(encoding='utf-8'))
    pages = json.loads(args.split_file.read_text(encoding='utf-8'))
    listed = [p for part in PARTS for p in pages[part]]
    unknown = sorted(set(listed) - {im['page_id'] for im in coco['images']})
    if unknown or len(listed) != len(set(listed)):
        raise SystemExit(f'Unknown or repeated page ids in the split: {unknown}')
    args.out.mkdir(parents=True, exist_ok=True)
    for part, data in split_files(coco, pages).items():
        (args.out / f'{part}.coco.json').write_text(json.dumps(data, ensure_ascii=False) + '\n', encoding='utf-8')
        print(part, len(data['images']), 'pages', len(data['annotations']), 'symbols')


if __name__ == '__main__':
    main()
