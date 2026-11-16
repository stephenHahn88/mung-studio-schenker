#!/usr/bin/env python3
"""Encode frozen PairCNN features of every 64-NN candidate of the pages in a split file.

Only the two box masks enter the CNN (the page channel is empty), so page images are not needed.
Features are stored as float16 and logits as float32, one file per page.

  python encode_features.py --cnn work/pair_cnn/split/pair_cnn.pth --output work/features
"""
import argparse
import json
import time
from pathlib import Path
import torch
import common
import graph as G
import model as core

HERE = Path(__file__).resolve().parent


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--data-dir', default=str(HERE / 'data'))
    p.add_argument('--split-file', default=[str(HERE / 'data/split.json')], nargs='+',
                   help='pages of all listed splits are encoded')
    p.add_argument('--cnn', required=True)
    p.add_argument('--cnn-sha256', help='expected checkpoint hash')
    p.add_argument('--output', required=True)
    p.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    p.add_argument('--batch-size', type=int, default=256)
    p.add_argument('--workers', type=int, default=4)
    p.add_argument('--cache-dir', help='optional cache of candidate geometry')
    a = p.parse_args()
    torch.set_num_threads(4)
    cnn_sha = common.sha(a.cnn)
    common.require(a.cnn_sha256 in (None, cnn_sha), 'CNN checkpoint hash differs from --cnn-sha256')
    categories = common.categories_list(Path(a.data_dir) / 'categories.json')
    rows = {}
    for split_file in a.split_file:
        for part in common.split_rows(split_file, a.data_dir).values():
            rows.update({r['page_id']: r for r in part})
    cnn = core.load_pair_cnn(a.cnn, a.device)
    for page_id in sorted(rows):
        started = time.monotonic()
        row = rows[page_id]
        g = common.load_page(row, False, a.cache_dir)
        graph = G.build_graph(g, row['input_path'], categories)
        if G.feature_path(a.output, graph).is_file():
            G.attach_features(graph, a.output, cnn_sha)
            continue
        visual, logit = core.encode_pairs(cnn, graph, int(graph.height), int(graph.width), a.device,
                                          a.batch_size, a.workers)
        G.save_features(a.output, graph, visual, logit, cnn_sha)
        print(json.dumps({'page_id': page_id, 'candidates': len(graph.edges), 'seconds': time.monotonic() - started}),
              flush=True)


if __name__ == '__main__':
    main()
