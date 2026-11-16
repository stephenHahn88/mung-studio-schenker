"""Small shared helpers: JSON input/output, hashing and the symbol size L."""
import gzip
import hashlib
import json
import os
from pathlib import Path

# Pages are scaled to the most common HandSchA page size before measuring a symbol.
REFERENCE_WIDTH, REFERENCE_HEIGHT = 5100.0, 3509.0


def read_json(path):
    path = Path(path)
    if path.suffix == '.gz':
        with gzip.open(path, 'rt') as stream:
            return json.load(stream)
    return json.loads(path.read_text())


def write_json(path, value, indent=1):
    """Write JSON (gzip if the name ends in .gz) through a temporary file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    text = json.dumps(value, indent=indent)
    if path.suffix == '.gz':
        with open(temporary, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as stream:
            stream.write(text.encode())
    else:
        temporary.write_text(text + '\n')
    os.replace(temporary, path)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def symbol_size(box, width, height):
    """L: longest side of an xyxy box after scaling the page to 5100 x 3509 (width and height scaled separately)."""
    return max(REFERENCE_WIDTH * (box[2] - box[0]) / width, REFERENCE_HEIGHT * (box[3] - box[1]) / height)
