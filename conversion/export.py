"""Write and check the four-lane JSON notation of Ni-Hahn et al.

Each lane (trebleNotes, innerTrebleNotes, innerBassNotes, bassNotes) has one
column per time position. A column holds a natural pitch name such as "B4" or
"_" for no note, a depth from 0 to 12, and a duration (null, since Schenkerian
graphs do not encode durations). Alterations are stored as column indices in
the sharps, flats and naturals lists when they differ from the key or are
written explicitly. scaleDegree (and localKey in the bass lane) are matrices
with one row per depth.
"""
from __future__ import annotations

import math
import re

VOICES = {"T": "trebleNotes", "IT": "innerTrebleNotes", "IB": "innerBassNotes", "B": "bassNotes"}
META_FIELDS = ("analyst", "composer", "title", "subtitle", "commentary")
INDICATORS = ("selected", "ursatz", "flagged", "sharps", "flats", "naturals", "parenthetical")
KEYS = {"0"} | {f"{i}{kind}" for i in range(1, 8) for kind in "sf"}
MAX_DEPTH = 12
PITCH = re.compile(r"([A-G])([#b]?)([0-7])")


def _integer(value):
    return type(value) is int


def validate(payload):
    """Return a list of format errors (empty when the JSON is valid)."""
    errors = []
    if not isinstance(payload, dict):
        return ["the JSON must be an object"]
    required = {"metadata", "key", "measureLines", "noteConnections", *VOICES.values()}
    if set(payload) != required:
        errors.append(f"root fields differ: missing {sorted(required - set(payload))}, extra {sorted(set(payload) - required)}")
    if payload.get("key") not in KEYS:
        errors.append("key must be 0, 1s..7s or 1f..7f")
    meta = payload.get("metadata")
    if not isinstance(meta, dict) or set(meta) != set(META_FIELDS) or any(not isinstance(v, str) for v in meta.values()):
        errors.append("metadata must contain exactly the five string fields")
    treble = payload.get("trebleNotes", {})
    count = len(treble.get("pitchNames", [])) if isinstance(treble, dict) and isinstance(treble.get("pitchNames"), list) else 0
    if count <= 0:
        errors.append("at least one time position is required")
    for name in VOICES.values():
        obj = payload.get(name)
        fields = {"pitchNames", "depths", "durations", "scaleDegree", *INDICATORS}
        if name == "bassNotes":
            fields.add("localKey")
        if not isinstance(obj, dict):
            errors.append(f"{name} must be an object")
            continue
        if set(obj) != fields:
            errors.append(f"{name}: fields differ")
        for field in ("pitchNames", "depths", "durations"):
            if not isinstance(obj.get(field), list) or len(obj[field]) != count:
                errors.append(f"{name}.{field}: expected {count} columns")
        pitches = obj.get("pitchNames") if isinstance(obj.get("pitchNames"), list) else []
        for i, pitch in enumerate(pitches):
            if not isinstance(pitch, str) or not (pitch == "_" or re.fullmatch(r"[A-G][0-7]", pitch)):
                errors.append(f"{name}.pitchNames[{i}]: expected a natural pitch C0..B7 or _")
        depths = obj.get("depths") if isinstance(obj.get("depths"), list) else []
        for i, depth in enumerate(depths):
            if not _integer(depth) or not 0 <= depth <= MAX_DEPTH:
                errors.append(f"{name}.depths[{i}]: expected an integer 0..12")
            if i < len(pitches) and pitches[i] == "_" and depth != 0:
                errors.append(f"{name}: empty column {i} has a nonzero depth")
        durations = obj.get("durations") if isinstance(obj.get("durations"), list) else []
        for i, duration in enumerate(durations):
            if duration is not None and (type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0):
                errors.append(f"{name}.durations[{i}]: expected a positive number or null")
            if i < len(pitches) and pitches[i] == "_" and duration is not None:
                errors.append(f"{name}: empty column {i} has a duration")
        for field in INDICATORS:
            values = obj.get(field)
            if not isinstance(values, list) or any(not _integer(i) or not 0 <= i < count for i in values):
                errors.append(f"{name}.{field}: invalid column list")
                continue
            if len(values) != len(set(values)):
                errors.append(f"{name}.{field}: duplicate column")
            if any(i < len(pitches) and pitches[i] == "_" for i in values):
                errors.append(f"{name}.{field}: refers to an empty column")
        accidentals = [obj.get(field, []) for field in ("sharps", "flats", "naturals")]
        if all(isinstance(v, list) for v in accidentals):
            flat_list = sum(accidentals, [])
            if len(flat_list) != len(set(flat_list)):
                errors.append(f"{name}: several accidentals in one column")
        for field in ("scaleDegree", "localKey") if name == "bassNotes" else ("scaleDegree",):
            matrix = obj.get(field)
            if not isinstance(matrix, list) or len(matrix) != MAX_DEPTH + 1:
                errors.append(f"{name}.{field}: expected 13 depth rows")
                continue
            for depth, row in enumerate(matrix):
                if not isinstance(row, list) or len(row) != count:
                    errors.append(f"{name}.{field}[{depth}]: expected {count} columns")
                    continue
                for i, value in enumerate(row):
                    valid = (_integer(value) and 0 <= value <= 9) if field == "scaleDegree" else isinstance(value, str)
                    if not valid:
                        errors.append(f"{name}.{field}[{depth}][{i}]: invalid value")
                    elif value not in (0, "") and (i >= len(pitches) or pitches[i] == "_"):
                        errors.append(f"{name}.{field}[{depth}][{i}]: annotation on an empty column")
                    elif value not in (0, "") and i < len(depths) and _integer(depths[i]) and depth > depths[i]:
                        errors.append(f"{name}.{field}[{depth}][{i}]: annotation deeper than its note")
    bars = payload.get("measureLines")
    if not isinstance(bars, list) or any(not _integer(i) or not 0 <= i < count for i in bars) or len(bars) != len(set(bars)):
        errors.append("measureLines: invalid column indices")
    connections = payload.get("noteConnections")
    lanes = {"voiceExchangesFromTreble": ("trebleNotes", "bassNotes"), "voiceExchangesFromBass": ("bassNotes", "trebleNotes")}
    if not isinstance(connections, dict) or set(connections) != set(lanes):
        errors.append("noteConnections: invalid fields")
    else:
        for field, (from_lane, to_lane) in lanes.items():
            edges = connections[field]
            if not isinstance(edges, list):
                errors.append(f"{field}: expected a list")
                continue
            for edge in edges:
                if not isinstance(edge, dict) or set(edge) != {"from", "to"} or any(not _integer(i) or not 0 <= i < count for i in edge.values()):
                    errors.append(f"{field}: invalid endpoints")
                    continue
                for lane, end in ((from_lane, "from"), (to_lane, "to")):
                    pitches = payload.get(lane, {}).get("pitchNames", [])
                    if isinstance(pitches, list) and edge[end] < len(pitches) and pitches[edge[end]] == "_":
                        errors.append(f"{field}: endpoint refers to an empty {lane} column")
    return errors


