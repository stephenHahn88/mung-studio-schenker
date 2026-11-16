"""Train RF-DETR Medium (rfdetr 1.8.3, PyTorch Lightning 2.6.5; settings in configs/rfdetr.json).

--config branch_HandSchA   branch on strips; regular-weight snapshots every 10 epochs and at the end
--config branch_MUSCIMA++  branch on whole pages; the selected checkpoint is checkpoint_best_regular.pth
Training stops after 20 epochs without an improvement of at least 0.001 in the validation mAP50:95, or after
120 epochs. The patches of symbolrec/patches.py are applied.

usage:
  python train_rfdetr.py --config branch_HandSchA --dataset work/rf_branch --init work/rf_branch/init.pth --seed 42 --out runs/rf_seed42
"""
import argparse
import json
import os
from pathlib import Path

from symbolrec import patches
from symbolrec.common import read_json

CONFIG = Path(__file__).resolve().parent / 'configs/rfdetr.json'


def snapshot_callback(out, every):
    import torch
    from pytorch_lightning import Callback

    class Snapshots(Callback):
        """Regular (non-EMA) weights every `every` epochs and after the last epoch, as snapshots/epoch_NNN.pth."""

        def __init__(self):
            self.completed, self.saved = 0, set()

        def save(self, trainer, module):
            if self.completed in self.saved:
                return
            raw = getattr(module.model, '_orig_mod', module.model)
            path = out / 'snapshots' / f'epoch_{self.completed:03d}.pth'
            path.parent.mkdir(parents=True, exist_ok=True)
            torch.save({'model': {k: v.detach().cpu() for k, v in raw.state_dict().items()},
                        'args': module.train_config.model_dump(), 'model_config': module.model_config.model_dump(),
                        'model_name': 'RFDETRMedium', 'epoch': self.completed - 1, 'global_step': int(trainer.global_step)}, path)
            self.saved.add(self.completed)

        def on_train_epoch_end(self, trainer, module):
            self.completed = int(trainer.current_epoch) + 1
            if self.completed % every == 0:
                self.save(trainer, module)

        def on_train_end(self, trainer, module):
            if self.completed:
                self.save(trainer, module)

    return Snapshots()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--config', choices=['branch_HandSchA', 'branch_MUSCIMA++'], required=True)
    parser.add_argument('--dataset', type=Path, required=True, help='output folder of prepare_rfdetr.py')
    parser.add_argument('--init', type=Path, required=True, help='output of init_rfdetr.py')
    parser.add_argument('--seed', type=int, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--smoke', action='store_true', help='one epoch of 9 micro-batches (short check only)')
    args = parser.parse_args()
    config = read_json(CONFIG)[args.config]
    names = [c['name'] for c in sorted(read_json(args.dataset / 'train/_annotations.coco.json')['categories'], key=lambda c: c['id'])]
    import torch
    from pytorch_lightning import seed_everything
    from pytorch_lightning.callbacks import ModelCheckpoint
    from rfdetr.config import RFDETRMediumConfig, TrainConfig
    from rfdetr.training import RFDETRDataModule, build_trainer
    from rfdetr.training.callbacks.best_model import BestModelCallback
    seed_everything(args.seed, workers=True)
    torch.set_num_threads(4)
    torch.set_float32_matmul_precision('high')
    args.out.mkdir(parents=True, exist_ok=False)
    model = {k: v for k, v in config['model'].items() if k != 'num_classes'}
    model_config = RFDETRMediumConfig(pretrain_weights=str(args.init), num_classes=len(names), model_name='RFDETRMedium',
                                      compile=False, **model)
    train_config = TrainConfig(dataset_dir=str(args.dataset), output_dir=str(args.out), class_names=names, seed=args.seed,
                               tensorboard=False, wandb=False, run_test=False, accelerator='gpu', devices=1, progress_bar=None,
                               **dict(config['train'], **({'epochs': 1} if args.smoke else {})))
    (args.out / 'training_config.json').write_text(json.dumps({'model': model_config.model_dump(), 'train': train_config.model_dump()},
                                                              indent=1, default=str))
    patches.fixed_square_resize(model_config.resolution)
    module = patches.corrected_rfdetr_module()(model_config, train_config)
    datamodule = RFDETRDataModule(model_config, train_config)
    limits = {'limit_train_batches': 9, 'limit_val_batches': 1} if args.smoke else {}
    trainer = build_trainer(train_config, model_config, num_sanity_val_steps=0, log_every_n_steps=1, enable_model_summary=False, **limits)
    trainer.callbacks = [c for c in trainer.callbacks if not isinstance(c, ModelCheckpoint) or isinstance(c, BestModelCallback)]
    if args.config != 'branch_MUSCIMA++':
        trainer.callbacks.insert(0, snapshot_callback(args.out, 10))
    trainer.fit(module, datamodule=datamodule)
    best = torch.load(args.out / 'checkpoint_best_regular.pth', map_location='cpu', weights_only=False, mmap=True)
    (args.out / 'done.json').write_text(json.dumps({'native_best_epoch': int(best['epoch']) + 1,
                                                    'completed_epochs': int(trainer.current_epoch)}, indent=1))


if __name__ == '__main__':
    os.environ.setdefault('WANDB_MODE', 'disabled')
    main()
