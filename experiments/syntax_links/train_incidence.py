#!/usr/bin/env python3
"""Train the incidence-attention syntax-link model on the training pages of one split.

The CNN features of all pages must have been written by encode_features.py with the given PairCNN.
The checkpoint with the highest validation directed-link average precision is kept, with the threshold that
maximizes pooled validation micro-F1. The output folder is a model folder for inference.py:
incidence.pt, direction.pkl, pair_cnn.pth, categories.json and model.json, plus the training
records CONFIG.json, HISTORY.json and RESULT.json.

  python train_incidence.py --features work/features --cnn work/pair_cnn/split/pair_cnn.pth \
      --seed 42 --output work/models/split/seed_42
"""
import os
import argparse
import json
import pickle
import random
import shutil
import time
from pathlib import Path
os.environ.setdefault('OMP_NUM_THREADS', '4')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '4')
import numpy as np
import torch
import common
import graph as G
import model as core

HERE = Path(__file__).resolve().parent


def load_graphs(rows, categories, features_dir, cnn_sha256, targets, cache_dir=None):
    pages = [common.load_page(r, targets, cache_dir) for r in rows]
    graphs = [G.attach_features(G.build_graph(g, r['input_path'], categories), features_dir, cnn_sha256)
              for g, r in zip(pages, rows)]
    return pages, graphs


