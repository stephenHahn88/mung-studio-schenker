"""RF-DETR page predictions for the pages of one stage, written as a prediction file (kind "page").

--model selects the query settings of configs/rfdetr.json:
  branch_HandSchA   branch on full-width strips (300 queries, 300 selected per strip)
  branch_MUSCIMA++  branch on whole pages (300 queries, 3000 selected); keeps boxes with L > 200 only
Class names are read from the checkpoint.

usage:
  python predict_rfdetr.py --model branch_HandSchA --checkpoint runs/rf_seed42/snapshots/epoch_070.pth --stage test \
      --dataset HandSchA --run seed42 --out pred/rfdetr_branch/HandSchA_seed42_test.json.gz
"""
import argparse
from pathlib import Path

from symbolrec import branches
from symbolrec.common import read_json
from symbolrec.predictions import write_predictions

CONFIG = Path(__file__).resolve().parent / 'configs/rfdetr.json'

DATA = Path(__file__).resolve().parent / 'data'


def checkpoint_class_names(path):
    import torch
    args = torch.load(str(path), map_location='cpu', weights_only=False, mmap=True)['args']
    return list(args['class_names'] if isinstance(args, dict) else args.class_names)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--model', choices=['branch_HandSchA', 'branch_MUSCIMA++'], required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--coco', type=Path, default=Path('work/coco'), help='output folder of make_coco.py (default work/coco)')
    parser.add_argument('--images-root', type=Path, default=DATA, help='folder that image file names are relative to (default data/)')
    parser.add_argument('--stage', choices=['val', 'test'], required=True)
    parser.add_argument('--dataset', choices=['HandSchA', 'MUSCIMA++'], required=True)
    parser.add_argument('--split', help='split name stored in the prediction file (optional)')
    parser.add_argument('--run', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--device', default='cuda:0')
    args = parser.parse_args()
    model_config = read_json(CONFIG)[args.model]['model']
    names = checkpoint_class_names(args.checkpoint)
    model = branches.load_rfdetr(args.checkpoint, len(names), model_config['num_queries'], model_config['num_select'],
                                 model_config.get('group_detr'), args.device)
    if list(model.class_names) != names:
        raise SystemExit('Checkpoint class order differs')
    strips = args.dataset == 'HandSchA'
    min_size = 200 if args.model == 'branch_MUSCIMA++' else None
    pages = {}
    for im in read_json(args.coco / f'{args.stage}.coco.json')['images']:
        image = branches.open_rgb(args.images_root / im['file_name'])
        rows = branches.rfdetr_candidates(model, image, len(names), strips=strips, min_size=min_size)
        pages[str(im['page_id'])] = branches.as_file_rows(rows, tiles=False)
        print(im['page_id'], len(rows), flush=True)
    write_predictions(args.out, dataset=args.dataset, split=args.split, method='rfdetr_branch', run=args.run, stage=args.stage,
                      checkpoint=args.checkpoint.name, class_names=names, kind='page', pages=pages)


if __name__ == '__main__':
    main()
