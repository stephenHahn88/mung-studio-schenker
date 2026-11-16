# Time groups and precedence links

```
data/
  categories.json                   class id -> class name
  split.json                        {"time" | "precedence": {"train" | "val" | "test": [page_id, ...]}}
  precedence/<page_id>/input.json   symbols of the page: {"image": {"width", "height"}, "nodes": [{"id", "class_id", "bbox"}, ...]}
  precedence/<page_id>/target.json  {"directed_edges": [[source_id, target_id], ...]}
  time/<page_id>/target.json        {"node_ids": [...], "groups": [[node_id, ...], ...]}
temporal/                           features, classifiers and decoding
train.py                            training
inference.py                        page-level inference
```

`bbox` is `[left, top, width, height]` in pixels. A time-group page uses the symbols of `precedence/<page_id>/input.json`
and the noteheads listed in `node_ids`.

## Install

Python 3.12. Run the commands from this folder.

```bash
pip install -r requirements.txt
```

## Train

```bash
OMP_NUM_THREADS=1 python train.py --seed 42 --out runs
```

Writes `runs/time_groups_seed42.joblib` and `runs/precedence_seed42.joblib`. `--data` and `--split` select another data
folder or split file.

## Inference

The trained models are in `../../models/temporal_relations/hgb/`:
`time_groups_heldout_rachmaninov_seed42.joblib` and `precedence_heldout_rachmaninov_seed43.joblib`
(trained on `data/split.json` with `train.py --seed 42` and `--seed 43`, respectively).

```bash
M=../../models/temporal_relations/hgb
P=data/precedence/rachmaninov_the_bells_second_mvmt_001/input.json
python inference.py time --model $M/time_groups_heldout_rachmaninov_seed42.joblib --page $P
python inference.py precedence --model $M/precedence_heldout_rachmaninov_seed43.joblib --page $P
```

```python
from inference import predict_time_groups, predict_precedence
M = '../../models/temporal_relations/hgb/'
nodes = [{'id': 0, 'class_name': 'noteheadBlack', 'left': 120, 'top': 340, 'width': 18, 'height': 15}, ...]
groups = predict_time_groups(nodes, (width, height), M + 'time_groups_heldout_rachmaninov_seed42.joblib')
links = predict_precedence(nodes, (width, height), M + 'precedence_heldout_rachmaninov_seed43.joblib')
```

`--page` takes a page file of `data/` or `{"image": {"width", "height"}, "nodes": [...]}` with nodes as above.
`predict_time_groups` returns `[[node_id, ...], ...]` over the nodes whose class starts with `notehead`;
`predict_precedence` returns `[{"source_id", "target_id", "score"}, ...]`.
