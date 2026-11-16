"""COCO-only RF-DETR Medium initializations with fresh class heads (no music-trained weights).

Source: the official COCO RF-DETR Medium checkpoint
  https://storage.googleapis.com/rfdetr/medium_coco/checkpoint_best_regular.pth
  (sha256 749ff6071828aaffac63e204c4f4135ed3d6cdae4d702e086c360edc3b5768c8; rfdetr caches it as rf-detr-medium.pth).

--layout branch (HandSchA branch): every tensor is copied from COCO, keeping its 300 queries in 13 groups. The
    class heads (class_embed and the 13 transformer.enc_out_class_embed layers, one row per class + background) are
    fresh: with torch.manual_seed(0), each weight is a torch.nn.Linear default initialization drawn in checkpoint
    key order, each bias is the focal prior logit(0.01); the background row of both is copied from the COCO
    background row.
--layout repack (MUSCIMA++ branch): with torch.manual_seed(SEED), the first NUM_QUERIES COCO query rows are
    repacked into one query group, the other groups' encoder-output layers are removed, and the class heads are a
    fresh torch.nn.Linear with bias -log(99) (as in the RF-DETR model constructor). SEED is the training seed of the
    run (20261027 or 20261104).

usage:
  python init_rfdetr.py --coco rf-detr-medium.pth --classes work/rf_branch/classes.json --layout branch --out work/rf_branch/init.pth
  python init_rfdetr.py --coco rf-detr-medium.pth --classes work/rf_branch/M/classes.json --layout repack --num-queries 300 \
      --num-select 3000 --seed 20261027 --out init_muscima_seed20261027.pth
--classes is the classes.json written by prepare_rfdetr.py (class names in model index order).
"""
import argparse
import json
import math
import re
from pathlib import Path

from symbolrec.common import read_json, sha256

COCO_SHA256 = '749ff6071828aaffac63e204c4f4135ed3d6cdae4d702e086c360edc3b5768c8'
RESOLUTION = 2048


def branch_layout(coco, names):
    import torch
    cm = coco['model']
    state = {'_kp_active_mask': torch.zeros(0, 0, dtype=torch.bool)}
    torch.manual_seed(0)
    for key, value in cm.items():
        if 'class_embed' in key:
            if key.endswith('.weight'):
                weight = torch.nn.Linear(value.shape[1], len(names) + 1).weight.detach().clone()
                weight[-1] = value[-1]
                state[key] = weight.to(value.dtype)
            else:
                bias = torch.full((len(names) + 1,), -math.log((1 - 0.01) / 0.01), dtype=value.dtype)
                bias[-1] = value[-1]
                state[key] = bias
        else:
            state[key] = value.clone()
    source = coco['args'] if isinstance(coco['args'], dict) else vars(coco['args']).copy()
    args = {**source, 'class_names': names, 'num_classes': len(names), 'dataset_file': 'roboflow'}
    return {'model': state, 'args': args, 'model_name': 'RFDETRMedium', 'epoch': -1, 'initialization_only': True}


def repack_layout(coco, names, num_queries, num_select, seed):
    import torch
    from rfdetr.config import RFDETRMediumConfig
    from rfdetr.models.weights import interpolate_position_embeddings
    torch.manual_seed(seed)
    state = {k: v.clone() for k, v in coco['model'].items()}
    for key in ('query_feat.weight', 'refpoint_embed.weight'):
        tensor = state[key]
        if num_queries <= tensor.shape[0]:
            state[key] = tensor[:num_queries].clone()
        else:
            extra = torch.empty((num_queries - tensor.shape[0], tensor.shape[1]), dtype=tensor.dtype)
            torch.nn.init.zeros_(extra) if key == 'refpoint_embed.weight' else torch.nn.init.normal_(extra)
            state[key] = torch.cat([tensor, extra], dim=0)
    pattern = re.compile(r'^transformer\.(enc_output|enc_output_norm|enc_out_class_embed|enc_out_bbox_embed)\.(\d+)\.')
    for key in list(state):
        match = pattern.match(key)
        if match and int(match.group(2)) >= 1:
            del state[key]
    head = torch.nn.Linear(state['class_embed.weight'].shape[1], len(names) + 1)
    torch.nn.init.constant_(head.bias, -math.log(99.0))
    for prefix in ('class_embed', 'transformer.enc_out_class_embed.0'):
        for suffix in ('weight', 'bias'):
            state[f'{prefix}.{suffix}'] = getattr(head, suffix).detach().clone()
    state['_kp_active_mask'] = torch.zeros(0, 0, dtype=torch.bool)
    config = RFDETRMediumConfig(pretrain_weights=None, device='cpu', resolution=RESOLUTION, num_classes=len(names),
                                num_queries=num_queries, num_select=num_select, group_detr=1, model_name='RFDETRMedium', compile=False)
    interpolate_position_embeddings(state, config.positional_encoding_size)
    source = coco['args'] if isinstance(coco['args'], dict) else vars(coco['args']).copy()
    args = {**source, 'class_names': names, 'num_classes': len(names), 'num_queries': num_queries, 'num_select': num_select,
            'group_detr': 1, 'resolution': RESOLUTION, 'positional_encoding_size': config.positional_encoding_size,
            'dataset_file': 'roboflow'}
    return {'model': state, 'args': args, 'model_config': config.model_dump(), 'model_name': 'RFDETRMedium', 'epoch': -1,
            'initialization_only': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--coco', type=Path, required=True, help='official COCO RF-DETR Medium checkpoint')
    parser.add_argument('--classes', type=Path, required=True)
    parser.add_argument('--layout', choices=['branch', 'repack'], required=True)
    parser.add_argument('--num-queries', type=int, default=300)
    parser.add_argument('--num-select', type=int, default=300)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if sha256(args.coco) != COCO_SHA256:
        raise SystemExit('Not the official COCO RF-DETR Medium checkpoint')
    import torch
    names = read_json(args.classes)
    coco = torch.load(args.coco, map_location='cpu', weights_only=False, mmap=True)
    if args.layout == 'branch':
        payload = branch_layout(coco, names)
    else:
        payload = repack_layout(coco, names, args.num_queries, args.num_select, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(payload, args.out)
    print(json.dumps({'out': str(args.out), 'classes': len(names), 'layout': args.layout, 'sha256': sha256(args.out)}))


if __name__ == '__main__':
    main()
