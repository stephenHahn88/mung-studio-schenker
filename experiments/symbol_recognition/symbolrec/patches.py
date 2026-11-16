"""Process-local changes to Ultralytics 8.4.18 and RF-DETR 1.8.3 that the training runs used.

No installed package file is modified; each function patches the running process only.

1. fp32_detection_criterion (Ultralytics 8.4.18): the YOLOv8 detection loss and its target assignment are computed
   in float32 while the network forward keeps automatic mixed precision. In the unpatched library the
   mixed-dtype CIoU can return -inf for finite, positive-area boxes (the predicted area is rounded in float16
   before it is combined with float32 targets). Loss formulas and assignment are unchanged; a non-finite loss
   raises an error before the backward pass.
2. seed_dataloader_rank (Ultralytics 8.4.18): Ultralytics seeds the training dataloader's generator from the
   process RANK, not from the `seed` argument, so data order and augmentation do not change with `seed`. The
   second-seed runs (HandSchA seed 20261104; MUSCIMA++ seed 20261104) set
   ultralytics.data.build.RANK = 20261104 before training. The first-seed runs did not change it.
3. corrected_rfdetr_module (RF-DETR 1.8.3): RFDETRModelModule.training_step returns loss / accumulate_grad_batches,
   and PyTorch Lightning divides by the accumulation steps again. The subclass multiplies the returned loss back,
   so the loss is averaged once over the 9 accumulated micro-batches.
4. fixed_square_resize (RF-DETR 1.8.3): training images (strips or whole pages) are resized to exactly
   2048 x 2048 with no random crop, flip or scale.
"""
import hashlib
import inspect
from pathlib import Path

ULTRALYTICS_VERSION = '8.4.18'
RFDETR_MODULE_SHA256 = '083f7a2833e227f0a1409ff75a48abae21ca557cc29aeb2bc55eed47e70df2a5'


def _tensors(value):
    import torch
    if isinstance(value, torch.Tensor):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _tensors(item)
    elif isinstance(value, (tuple, list)):
        for item in value:
            yield from _tensors(item)


def _float_tree(value):
    import torch
    if isinstance(value, torch.Tensor):
        return value.float() if value.is_floating_point() else value
    if isinstance(value, dict):
        return {key: _float_tree(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return tuple(_float_tree(item) for item in value)
    if isinstance(value, list):
        return [_float_tree(item) for item in value]
    return value


def _fp32_loss(self, batch, preds=None):
    import torch
    if getattr(self, 'criterion', None) is None:
        self.criterion = self.init_criterion()
    if preds is None:
        preds = self.forward(batch['img'])
    first = next(_tensors(preds))
    with torch.autocast(device_type=first.device.type, enabled=False):
        result = self.criterion(_float_tree(preds), _float_tree(batch))
    if any(not bool(torch.isfinite(t).all()) for t in _tensors(result)):
        raise FloatingPointError('Non-finite float32 detection loss before backward')
    return result


def fp32_detection_criterion():
    import ultralytics
    from ultralytics.nn import tasks
    if ultralytics.__version__ != ULTRALYTICS_VERSION:
        raise RuntimeError(f'This patch was used with Ultralytics {ULTRALYTICS_VERSION}')
    if tasks.BaseModel.loss is not _fp32_loss:
        if tasks.BaseModel.loss.__module__ != 'ultralytics.nn.tasks':
            raise RuntimeError('Another BaseModel.loss patch is active')
        tasks.BaseModel.loss = _fp32_loss


def seed_dataloader_rank(value):
    import ultralytics.data.build as data_build
    data_build.RANK = int(value)


def disable_label_cache():
    """Read tile labels in memory only (no .cache files next to the tiles)."""
    import ultralytics.data.dataset as dataset

    def no_load(path):
        raise FileNotFoundError('label cache disabled')

    def no_save(prefix, path, data, version):
        data['version'] = version

    dataset.load_dataset_cache_file = no_load
    dataset.save_dataset_cache_file = no_save


def corrected_rfdetr_module():
    from rfdetr.training import RFDETRModelModule
    source = Path(inspect.getfile(RFDETRModelModule))
    if hashlib.sha256(source.read_bytes()).hexdigest() != RFDETR_MODULE_SHA256:
        raise RuntimeError('RF-DETR training module differs from rfdetr 1.8.3; re-check the accumulation correction')

    class CorrectedRFDETRModelModule(RFDETRModelModule):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            if self._use_manual_optimization:
                raise ValueError('Automatic optimization expected')

        def training_step(self, batch, batch_idx):
            value = super().training_step(batch, batch_idx)
            accumulation = max(1, int(self.trainer.accumulate_grad_batches))
            if isinstance(value, dict):
                return {**value, 'loss': value['loss'] * accumulation}
            return value * accumulation

    return CorrectedRFDETRModelModule


def fixed_square_resize(resolution=2048):
    from rfdetr.datasets import coco

    def resize(scales, *, square, max_size=None):
        if not square or list(scales) != [resolution]:
            raise ValueError('Expected one square training resolution')
        return [{'Resize': {'height': resolution, 'width': resolution, 'p': 1.0}}]

    coco._build_train_resize_config = resize
    return coco.make_coco_transforms_square_div_64('train', resolution, multi_scale=False, aug_config={})
