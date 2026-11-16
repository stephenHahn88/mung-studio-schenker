"""Voices from structural marks.

Sequences are traced along the precedence links between noteheads. Each sequence
takes a role from its first hollow notehead or beamed note: outer treble (T),
outer bass (B) or inner. Inner voices are placed in the inner treble (IT) and
inner bass (IB) lanes by their average relative vertical position, and every
notehead takes the voice of its sequence.
"""
from __future__ import annotations

from collections import defaultdict
from statistics import mean

from .mung import center, is_beam, is_hollow, is_notehead, linked, stems_of
from .pitch import line_y


def relative_position(node, staves):
    """Vertical position on the grand staff: 0 at the top line of the treble staff, 1 at the bottom line of the bass staff."""
    x, y = center(node)
    top = line_y(staves[0], x)[0]
    bottom = line_y(staves[-1], x)[-1]
    return (y - top) / (bottom - top)


def stem_direction(head, stem):
    """'up' when the end of the stem farther from the notehead centre is its top end."""
    y = center(head)[1]
    top, bottom = stem["top"], stem["top"] + stem["height"]
    return "up" if abs(y - top) > abs(y - bottom) else "down"


def is_beamed(graph, head_id):
    """A notehead linked to a beam directly or through one of its stems."""
    if linked(graph, head_id, is_beam):
        return True
    return any(linked(graph, stem["id"], is_beam) for stem in stems_of(graph, head_id))


def trace_sequences(graph, time):
    """Split the notehead precedence graph into sequences.

    A sequence follows a precedence link only where the earlier notehead has no
    other successor and the later notehead has no other predecessor.
    """
    nodes = graph["nodes"]
    heads = sorted(i for i, n in nodes.items() if is_notehead(n))
    successors, predecessors, warnings = defaultdict(list), defaultdict(list), []
    for a, b in graph["precedence"]:
        if a in time and b in time:
            if time[b] <= time[a]:
                warnings.append({"code": "precedence_not_forward", "node_ids": sorted({a, b}),
                                 "message": "This notehead precedence link does not move forward in time; it is not used for voices."})
                continue
            successors[a].append(b)
            predecessors[b].append(a)
    following = {a: s[0] for a, s in successors.items() if len(s) == 1 and len(predecessors[s[0]]) == 1}
    previous = {b: a for a, b in following.items()}
    starts = sorted((h for h in heads if h not in previous),
                    key=lambda h: (time[h], center(nodes[h])[0], h))
    sequences = []
    for head in starts:
        sequence = [head]
        while sequence[-1] in following:
            sequence.append(following[sequence[-1]])
        sequences.append(sequence)
    return sequences, warnings


def count_above_below(index, sequences, time, y):
    """How often sequence ``index`` lies above or below the other sequences at shared times."""
    own = {time[n]: n for n in sequences[index]}
    above = below = 0
    for other_index, other in enumerate(sequences):
        if other_index == index:
            continue
        for n in other:
            mine = own.get(time[n])
            if mine is None:
                continue
            above += y[mine] < y[n]
            below += y[mine] > y[n]
    return above, below


def sequence_role(graph, index, sequences, time, y, position):
    """Role (T, B or inner) of one sequence."""
    nodes = graph["nodes"]
    sequence = sequences[index]
    mark = next((n for n in sequence if is_hollow(nodes[n]) or is_beamed(graph, n)), None)
    record = {"index": index, "notes": sequence, "first_mark": mark}
    if mark is None:
        return {**record, "mark": None, "role": "inner", "rule": "no hollow notehead or beamed note"}
    if is_hollow(nodes[mark]):
        directions = {stem_direction(nodes[mark], s) for s in stems_of(graph, mark)}
        if len(directions) == 1:
            role = "T" if directions == {"up"} else "B"
            return {**record, "mark": "hollow", "role": role, "rule": f"hollow notehead, {directions.pop()}ward stem"}
        # no single stem direction: treated like a beamed note
        kind = "hollow (no single stem direction)"
    else:
        kind = "beamed"
    above, below = count_above_below(index, sequences, time, y)
    if above != below:
        role = "T" if above > below else "B"
        rule = "more often above other sequences" if above > below else "more often below other sequences"
    else:
        role = "T" if position[mark] <= .5 else "B"
        rule = "as often above as below; mark is on the " + ("treble" if role == "T" else "bass") + " staff"
    return {**record, "mark": kind, "role": role, "rule": rule, "above": above, "below": below}


