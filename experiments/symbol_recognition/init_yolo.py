"""COCO-initialized YOLOv8L with a new class head for the HandSchA classes.

Tensors of the official Ultralytics COCO yolov8l.pt are copied where the shapes match; the final classification
convolutions are newly initialized. MUSCIMA++ training starts from yolov8l.pt directly.

usage: python init_yolo.py --coco yolov8l.pt --out work/yolov8l_coco_handscha128.pt
"""
import argparse
import copy
import json
from pathlib import Path

from symbolrec.common import read_json, sha256

DATA = Path(__file__).resolve().parent / 'data'

COCO_SHA256 = '64c9115303f6a25575f82200d1b22ec409fa6bd7d08d0313884fc20d919478cd'
HEAD_SEED = 20261021


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--coco', type=Path, required=True)
    parser.add_argument('--categories', type=Path, default=DATA / 'categories.json', help='[{id, name}] of the target vocabulary')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if sha256(args.coco) != COCO_SHA256:
        raise SystemExit('Not the official COCO YOLOv8L checkpoint')
    import torch
    from ultralytics import YOLO
    from ultralytics.nn.tasks import DetectionModel
    names = [c['name'] for c in sorted(read_json(args.categories), key=lambda c: c['id'])]
    wrapper = YOLO(str(args.coco))
    source = wrapper.model.float()
    yaml = copy.deepcopy(source.yaml)
    yaml.update(nc=len(names), reg_max=16, end2end=False)
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(HEAD_SEED)
        target = DetectionModel(yaml, nc=len(names), ch=3, verbose=False)
    target.load(source)
    target.names = dict(enumerate(names))
    target.args = copy.deepcopy(source.args)
    unmatched = [k for k, v in source.state_dict().items() if k not in target.state_dict() or v.shape != target.state_dict()[k].shape]
    assert set(unmatched) == {f'model.22.cv3.{s}.2.{kind}' for s in range(3) for kind in ('weight', 'bias')}, unmatched
    target.nc = len(names)
    wrapper.model = target
    args.out.parent.mkdir(parents=True, exist_ok=True)
    wrapper.save(args.out)
    print(json.dumps({'out': str(args.out), 'classes': len(names), 'fresh_tensors': sorted(unmatched)}))


if __name__ == '__main__':
    main()
