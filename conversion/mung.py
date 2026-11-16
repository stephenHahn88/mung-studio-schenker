"""Read a MuNG page with syntax links, precedence links and time groups.

Syntax links are the MuNG ``Inlinks``/``Outlinks``. Precedence links are stored
as ``precedence_outlinks``/``precedence_inlinks`` DataItems, and time-group
membership as ``schenker_time_group_v1_<group id>`` DataItems on noteheads.
"""
from __future__ import annotations

import math
from pathlib import Path
import xml.etree.ElementTree as ET


class ConversionError(ValueError):
    """The page cannot be converted (unsupported layout or invalid input)."""


def read_mung(path):
    raw = Path(path).read_bytes()
    upper = raw.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise ConversionError("XML document type and entity declarations are not supported.")
    root = ET.fromstring(raw)
    if root.tag != "Nodes":
        raise ConversionError("Expected a MuNG <Nodes> root element.")
    nodes = {}
    for element in root.findall("Node"):
        node_id = int(element.findtext("Id"))
        if node_id in nodes:
            raise ConversionError(f"Duplicate node ID {node_id}.")
        data = {}
        for item in element.findall("./Data/DataItem"):
            key = item.get("key")
            if not key or key in data:
                raise ConversionError(f"Missing or duplicate DataItem key on node {node_id}: {key}")
            data[key] = item.text or ""
        node = {"id": node_id, "class_name": element.findtext("ClassName") or "", "data": data}
        for name in ("Top", "Left", "Width", "Height"):
            value = float(element.findtext(name))
            if not math.isfinite(value) or (name in ("Width", "Height") and value <= 0):
                raise ConversionError(f"Invalid {name} on node {node_id}.")
            node[name.lower()] = value
        for name in ("Inlinks", "Outlinks"):
            node[name.lower()] = sorted({int(x) for x in (element.findtext(name) or "").split()})
        nodes[node_id] = node
    syntax, precedence = set(), set()
    for node in nodes.values():
        i = node["id"]
        syntax.update((i, j) for j in node["outlinks"])
        syntax.update((j, i) for j in node["inlinks"])
        precedence.update((i, int(j)) for j in node["data"].get("precedence_outlinks", "").split())
        precedence.update((int(j), i) for j in node["data"].get("precedence_inlinks", "").split())
    for a, b in syntax | precedence:
        if a not in nodes or b not in nodes:
            raise ConversionError(f"Link {a}->{b} refers to a missing node.")
    neighbours = {i: set() for i in nodes}
    for a, b in syntax:
        neighbours[a].add(b)
        neighbours[b].add(a)
    return {"document": root.get("document", Path(path).stem), "nodes": nodes,
            "syntax": sorted(syntax), "precedence": sorted(precedence),
            "neighbours": {i: sorted(v) for i, v in neighbours.items()}}


def is_notehead(node):
    return "notehead" in node["class_name"].lower()


def is_stem(node):
    return node["class_name"].lower().startswith("stem")


def is_beam(node):
    return node["class_name"].lower().startswith("beam")


def is_hollow(node):
    name = node["class_name"].lower()
    return is_notehead(node) and any(k in name for k in ("half", "whole", "empty", "hollow"))


def center(node):
    return node["left"] + node["width"] / 2, node["top"] + node["height"] / 2


def linked(graph, node_id, predicate=None):
    """Nodes connected to ``node_id`` by a syntax link in either direction."""
    nodes = graph["nodes"]
    return [nodes[j] for j in graph["neighbours"][node_id] if predicate is None or predicate(nodes[j])]


def stems_of(graph, head_id):
    return linked(graph, head_id, is_stem)


def heads_of(graph, node_id):
    return linked(graph, node_id, is_notehead)
