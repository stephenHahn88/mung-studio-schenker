# HandSchA symbol-recognition data

| File | Format |
|---|---|
| `pages/<page_id>/image.<jpg, jpeg or png>` | 47 page images |
| `symbols.coco.json` | COCO file of the 47 pages: `images` (`id`, `page_id`, `file_name` relative to this folder, `width`, `height`, `image_sha256`), 30,780 `annotations` (`bbox` = `[left, top, width, height]` in page pixels, `category_id`), 128 `categories` |
| `categories.json` | the 128 classes `[{"id", "name"}]` |
| `label_policy_log.json` | MuNG nodes that were excluded, renamed, clipped or merged when the annotations were built |
| `ignore_regions.json` | `{"pages": {page_id: [{"node_id", "class_name", "box": [left, top, right, bottom]}]}}`: boxes of class "unknown" or "unclassified", ignored in scoring |
| `split.json` | split `{"train": [...], "val": [...], "test": [...]}` (30, 7 and 10 page ids; every class on the test pages also occurs on the training pages) |

The images are copies of `dataset/pages/<page_id>/image.*`; the annotations come from
`dataset/pages/<page_id>/mung/symbols.xml` (license: `dataset/README.md`).
