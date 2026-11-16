"""Score one set of YOLOv8L + RF-DETR test predictions with the eight symbol-detection metrics.

The two prediction files (written by predict_yolo.py and predict_rfdetr.py) are merged with symbolrec/merge.py and
compared with the ground truth of the test pages of the split.

Example (HandSchA, split of data/split.json; work/coco written by make_coco.py, ignore regions from data/):
  python score.py --files pred/yolov8l/HandSchA_seed20261021_test.json.gz pred/rfdetr_branch/HandSchA_seed42_test.json.gz \
      --out out/run1.json
For MUSCIMA++ pass --coco <output of muscima/convert_muscima.py>.
"""
import argparse
import json
from pathlib import Path

from symbolrec.data import load_split
from symbolrec.metrics import COLUMNS, table_metrics
from symbolrec.predictions import merged_predictions

DATA = Path(__file__).resolve().parent / 'data'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--files', nargs=2, required=True, metavar=('YOLOV8L', 'RFDETR'),
                        help='YOLOv8L tile candidates, then RF-DETR branch predictions')
    parser.add_argument('--coco', default='work/coco', help='folder with test.coco.json of the split (default work/coco)')
    parser.add_argument('--dataset-root', default=str(DATA),
                        help='folder with ignore_regions.json (default data/; MUSCIMA++ pages have no ignore regions)')
    parser.add_argument('--stage', default='test')
    parser.add_argument('--out', type=Path, help='also write the values to this JSON file (input of aggregate.py)')
    args = parser.parse_args()
    split = load_split(args.coco, args.stage, args.dataset_root)
    values = dict(zip(COLUMNS, table_metrics(merged_predictions(split, args.files), split)))
    text = json.dumps(values, indent=1)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + '\n')
    print(text)


if __name__ == '__main__':
    main()
