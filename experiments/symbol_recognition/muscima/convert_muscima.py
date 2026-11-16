"""MUSCIMA++ v2.0 in the 73-class protocol and the 84/28/28-page split of completeOMR, as per-split COCO files.

Inputs:
  --muscima    folder with v2.0/data/annotations/*.xml and v2.0/specifications/mff-muscima-mlclasses-annot.xml
               (https://github.com/OMR-Research/muscima-pp/releases/download/v2.0/MUSCIMA-pp_v2.0.zip) and
               datasets_r_staff/images/*.png (staff-removed CVC-MUSCIMA pages, as distributed for completeOMR)
  --split      muscima/completeomr_split.json: the train/val/test page lists of completeOMR's splits/mob_split.yaml
               (https://github.com/guang-yng/completeOMR, commit 771e52f94091f98e979122ba3051cd5921d1c0fe)
  --classes    muscima/completeomr_classes.json: CLASS_LIST_ESSN of completeOMR's utils/constants.py (same commit)
Output: <out>/{train,val,test}.coco.json, categories.json and images/ (links to the page images). The 73 classes are
numbered 0..72 in the order of their MUSCIMA++ schema id; nodes of other classes are left out.

usage: python muscima/convert_muscima.py --muscima MUSCIMA++ --out work/muscima_coco
"""
import argparse
import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--muscima', type=Path, required=True)
    parser.add_argument('--split', type=Path, default=HERE / 'completeomr_split.json')
    parser.add_argument('--classes', type=Path, default=HERE / 'completeomr_classes.json')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    splits = json.loads(args.split.read_text())
    assert {k: len(v) for k, v in splits.items()} == {'train': 84, 'val': 28, 'test': 28}
    page_ids = sorted(p for pages in splits.values() for p in pages)
    schema_root = ET.parse(args.muscima / 'v2.0/specifications/mff-muscima-mlclasses-annot.xml').getroot()
    schema = {n.findtext('Name'): int(n.findtext('Id')) for n in schema_root}
    essential = json.loads(args.classes.read_text())
    assert len(set(essential)) == 73 and set(essential) <= set(schema)
    names = sorted(essential, key=lambda name: schema[name])
    categories = [{'id': i, 'name': n, 'source_native_id': schema[n]} for i, n in enumerate(names)]
    class_id = {c['name']: c['id'] for c in categories}
    (args.out / 'images').mkdir(parents=True, exist_ok=True)
    images, boxes = {}, {}
    for image_id, page_id in enumerate(page_ids, 1):
        source = (args.muscima / 'datasets_r_staff/images' / f'{page_id}.png').resolve()
        link = args.out / 'images' / f'{page_id}.png'
        if not link.exists():
            link.symlink_to(source)
        with Image.open(source) as im:
            width, height = im.size
        root = ET.parse(args.muscima / 'v2.0/data/annotations' / f'{page_id}.xml').getroot()
        assert root.attrib['document'] == page_id
        images[page_id] = {'id': image_id, 'page_id': page_id, 'file_name': f'images/{page_id}.png', 'width': width,
                           'height': height, 'image_sha256': sha256(source)}
        boxes[page_id] = []
        for node in root.findall('Node'):
            label = node.findtext('ClassName')
            if label not in class_id:
                continue
            native_id = int(node.findtext('Id'))
            x, y, w, h = [int(node.findtext(k)) for k in ('Left', 'Top', 'Width', 'Height')]
            boxes[page_id].append({'id': image_id * 100000 + native_id, 'image_id': image_id, 'category_id': class_id[label],
                                   'bbox': [x, y, w, h], 'area': w * h, 'iscrowd': 0, 'source_node_id': native_id})
    for part in ('train', 'val', 'test'):
        coco = {'info': {'dataset': 'MUSCIMA++ v2.0', 'protocol': 'completeOMR 73 classes', 'split': part},
                'images': [images[p] for p in splits[part]], 'annotations': [b for p in splits[part] for b in boxes[p]],
                'categories': categories}
        (args.out / f'{part}.coco.json').write_text(json.dumps(coco) + '\n')
        print(part, len(coco['images']), 'pages', len(coco['annotations']), 'boxes')
    (args.out / 'categories.json').write_text(json.dumps(categories, indent=1) + '\n')


if __name__ == '__main__':
    main()
