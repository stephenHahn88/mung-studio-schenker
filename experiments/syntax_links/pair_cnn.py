#!/usr/bin/env python3
"""Train the PairCNN of one split as a pairwise link classifier (Section VII-B).

The CNN is trained from random initialization on the training pages of the split file only:
40 epochs, Adam 1e-3, cosine decay, batch 256, label smoothing 0.1. Training pairs are the symbol
pairs whose box gap is at most the gate of their class pair, learned from the same training pages:
clip(1.2 x the 99.5th percentile of annotated link gaps for that class pair, 40, 900) pixels,
and 60 pixels for class pairs without an annotated link. Each epoch samples up to 25,000
positives and five negatives per sampled positive. The final epoch is saved.

  python pair_cnn.py --output work/pair_cnn/split
"""
import argparse
import json
import random
import time
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
import common
from model import PairCNN, bbox_gap, pair_crop

Image.MAX_IMAGE_PIXELS = None
HERE = Path(__file__).resolve().parent
GATE_MIN, GATE_DEFAULT, GATE_CAP = 40., 60., 900.


def learn_gates(page_nodes_list) -> dict:
    """Per class pair: clip(1.2 * 99.5th percentile of annotated link gaps, GATE_MIN, GATE_CAP)."""
    pair_gaps = defaultdict(list)
    for nodes in page_nodes_list:
        by_id = {n.id: n for n in nodes}
        for n in nodes:
            for oid in n.outlinks:
                m = by_id.get(oid)
                if m is None:
                    continue
                key = tuple(sorted([n.class_name, m.class_name]))
                pair_gaps[key].append(bbox_gap(n, m))
    return {"|".join(k): float(np.clip(1.2 * np.percentile(v, 99.5), GATE_MIN, GATE_CAP))
            for k, v in pair_gaps.items()}


def gate_for(gates: dict, na: str, nb: str) -> float:
    return gates.get("|".join(sorted([na, nb])), GATE_DEFAULT)


def page_pairs(nodes, gates):
    """[(node_a, node_b, label)] for the pairs inside the gates, and the number of links outside them."""
    by_id = {n.id: n for n in nodes}
    linked = set()
    for n in nodes:
        for oid in n.outlinks:
            if oid in by_id:
                linked.add((min(n.id, oid), max(n.id, oid)))
    out, covered = [], set()
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            if bbox_gap(nodes[i], nodes[j]) > gate_for(gates, nodes[i].class_name, nodes[j].class_name):
                continue
            key = (min(nodes[i].id, nodes[j].id), max(nodes[i].id, nodes[j].id))
            lab = 1.0 if key in linked else 0.0
            if lab > 0.5:
                covered.add(key)
            out.append((nodes[i], nodes[j], lab))
    return out, len(linked - covered)


class PairDataset(torch.utils.data.Dataset):
    """(page index, a, b, label) items over in-memory page images."""

    def __init__(self, images, items):
        self.images = images
        self.items = items

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        pi, a, b, lab = self.items[i]
        return pair_crop(self.images[pi], a, b), np.float32(lab)


def run_epochs(model, images, items, device, args):
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    crit = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(args.pos_weight, device=device))
    pos = [t for t in items if t[3] > 0.5]
    neg = [t for t in items if t[3] <= 0.5]
    history = []
    for ep in range(args.epochs):
        begin = time.monotonic()
        random.shuffle(neg)
        pos_ep = pos if len(pos) <= args.pos_per_epoch else random.sample(pos, args.pos_per_epoch)
        epoch_items = pos_ep + neg[:len(pos_ep) * args.neg_ratio]
        random.shuffle(epoch_items)
        dl = torch.utils.data.DataLoader(PairDataset(images, epoch_items), batch_size=args.batch_size,
                                         num_workers=args.workers, pin_memory=True, drop_last=False)
        model.train()
        tot = 0.0
        for x, y in dl:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            y = y * (1 - args.label_smoothing) + 0.5 * args.label_smoothing
            opt.zero_grad()
            loss = crit(model(x), y)
            loss.backward()
            opt.step()
            tot += float(loss.detach())
        sched.step()
        record = {'epoch': ep + 1, 'loss': tot / max(len(dl), 1), 'positives': len(pos_ep),
                  'negatives': len(epoch_items) - len(pos_ep), 'seconds': time.monotonic() - begin}
        history.append(record)
        print(json.dumps(record), flush=True)
    return model, history


