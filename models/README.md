Place local detector model files in this directory.

Download the prepared model package from Google Drive:

```text
https://drive.google.com/file/d/1RsXbsR17CwZLJQ7G-Iiw7xSl3RtpcHZp/view?usp=drive_link
```

Unzip the package in the repository root, not inside this directory. After
extraction, this directory should contain the files and folders listed below.

YOLO model weights:

- yolo26l_all9_fixed_ep100_tiled_ep100.pt
- yolo26l_large_fullwidth_7pages_pre.pt
- yolo26l_tiled_7pages_pre.pt
- yolo26l_large_fullwidth_9pages_pre_ep300.pt
- yolo26l_tiled_9pages_pre_ep300.pt
- yolo26l_tiled_9pages_pre_ep200.pt

Place local DETR model directories in this shape:

```text
models/detr_large_fullwidth_9pages_ep90/model/
models/detr_large_fullwidth_9pages_boxfocused_ep200/model/
models/detr_large_9pages_copypaste_ep50/model/
models/detr_large_9pages_plus50/model/
models/detr_tiled_9pages_plus50/model/
```

These files are intentionally not tracked by git.

Learned edge model bundle:

```
models/edge_all9_production/
  COMPLETE
  bundle.json
  direction.joblib
  incidence.pth
  incidence_initialization.pth
  proposal.pth
  vcnn.pth
```

The backend verifies the production marker, the no-rules inference contract,
and every declared artifact size and SHA-256 before loading this bundle. The
directory can be overridden with `EDGE_LEARNED_BUNDLE_DIR`.

The fixed-epoch-100 tiled file is the default small-symbol detector. It must be
present before enabling small-symbol detection; the backend lists a missing
model but does not silently fall back. Override its directory with
`YOLO26_ALL9_FIXED_EP100_MODELS_DIR`, or override the file with
`YOLO26_ALL9_FIXED_EP100_TILED_MODEL`. Large-symbol detection defaults to the
5-model MuSViT ensemble registered in `simple-php-backend/yolo26_inference.py`.

The backend checks local paths first and then falls back to the server paths
registered in `simple-php-backend/yolo26_inference.py`:

- YOLO26L, 7 pages
- YOLO26L, 9 pages, 300 epochs
- YOLO26L, 9 pages, 200 epochs
- DETR, 9 pages, 90 epochs
- DETR box-focused, 9 pages, 200 epochs
- DETR copy-paste, 9 pages, 50 epochs
- DETR, 9 pages, 200 epochs
- DETR, 9 pages, 170 epochs

Override those paths with the matching environment variables if the model files
live somewhere else on the machine running the backend.
