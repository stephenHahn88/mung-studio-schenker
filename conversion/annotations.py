"""Annotated symbols that fill the remaining fields of the JSON format.

They are copied from symbols linked to noteheads, directly or through a stem:

* ursatz: hollow noteheads;
* flagged: noteheads with a linked flag;
* parenthetical: noteheads with linked implied-note parentheses;
* scale degrees: numerals 1-7 linked to a scale-degree caret;
* Roman numerals (written into the bass lane's scaleDegree field);
* voice exchanges between the two outer voices;
* measure lines from barlines.
"""
from __future__ import annotations

import re

from .mung import center, heads_of, is_hollow, is_notehead, is_stem, linked

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7}


def attached_heads(graph, node_id):
    """Noteheads linked to a symbol directly or through a linked stem."""
    ids = {n["id"] for n in heads_of(graph, node_id)}
    for stem in linked(graph, node_id, is_stem):
        ids.update(n["id"] for n in heads_of(graph, stem["id"]))
    return sorted(ids)


def read_annotations(graph, time, groups):
    nodes = graph["nodes"]
    heads = sorted(i for i, n in nodes.items() if is_notehead(n))
    per_note = {}
    for n in heads:
        near = linked(graph, n)
        for stem in linked(graph, n, is_stem):
            near += linked(graph, stem["id"])
        names = {x["class_name"].lower() for x in near}
        per_note[n] = {"ursatz": is_hollow(nodes[n]), "flagged": any("flag" in c for c in names),
                       "parenthetical": any(c.startswith("parensimplied") for c in names),
                       "scale_degree": None, "roman_numeral": None}
    warnings, exchanges, measure_lines = [], [], set()
    for node in sorted(nodes.values(), key=lambda n: n["id"]):
        name = node["class_name"]
        numeral = re.fullmatch(r"numeral([1-7])", name)
        roman = re.fullmatch(r"numeralRoman([IV]+)", name)
        if numeral and linked(graph, node["id"], lambda x: x["class_name"] == "scaleDegreeMark"):
            for n in attached_heads(graph, node["id"]):
                if per_note[n]["scale_degree"] not in (None, int(numeral[1])):
                    warnings.append({"code": "several_scale_degrees", "node_ids": [n],
                                     "message": "Several scale-degree numerals are linked to this notehead; the last one is used."})
                per_note[n]["scale_degree"] = int(numeral[1])
        elif roman and roman[1] in ROMAN:
            ids = attached_heads(graph, node["id"])
            for n in ids:
                per_note[n]["roman_numeral"] = ROMAN[roman[1]]
            extra = [x["id"] for x in linked(graph, node["id"]) if not is_notehead(x) and not is_stem(x)]
            if extra:
                warnings.append({"code": "roman_numeral_modifiers", "node_ids": sorted(ids + extra),
                                 "message": "Symbols linked to this Roman numeral (e.g. figures or accidentals) have no field in the JSON; only the numeral is written."})
        elif name.startswith("voiceExchange"):
            ids = attached_heads(graph, node["id"])
            if len(ids) == 2:
                first, second = sorted(ids, key=lambda i: (time[i], i))
                exchanges.append({"symbol": node["id"], "from": first, "to": second})
            else:
                warnings.append({"code": "unreadable_voice_exchange", "node_ids": [node["id"]] + ids,
                                 "message": "A voice exchange should be linked to exactly two noteheads; ignored."})
        elif "barline" in name.lower():
            x = center(node)[0]
            before = [g["index"] for g in groups if max(center(nodes[i])[0] for i in g["members"]) < x]
            if before and max(before) < len(groups) - 1:
                measure_lines.add(max(before))
    return {"notes": per_note, "voice_exchanges": exchanges,
            "measure_lines": sorted(measure_lines), "warnings": warnings}