def assign_voices(graph, time, staves):
    """Return the voice of every notehead and how it was obtained."""
    nodes = graph["nodes"]
    heads = sorted(i for i, n in nodes.items() if is_notehead(n))
    y = {n: center(nodes[n])[1] for n in heads}
    position = {n: relative_position(nodes[n], staves) for n in heads}
    sequences, warnings = trace_sequences(graph, time)
    records = [sequence_role(graph, k, sequences, time, y, position) for k in range(len(sequences))]
    role = {n: r["role"] for r in records for n in r["notes"]}

    # At each time position only the highest T note and the lowest B note keep
    # their role; the others become inner-voice notes.
    by_time = defaultdict(list)
    for n in heads:
        by_time[time[n]].append(n)
    demoted, demotions = set(), []
    for t in sorted(by_time):
        for outer in ("T", "B"):
            notes = [n for n in by_time[t] if role[n] == outer]
            if len(notes) < 2:
                continue
            keep = min(notes, key=lambda n: (y[n] if outer == "T" else -y[n], n))
            lost = sorted(set(notes) - {keep})
            demoted.update(lost)
            demotions.append({"time": t, "role": outer, "kept": keep, "moved_to_inner": lost})

    voice = {n: role[n] for n in heads if role[n] in ("T", "B") and n not in demoted}
    inner = []
    for record in records:
        if record["role"] == "inner":
            inner.append(list(record["notes"]))
            continue
        run = []
        for n in record["notes"] + [None]:
            if n is not None and n in demoted:
                run.append(n)
            elif run:
                inner.append(run)
                run = []

    # Inner voices are placed from the outside in: the preferred lane if it is free
    # at all of their time positions, else the other lane if it is, else the lane
    # with fewer collisions. Colliding notes stay without a voice.
    voices_inner, average = [], {}
    for k, notes in enumerate(inner):
        average[k] = mean(position[n] for n in notes)
        voices_inner.append({"notes": notes, "average_position": round(average[k], 4),
                             "preferred": "IT" if average[k] <= .5 else "IB"})
    taken = {"IT": {}, "IB": {}}
    lane_of = dict(voice)
    unplaced = []
    order = sorted(range(len(inner)), key=lambda k: (-abs(average[k] - .5), time[inner[k][0]], inner[k][0]))
    for rank, inner_voice in enumerate(voices_inner[k] for k in order):
        first = inner_voice["preferred"]
        second = "IB" if first == "IT" else "IT"
        clashes = {lane: [n for n in inner_voice["notes"] if time[n] in taken[lane]] for lane in (first, second)}
        if not clashes[first]:
            lane = first
        elif not clashes[second]:
            lane = second
        else:
            lane = first if len(clashes[first]) <= len(clashes[second]) else second
        inner_voice.update(order=rank, lane=lane, unplaced=clashes[lane])
        for n in inner_voice["notes"]:
            lane_of[n] = lane
            if time[n] in taken[lane]:
                unplaced.append({"code": "no_free_lane", "node_ids": [n],
                                 "message": f"Its inner voice is placed in {lane}, which is already taken at time position "
                                            f"{time[n]} by notehead {taken[lane][time[n]]}; this notehead is not written to the JSON."})
            else:
                taken[lane][time[n]] = n
                voice[n] = lane
    return {"voice": {n: voice.get(n) for n in heads}, "lane": lane_of, "sequences": records,
            "outer_demotions": demotions, "inner_voices": voices_inner, "unresolved": unplaced,
            "relative_position": position, "warnings": warnings}