def key_alteration_name(key, letter):
    if key == "0":
        return "natural"
    order = "FCGDAEB" if key.endswith("s") else "BEADGCF"
    return ("sharp" if key.endswith("s") else "flat") if letter in order[:int(key[0])] else "natural"


def build_json(notes, time_count, key, metadata=None, measure_lines=(), connections=None):
    """Build the JSON from complete notes.

    Each note is a dict with ``time``, ``voice`` (T, IT, IB or B), ``pitch``
    (e.g. "Bb4"), ``depth`` and optional ``written_accidental`` ("sharp", "flat"
    or "natural"), ``ursatz``, ``flagged``, ``parenthetical`` and
    ``scale_degree``. Raises ValueError if a note does not fit the format.
    """
    if key not in KEYS:
        raise ValueError(f"Unsupported key {key!r}")
    metadata = metadata or {}
    payload = {"metadata": {field: metadata.get(field, "") for field in META_FIELDS}, "key": key,
               "measureLines": sorted(measure_lines),
               "noteConnections": connections or {"voiceExchangesFromTreble": [], "voiceExchangesFromBass": []}}
    for voice, lane in VOICES.items():
        payload[lane] = {"pitchNames": ["_"] * time_count, "depths": [0] * time_count,
                         "durations": [None] * time_count, "scaleDegree": [[0] * time_count for _ in range(MAX_DEPTH + 1)],
                         **{field: [] for field in INDICATORS}}
        if voice == "B":
            payload[lane]["localKey"] = [[""] * time_count for _ in range(MAX_DEPTH + 1)]
    for note in notes:
        lane = payload[VOICES[note["voice"]]]
        t = note["time"]
        if lane["pitchNames"][t] != "_":
            raise ValueError(f"Two notes in {note['voice']} at time position {t}")
        match = PITCH.fullmatch(note["pitch"])
        if not match or not _integer(note["depth"]) or not 0 <= note["depth"] <= MAX_DEPTH:
            raise ValueError(f"Note at {note['voice']} {t} has an unsupported pitch or depth")
        letter, alteration, octave = match.groups()
        actual = {"#": "sharp", "b": "flat", "": "natural"}[alteration]
        lane["pitchNames"][t] = letter + octave
        lane["depths"][t] = note["depth"]
        for field in ("ursatz", "flagged", "parenthetical"):
            if note.get(field):
                lane[field].append(t)
        if note.get("written_accidental") is not None or actual != key_alteration_name(key, letter):
            lane[{"sharp": "sharps", "flat": "flats", "natural": "naturals"}[actual]].append(t)
        if note.get("scale_degree") is not None:
            lane["scaleDegree"][note["depth"]][t] = note["scale_degree"]
    for lane in VOICES.values():
        for field in INDICATORS:
            payload[lane][field].sort()
    errors = validate(payload)
    if errors:
        raise ValueError("; ".join(errors))
    return payload
