"""Train the time-group and precedence-link classifiers on the training pages of the split and select their decoding
thresholds on the validation pages (pooled F1; ties go to the first grid entry).

  OMP_NUM_THREADS=1 python train.py --seed 42 --out runs

Writes <out>/time_groups_seed<seed>.joblib and <out>/precedence_seed<seed>.joblib (used by inference.py).
"""
import argparse
import os
import platform
from pathlib import Path

import joblib
import numpy as np
import scipy
import sklearn

from temporal import data, time_model as tm, precedence_model as pm

HERE = Path(__file__).resolve().parent


def f1(c):
    """F1 from pooled (TP, FP, FN)."""
    tp, fp, fn = c
    return 2 * tp / max(2 * tp + fp + fn, 1)


def environment():
    from numpy._core._multiarray_umath import __cpu_features__ as feats
    return {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__, 'scikit-learn': sklearn.__version__,
            'OMP_NUM_THREADS': os.environ.get('OMP_NUM_THREADS'), 'cpu_avx2': bool(feats.get('AVX2')), 'cpu_avx512f': bool(feats.get('AVX512F')),
            'NPY_DISABLE_CPU_FEATURES': os.environ.get('NPY_DISABLE_CPU_FEATURES')}


def train_time_groups(root, split, seed, cats):
    """Classifier on the training pages, average-linkage threshold on the validation pages."""
    rows = {part: data.rows(root, split, 'time', part) for part in ('train', 'val')}
    feats = {part: [tm.page_feats(r, cats) for r in rows[part]] for part in rows}
    model = tm.fit(feats['train'], seed)
    V = tm.prep(feats['val'], model)
    thr = max(tm.THRESHOLDS, key=lambda t: f1(tm.counts(V, t)))
    print(f'time groups: average-linkage threshold {float(thr):.2f}, validation F1 {f1(tm.counts(V, thr)):.4f}', flush=True)
    return {'task': 'time_groups', 'model': model, 'features': tm.FEATURES, 'average_linkage_threshold': float(thr),
            'seed': seed, 'train_pages': [r['page_id'] for r in rows['train']], 'environment': environment()}


def train_precedence(root, split, seed, cats):
    """Classifier on the training pages, successor-selection thresholds (t1, t2) on the validation pages."""
    rows = {part: data.rows(root, split, 'precedence', part) for part in ('train', 'val')}
    F = {}
    for part in rows:
        F[part] = []
        for r in rows[part]:
            p = pm.load(r, cats); X, I, J = pm.featurize(p); F[part].append((p, X, I, J))
    model = pm.fit(F['train'], seed)
    V = [(f[0], f[2], f[3], model.predict_proba(f[1])[:, 1] if len(f[2]) else np.zeros(0)) for f in F['val']]
    best = max(pm.grid(), key=lambda g: f1(pm.counts(V, *g)))
    selected = [float(b) for b in best]
    print(f'precedence: successor thresholds {selected[0]:.2f} {selected[1]:.2f}, validation F1 {f1(pm.counts(V, *best)):.4f}', flush=True)
    return {'task': 'precedence', 'model': model, 'features': pm.FEATURES, 'successor_thresholds': selected,
            'seed': seed, 'train_pages': [r['page_id'] for r in rows['train']], 'environment': environment()}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seed', type=int, default=42, help='random_state of both classifiers')
    ap.add_argument('--data', type=Path, default=data.DEFAULT_ROOT, help='data folder')
    ap.add_argument('--split', type=Path, default=data.DEFAULT_ROOT / 'split.json', help='split file')
    ap.add_argument('--out', type=Path, default=HERE / 'runs', help='output folder for the two model files')
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    cats = data.categories(a.data)
    joblib.dump(train_time_groups(a.data, a.split, a.seed, cats), a.out / f'time_groups_seed{a.seed}.joblib')
    joblib.dump(train_precedence(a.data, a.split, a.seed, cats), a.out / f'precedence_seed{a.seed}.joblib')


if __name__ == '__main__':
    main()
