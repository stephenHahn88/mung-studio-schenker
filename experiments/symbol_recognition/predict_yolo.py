"""YOLOv8L tile candidates for the pages of one stage, written as a prediction file (kind "tile_candidates").

usage:
  python predict_yolo.py --dataset HandSchA --weights runs/yolo_seed20261021/fit/weights/best.pt --stage test \
      --run seed20261021 --out pred/yolov8l/HandSchA_seed20261021_test.json.gz
"""
import argparse
from pathlib import Path

from symbolrec import branches
from symbolrec.common import read_json
from symbolrec.predictions import write_predictions

DATA = Path(__file__).resolve().parent / 'data'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dataset', choices=['HandSchA', 'MUSCIMA++'], required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--coco', type=Path, default=Path('work/coco'), help='output folder of make_coco.py (default work/coco)')
    parser.add_argument('--images-root', type=Path, default=DATA, help='folder that image file names are relative to (default data/)')
    parser.add_argument('--stage', choices=['val', 'test'], required=True)
    parser.add_argument('--split', help='split name stored in the prediction file (optional)')
    parser.add_argument('--run', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--device', default='0')
    args = parser.parse_args()
    coco = read_json(args.coco / f'{args.stage}.coco.json')
    names = [c['name'] for c in sorted(coco['categories'], key=lambda c: c['id'])]
    model = branches.load_yolo(args.weights)
    if [model.names[i] for i in range(len(model.names))] != names:
        raise SystemExit('Model class order differs from the categories')
    pages = {}
    for im in coco['images']:
        image = branches.open_rgb(args.images_root / im['file_name'])
        rows = branches.yolo_candidates(model, image, args.device, page_float32=args.dataset == 'HandSchA')
        pages[str(im['page_id'])] = branches.as_file_rows(rows, tiles=True)
        print(im['page_id'], len(rows), flush=True)
    write_predictions(args.out, dataset=args.dataset, split=args.split, method='yolov8l', run=args.run, stage=args.stage,
                      checkpoint=args.weights.name, class_names=names, kind='tile_candidates', pages=pages)


if __name__ == '__main__':
    main()
