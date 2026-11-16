"""Crop layouts of the two branches.

YOLOv8L: square 1216 x 1216 tiles with stride 960; the last tile in each direction is shifted to the page edge, and
pages shorter than a tile are padded with black. Each tile owns the region between the midpoints of neighbouring
tile centres, and a prediction is kept by a tile only if its box centre lies in that region. A prediction touches an
interior tile edge when its box comes within 128 pixels of a tile side that is not a page side.

RF-DETR: full-width strips of height 768 with stride 384; the last strip is shifted to the page bottom.
"""

PATCH, STEP, MARGIN = 1216, 960, 128
STRIP_HEIGHT, STRIP_STRIDE, MIN_VISIBILITY = 768, 384, 0.9


def tile_positions(length, patch=PATCH, step=STEP):
    positions = list(range(0, max(length - patch, 0) + 1, step))
    if not positions or positions[-1] + patch < length:
        positions.append(max(length - patch, 0))
    return sorted(set(positions))


def responsibility_bounds(positions, length, patch=PATCH):
    """Ownership interval of each tile: boundaries halfway between neighbouring tile centres."""
    centers = [position + patch / 2 for position in positions]
    bounds = []
    for index in range(len(positions)):
        left = 0.0 if index == 0 else (centers[index - 1] + centers[index]) / 2
        right = float(length) if index == len(positions) - 1 else (centers[index] + centers[index + 1]) / 2
        bounds.append((left, right))
    return bounds


def owned(center, bounds, index):
    left, right = bounds[index]
    return left <= center and (center < right or index == len(bounds) - 1)


def touches_interior_tile_edge(local_box, x0, y0, width, height, patch=PATCH, margin=MARGIN):
    """True if a tile-local xyxy box lies within `margin` pixels of a tile side that is inside the page."""
    left, top, right, bottom = local_box
    return bool((x0 > 0 and left < margin) or (x0 + patch < width and right > patch - margin)
                or (y0 > 0 and top < margin) or (y0 + patch < height and bottom > patch - margin))


def strip_origins(height, strip_height=STRIP_HEIGHT, stride=STRIP_STRIDE):
    height, strip_height, stride = int(height), int(strip_height), int(stride)
    last = max(0, height - strip_height)
    origins = list(range(0, last + 1, stride))
    if origins[-1] != last:
        origins.append(last)
    return origins


def strip_boxes(width, height):
    """Full-width strips as (left, top, right, bottom) page rectangles."""
    return [(0, y, int(width), min(int(height), y + STRIP_HEIGHT)) for y in strip_origins(height)]


def clipped_xywh(box, crop):
    """Clip an xywh page box to a crop; returns (crop-local xywh or None, visible area fraction)."""
    x, y, width, height = map(float, box)
    if width <= 0 or height <= 0:
        raise ValueError('Source box must have positive area')
    left, top, right, bottom = crop
    x1, y1 = max(x, left), max(y, top)
    x2, y2 = min(x + width, right), min(y + height, bottom)
    if x2 <= x1 or y2 <= y1:
        return None, 0.0
    visible = (x2 - x1) * (y2 - y1) / (width * height)
    return [x1 - left, y1 - top, x2 - x1, y2 - y1], visible
