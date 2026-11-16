"""Graph-to-JSON conversion of one annotated page (Algorithm 1)."""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from .annotations import read_annotations
from .depth import assign_depths
from .export import PITCH, VOICES, build_json
from .mung import ConversionError, read_mung, is_notehead
from .pitch import infer_pitches
from .temporal import order_time_groups
from .voices import assign_voices

IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png")


def find_image(mung_xml_path):
    """The page image next to the MuNG file (same file stem, original.* or image.*), or image.* one folder up."""
    path = Path(mung_xml_path)
    candidates = [path.with_name(stem + suffix) for stem in (path.stem, "original", "image") for suffix in IMAGE_SUFFIXES]
    candidates += [path.parent.parent / ("image" + suffix) for suffix in IMAGE_SUFFIXES]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise ConversionError(f"No page image found next to {path.name}; Algorithm 1 needs the page image "
                          "to detect staff lines. Pass the image path explicitly.")


def check_grand_staff(graph):
    clefs = Counter(n["class_name"] for n in graph["nodes"].values() if "clef" in n["class_name"].lower())
    if sorted(clefs.elements()) != ["fClef", "gClef"]:
        found = ", ".join(f"{count} {name}" for name, count in sorted(clefs.items())) or "no clefs"
        raise ConversionError("This converter handles pages with a single grand staff: one treble staff with a "
                              f"G clef above one bass staff with an F clef. This page has {found}.")
    if not any(is_notehead(n) for n in graph["nodes"].values()):
        raise ConversionError("The page has no noteheads.")


def convert_page(mung_xml_path, image_path=None):
    """Convert an annotated MuNG page into the JSON notation of Ni-Hahn et al.

    Returns a dict with
      ``schenkernote``: the JSON for the SchenkerNote renderer;
      ``notes``: time, pitch, voice and depth of every notehead (None where unresolved);
      ``unresolved``: noteheads that could not be written to the JSON, with reasons;
      ``warnings``: other cases worth checking (the JSON is still written);
      ``details``: time groups, sequences, inner voices and stem levels;
      ``summary``: counts.
    Raises ConversionError for pages outside the supported layout.
    """
    graph = read_mung(mung_xml_path)
    check_grand_staff(graph)
    image_path = Path(image_path) if image_path is not None else find_image(mung_xml_path)
    nodes = graph["nodes"]
    heads = sorted(i for i, n in nodes.items() if is_notehead(n))

    # Lines 1-3.
    temporal = order_time_groups(graph)
    time = temporal["time"]
    pitch = infer_pitches(graph, image_path, time)
    staves = pitch["staves"]
    if [s["name"] for s in staves] != ["treble", "bass"]:
        raise ConversionError("A treble staff above a bass staff could not be found on the page image "
                              f"(found staves: {[s['name'] for s in staves] or 'none'}).")

    # Lines 4-15.
    voices = assign_voices(graph, time, staves)
    # Lines 16-18.
    staff_by_id = {s["id"]: s for s in staves}
    spacing = {n: staff_by_id[pitch["notes"][n]["staff_id"]]["spacing"] for n in heads}
    depths = assign_depths(graph, voices["lane"], spacing)

    annotations = read_annotations(graph, time, temporal["groups"])
    unresolved = list(voices["unresolved"])
    notes, complete = [], []
    for n in heads:
        p = pitch["notes"][n]
        info = annotations["notes"][n]
        note = {"id": n, "class_name": nodes[n]["class_name"], "time": time[n], "pitch": p["pitch"],
                "voice": voices["voice"][n], "depth": depths["depth"][n], "staff": p["staff"],
                "ursatz": info["ursatz"], "flagged": info["flagged"], "parenthetical": info["parenthetical"],
                "scale_degree": info["roman_numeral"] if voices["voice"][n] == "B" and info["roman_numeral"] else info["scale_degree"],
                "written_accidental": p.get("written_accidental"), "pitch_warnings": p["warnings"]}
        if p["pitch"] is None:
            unresolved.append({"code": "pitch_unresolved", "node_ids": [n], "message": " ".join(p["warnings"])})
        elif not PITCH.fullmatch(p["pitch"]):
            unresolved.append({"code": "pitch_not_representable", "node_ids": [n],
                               "message": f"{p['pitch']} has no spelling in the JSON format (single sharps and flats, octaves 0-7)."})
        note["complete"] = all(note[k] is not None for k in ("time", "pitch", "voice", "depth")) \
            and bool(PITCH.fullmatch(note["pitch"]))
        if note["complete"]:
            complete.append(note)
        notes.append(note)

    by_id = {n["id"]: n for n in complete}
    connections = {"voiceExchangesFromTreble": [], "voiceExchangesFromBass": []}
    warnings = temporal["warnings"] + pitch["warnings"] + voices["warnings"] + depths["warnings"] + annotations["warnings"]
    for exchange in annotations["voice_exchanges"]:
        a, b = by_id.get(exchange["from"]), by_id.get(exchange["to"])
        if a and b and {a["voice"], b["voice"]} == {"T", "B"}:
            field = "voiceExchangesFromTreble" if a["voice"] == "T" else "voiceExchangesFromBass"
            connections[field].append({"from": a["time"], "to": b["time"]})
        else:
            warnings.append({"code": "voice_exchange_not_outer", "node_ids": [exchange["symbol"], exchange["from"], exchange["to"]],
                             "message": "The JSON format stores voice exchanges between the two outer voices only; this one is not written."})
    for note in notes:
        for message in note["pitch_warnings"]:
            if note["pitch"] is not None:
                warnings.append({"code": "pitch_check", "node_ids": [note["id"]], "message": message})

    omitted = sorted(n["id"] for n in notes if not n["complete"])
    metadata = {"title": graph["document"],
                "commentary": "Converted automatically from an annotated MuNG graph."
                              + (f" Noteheads not shown: {', '.join(map(str, omitted))}." if omitted else "")}
    payload = build_json(complete, len(temporal["groups"]), pitch["key"], metadata,
                         annotations["measure_lines"], connections)
    for note in notes:
        del note["pitch_warnings"]
    summary = {"noteheads": len(heads), "time_positions": len(temporal["groups"]),
               "complete_noteheads": len(complete), "noteheads_not_in_json": len(omitted),
               "notes_per_voice": {v: sum(n["voice"] == v for n in complete) for v in VOICES},
               "key": pitch["key"], "warnings": len(warnings)}
    details = {"time_groups": temporal["groups"], "horizontal_tie_breaks": temporal["horizontal_tie_breaks"],
               "sequences": voices["sequences"], "outer_role_conflicts": voices["outer_demotions"],
               "inner_voices": voices["inner_voices"], "stems": depths["stems"],
               "stem_levels": depths["levels"], "level_offsets": depths["offset"],
               "staves": [{"name": s["name"], "clef_id": s["clef_id"], "spacing": round(s["spacing"], 3)} for s in staves]}
    return {"document": graph["document"], "schenkernote": payload, "notes": notes,
            "unresolved": unresolved, "warnings": warnings, "details": details, "summary": summary}
