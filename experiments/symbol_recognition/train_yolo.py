"""Train the YOLOv8L branch on prepared tiles (Ultralytics 8.4.18; settings in configs/yolov8l.json).

The validation metric is Ultralytics' mAP50:95 on the validation tiles. Training stops after `patience` epochs
(15 on HandSchA, 20 on MUSCIMA++) without an improvement of at least 0.001, or after 120 epochs; best.pt holds the
epoch with the highest validation mAP50:95.

usage:
  python train_yolo.py --dataset HandSchA --tiles work/tiles --init work/yolov8l_coco_handscha128.pt --seed 20261021 \
      --out runs/yolo_seed20261021
  python train_yolo.py --dataset HandSchA --tiles work/tiles --init work/yolov8l_coco_handscha128.pt --seed 20261104 \
      --dataloader-rank 20261104 --out runs/yolo_seed20261104
  python train_yolo.py --dataset MUSCIMA++ --tiles work/tiles/M_seed20261027 --init yolov8l.pt --seed 20261027 --out runs/yolo_M_seed20261027
"""
import argparse
import json
import math
import os
from pathlib import Path

from symbolrec import patches
from symbolrec.common import read_json

CONFIG = Path(__file__).resolve().parent / 'configs/yolov8l.json'


class MinDeltaEarlyStopping:
    def __init__(self, patience, min_delta=.001):
        self.patience, self.min_delta = patience, min_delta
        self.best_fitness, self.best_epoch, self.possible_stop = float('-inf'), 0, False

    def __call__(self, epoch, fitness):
        if fitness is None:
            return False
        if not math.isfinite(float(fitness)):
            raise FloatingPointError('Non-finite validation fitness')
        if float(fitness) > self.best_fitness + self.min_delta:
            self.best_fitness, self.best_epoch = float(fitness), epoch
        elapsed = epoch - self.best_epoch
        self.possible_stop = elapsed >= self.patience - 1
        return elapsed >= self.patience


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dataset', choices=['HandSchA', 'MUSCIMA++'], required=True)
    parser.add_argument('--tiles', type=Path, required=True, help='output folder of prepare_yolo.py')
    parser.add_argument('--init', type=Path, required=True, help='init_yolo.py output (HandSchA) or yolov8l.pt (MUSCIMA++)')
    parser.add_argument('--seed', type=int, required=True)
    parser.add_argument('--dataloader-rank', type=int, help='set ultralytics.data.build.RANK (second-seed runs: 20261104)')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--device', default='0')
    parser.add_argument('--epochs', type=int, help='override the 120-epoch limit (short checks only)')
    args = parser.parse_args()
    config = read_json(CONFIG)
    dataset = config['datasets'][args.dataset]
    os.environ.setdefault('YOLO_OFFLINE', 'true')
    import ultralytics
    from ultralytics import YOLO
    from ultralytics.models.yolo.detect import DetectionTrainer
    import ultralytics.engine.trainer as trainer_module
    if ultralytics.__version__ != '8.4.18':
        raise SystemExit('Ultralytics 8.4.18 required')
    if args.dataloader_rank is not None:
        patches.seed_dataloader_rank(args.dataloader_rank)
    patches.disable_label_cache()
    trainer_module.check_amp = lambda model: True  # skip the AMP self-test download
    history = []

    class ValidationTrainer(DetectionTrainer):
        def validate(self):
            metrics = self.validator(self)
            metrics.pop('fitness', None)
            fitness = float(metrics['metrics/mAP50-95(B)'])
            if self.best_fitness is None or fitness > self.best_fitness:
                self.best_fitness = fitness
            return metrics, fitness

    def on_train_start(trainer):
        patches.fp32_detection_criterion()
        trainer.stopper = MinDeltaEarlyStopping(dataset['patience'], .001)

    def on_fit_epoch_end(trainer):
        history.append({'epoch': trainer.epoch + 1, 'fitness': float(trainer.fitness)})
        (args.out / 'history.json').write_text(json.dumps(history, indent=1))

    model = YOLO(str(args.init))
    model.add_callback('on_train_start', on_train_start)
    model.add_callback('on_fit_epoch_end', on_fit_epoch_end)
    kwargs = dict(config['train_arguments'], data=str(args.tiles / 'dataset.yaml'), seed=args.seed, patience=dataset['patience'],
                  workers=dataset['workers'], device=args.device, project=str(args.out.resolve()), name='fit', exist_ok=False)
    if args.epochs:
        kwargs['epochs'] = args.epochs
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'train_arguments.json').write_text(json.dumps({**kwargs, 'dataloader_rank': args.dataloader_rank}, indent=1))
    model.train(trainer=ValidationTrainer, **kwargs)
    best = max(history, key=lambda row: (row['fitness'], row['epoch']))
    (args.out / 'done.json').write_text(json.dumps({'checkpoint': str(args.out / 'fit/weights/best.pt'), 'best_epoch': best['epoch'],
                                                    'best_val_tiled_map5095': best['fitness'], 'epochs_run': len(history)}, indent=1))


if __name__ == '__main__':
    main()
