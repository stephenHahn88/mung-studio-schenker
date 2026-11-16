# Models

The syntax-link, time-group and precedence-link models are in this folder. The symbol-detection checkpoints are
assets of the GitHub release `v1.0`; download them from the repository root:

```bash
R=https://github.com/stephenHahn88/mung-studio-schenker/releases/download/v1.0
mkdir -p models/symbol_recognition/yolov8l models/symbol_recognition/rfdetr_branch
curl -L -o models/symbol_recognition/yolov8l/HandSchA_seed20261021.pt $R/HandSchA_seed20261021.pt
curl -L -o models/symbol_recognition/rfdetr_branch/HandSchA_seed43.pth $R/HandSchA_seed43.pth
curl -L -o models/symbol_recognition/yolov8l/MUSCIMA_M_seed20261027.pt $R/MUSCIMA_M_seed20261027.pt
curl -L -o models/symbol_recognition/rfdetr_branch/MUSCIMA_M_seed20261027.pth $R/MUSCIMA_M_seed20261027.pth
```

| Path | Model | Code and split |
|---|---|---|
| `symbol_recognition/yolov8l/HandSchA_seed20261021.pt` | YOLOv8L branch, HandSchA | `experiments/symbol_recognition/`, `data/split.json` |
| `symbol_recognition/rfdetr_branch/HandSchA_seed43.pth` | RF-DETR branch, HandSchA | `experiments/symbol_recognition/`, `data/split.json` |
| `symbol_recognition/yolov8l/MUSCIMA_M_seed20261027.pt` | YOLOv8L branch, MUSCIMA++ | `experiments/symbol_recognition/`, `muscima/completeomr_split.json` |
| `symbol_recognition/rfdetr_branch/MUSCIMA_M_seed20261027.pth` | RF-DETR branch, MUSCIMA++ | `experiments/symbol_recognition/`, `muscima/completeomr_split.json` |
| `syntax_links/incidence/handscha/heldout/seed_42/` | syntax-link model folder | `experiments/syntax_links/`, `data/split.json` |
| `syntax_links/pair_cnn/handscha/heldout_seed42.pth` | CNN of the syntax-link model folder (copied there as `pair_cnn.pth`) | `experiments/syntax_links/`, `data/split.json` |
| `temporal_relations/hgb/time_groups_heldout_rachmaninov_seed42.joblib` | time-group model | `experiments/temporal_relations/`, `data/split.json` |
| `temporal_relations/hgb/precedence_heldout_rachmaninov_seed43.joblib` | precedence-link model | `experiments/temporal_relations/`, `data/split.json` |

The annotation tool uses the two HandSchA symbol checkpoints and these relation models ([`docs/model-actions.md`](../docs/model-actions.md)).

## Licenses

- YOLOv8L weights: AGPL-3.0 (Ultralytics).
- Models trained on MUSCIMA++: CC BY-NC-SA 4.0.
- Models trained on HandSchA: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
