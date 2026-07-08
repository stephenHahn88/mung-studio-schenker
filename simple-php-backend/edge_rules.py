"""Geometric edge rules for well-defined Schenkerian attachment/slur types.

Validated on the 9 GT pages (single-shot, no param tuning) vs the deployed
2-init model's HELD-OUT per-type numbers (2026-07-07):

    slur-NH   0.90 (model 0.54)     stem-NH  0.92 (0.74)
    acc-NH    0.97 (0.84)           beam-NH  0.85 (0.14)
    flag-NH   0.93-0.99 (0.66-.75)  leger-NH 0.84 (0.80)
    keysig-acc 0.99 (0.89)

The hybrid (rules for these types + model for the rest) aggregates to ~0.87
vs 0.632 model-only. Mirror of scripts/training/edge_rules_hybrid.py.
"""
from collections import defaultdict

NH = {"noteheadBlack", "noteheadHalf", "noteheadWhole"}
SLUR = {"slurStructuralUp", "slurStructuralDown", "slurStructuralUpDashed",
        "slurStructuralDownDashed", "voiceExchangeUp", "voiceExchangeDown"}
STEM = {"stemStructural"}
BEAM = {"beamStructural", "beamStructuralPartialLeft", "beamStructuralPartialMiddle",
        "beamStructuralPartialRight", "beamStructuralUnfoldingUp",
        "beamStructuralUnfoldingDown"}
FLAG = {"flagStructuralUp", "flagStructuralDown"}
LEGER = {"legerLine"}
KEYSIG = {"keySignature"}


def _acc(c):
    return c.startswith("accidental")


def is_rule_pair(cls_a, cls_b):
    """True if this class pair is decided by rules (model must skip it)."""
    for a, b in ((cls_a, cls_b), (cls_b, cls_a)):
        if a in NH and (b in SLUR or b in STEM or b in BEAM or b in FLAG
                        or b in LEGER or _acc(b)):
            return True
        if b in KEYSIG and _acc(a):
            return True
    return False


def _cx(n): return (n.left + n.right) / 2
def _cy(n): return (n.top + n.bottom) / 2


def _gap(a, b):
    dx = max(0, max(a.left, b.left) - min(a.right, b.right))
    dy = max(0, max(a.top, b.top) - min(a.bottom, b.bottom))
    return (dx * dx + dy * dy) ** 0.5


def rule_edges(nodes):
    """All rule-predicted undirected edges as a set of (id, id) tuples."""
    edges = set()
    nhs = [n for n in nodes if n.class_name in NH]
    stems = [n for n in nodes if n.class_name in STEM]
    accs = [n for n in nodes if _acc(n.class_name)]

    # slur-NH: one notehead near each endpoint, endpoints on the open side
    for s in (n for n in nodes if n.class_name in SLUR):
        ey = s.bottom if "Up" in s.class_name else s.top
        for pass_h in (30, 75):
            pair = []
            for ex in (s.left, s.right):
                cands = [n for n in nhs if abs(_cx(n) - ex) <= pass_h]
                if not cands:
                    pair = []
                    break
                cands.sort(key=lambda n: abs(_cx(n) - ex) + abs(_cy(n) - ey))
                pair.append(cands[0])
            if pair:
                break
        for n in pair:
            edges.add(tuple(sorted((s.id, n.id))))

    # stem-NH: touching notehead(s), else nearest within 25
    stem_nh = defaultdict(list)
    for st in stems:
        touch = [n for n in nhs if _gap(st, n) <= 5]
        if not touch:
            near = sorted(nhs, key=lambda n: _gap(st, n))[:1]
            touch = [n for n in near if _gap(st, n) <= 25]
        stem_nh[st.id] = touch
        for n in touch:
            edges.add(tuple(sorted((st.id, n.id))))

    # leger-NH: horizontal overlap + small vertical gap, else nearest
    for lg in (n for n in nodes if n.class_name in LEGER):
        found = False
        for n in nhs:
            xov = min(lg.right, n.right) - max(lg.left, n.left)
            if xov < 0.3 * (n.right - n.left):
                continue
            vgap = max(0, max(lg.top, n.top) - min(lg.bottom, n.bottom))
            if vgap <= 14:
                edges.add(tuple(sorted((lg.id, n.id))))
                found = True
        if not found and nhs:
            n = min(nhs, key=lambda n: _gap(lg, n))
            if _gap(lg, n) <= 30:
                edges.add(tuple(sorted((lg.id, n.id))))

    # accidental-NH: notehead to the right at similar height
    for ac in accs:
        cands = [n for n in nhs
                 if -8 <= n.left - ac.right <= 60 and abs(_cy(n) - _cy(ac)) <= 25]
        if cands:
            n = min(cands, key=lambda n: (n.left - ac.right) + 2 * abs(_cy(n) - _cy(ac)))
            edges.add(tuple(sorted((ac.id, n.id))))

    # flag-NH: via its stem, else nearest notehead
    for fl in (n for n in nodes if n.class_name in FLAG):
        st = min(stems, key=lambda s: _gap(fl, s), default=None)
        targets = []
        if st is not None and _gap(fl, st) <= 8:
            targets = stem_nh[st.id]
        if not targets and nhs:
            n = min(nhs, key=lambda n: _gap(fl, n))
            if _gap(fl, n) <= 40:
                targets = [n]
        for n in targets:
            edges.add(tuple(sorted((fl.id, n.id))))

    # beam-NH: via touching stems, plus directly-touching noteheads
    for bm in (n for n in nodes if n.class_name in BEAM):
        linked = set()
        for st in stems:
            if _gap(bm, st) <= 8:
                linked.update(n.id for n in stem_nh[st.id])
        for n in nhs:
            if _gap(bm, n) <= 4:
                linked.add(n.id)
        for nid in linked:
            edges.add(tuple(sorted((bm.id, nid))))

    # keysig-accidental: accidentals overlapping the key-signature box
    for ks in (n for n in nodes if n.class_name in KEYSIG):
        for ac in accs:
            xov = min(ks.right, ac.right) - max(ks.left, ac.left)
            yov = min(ks.bottom, ac.bottom) - max(ks.top, ac.top)
            if xov > 0.5 * (ac.right - ac.left) and yov > 0.5 * (ac.bottom - ac.top):
                edges.add(tuple(sorted((ks.id, ac.id))))

    return edges
