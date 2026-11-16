"""Algorithm 1, lines 1-2: time positions from time groups and precedence links.

Line 1 maps precedence links between structural stems to the noteheads that the
stems are attached to through syntax links. Line 2 orders the time groups
topologically along the resulting notehead precedence links. When several
groups are ready at the same step, the group with the smaller median
horizontal notehead position comes first. The index of a group in this order
is the time position of its noteheads.
"""
from __future__ import annotations

from collections import defaultdict
import json
from statistics import median

from .mung import center, heads_of, is_notehead, is_stem

GROUP_PREFIX = "schenker_time_group_v1_"


def read_time_groups(graph):
    """Return (groups, group_of, warnings) from the time-group DataItems."""
    nodes = graph["nodes"]
    heads = sorted(i for i, n in nodes.items() if is_notehead(n))
    groups, membership, warnings = {}, defaultdict(list), []
    for i, node in sorted(nodes.items()):
        for key, value in node["data"].items():
            if not key.startswith(GROUP_PREFIX):
                continue
            try:
                meta = json.loads(value)
                valid = meta.get("version") == 1 and meta.get("kind") == "shared-time"
            except (ValueError, AttributeError):
                valid = False
            if not valid:
                warnings.append(_issue("invalid_time_group", [i], f"Unreadable time-group entry {key}; ignored."))
                continue
            if i not in heads:
                warnings.append(_issue("non_notehead_in_time_group", [i], "Only noteheads can belong to a time group; ignored."))
                continue
            group_id = key[len(GROUP_PREFIX):]
            groups.setdefault(group_id, []).append(i)
            membership[i].append(group_id)
    for i in heads:
        if not membership[i]:
            group_id = f"ungrouped-{i}"
            groups[group_id] = [i]
            membership[i].append(group_id)
            warnings.append(_issue("ungrouped_notehead", [i], "Notehead has no time group; it forms its own time position."))
        elif len(membership[i]) > 1:
            warnings.append(_issue("several_time_groups", [i], "Notehead belongs to several time groups; the first one is used."))
    group_of = {i: membership[i][0] for i in heads}
    groups = {g: sorted(i for i in members if group_of[i] == g) for g, members in groups.items()}
    return {g: m for g, m in groups.items() if m}, group_of, warnings


def notehead_precedence(graph, group_of):
    """Line 1: precedence links between noteheads, including those mapped from stems.

    A stem endpoint is replaced by the noteheads linked to that stem. The link is
    kept when those noteheads lie in a single time group. Precedence links of
    other symbol families (numerals, Roman numerals) do not enter time ordering.
    """
    nodes = graph["nodes"]
    links, warnings = [], []

    def endpoint(i):
        if is_notehead(nodes[i]):
            return [i], "notehead"
        if is_stem(nodes[i]):
            return sorted(n["id"] for n in heads_of(graph, i)), "stem"
        return None, None

    for a, b in graph["precedence"]:
        heads_a, kind_a = endpoint(a)
        heads_b, kind_b = endpoint(b)
        if kind_a is None or kind_b is None:
            continue
        if not heads_a or not heads_b or len({group_of[h] for h in heads_a}) > 1 \
                or len({group_of[h] for h in heads_b}) > 1:
            warnings.append(_issue("unmapped_stem_precedence", [a, b],
                                   "A stem precedence link has no unique time group at one end; ignored for time order."))
            continue
        links.append({"source": [a, b], "heads": [heads_a[0], heads_b[0]],
                      "kind": "notehead" if kind_a == kind_b == "notehead" else "stem"})
    return links, warnings


def order_time_groups(graph):
    """Lines 1-2. Returns time groups in order and the time index of each notehead."""
    nodes = graph["nodes"]
    groups, group_of, warnings = read_time_groups(graph)
    links, link_warnings = notehead_precedence(graph, group_of)
    warnings += link_warnings
    successors = {g: set() for g in groups}
    indegree = {g: 0 for g in groups}
    for link in links:
        a, b = link["heads"]
        ga, gb = group_of[a], group_of[b]
        if ga == gb:
            warnings.append(_issue("precedence_within_time_group", link["source"],
                                   "A precedence link joins two symbols of the same time group; ignored for time order."))
        elif gb not in successors[ga]:
            successors[ga].add(gb)
            indegree[gb] += 1

    def horizontal(g):
        return median(center(nodes[i])[0] for i in groups[g]), g

    ready = sorted((g for g, d in indegree.items() if d == 0), key=horizontal)
    order, ties = [], 0
    while ready:
        ties += len(ready) > 1
        g = ready.pop(0)
        order.append(g)
        for nxt in successors[g]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                ready.append(nxt)
        ready.sort(key=horizontal)
    if len(order) < len(groups):
        rest = sorted(set(groups) - set(order), key=horizontal)
        warnings.append(_issue("precedence_cycle", [i for g in rest for i in groups[g]],
                               "Precedence links between these time groups form a cycle; they are ordered by horizontal position."))
        order += rest
    time = {i: t for t, g in enumerate(order) for i in groups[g]}
    return {"groups": [{"index": t, "id": g, "members": groups[g]} for t, g in enumerate(order)],
            "time": time, "links": links, "horizontal_tie_breaks": ties, "warnings": warnings}


def _issue(code, node_ids, message):
    return {"code": code, "node_ids": sorted(set(node_ids)), "message": message}
