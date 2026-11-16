# Symbol recognition

```
data/        HandSchA page images, symbol annotations and the split (see data/README.md)
configs/     training settings (yolov8l.json, rfdetr.json) and merge rule (merge_rule.json)
symbolrec/   shared code
muscima/     MUSCIMA++ converter with the completeOMR split and class list
*.py         the steps below
```

## Environment

Python 3.12. Run the scripts from this folder.

```bash
pip install -r requirements-yolo.txt        # YOLOv8L, scoring, MUSCIMA++ conversion
pip install -r requirements-rfdetr.txt      # RF-DETR (separate environment)
pip install -r requirements-inference.txt   # inference.py
```

## Train, predict and score

`data/split.json` lists the page ids of each partition: `{"train": [...], "val": [...], "test": [...]}`. Another
split in this format can be passed with `make_coco.py --split-file`.

```bash
python make_coco.py                         # data/split.json -> work/coco/{train,val,test}.coco.json

# YOLOv8L branch; yolov8l.pt = official Ultralytics COCO checkpoint (release v8.4.0)
python init_yolo.py --coco yolov8l.pt --out work/yolov8l_coco_handscha128.pt
python prepare_yolo.py --dataset HandSchA --out work/tiles
python train_yolo.py --dataset HandSchA --tiles work/tiles --init work/yolov8l_coco_handscha128.pt --seed 20261021 --out runs/yolo_seed20261021
python train_yolo.py --dataset HandSchA --tiles work/tiles --init work/yolov8l_coco_handscha128.pt --seed 20261104 \
    --dataloader-rank 20261104 --out runs/yolo_seed20261104
for y in 20261021 20261104; do
  python predict_yolo.py --dataset HandSchA --weights runs/yolo_seed$y/fit/weights/best.pt --stage test --run seed$y \
      --out pred/yolov8l/HandSchA_seed${y}_test.json.gz
done

# RF-DETR branch; rf-detr-medium.pth = official COCO RF-DETR Medium checkpoint
python prepare_rfdetr.py --mode strips --out work/rf_branch
python init_rfdetr.py --coco rf-detr-medium.pth --classes work/rf_branch/classes.json --layout branch --out work/rf_branch/init.pth
for r in 42 43; do
  python train_rfdetr.py --config branch_HandSchA --dataset work/rf_branch --init work/rf_branch/init.pth --seed $r --out runs/rf_seed$r
  python select_rfdetr.py --run runs/rf_seed$r          # writes runs/rf_seed$r/selection.json
done
python predict_rfdetr.py --model branch_HandSchA --checkpoint runs/rf_seed42/<checkpoint in selection.json> --stage test \
    --dataset HandSchA --run seed42 --out pred/rfdetr_branch/HandSchA_seed42_test.json.gz   # and seed 43

# Scores (eight metrics) and mean and sample SD over runs
python score.py --files pred/yolov8l/HandSchA_seed20261021_test.json.gz pred/rfdetr_branch/HandSchA_seed42_test.json.gz --out out/run1.json
python score.py --files pred/yolov8l/HandSchA_seed20261104_test.json.gz pred/rfdetr_branch/HandSchA_seed43_test.json.gz --out out/run2.json
python aggregate.py out/run1.json out/run2.json   # FILE+FILE averages several runs into one value
```

The released checkpoints (`../../models/symbol_recognition/`, see `models/README.md`) can be used in place of
`runs/...` in `predict_yolo.py --weights` and `predict_rfdetr.py --checkpoint`. Prediction files are gzip JSON
(`symbolrec/predictions.py`); `score.py` writes a JSON object with the eight metrics.

## Page-level inference

```python
import json
from inference import detect_symbols
names = [c['name'] for c in sorted(json.load(open('data/categories.json')), key=lambda c: c['id'])]
M = '../../models/symbol_recognition/'
symbols = detect_symbols('page.jpg', M + 'yolov8l/HandSchA_seed20261021.pt', M + 'rfdetr_branch/HandSchA_seed43.pth',
                         names, region=None, score_threshold=None, device='cpu')
# [{'class_name', 'left', 'top', 'width', 'height', 'score'}, ...]
```

Command line: `python inference.py page.jpg --yolo <.pt> --rfdetr <.pth> [--region L T R B] [--out result.json]`.

## MUSCIMA++

Download MUSCIMA++ v2.0 (https://github.com/OMR-Research/muscima-pp/releases/tag/v2.0) and the staff-removed
CVC-MUSCIMA images (`datasets_r_staff/images`, linked from https://github.com/guang-yng/completeOMR) into one folder.

```bash
python muscima/convert_muscima.py --muscima <folder> --out work/muscima_coco
python prepare_yolo.py --dataset MUSCIMA++ --coco work/muscima_coco --images-root work/muscima_coco --sampler-seed 20261027 --out work/tiles_M
python train_yolo.py --dataset MUSCIMA++ --tiles work/tiles_M --init yolov8l.pt --seed 20261027 --out runs/yolo_M_seed20261027
python prepare_rfdetr.py --mode pages --coco work/muscima_coco --images-root work/muscima_coco --out work/rf_M
python init_rfdetr.py --coco rf-detr-medium.pth --classes work/rf_M/classes.json --layout repack --num-queries 300 \
    --num-select 3000 --seed 20261027 --out work/rf_M/init_seed20261027.pth
python train_rfdetr.py --config branch_MUSCIMA++ --dataset work/rf_M --init work/rf_M/init_seed20261027.pth --seed 20261027 \
    --out runs/rf_M_seed20261027          # checkpoint: checkpoint_best_regular.pth
```

Second seed: 20261104 (`prepare_yolo.py --sampler-seed`, `train_yolo.py --seed` with `--dataloader-rank 20261104`,
`init_rfdetr.py --seed`, `train_rfdetr.py --seed`). Prediction: `predict_yolo.py` and `predict_rfdetr.py --model
branch_MUSCIMA++` with `--dataset MUSCIMA++ --coco work/muscima_coco --images-root work/muscima_coco`; scoring:
`score.py --coco work/muscima_coco`.
