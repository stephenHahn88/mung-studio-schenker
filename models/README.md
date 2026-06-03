Place local detector model files in this directory.

Download the prepared model package from Google Drive:

```text
https://drive.google.com/file/d/1RsXbsR17CwZLJQ7G-Iiw7xSl3RtpcHZp/view?usp=drive_link
```

Unzip the package in the repository root, not inside this directory. After
extraction, this directory should contain the files and folders listed below.

YOLO model weights:

- yolo26l_large_fullwidth_7pages_pre.pt
- yolo26l_tiled_7pages_pre.pt
- yolo26l_large_fullwidth_9pages_pre_ep300.pt
- yolo26l_tiled_9pages_pre_ep300.pt

Place local DETR model directories in this shape:

```text
models/detr_large_9pages_plus50/model/
models/detr_tiled_9pages_plus50/model/
```

These files are intentionally not tracked by git.

The backend checks local paths first and then falls back to the server paths
registered in `simple-php-backend/yolo26_inference.py`:

- YOLO26L, 7 pages
- YOLO26L, 9 pages, 300 epochs
- DETR, 9 pages, 200 epochs
- DETR, 9 pages, 170 epochs

Override those paths with the matching environment variables if the model files
live somewhere else on the machine running the backend.
