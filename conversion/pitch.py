"""Staff lines from the page image and the pitch of each notehead.

Staff lines are found as five evenly spaced long rows of dark pixels. The staff
of each clef is the detected staff whose middle line is closest to the clef.
The pitch of a notehead is the diatonic step of its nearest staff position on
its nearest staff, read with that staff's clef. An accidental linked to the
notehead sets the alteration; otherwise the key signature does. Accidentals are
not carried to later noteheads.
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image

from .mung import center, is_notehead, linked

LETTERS = "CDEFGAB"
FLAT_ORDER = "BEADGCF"
SHARP_ORDER = "FCGDAEB"
ACCIDENTALS = {"accidentalFlat": -1, "accidentalNatural": 0, "accidentalSharp": 1,
               "accidentalDoubleFlat": -2, "accidentalDoubleSharp": 2}
# Diatonic step number (7 * octave + letter index) of the bottom staff line.
CLEFS = {"gClef": ("treble", 4 * 7 + 2),  # E4
         "fClef": ("bass", 2 * 7 + 4)}    # G2
INK_THRESHOLD = 205          # gray value below which a pixel counts as ink
MIN_LINE_COVERAGE = 0.42     # fraction of the page width a staff-line row must cover
BOUNDARY_MARGIN = 0.16       # warn when a notehead is this close (in steps) to the midpoint of two positions


def key_alterations(key):
    """Alteration per letter for a key written as 0, 1f..7f or 1s..7s."""
    if key in ("0", "0f", "0s"):
        return {}
    if not isinstance(key, str) or len(key) != 2 or key[0] not in "1234567" or key[1] not in "fs":
        raise ValueError(f"Unsupported key signature {key!r}")
    order, alter = (FLAT_ORDER, -1) if key[1] == "f" else (SHARP_ORDER, 1)
    return {letter: alter for letter in order[:int(key[0])]}


def load_gray(image_path):
    rgb = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.float32)
    return rgb, rgb.mean(axis=2)


def detect_staves(gray):
    """Return every five-line staff found on the page, from top to bottom.

    Each staff has five lines (top to bottom), each a fitted ``y = slope * x +
    intercept`` that follows a slight skew, and the mean line spacing.
    """
    height, width = gray.shape
    left, right = int(width * .05), int(width * .95)
    coverage = (gray[:, left:right] < INK_THRESHOLD).mean(axis=1)
    rows = np.flatnonzero(coverage >= MIN_LINE_COVERAGE)
    clusters = []
    for y in rows:
        if not clusters or y - clusters[-1][-1] > 3:
            clusters.append([int(y)])
        else:
            clusters[-1].append(int(y))
    peaks = [int(c[int(np.argmax(coverage[c]))]) for c in clusters]
    staves, used = [], set()
    for start in range(len(peaks) - 4):
        five = peaks[start:start + 5]
        gaps = np.diff(five)
        spacing = float(np.mean(gaps))
        if spacing < 5 or spacing > height / 8 or max(abs(gaps - spacing)) > max(2.5, spacing * .16):
            continue
        if used.intersection(five):
            continue
        used.update(five)
        lines = []
        for row in five:
            xs, ys = [], []
            for lo in np.linspace(left, right, 13, dtype=int)[:-1]:
                hi = min(right, lo + max(20, (right - left) // 12))
                top, bottom = max(0, row - 4), min(height, row + 5)
                score = (gray[top:bottom, lo:hi] < INK_THRESHOLD).mean(axis=1)
                peak = int(np.argmax(score))
                if score[peak] < .40:
                    continue
                a, b = max(0, peak - 1), min(len(score), peak + 2)
                weights = np.maximum(0, score[a:b] - .25)
                xs.append((lo + hi) / 2)
                ys.append(float(np.average(np.arange(top + a, top + b), weights=weights)))
            slope, intercept = np.polyfit(xs, ys, 1) if len(xs) >= 3 else (0., float(row))
            lines.append({"slope": float(slope), "intercept": float(intercept)})
        staves.append({"id": len(staves), "lines": lines, "spacing": spacing})
    return staves


def line_y(staff, x):
    return [line["intercept"] + line["slope"] * x for line in staff["lines"]]


def staves_for_clefs(graph, staves):
    """Attach each clef to its nearest detected staff. Returns (staves, warnings)."""
    result, warnings = [], []
    for clef in sorted(graph["nodes"].values(), key=lambda n: n["id"]):
        if clef["class_name"] not in CLEFS:
            continue
        x, y = center(clef)
        if not staves:
            break
        staff = min(staves, key=lambda s: abs(line_y(s, x)[2] - y))
        if abs(line_y(staff, x)[2] - y) > 4 * staff["spacing"]:
            warnings.append({"code": "clef_without_staff", "node_ids": [clef["id"]],
                             "message": "No detected staff lies near this clef."})
            continue
        if any(s["id"] == staff["id"] for s in result):
            warnings.append({"code": "several_clefs_on_staff", "node_ids": [clef["id"]],
                             "message": "Another clef was already attached to this staff."})
            continue
        name, bottom = CLEFS[clef["class_name"]]
        result.append({**staff, "clef": clef["class_name"], "clef_id": clef["id"],
                       "name": name, "bottom_step": bottom})
    return sorted(result, key=lambda s: line_y(s, 0)[0]), warnings


def key_signatures(graph, staves):
    """Read each keySignature node from the accidentals linked to it."""
    records, warnings = [], []
    for node in sorted(graph["nodes"].values(), key=lambda n: n["id"]):
        if node["class_name"] != "keySignature":
            continue
        symbols = linked(graph, node["id"], lambda n: n["class_name"] in ACCIDENTALS)
        kinds = {s["class_name"] for s in symbols}
        if not symbols or len(symbols) > 7 or len(kinds) != 1 or not kinds <= {"accidentalFlat", "accidentalSharp"}:
            warnings.append({"code": "unreadable_key_signature", "node_ids": [node["id"]],
                             "message": "Key signature without a readable set of linked flats or sharps; ignored."})
            continue
        x, y = center(node)
        staff = min(staves, key=lambda s: abs(line_y(s, x)[2] - y))
        records.append({"node": node["id"], "staff": staff["id"],
                        "key": f"{len(symbols)}{'f' if 'accidentalFlat' in kinds else 's'}"})
    return records, warnings


def nearest_staff(note, staves):
    """Nearest staff by distance to its middle line, plus a warning if that is unclear."""
    x, y = center(note)
    ranked = sorted(staves, key=lambda s: abs(line_y(s, x)[2] - y) / s["spacing"])
    distances = [abs(line_y(s, x)[2] - y) / s["spacing"] for s in ranked]
    warning = None
    if len(distances) > 1 and distances[1] - distances[0] < 1:
        warning = "Notehead lies about halfway between the two staves; the nearer staff is used."
    elif distances[0] > 8:
        warning = "Notehead lies more than eight staff spaces from both staves; the nearer staff is used."
    return ranked[0], warning


def staff_position(note_y, x, staff):
    """Nearest diatonic step for a vertical position, and how far from it the head lies."""
    lines = line_y(staff, x)
    half_space = (lines[-1] - lines[0]) / 8
    step_float = (lines[-1] - note_y) / half_space
    step = math.floor(step_float + .5)
    return staff["bottom_step"] + step, step_float, abs(step_float - step)


def notehead_center_y(note, rgb):
    """Vertical centre of a notehead.

    Filled heads drawn in coloured ink use the wide part of the coloured stroke,
    which excludes neutral staff lines and attached stems. Hollow heads and heads
    in black or weakly coloured ink use the centre of the annotated box.
    """
    box_center = center(note)[1]
    if note["class_name"] != "noteheadBlack":
        return box_center
    x, y = int(note["left"]), int(note["top"])
    width, height = int(note["width"]), int(note["height"])
    crop = rgb[max(0, y):max(0, y) + height, max(0, x):max(0, x) + width]
    if crop.size == 0:
        return box_center
    saturated = (crop.max(axis=2) - crop.min(axis=2) > 60) & (crop.min(axis=2) < 150)
    if saturated.sum() < 8:
        return box_center
    ink = np.median(crop[saturated], axis=0)
    high, low = int(np.argmax(ink)), int(np.argmin(ink))
    if ink[high] - ink[low] < 45:
        return box_center
    colored = (crop[:, :, high] - crop[:, :, low] > 25) & (crop[:, :, low] < 160)
    if colored.mean() < .15:
        return box_center
    row_width = colored.sum(axis=1)
    if row_width.max() < width * .4:
        return box_center
    weights = row_width * row_width
    estimate = y + float(np.average(np.arange(len(weights)), weights=weights))
    if abs(estimate - box_center) > height * .3:
        return box_center
    return estimate


def spell(step, alter):
    letter, octave = LETTERS[step % 7], step // 7
    return f"{letter}{ {-2: 'bb', -1: 'b', 0: '', 1: '#', 2: '##'}[alter]}{octave}"


def infer_pitches(graph, image_path, time):
    """Return staves, key and per-notehead pitch with any warnings."""
    rgb, gray = load_gray(image_path)
    staves, warnings = staves_for_clefs(graph, detect_staves(gray))
    signatures, key_warnings = key_signatures(graph, staves) if staves else ([], [])
    warnings += key_warnings
    keys = {r["key"] for r in signatures}
    if not signatures:
        key = "0"
        warnings.append({"code": "no_key_signature", "node_ids": [],
                         "message": "No key signature is annotated; the page is read without one."})
    else:
        treble = [r["key"] for r in signatures if staves and r["staff"] == staves[0]["id"]]
        key = treble[0] if treble else sorted(keys)[0]
        if len(keys) > 1:
            warnings.append({"code": "different_key_signatures", "node_ids": [r["node"] for r in signatures],
                             "message": f"The staves have different key signatures; the JSON key is {key}, pitches use each staff's own key."})
    notes = {}
    if not staves:
        return {"staves": [], "key": key, "notes": notes, "warnings": warnings}
    earlier = {}
    heads = sorted((n for n in graph["nodes"].values() if is_notehead(n)),
                   key=lambda n: (time[n["id"]], center(n)[0], n["id"]))
    for node in heads:
        staff, staff_warning = nearest_staff(node, staves)
        own = [r["key"] for r in signatures if r["staff"] == staff["id"]]
        staff_key = own[0] if own else key
        x = center(node)[0]
        step, step_float, residual = staff_position(notehead_center_y(node, rgb), x, staff)
        attached = linked(graph, node["id"], lambda n: n["class_name"] in ACCIDENTALS)
        record = {"staff": staff["name"], "staff_id": staff["id"], "step": step,
                  "step_float": round(step_float, 3), "accidentals": [a["id"] for a in attached],
                  "pitch": None, "warnings": [staff_warning] if staff_warning else []}
        notes[node["id"]] = record
        values = {ACCIDENTALS[a["class_name"]] for a in attached}
        if len(values) > 1:
            record["warnings"].append("Conflicting accidentals are linked to this notehead.")
            continue
        alter = values.pop() if values else key_alterations(staff_key).get(LETTERS[step % 7], 0)
        if attached:
            record["written_accidental"] = {-1: "flat", 0: "natural", 1: "sharp"}.get(alter)
        record["pitch"] = spell(step, alter)
        if residual >= .5 - BOUNDARY_MARGIN:
            record["warnings"].append("Notehead lies near the boundary between two staff positions.")
        place = (staff["id"], step)
        if not attached and place in earlier and earlier[place] != alter:
            record["warnings"].append("An earlier notehead at the same staff position has a different linked accidental.")
        if attached:
            earlier[place] = alter
    return {"staves": staves, "key": key, "notes": notes, "warnings": warnings}
