"""Data files of this folder (default: data/).

  categories.json                   class id -> class name
  split.json                        {"time" | "precedence": {"train" | "val" | "test": [page_id, ...]}}
  precedence/<page_id>/input.json   every symbol of the page: id, class_id, bbox = [left, top, width, height]
  precedence/<page_id>/target.json  precedence links as [source_id, target_id]
  time/<page_id>/target.json        ids of the grouped noteheads (node_ids) and their time groups
"""
import json
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[1] / 'data'


def read_json(path):
    return json.loads(Path(path).read_text())


def categories(root=DEFAULT_ROOT):
    return {c['id']: c['name'] for c in read_json(Path(root) / 'categories.json')}


def rows(root, split_file, task, part):
    """Pages of one partition, in the order of the split file."""
    return [{'page_id': p,
             'symbols_path': Path(root) / 'precedence' / p / 'input.json',
             'target_path': Path(root) / task / p / 'target.json'}
            for p in read_json(split_file)[task][part]]
