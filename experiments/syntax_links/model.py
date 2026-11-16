"""Syntax-link model: PairCNN mask features, box geometry, incidence attention, losses, direction classifier."""
from __future__ import annotations
import math
from dataclasses import dataclass
import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

VIS_DIM = 128
NODE_GEO_DIM = 8
EDGE_GEO_DIM = 16
INC_GEO_DIM = 10
CROP_W, CROP_H = 256, 128
MARGIN = 0.15


def bbox_gap(a, b) -> float:
    dx = max(0, max(a.left, b.left) - min(a.right, b.right))
    dy = max(0, max(a.top, b.top) - min(a.bottom, b.bottom))
    return float((dx * dx + dy * dy) ** 0.5)


def pair_crop(img, a, b):
    """3xHxW float32: page crop and the box masks of a and b, resized to 128x256."""
    H, W = img.shape
    x0 = min(a.left, b.left); x1 = max(a.right, b.right)
    y0 = min(a.top, b.top);   y1 = max(a.bottom, b.bottom)
    mw = max(int((x1 - x0) * MARGIN), 8)
    mh = max(int((y1 - y0) * MARGIN), 8)
    cx0, cx1 = max(0, x0 - mw), min(W, x1 + mw)
    cy0, cy1 = max(0, y0 - mh), min(H, y1 + mh)
    crop = img[cy0:cy1, cx0:cx1]
    if crop.size == 0:
        crop = np.zeros((8, 8), np.uint8)
        cy0 = cx0 = 0
    ch, cw = crop.shape
    sx, sy = CROP_W / max(cw, 1), CROP_H / max(ch, 1)
    c1 = cv2.resize(crop * 255, (CROP_W, CROP_H),
                    interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0

    def box_mask(n):
        m = np.zeros((CROP_H, CROP_W), np.float32)
        bx0 = int((n.left - cx0) * sx); bx1 = int((n.right - cx0) * sx)
        by0 = int((n.top - cy0) * sy);  by1 = int((n.bottom - cy0) * sy)
        m[max(0, by0):min(CROP_H, by1 + 1), max(0, bx0):min(CROP_W, bx1 + 1)] = 1.0
        return m

    return np.stack([c1, box_mask(a), box_mask(b)])


class PairCNN(nn.Module):
    """Five conv blocks (3x3 conv, batch norm, ReLU, 2x2 max pool), global average pooling and a linear head."""

    def __init__(self):
        super().__init__()
        chans = [3, 16, 32, 64, 128, 128]
        layers = []
        for i in range(5):
            layers += [nn.Conv2d(chans[i], chans[i + 1], 3, padding=1),
                       nn.BatchNorm2d(chans[i + 1]), nn.ReLU(),
                       nn.MaxPool2d(2)]
        self.features = nn.Sequential(*layers)
        self.head = nn.Linear(chans[-1], 1)

    def forward(self, x):
        h = self.features(x)
        h = h.mean(dim=(2, 3))
        return self.head(h).squeeze(-1)


def center(node) -> tuple[float, float]:
    return 0.5 * (node.left + node.right), 0.5 * (node.top + node.bottom)


@dataclass
class PageGraph:
    name: str
    nodes: list
    node_cls: np.ndarray
    node_geo: np.ndarray
    edges: np.ndarray
    edge_geo: np.ndarray
    incidence_geo: np.ndarray
    labels: np.ndarray
    visual: np.ndarray | None = None
    cnn_logit: np.ndarray | None = None


def node_geometry(nodes, width: float, height: float) -> np.ndarray:
    """Box geometry of each symbol."""
    out = np.zeros((len(nodes), NODE_GEO_DIM), dtype=np.float32)
    for i, n in enumerate(nodes):
        cx, cy = center(n)
        w = max(float(n.right - n.left), 1.0)
        h = max(float(n.bottom - n.top), 1.0)
        out[i] = (n.left / width, n.top / height, n.right / width, n.bottom / height,
                  cx / width, cy / height, w / width, h / height)
    return out


def pair_geometry(a, b, width: float, height: float) -> np.ndarray:
    """Pair geometry that does not change when a and b are exchanged."""
    acx, acy = center(a)
    bcx, bcy = center(b)
    aw = max(float(a.right - a.left), 1.0)
    ah = max(float(a.bottom - a.top), 1.0)
    bw = max(float(b.right - b.left), 1.0)
    bh = max(float(b.bottom - b.top), 1.0)
    dx, dy = abs(bcx - acx), abs(bcy - acy)
    xgap = max(0.0, max(a.left, b.left) - min(a.right, b.right))
    ygap = max(0.0, max(a.top, b.top) - min(a.bottom, b.bottom))
    xov = max(0.0, min(a.right, b.right) - max(a.left, b.left))
    yov = max(0.0, min(a.bottom, b.bottom) - max(a.top, b.top))
    ux0, ux1 = min(a.left, b.left), max(a.right, b.right)
    uy0, uy1 = min(a.top, b.top), max(a.bottom, b.bottom)
    inter = xov * yov
    union = aw * ah + bw * bh - inter
    diag = max(math.hypot(width, height), 1.0)
    return np.asarray([
        dx / width, dy / height, math.hypot(dx, dy) / diag, bbox_gap(a, b) / diag,
        xgap / width, ygap / height, xov / min(aw, bw), yov / min(ah, bh),
        (ux1 - ux0) / width, (uy1 - uy0) / height,
        min(aw, bw) / max(aw, bw), min(ah, bh) / max(ah, bh),
        abs(math.log(aw / bw)), abs(math.log(ah / bh)),
        inter / max(union, 1.0), abs(math.log((aw * ah) / (bw * bh))),
    ], dtype=np.float32)


def directed_geometry(a, b, width: float, height: float) -> np.ndarray:
    """Directed incidence geometry from a to b, clipped to [-10, 10]."""
    acx, acy = center(a)
    bcx, bcy = center(b)
    aw = max(float(a.right - a.left), 1.0)
    ah = max(float(a.bottom - a.top), 1.0)
    bw = max(float(b.right - b.left), 1.0)
    bh = max(float(b.bottom - b.top), 1.0)
    vals = np.asarray([
        (bcx - acx) / width, (bcy - acy) / height,
        (bcx - acx) / math.sqrt(aw * bw), (bcy - acy) / math.sqrt(ah * bh),
        math.log(bw / aw), math.log(bh / ah),
        (b.left - a.right) / width, (b.right - a.left) / width,
        (b.top - a.bottom) / height, (b.bottom - a.top) / height,
    ], dtype=np.float32)
    return np.clip(vals, -10.0, 10.0)


class EdgeCropDataset(torch.utils.data.Dataset):
    def __init__(self, image: np.ndarray, nodes: list, edges: list[tuple[int, int]]):
        self.image = image
        self.nodes = nodes
        self.edges = edges

    def __len__(self) -> int:
        return len(self.edges)

    def __getitem__(self, index: int) -> np.ndarray:
        i, j = self.edges[index]
        return pair_crop(self.image, self.nodes[i], self.nodes[j])


def load_pair_cnn(checkpoint: str, device: str) -> PairCNN:
    model = PairCNN().to(device)
    model.load_state_dict(torch.load(checkpoint, map_location=device)["model"])
    model.eval()
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    return model


@torch.inference_mode()
def encode_pairs(model: PairCNN, graph: PageGraph, height: int, width: int, device: str,
                 batch_size: int = 256, workers: int = 4) -> tuple[np.ndarray, np.ndarray]:
    """Frozen-CNN features (float16) and logits (float32) of every candidate.

    The page channel is left empty, so only the two box masks enter the CNN. Features
    are averaged over both mask orders and the logit is computed from the average.
    """
    image = np.zeros((height, width), np.uint8)
    loader = torch.utils.data.DataLoader(
        EdgeCropDataset(image, graph.nodes, [tuple(map(int, e)) for e in graph.edges]),
        batch_size=batch_size, shuffle=False, num_workers=workers,
        pin_memory=device.startswith("cuda"))
    encoded, logits = [], []
    for crops in loader:
        crops = crops.to(device, non_blocking=True)
        crops = crops.clone()
        crops[:, 0].zero_()
        feat = model.features(crops).mean(dim=(2, 3))
        swapped = crops[:, [0, 2, 1]]
        feat = 0.5 * (feat + model.features(swapped).mean(dim=(2, 3)))
        encoded.append(feat.cpu().numpy().astype(np.float16))
        logits.append(model.head(feat).squeeze(-1).cpu().numpy())
    visual = np.concatenate(encoded) if encoded else np.zeros((0, VIS_DIM), np.float16)
    logit = np.concatenate(logits) if logits else np.zeros((0,), np.float32)
    return visual, logit.astype(np.float32)


def scatter_softmax(scores: torch.Tensor, index: torch.Tensor, size: int) -> torch.Tensor:
    """Softmax over the incidences that share a symbol, separately for each channel."""
    expanded = index[:, None].expand_as(scores)
    maxima = torch.full((size, scores.shape[1]), -torch.inf, dtype=scores.dtype, device=scores.device)
    maxima.scatter_reduce_(0, expanded, scores, reduce="amax", include_self=True)
    numer = torch.exp(scores - maxima[index])
    denom = torch.zeros_like(maxima)
    denom.scatter_add_(0, expanded, numer)
    return numer / denom[index].clamp_min(1e-9)


class IncidenceAttentionLayer(nn.Module):
    """One round: incidence tokens, K-channel attention pooling per symbol, symbol and candidate updates."""

    def __init__(self, hidden: int, ports: int):
        super().__init__()
        if hidden % ports:
            raise ValueError("hidden dimension must be divisible by the number of channels")
        self.hidden = hidden
        self.ports = ports
        self.port_dim = hidden // ports
        self.incidence = nn.Sequential(
            nn.Linear(hidden * 3 + INC_GEO_DIM, hidden * 2), nn.GELU(),
            nn.Linear(hidden * 2, hidden), nn.LayerNorm(hidden))
        self.attention = nn.Linear(hidden, ports)
        self.value = nn.Linear(hidden, hidden)
        self.context = nn.Linear(hidden, hidden)
        self.node_update = nn.Sequential(
            nn.Linear(hidden * 2, hidden * 2), nn.GELU(), nn.Dropout(0.1), nn.Linear(hidden * 2, hidden))
        self.edge_update = nn.Sequential(
            nn.Linear(hidden * 5 + EDGE_GEO_DIM, hidden * 2), nn.GELU(), nn.Dropout(0.1),
            nn.Linear(hidden * 2, hidden))
        self.node_norm = nn.LayerNorm(hidden)
        self.edge_norm = nn.LayerNorm(hidden)

    def forward(self, node_h, edge_h, edges, incidence_geo, edge_geo):
        edge_ids = torch.arange(edges.shape[0], device=edges.device)
        inc_node = torch.cat((edges[:, 0], edges[:, 1]))
        inc_other = torch.cat((edges[:, 1], edges[:, 0]))
        inc_edge = torch.cat((edge_ids, edge_ids))
        token = self.incidence(torch.cat(
            (node_h[inc_node], node_h[inc_other], edge_h[inc_edge], incidence_geo), dim=-1))
        weights = scatter_softmax(self.attention(token), inc_node, len(node_h))
        values = self.value(token).view(-1, self.ports, self.port_dim)
        messages = weights[:, :, None] * values
        context = torch.zeros((len(node_h), self.ports, self.port_dim), dtype=node_h.dtype, device=node_h.device)
        context.index_add_(0, inc_node, messages)
        context = self.context(context.reshape(len(node_h), self.hidden))
        node_h = self.node_norm(node_h + self.node_update(torch.cat((node_h, context), -1)))
        i, j = edges[:, 0], edges[:, 1]
        edge_delta = self.edge_update(torch.cat((
            edge_h, node_h[i] + node_h[j], torch.abs(node_h[i] - node_h[j]),
            context[i] + context[j], torch.abs(context[i] - context[j]), edge_geo), dim=-1))
        return node_h, self.edge_norm(edge_h + edge_delta)


class IncidenceNet(nn.Module):
    def __init__(self, vocab: int, hidden: int = 128, ports: int = 4, layers: int = 2, class_dim: int = 32):
        super().__init__()
        self.vocab = vocab
        self.class_embed = nn.Embedding(vocab, class_dim)
        self.node_input = nn.Sequential(nn.Linear(class_dim + NODE_GEO_DIM, hidden), nn.GELU(), nn.LayerNorm(hidden))
        self.edge_input = nn.Sequential(
            nn.Linear(VIS_DIM + 1 + EDGE_GEO_DIM + class_dim * 2, hidden), nn.GELU(), nn.LayerNorm(hidden))
        self.layers = nn.ModuleList([IncidenceAttentionLayer(hidden, ports) for _ in range(layers)])
        self.base_delta = nn.Sequential(nn.Linear(hidden, hidden), nn.GELU(), nn.Linear(hidden, 1))
        self.topology_delta = nn.Sequential(nn.Linear(hidden, hidden), nn.GELU(), nn.Linear(hidden, 1))
        # zero-initialized output layers: training starts from the CNN logit
        nn.init.zeros_(self.base_delta[-1].weight)
        nn.init.zeros_(self.base_delta[-1].bias)
        nn.init.zeros_(self.topology_delta[-1].weight)
        nn.init.zeros_(self.topology_delta[-1].bias)

    def forward(self, batch: dict[str, torch.Tensor]) -> tuple[torch.Tensor, torch.Tensor]:
        edges = batch["edges"]
        class_e = self.class_embed(batch["node_cls"])
        node_h = self.node_input(torch.cat((class_e, batch["node_geo"]), dim=-1))
        ci, cj = class_e[edges[:, 0]], class_e[edges[:, 1]]
        edge_h = self.edge_input(torch.cat(
            (batch["visual"], batch["cnn_logit"][:, None], batch["edge_geo"], ci + cj, torch.abs(ci - cj)), dim=-1))
        base_logit = batch["cnn_logit"] + self.base_delta(edge_h).squeeze(-1)
        for layer in self.layers:
            node_h, edge_h = layer(node_h, edge_h, edges, batch["incidence_geo"], batch["edge_geo"])
        final_logit = base_logit + self.topology_delta(edge_h).squeeze(-1)
        return final_logit, base_logit


def graph_to_device(graph: PageGraph, device: str) -> dict[str, torch.Tensor]:
    if graph.visual is None or graph.cnn_logit is None:
        raise RuntimeError(f"visual features were not attached for {graph.name}")
    return {
        "node_cls": torch.as_tensor(graph.node_cls, dtype=torch.long, device=device),
        "node_geo": torch.as_tensor(graph.node_geo, dtype=torch.float32, device=device),
        "edges": torch.as_tensor(graph.edges, dtype=torch.long, device=device),
        "edge_geo": torch.as_tensor(graph.edge_geo, dtype=torch.float32, device=device),
        "incidence_geo": torch.as_tensor(graph.incidence_geo, dtype=torch.float32, device=device),
        "visual": torch.as_tensor(graph.visual, dtype=torch.float32, device=device),
        "cnn_logit": torch.as_tensor(graph.cnn_logit, dtype=torch.float32, device=device),
        "labels": torch.as_tensor(graph.labels, dtype=torch.float32, device=device),
    }


def selected_edge_bce(logits, labels, neg_ratio: int, smoothing: float, pos_weight: float):
    """BCE on all positives and up to neg_ratio negatives per positive (half hardest, half uniform)."""
    positive = torch.where(labels > 0.5)[0]
    negative = torch.where(labels <= 0.5)[0]
    if neg_ratio > 0 and len(positive) and len(negative) > len(positive) * neg_ratio:
        count = len(positive) * neg_ratio
        hard_count = count // 2
        hard_local = torch.topk(logits.detach()[negative], hard_count).indices
        hard = negative[hard_local]
        available = torch.ones(len(negative), dtype=torch.bool, device=labels.device)
        available[hard_local] = False
        remaining = negative[available]
        random_count = min(count - hard_count, len(remaining))
        random_neg = remaining[torch.randperm(len(remaining), device=labels.device)[:random_count]]
        selected = torch.cat((positive, hard, random_neg))
    else:
        selected = torch.arange(len(labels), device=labels.device)
    target = labels[selected] * (1.0 - smoothing) + 0.5 * smoothing
    return F.binary_cross_entropy_with_logits(
        logits[selected], target, pos_weight=torch.tensor(pos_weight, dtype=logits.dtype, device=logits.device))


def cardinality_loss(logits, labels, edges, node_cls, vocab: int, zero_weight: float):
    """Count loss over (symbol, class of the other endpoint) groups."""
    edge_ids = torch.arange(len(edges), device=edges.device)
    inc_node = torch.cat((edges[:, 0], edges[:, 1]))
    inc_other = torch.cat((edges[:, 1], edges[:, 0]))
    inc_edge = torch.cat((edge_ids, edge_ids))
    groups = inc_node * vocab + node_cls[inc_other]
    size = len(node_cls) * vocab
    pred_count = torch.zeros(size, dtype=logits.dtype, device=logits.device)
    true_count = torch.zeros_like(pred_count)
    pred_count.index_add_(0, groups, torch.sigmoid(logits)[inc_edge])
    true_count.index_add_(0, groups, labels[inc_edge])
    active = torch.unique(groups)
    pred_count, true_count = pred_count[active], true_count[active]
    residual = (pred_count - true_count) / torch.sqrt(true_count + 1.0)
    losses = F.smooth_l1_loss(residual, torch.zeros_like(residual), reduction="none")
    positive = true_count > 0.0
    pos_loss = losses[positive].mean() if positive.any() else losses.new_zeros(())
    zero_loss = losses[~positive].mean() if (~positive).any() else losses.new_zeros(())
    return pos_loss + zero_weight * zero_loss


def incidence_ranking_loss(logits, labels, edges, node_cls, vocab: int, margin: float = 0.2):
    """softplus(margin - lowest positive score + highest negative score) per group with both."""
    edge_ids = torch.arange(len(edges), device=edges.device)
    inc_node = torch.cat((edges[:, 0], edges[:, 1]))
    inc_other = torch.cat((edges[:, 1], edges[:, 0]))
    inc_edge = torch.cat((edge_ids, edge_ids))
    groups = inc_node * vocab + node_cls[inc_other]
    size = len(node_cls) * vocab
    values = logits[inc_edge]
    labs = labels[inc_edge] > 0.5
    pos_min = torch.full((size,), torch.inf, dtype=logits.dtype, device=logits.device)
    neg_max = torch.full((size,), -torch.inf, dtype=logits.dtype, device=logits.device)
    if labs.any():
        pos_min.scatter_reduce_(0, groups[labs], values[labs], reduce="amin", include_self=True)
    if (~labs).any():
        neg_max.scatter_reduce_(0, groups[~labs], values[~labs], reduce="amax", include_self=True)
    valid = torch.isfinite(pos_min) & torch.isfinite(neg_max)
    if not valid.any():
        return logits.new_zeros(())
    return F.softplus(margin - pos_min[valid] + neg_max[valid]).mean()


def canonical_pair(a, b, class_dict):
    """Order two endpoints by class id, then centre x, then centre y."""
    ka = (class_dict[a.class_name], *center(a))
    kb = (class_dict[b.class_name], *center(b))
    return (b, a) if kb < ka else (a, b)


def pair_features(a, b, width, height, class_dict):
    """Two class ids and 15 signed geometric features of the direction classifier."""
    a, b = canonical_pair(a, b, class_dict)
    ca = class_dict[a.class_name]
    cb = class_dict[b.class_name]
    acx, acy = center(a)
    bcx, bcy = center(b)
    aw = max(float(a.right - a.left), 1.0)
    ah = max(float(a.bottom - a.top), 1.0)
    bw = max(float(b.right - b.left), 1.0)
    bh = max(float(b.bottom - b.top), 1.0)
    xov = max(0.0, min(a.right, b.right) - max(a.left, b.left))
    yov = max(0.0, min(a.bottom, b.bottom) - max(a.top, b.top))
    diag = max(float(np.hypot(width, height)), 1.0)
    values = [ca, cb, acx / width, acy / height, bcx / width, bcy / height,
              (bcx - acx) / width, (bcy - acy) / height, aw / width, ah / height, bw / width, bh / height,
              np.log(aw / bw), np.log(ah / bh), bbox_gap(a, b) / diag, xov / min(aw, bw), yov / min(ah, bh)]
    return np.asarray(values, dtype=np.float64), a, b


def directed_rows(page, class_dict):
    """One training row per annotated link with a single direction."""
    _name, nodes, width, height = page
    by_id = {int(node.id): node for node in nodes}
    directed = {(int(node.id), int(other_id)) for node in nodes for other_id in node.outlinks if int(other_id) in by_id}
    unordered = {tuple(sorted(edge)) for edge in directed}
    rows = []
    for lo, hi in sorted(unordered):
        if (lo, hi) in directed and (hi, lo) in directed:
            continue
        feat, a, b = pair_features(by_id[lo], by_id[hi], width, height, class_dict)
        label = int((int(a.id), int(b.id)) in directed)
        rows.append((feat, label, int(a.id), int(b.id)))
    return rows


def make_classifier(seed):
    """One-hot endpoint classes plus standardized geometry, then logistic regression (C=4, lbfgs)."""
    transform = ColumnTransformer([
        ("class", OneHotEncoder(handle_unknown="ignore"), [0, 1]),
        ("geometry", StandardScaler(), list(range(2, 17))),
    ])
    return make_pipeline(transform, LogisticRegression(C=4.0, max_iter=1500, random_state=seed))
