# Syntax links

```
data/categories.json                      symbol classes (id, name)
data/pages/<page_id>/input.json           page size and symbols
data/pages/<page_id>/target.json          directed syntax links
data/pages/<page_id>/staff_removed.png    page image with the staff lines removed (used to train the PairCNN)
data/split.json                           train, val and test page ids
train.py                                  training: runs pair_cnn.py, encode_features.py and train_incidence.py
inference.py                              prediction with a trained model folder
model.py, graph.py, common.py             model and data code
configs/                                  training settings
```

## Install

```
pip install -r requirements.txt
```

Python 3.12.8.

## Training

```
python train.py
```

One GPU. Trains on `data/` with `data/split.json` and writes the model folders `work/models/split/seed_42` and
`work/models/split/seed_43`. Options: `python train.py --help`.

## Inference

```
python inference.py --input data/pages/<page_id>/input.json [--model-dir M] [--device cuda]
```

```python
from inference import predict_syntax_links
links = predict_syntax_links(nodes, (width, height), '../../models/syntax_links/incidence/handscha/heldout/seed_42', device='cpu')
```

## Formats

```
input.json    {"page_id": ..., "image": {"width": W, "height": H}, "nodes": [{"id": 7, "class_id": 106, "bbox": [x, y, w, h]}, ...]}
target.json   {"page_id": ..., "directed_edges": [[source_id, target_id], ...]}
split.json    {"train": [page_id, ...], "val": [...], "test": [...]}
nodes         [{"id": 7, "class_name": "noteheadBlack", "left": 412, "top": 96, "width": 18, "height": 15}, ...]
links         [{"source_id": 7, "target_id": 12, "score": 0.93}, ...]
```

`inference.py` prints `links` as JSON.

## Trained models

`../../models/syntax_links/incidence/handscha/heldout/seed_42` (the default of `inference.py`) is the
model folder trained on `data/split.json` with seed 42; `../../models/syntax_links/pair_cnn/handscha/heldout_seed42.pth` is
its PairCNN.