def load_image(path, ink):
    gray = np.array(Image.open(path).convert('L'))
    return ((gray > 128) if ink == 'bright' else (gray < 128)).astype(np.uint8)


def image_path(args, page_id):
    return Path(args.image_dir) / args.image_pattern.format(page_id=page_id)


def training_pages(args):
    """Training pages of the split: symbol nodes with their annotated outlinks, from the task folder."""
    categories = common.categories_list(Path(args.data_dir) / 'categories.json')
    names = {int(c['id']): c['name'] for c in categories}
    rows = common.split_rows(args.split_file, args.data_dir)['train']
    pages = []
    for row in rows:
        x = common.read(row['input_path'])
        target = common.read(row['target_path'])
        links = {int(n['id']): [] for n in x['nodes']}
        for a, b in target['directed_edges']:
            links[int(a)].append(int(b))
        nodes = []
        for n in x['nodes']:
            a, b, w, h = n['bbox']
            nodes.append(SimpleNamespace(id=int(n['id']), class_name=names[int(n['class_id'])], left=int(a), top=int(b),
                                         right=int(a + w), bottom=int(b + h), outlinks=links[int(n['id'])]))
        pages.append((row['page_id'], nodes))
    return pages


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--data-dir', default=str(HERE / 'data'), help='task folder')
    p.add_argument('--split-file', default=str(HERE / 'data/split.json'),
                   help='split file; the CNN is trained on its training pages')
    p.add_argument('--image-dir', default=str(HERE / 'data/pages'))
    p.add_argument('--image-pattern', default='{page_id}/staff_removed.png', help='image file name under --image-dir')
    p.add_argument('--ink', choices=['bright', 'dark'], default='bright',
                   help='bright: pixels > 128 are ink (staff_removed.png); dark: pixels < 128 are ink')
    p.add_argument('--output', required=True)
    p.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    p.add_argument('--seed', type=int, default=42)
    p.add_argument('--epochs', type=int, default=40)
    p.add_argument('--lr', type=float, default=1e-3)
    p.add_argument('--batch-size', type=int, default=256)
    p.add_argument('--label-smoothing', type=float, default=0.1)
    p.add_argument('--pos-weight', type=float, default=1.0)
    p.add_argument('--pos-per-epoch', type=int, default=25000)
    p.add_argument('--neg-ratio', type=int, default=5)
    p.add_argument('--workers', type=int, default=8)
    args = p.parse_args()
    torch.set_num_threads(4)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    started = time.monotonic()
    pages = training_pages(args)
    gates = learn_gates([nodes for _, nodes in pages])
    images, items, stats = [], [], []
    for name, nodes in pages:
        pi = len(images)
        images.append(load_image(image_path(args, name), args.ink))
        pairs, missed = page_pairs(nodes, gates)
        items += [(pi, a, b, lab) for a, b, lab in pairs]
        stats.append({'page_id': name, 'pairs': len(pairs), 'positives': sum(lab > .5 for _, _, lab in pairs),
                      'links_outside_gates': missed})
    print(json.dumps({'training_pages': len(pages), 'train_pairs': len(items)}), flush=True)
    model = PairCNN().to(args.device)
    model, history = run_epochs(model, images, items, args.device, args)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    torch.save({'model': model.state_dict()}, out / 'pair_cnn.pth')
    summary = {'split_file': str(args.split_file), 'seed': args.seed, 'epochs': args.epochs, 'lr': args.lr,
               'batch_size': args.batch_size, 'label_smoothing': args.label_smoothing,
               'pos_per_epoch': args.pos_per_epoch, 'neg_ratio': args.neg_ratio, 'ink': args.ink, 'gates': gates,
               'pages': stats, 'history': history, 'checkpoint_sha256': common.sha(out / 'pair_cnn.pth'),
               'seconds': time.monotonic() - started}
    common.write(out / 'pair_cnn.json', summary)
    print('saved', out / 'pair_cnn.pth', summary['checkpoint_sha256'], flush=True)


if __name__ == '__main__':
    main()
