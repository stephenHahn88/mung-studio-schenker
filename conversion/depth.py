"""Structural depth from stem tips.

Noteheads without a stem get depth 0. The stems of the upper voices (T, IT) and
of the lower voices (IB, B) are layered separately by stem length (notehead
centre to the far end of the stem, in staff spaces); a longer stem marks a
deeper level. The two sets of levels are aligned at their deepest level.
"""
from __future__ import annotations

from .mung import center, is_notehead, stems_of

# a new level starts where a stem is more than LEVEL_RATIO times as long as the next shorter one
LEVEL_RATIO = 1.25
MAX_DEPTH = 12
UPPER, LOWER = ("T", "IT"), ("IB", "B")


def stem_length(head, stem, spacing):
    y = center(head)[1]
    top, bottom = stem["top"], stem["top"] + stem["height"]
    tip = top if abs(y - top) > abs(y - bottom) else bottom
    return abs(tip - y) / spacing


def layer(lengths):
    """Level 1 for the shortest stems of one group, higher for longer ones."""
    levels, level, previous = {}, 0, None
    for length, key in sorted(lengths):
        if previous is None or length > previous * LEVEL_RATIO:
            level += 1
        levels[key] = level
        previous = length
    return levels, level


def assign_depths(graph, lane, spacing):
    """Depth of every notehead.

    ``lane`` maps each notehead to the voice of its sequence (T, IT, IB or B),
    ``spacing`` maps each notehead to the line spacing of its staff in pixels.
    A notehead with several stems takes the deepest of their levels.
    """
    nodes = graph["nodes"]
    heads = sorted(i for i, n in nodes.items() if is_notehead(n))
    stems = {n: stems_of(graph, n) for n in heads}
    lengths = {"upper": [], "lower": []}
    records = []
    for n in heads:
        if lane.get(n) is None:
            continue
        group = "upper" if lane[n] in UPPER else "lower"
        for stem in stems[n]:
            length = stem_length(nodes[n], stem, spacing[n])
            lengths[group].append((length, (n, stem["id"])))
            records.append({"notehead": n, "stem": stem["id"], "group": group, "length": round(length, 3)})
    levels, counts = {}, {}
    for group, values in lengths.items():
        levels[group], counts[group] = layer(values)
    deepest = max(counts.values())
    offset = {g: deepest - c if c else 0 for g, c in counts.items()}
    stem_level = {}
    for record in records:
        key = (record["notehead"], record["stem"])
        record["level"] = levels[record["group"]][key]
        record["depth"] = min(MAX_DEPTH, record["level"] + offset[record["group"]])
        stem_level[key] = record["depth"]
    depth = {}
    for n in heads:
        if not stems[n]:
            depth[n] = 0
        elif lane.get(n) is not None:
            depth[n] = max(stem_level[(n, s["id"])] for s in stems[n])
        else:
            depth[n] = None
    warnings = []
    if deepest > MAX_DEPTH:
        warnings.append({"code": "too_many_levels", "node_ids": [],
                         "message": f"{deepest} stem levels were found; levels above {MAX_DEPTH} are written as {MAX_DEPTH}."})
    return {"depth": depth, "stems": records, "levels": counts, "offset": offset, "warnings": warnings}
