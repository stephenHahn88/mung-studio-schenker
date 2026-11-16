"""Choose the checkpoint of the HandSchA RF-DETR branch on validation pages (symbolrec/selection.py) and write
selection.json.

Candidates: the snapshots of train_rfdetr.py (every 10 epochs and the last epoch) and the best native-validation
checkpoint (checkpoint_best_regular.pth); identical files are scored once. The score is the pooled AP50 of the
branch classes (read from the checkpoint) over symbols with L > 200 on whole validation pages; the higher score
wins, ties go to the earlier epoch. The MUSCIMA++ branch uses checkpoint_best_regular.pth and needs no selection.

usage:
  python select_rfdetr.py --run runs/rf_seed42                      # validation pages of work/coco, data/
"""
import argparse
import json
import re
from pathlib import Path

from symbolrec import branches
from symbolrec.common import read_json, sha256
from symbolrec.data import load_split
from symbolrec.selection import branch_score

CONFIG = Path(__file__).resolve().parent / 'configs/rfdetr.json'

DATA = Path(__file__).resolve().parent / 'data'


def candidates(run):
    import torch
    found = []
    for path in sorted((run / 'snapshots').glob('epoch_*.pth')):
        found.append((int(re.search(r'epoch_(\d+)', path.name).group(1)), path))
    best = run / 'checkpoint_best_regular.pth'
    found.append((int(torch.load(best, map_location='cpu', weights_only=False, mmap=True)['epoch']) + 1, best))
    unique, seen = [], set()
    for epoch, path in sorted(found, key=lambda item: item[0]):
        digest = sha256(path)
        if digest not in seen:
            seen.add(digest)
            unique.append((epoch, path))
    return unique


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--coco', type=Path, default=Path('work/coco'), help='output folder of make_coco.py (default work/coco)')
    parser.add_argument('--dataset-root', type=Path, default=DATA, help='HandSchA data folder: images and ignore regions (default data/)')
    parser.add_argument('--device', default='cuda:0')
    args = parser.parse_args()
    split = load_split(args.coco, 'val', args.dataset_root)
    model_config = read_json(CONFIG)['branch_HandSchA']['model']
    scored = []
    for epoch, path in candidates(args.run):
        names = list(checkpoint_class_names(path))
        model = branches.load_rfdetr(path, len(names), model_config['num_queries'], model_config['num_select'],
                                     model_config.get('group_detr'), args.device)
        rows = {}
        for pid, page in split['pages'].items():
            image = branches.open_rgb(page['image'])
            rows[pid] = [{'box': r['box'], 'score': r['score'], 'class_name': names[r['class_index']]}
                         for r in branches.rfdetr_candidates(model, image, len(names), strips=True)]
        score = branch_score(rows, split, names)
        scored.append({'epoch': epoch, 'checkpoint': path.name, 'score': score})
        print(json.dumps(scored[-1]), flush=True)
    best = sorted(scored, key=lambda r: (-r['score'], r['epoch']))[0]
    (args.run / 'selection.json').write_text(json.dumps({'criterion': 'branch', 'candidates': scored, 'selected': best}, indent=1))
    print('selected', best)


def checkpoint_class_names(path):
    import torch
    payload_args = torch.load(path, map_location='cpu', weights_only=False, mmap=True)['args']
    return payload_args['class_names'] if isinstance(payload_args, dict) else payload_args.class_names


if __name__ == '__main__':
    main()
