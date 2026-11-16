#!/usr/bin/env python3
"""Train the syntax-link model on the pages of one or more split files.

For each split file, a PairCNN is trained from random initialization on the training pages of the
split (pair_cnn.py), the frozen CNN encodes the 64-NN candidates of all pages of the split
(encode_features.py), and the incidence model is trained once per seed (train_incidence.py).
Each <work>/models/<split>/seed_<s>/ folder is a model folder for inference.py; <split> is the
name of the split file without .json. By default the data and the split in data/ are used:

  python train.py

Steps whose output exists are skipped, so an interrupted run can be restarted with the same command.
"""
import argparse
import subprocess
import sys
from pathlib import Path
import common

HERE = Path(__file__).resolve().parent


def call(script, *args):
    command = [sys.executable, '-u', str(HERE / script), *map(str, args)]
    print('+', ' '.join(command), flush=True)
    subprocess.run(command, check=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--data-dir', default=str(HERE / 'data'),
                   help='task folder (categories.json, pages/<page_id>/input.json, target.json)')
    p.add_argument('--split-file', default=[str(HERE / 'data/split.json')], nargs='+', help='one model per split file')
    p.add_argument('--image-dir', default=str(HERE / 'data/pages'), help='page images for training the PairCNN')
    p.add_argument('--image-pattern', default='{page_id}/staff_removed.png', help='image file name under --image-dir')
    p.add_argument('--ink', choices=['bright', 'dark'], default='bright',
                   help='bright: pixels > 128 are ink; dark: pixels < 128 are ink')
    p.add_argument('--work', default=str(HERE / 'work'), help='output folder')
    p.add_argument('--config', default=str(HERE / 'configs/incidence_model.json'), help='settings of the incidence model')
    p.add_argument('--seeds', nargs='+', type=int, help='seeds of the incidence model (default: the seeds in --config)')
    p.add_argument('--device', default='cuda')
    a = p.parse_args()
    config = Path(a.config).resolve()
    seeds = a.seeds or common.read(config)['training']['seeds']
    data_dir, image_dir, work = Path(a.data_dir).resolve(), Path(a.image_dir).resolve(), Path(a.work).resolve()
    cache = work / 'cache/geometry'
    for split_file in [Path(f).resolve() for f in a.split_file]:
        name = split_file.stem
        cnn = work / 'pair_cnn' / name / 'pair_cnn.pth'
        if not cnn.exists():
            call('pair_cnn.py', '--data-dir', data_dir, '--split-file', split_file, '--image-dir', image_dir,
                 '--image-pattern', a.image_pattern, '--ink', a.ink, '--output', cnn.parent, '--device', a.device)
        features = work / 'features' / common.sha(cnn)[:16]
        call('encode_features.py', '--data-dir', data_dir, '--split-file', split_file, '--cnn', cnn,
             '--output', features, '--device', a.device, '--cache-dir', cache)
        for seed in seeds:
            call('train_incidence.py', '--data-dir', data_dir, '--split-file', split_file, '--features', features,
                 '--cnn', cnn, '--seed', seed, '--config', config, '--device', a.device, '--cache-dir', cache,
                 '--output', work / 'models' / name / f'seed_{seed}')


if __name__ == '__main__':
    main()