@torch.inference_mode()
def infer(model, graphs, masks, device):
    model.eval()
    result = []
    for g, mask in zip(graphs, masks):
        logits, _ = model(core.graph_to_device(g, device))
        result.append(G.directed_scores(g, logits.sigmoid().cpu().numpy(), mask))
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--data-dir', default=str(HERE / 'data'))
    p.add_argument('--split-file', default=str(HERE / 'data/split.json'))
    p.add_argument('--features', required=True)
    p.add_argument('--cnn', required=True, help='PairCNN checkpoint that encoded the features')
    p.add_argument('--seed', type=int, required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    p.add_argument('--config', default=str(HERE / 'configs/incidence_model.json'))
    p.add_argument('--cache-dir')
    a = p.parse_args()
    cfg = common.read(a.config)
    arch, opt, loss_cfg, train_cfg = cfg['architecture'], cfg['optimizer'], cfg['loss'], cfg['training']
    common.require((arch['hidden'], arch['layers'], arch['attention_channels'], arch['class_embedding']) == (128, 2, 4, 32),
                   'model.py implements hidden 128, 2 layers, 4 channels and class embedding 32')
    common.require(cfg['direction_classifier']['C'] == 4.0 and cfg['direction_classifier']['max_iter'] == 1500,
                   'model.make_classifier implements C=4 and max_iter=1500')
    common.require(cfg['candidates']['k_neighbours'] == common.K_NEIGHBOURS, 'common.py implements 64 neighbours')
    epochs, patience = train_cfg['max_epochs'], train_cfg['patience']
    torch.set_num_threads(4)
    torch.set_num_interop_threads(2)
    from threadpoolctl import threadpool_limits
    threadpool_limits(4)
    random.seed(a.seed)
    np.random.seed(a.seed)
    torch.manual_seed(a.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(a.seed)
    out = Path(a.output)
    if (out / 'model.json').exists():
        print('already complete', out)
        return
    out.mkdir(parents=True, exist_ok=True)
    cnn_sha256 = common.sha(a.cnn)
    categories = common.categories_list(Path(a.data_dir) / 'categories.json')
    split = common.split_rows(a.split_file, a.data_dir)
    common.write(out / 'CONFIG.json', {'split_file': str(a.split_file), 'seed': a.seed, 'cnn_sha256': cnn_sha256,
                                       'train_pages': [r['page_id'] for r in split['train']],
                                       'val_pages': [r['page_id'] for r in split['val']], **cfg})
    started = time.monotonic()
    train_pages, train = load_graphs(split['train'], categories, a.features, cnn_sha256, True, a.cache_dir)
    val_pages, val = load_graphs(split['val'], categories, a.features, cnn_sha256, True, a.cache_dir)
    direction = G.fit_direction(train, categories, a.seed)
    (out / 'direction.pkl').write_bytes(pickle.dumps(direction))
    val_masks = [G.direction_mask(g, direction, categories) for g in val]
    model = G.make_model(len(categories)).to(a.device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=opt['lr'], weight_decay=opt['weight_decay'])
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=opt['cosine_T_max'])
    rng = np.random.default_rng(a.seed)
    history, best, significant, stale = [], -1., -1., 0
    reason = 'epoch_budget'
    for epoch in range(epochs):
        if stale >= patience:
            reason = 'validation_patience'
            break
        begin = time.monotonic()
        model.train()
        losses = []
        for idx in rng.permutation(len(train)):
            b = core.graph_to_device(train[idx], a.device)
            optimizer.zero_grad(set_to_none=True)
            final, base = model(b)
            edge = core.selected_edge_bce(final, b['labels'], loss_cfg['negatives_per_positive'],
                                          loss_cfg['label_smoothing'], 1.)
            baseloss = core.selected_edge_bce(base, b['labels'], loss_cfg['negatives_per_positive'],
                                              loss_cfg['label_smoothing'], 1.)
            card = core.cardinality_loss(final, b['labels'], b['edges'], b['node_cls'], model.vocab, loss_cfg['eta'])
            rank = core.incidence_ranking_loss(final, b['labels'], b['edges'], b['node_cls'], model.vocab, loss_cfg['mu'])
            loss = (edge + loss_cfg['lambda_base'] * baseloss + loss_cfg['lambda_count'] * card
                    + loss_cfg['lambda_rank'] * rank)
            common.require(bool(torch.isfinite(loss)), 'Nonfinite loss')
            loss.backward()
            norm = torch.nn.utils.clip_grad_norm_(model.parameters(), opt['gradient_clip'])
            common.require(bool(torch.isfinite(norm)), 'Nonfinite gradient')
            optimizer.step()
            losses.append(float(loss.detach()))
        scheduler.step()
        scores = infer(model, val, val_masks, a.device)
        metrics = common.pooled_metrics(val_pages, scores)
        improved = metrics['auprc'] > best
        if improved:
            best = metrics['auprc']
        if metrics['auprc'] > significant + train_cfg['patience_min_delta_ap']:
            significant = metrics['auprc']
            stale = 0
        else:
            stale += 1
        row = {'epoch': epoch + 1, 'validation': metrics, 'seconds': time.monotonic() - begin,
               'loss': float(np.mean(losses)), 'stale_epochs': stale}
        history.append(row)
        if improved:
            torch.save({'model': model.state_dict(), 'epoch': epoch + 1, 'threshold': metrics['threshold']},
                       out / 'incidence.pt')
        common.write(out / 'HISTORY.json', history)
        print(json.dumps(row), flush=True)
    ck = torch.load(out / 'incidence.pt', map_location='cpu', weights_only=False)
    model.load_state_dict(ck['model'])
    scores = infer(model, val, val_masks, a.device)
    validation = common.pooled_metrics(val_pages, scores, ck['threshold'])
    common.write(out / 'RESULT.json', {'seed': a.seed, 'epochs_run': len(history), 'selected_epoch': ck['epoch'],
                                       'threshold': ck['threshold'], 'validation': validation, 'stop_reason': reason,
                                       'training_seconds': time.monotonic() - started})
    shutil.copyfile(a.cnn, out / 'pair_cnn.pth')
    shutil.copyfile(Path(a.data_dir) / 'categories.json', out / 'categories.json')
    common.write(out / 'model.json', {'threshold': ck['threshold'], 'selected_epoch': ck['epoch'], 'seed': a.seed,
                                      'split_file': Path(a.split_file).name, 'k_neighbours': common.K_NEIGHBOURS,
                                      'pair_cnn': {'file': 'pair_cnn.pth', 'sha256': cnn_sha256}})
    print('VALIDATION', json.dumps({k: validation[k] for k in ('auprc', 'f1', 'tp', 'fp', 'fn', 'threshold')}),
          'epoch', ck['epoch'], flush=True)


if __name__ == '__main__':
    main()
