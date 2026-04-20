"""LAB-space K-means color detection for flat-image separation.

Replaces the old RGB median-cut quantization that:
  - Clustered by RGB distance (perceptually non-uniform; two colors that
    LOOK very different can be RGB-close, and vice versa)
  - Got fooled by anti-aliased edges (creating fake intermediate colors
    that weren't real inks)
  - Couldn't reliably merge near-identical shades into one ink

The new detector clusters in CIE LAB color space using K-means, which
matches human perception — two colors that look the same to the eye
cluster together even if their RGB values differ. Works reliably on
illustrations with smooth edges, anti-aliased text, and art where
multiple source pixels should map to the same ink.

Pipeline
--------
1. Downsample to 400px max (speed; clustering doesn't need all pixels)
2. Convert to LAB
3. Drop pixels within delta-E < 15 of the garment color (background)
4. K-means on the remaining pixels, k = user-specified ink count
5. Return centroids sorted by coverage, with RGB + name

The "drop garment pixels first" step is what makes this much better
than the old detector. Before, the garment color would dominate a slot
in the palette and we'd always waste one color on "white" (or whatever
the shirt is). Now the garment pixels are excluded up front and every
returned cluster is a real ink.
"""
from __future__ import annotations

import logging

import numpy as np
from PIL import Image


log = logging.getLogger("filmseps.color_detect")


# ---------------------------------------------------------------------------
# RGB ↔ LAB conversion (D65, sRGB)
# ---------------------------------------------------------------------------
# Standard CIE formula. We do this manually so we have no extra deps and
# full control over numerical precision.

_SRGB_XYZ = np.array([
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
], dtype=np.float32)

_XYZ_SRGB = np.linalg.inv(_SRGB_XYZ)
_XN, _YN, _ZN = 0.95047, 1.0, 1.08883  # D65 white point


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """rgb: float32 in [0, 1], shape (..., 3). Returns LAB shape (..., 3).
    L ~0..100, a/b ~-128..127."""
    mask = rgb > 0.04045
    linear = np.where(mask, ((rgb + 0.055) / 1.055) ** 2.4, rgb / 12.92)
    xyz = linear @ _SRGB_XYZ.T
    xyz_n = xyz / np.array([_XN, _YN, _ZN], dtype=np.float32)
    mask2 = xyz_n > 0.008856
    f = np.where(mask2, np.cbrt(xyz_n), 7.787 * xyz_n + 16 / 116)
    L = 116 * f[..., 1:2] - 16
    a = 500 * (f[..., 0:1] - f[..., 1:2])
    b = 200 * (f[..., 1:2] - f[..., 2:3])
    return np.concatenate([L, a, b], axis=-1)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    """lab: shape (..., 3). Returns RGB in [0, 1]."""
    L = lab[..., 0:1]
    a = lab[..., 1:2]
    b = lab[..., 2:3]
    fy = (L + 16) / 116
    fx = a / 500 + fy
    fz = fy - b / 200
    f = np.concatenate([fx, fy, fz], axis=-1)
    mask = f > 0.206893
    xyz_n = np.where(mask, f ** 3, (f - 16 / 116) / 7.787)
    xyz = xyz_n * np.array([_XN, _YN, _ZN], dtype=np.float32)
    linear = xyz @ _XYZ_SRGB.T
    mask2 = linear > 0.0031308
    rgb = np.where(mask2, 1.055 * (linear ** (1 / 2.4)) - 0.055, 12.92 * linear)
    return np.clip(rgb, 0, 1)


# ---------------------------------------------------------------------------
# K-means (plain numpy, no sklearn dep)
# ---------------------------------------------------------------------------

def _kmeans(data: np.ndarray, k: int, iters: int = 25, seed: int = 42) -> tuple:
    """K-means clustering. Returns (centers, labels).

    Uses k-means++ seeding which converges faster and more reliably than
    random init, especially for image color distributions where some
    colors are vastly more populated than others.
    """
    rng = np.random.RandomState(seed)
    n = len(data)
    k = min(k, n)

    # k-means++ init — first center random, subsequent chosen with
    # probability proportional to squared distance from nearest existing center
    centers = np.empty((k, data.shape[1]), dtype=np.float32)
    centers[0] = data[rng.randint(n)]
    for i in range(1, k):
        d2 = np.min(
            ((data[:, None, :] - centers[None, :i, :]) ** 2).sum(axis=2),
            axis=1,
        )
        # Sample next center proportional to d^2
        total = d2.sum()
        if total <= 0:
            centers[i] = data[rng.randint(n)]
            continue
        r = rng.random() * total
        cumsum = np.cumsum(d2)
        centers[i] = data[np.searchsorted(cumsum, r)]

    # Lloyd iterations
    labels = np.zeros(n, dtype=np.int32)
    for _ in range(iters):
        # Assign each point to nearest center (LAB Euclidean = delta-E*)
        dists = ((data[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        new_labels = dists.argmin(axis=1)
        if np.array_equal(new_labels, labels):
            break
        labels = new_labels
        # Recompute centers
        for j in range(k):
            members = data[labels == j]
            if len(members) > 0:
                centers[j] = members.mean(axis=0)
    return centers, labels


# ---------------------------------------------------------------------------
# Main detector
# ---------------------------------------------------------------------------

MERGE_DELTA_E = 15.0
"""Two LAB centroids closer than this Euclidean distance are treated as the
same ink and collapsed into one after K-means. Prevents the detector from
returning near-duplicate clusters (e.g. "dark-orange" + "dark-orange") when
the user asks for more colors than the art actually has.

15 in LAB is the threshold for "visually similar but noticeably different."
For spot-color work that's right — if two inks look this close to the eye,
they'd mix on press anyway and a printer would combine them.
"""

# Also drop clusters that end up with < this fraction of ink pixels —
# they're usually anti-aliased edge transitions, not real inks, and
# render as near-empty films full of only outline artifacts.
MIN_CLUSTER_FRACTION = 0.02


# Any pixel with LAB L* below this is treated as potential "key/black ink"
# (linework, outlines, solid dark fills). Professional sep software treats
# key as its own axis separate from hue-based color clustering — black line
# art ALWAYS gets its own film, never mixed into a color cluster.
KEY_INK_L_THRESHOLD = 25.0

# The dark pixels must cover at least this fraction of the image for us to
# reserve a slot for a key/black ink. Otherwise the user's art has no
# meaningful linework and we cluster normally.
KEY_INK_MIN_FRACTION = 0.01


def _merge_near_duplicates(
    centers_lab: np.ndarray,
    labels: np.ndarray,
    delta_e: float = MERGE_DELTA_E,
) -> tuple[np.ndarray, np.ndarray, int]:
    """Fold near-duplicate cluster centers into one.

    For each pair of centers within `delta_e` in LAB, we merge the smaller
    cluster into the larger one. Returns (new_centers, new_labels, n_dropped).
    """
    k = len(centers_lab)
    if k <= 1:
        return centers_lab, labels, 0

    # Cluster sizes
    sizes = np.bincount(labels, minlength=k)

    # Union-find: each center starts in its own group
    parent = list(range(k))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        # Always keep the larger cluster as the survivor
        if sizes[ra] >= sizes[rb]:
            parent[rb] = ra
        else:
            parent[ra] = rb

    # Pairwise distances between centers
    for i in range(k):
        for j in range(i + 1, k):
            d = float(np.sqrt(((centers_lab[i] - centers_lab[j]) ** 2).sum()))
            if d < delta_e:
                union(i, j)

    # Build remap old_label → new_label in survivor order
    root_of = [find(i) for i in range(k)]
    unique_roots = sorted(set(root_of), key=lambda r: -sizes[r])  # biggest first
    remap = {r: new_i for new_i, r in enumerate(unique_roots)}

    new_labels = np.array([remap[root_of[l]] for l in labels], dtype=np.int32)
    new_centers = np.empty((len(unique_roots), centers_lab.shape[1]),
                           dtype=centers_lab.dtype)
    for new_i, root in enumerate(unique_roots):
        members = np.array([j for j in range(k) if root_of[j] == root])
        # Weighted centroid — sizes serve as pixel weights
        weights = sizes[members].astype(np.float32)
        new_centers[new_i] = (centers_lab[members] * weights[:, None]).sum(axis=0) / weights.sum()
    return new_centers, new_labels, k - len(unique_roots)


def detect_ink_colors(
    img: Image.Image,
    n_colors: int,
    garment_rgb: tuple[int, int, int],
    downsample_to: int = 400,
    garment_delta_e: float = 15.0,
    min_fraction: float = MIN_CLUSTER_FRACTION,
) -> list[dict]:
    """Detect `n_colors` ink colors in `img` using LAB K-means.

    Returns a list (most dominant first) of:
        {"rgb": (r,g,b), "pixel_count": int, "fraction": float,
         "lab": (L,a,b), "suggested_name": str}

    `garment_rgb` pixels are filtered out before clustering so the
    returned centroids are all real inks.
    """
    # --- downsample for speed ---
    thumb = img.convert("RGB").copy()
    thumb.thumbnail((downsample_to, downsample_to), Image.LANCZOS)
    rgb = np.array(thumb, dtype=np.float32) / 255.0
    pixels = rgb.reshape(-1, 3)
    h, w = rgb.shape[:2]

    # --- RGB → LAB ---
    lab = rgb_to_lab(pixels)
    garment_lab = rgb_to_lab(
        np.array(garment_rgb, dtype=np.float32).reshape(1, 3) / 255.0
    ).reshape(3)

    # --- edge mask: exclude anti-aliased transitions from clustering ---
    # Transition pixels between two real colors form a midtone "cluster"
    # that K-means mistakes for a real ink. Film shows up as pure outlines.
    # Compute an edge mask on the LAB L-channel — any pixel with a
    # significant gradient is an edge — and drop those from the k-means
    # input. They still get assigned during mask-building later, naturally
    # falling to whichever side of the edge they're on.
    L = lab[:, 0].reshape(h, w)
    gx = np.abs(np.diff(L, axis=1, prepend=L[:, :1]))
    gy = np.abs(np.diff(L, axis=0, prepend=L[:1, :]))
    edge_mag = gx + gy
    is_edge = edge_mag.reshape(-1) > 5.0  # LAB L units; >5 = transition
    n_edges = int(is_edge.sum())

    # --- drop garment pixels (background) ---
    dist_to_garment = np.sqrt(((lab - garment_lab) ** 2).sum(axis=1))
    is_ink_candidate = dist_to_garment > garment_delta_e

    # --- KEY INK EXTRACTION ---
    # Screen-print technique: the "key" (black/line) ink is separated from
    # hue-based color clusters, not mixed with them. Pen linework, outlines,
    # cross-hatching — all dark regardless of what color "family" they're in.
    # When present, it always gets its own film. Include edge pixels in the
    # dark cluster (fine lines ARE edges by definition and should go on the
    # black film; we only want to exclude edges from the HUE clustering).
    is_dark = (lab[:, 0] < KEY_INK_L_THRESHOLD) & is_ink_candidate
    key_fraction = is_dark.sum() / max(1, len(pixels))
    reserve_key = key_fraction >= KEY_INK_MIN_FRACTION and n_colors >= 2

    # Color clustering pool: ink pixels that are NOT dark AND NOT on edges
    is_color_cluster_pixel = is_ink_candidate & ~is_edge & ~is_dark
    color_lab = lab[is_color_cluster_pixel]

    log.info(
        "detect_ink_colors: %d total, %d edge, %d garment, %d dark (key %s)",
        len(pixels), n_edges,
        int((~is_ink_candidate).sum()),
        int(is_dark.sum()),
        "reserved" if reserve_key else "skipped",
    )

    if len(color_lab) < 50:
        # Too few hue pixels — fall back to clustering all non-edge non-dark
        # ink pixels, or everything if still too few.
        color_lab = lab[is_ink_candidate & ~is_edge]
        if len(color_lab) < 50:
            color_lab = lab[is_ink_candidate]
        if len(color_lab) < 50:
            color_lab = lab
        log.warning("detect_ink_colors: fell back to %d pixels for color cluster",
                    len(color_lab))

    # --- K-means on the color pool ---
    n_color_slots = n_colors - 1 if reserve_key else n_colors
    n_color_slots = max(1, min(n_color_slots, len(color_lab)))
    centers_lab, labels = _kmeans(color_lab, k=n_color_slots)

    # --- collapse near-duplicate color clusters ---
    centers_lab, labels, merged = _merge_near_duplicates(centers_lab, labels)
    if merged:
        log.info("detect_ink_colors: merged %d near-duplicate color cluster(s)",
                 merged)

    # --- build color cluster results ---
    total_ink = int(is_ink_candidate.sum())
    if total_ink == 0:
        total_ink = len(pixels)  # avoid div-by-zero on edge cases
    results: list[dict] = []
    for i, c_lab in enumerate(centers_lab):
        count = int((labels == i).sum())
        if count == 0:
            continue
        fraction = count / total_ink
        if fraction < min_fraction:
            continue
        c_rgb = (lab_to_rgb(c_lab.reshape(1, 3)).reshape(3) * 255)
        c_rgb = tuple(int(round(v)) for v in c_rgb)
        results.append({
            "rgb": c_rgb,
            "lab": tuple(float(v) for v in c_lab),
            "pixel_count": count,
            "fraction": round(fraction, 4),
            "suggested_name": _suggest_lab_name(c_lab),
        })

    # --- prepend the key/black cluster if we reserved one ---
    if reserve_key:
        key_lab = lab[is_dark].mean(axis=0)
        # Pin to pure black in LAB (L=0, a=0, b=0) — the detected centroid
        # averages across pen strokes that may have mixed slightly but the
        # INK we're going to print is always full black. This prevents
        # odd RGB values like (28, 24, 18) that look brownish.
        key_lab_rendered = np.array([0.0, 0.0, 0.0], dtype=np.float32)
        key_count = int(is_dark.sum())
        results.insert(0, {
            "rgb": (0, 0, 0),
            "lab": tuple(float(v) for v in key_lab),  # the DETECTED centroid
            "pixel_count": key_count,
            "fraction": round(key_count / total_ink, 4),
            "suggested_name": "black",
        })

    # Sort color clusters by coverage but keep black first — it's the key film
    # and matches operator expectation (black always prints first/last in the
    # print order, never buried in the middle of a palette sort).
    if reserve_key:
        black = results[0]
        rest = sorted(results[1:], key=lambda c: -c["pixel_count"])
        results = [black] + rest
    else:
        results.sort(key=lambda c: -c["pixel_count"])
    return results


# ---------------------------------------------------------------------------
# LAB-based naming
# ---------------------------------------------------------------------------
# Names a color using LAB coordinates, which is better than the old
# HSV-based naming for three reasons:
#   1. Lightness (L*) is perceptually uniform — dark/mid/light splits work
#   2. Chroma C* = sqrt(a² + b²) — tells us how saturated vs neutral
#   3. Hue h° = atan2(b, a) — perceptually uniform hue wheel
#
# So "brown" can be distinguished from "orange" properly (same hue, much
# lower chroma), "navy" from "royal blue" (same hue, different lightness),
# etc.

def _suggest_lab_name(lab: np.ndarray) -> str:
    """Map a LAB centroid to a human-friendly ink name.

    LAB hue bands are NOT the same as HSV/RGB hue wheels — they're based on
    opponent-color axes, so primaries land at specific LAB angles:
        red    ~ 40°   orange ~ 55-75°   yellow ~ 100°   green ~ 135°
        cyan   ~ 195°  blue   ~ 300°     purple ~ 325°   magenta ~ 325°
    Our bands below are tuned to those real LAB angles, not HSV wheel angles.
    """
    L, a, b = float(lab[0]), float(lab[1]), float(lab[2])

    # Chroma: 0 = perfect neutral, higher = more saturated
    C = float(np.sqrt(a * a + b * b))
    # Hue in degrees, 0-360
    h = float(np.degrees(np.arctan2(b, a))) % 360

    # --- Neutrals (low chroma) ---
    if C < 10:
        if L > 92:
            return "white"
        if L > 75:
            return "light-gray"
        if L > 55:
            return "gray"
        if L > 25:
            return "dark-gray"
        return "black"

    # --- Very dark regardless of hue ---
    if L < 15:
        return "black"

    # --- Warm reds / pinks / maroons (hue 340-25°) ---
    if h >= 340 or h < 25:
        if L < 30 and C < 40:
            return "maroon"
        if L > 75 and C < 50:
            return "pink"
        if L < 35:
            return "dark-red"
        if L > 72:
            return "light-red"
        return "red"

    # --- Oranges / browns / tans (hue 25-85°) ---
    if h < 85:
        if C < 35:
            if L < 35:
                return "dark-brown"
            if L < 55:
                return "brown"
            if L < 75:
                return "tan"
            return "beige"
        # Saturated warm hue
        if L < 35:
            return "rust"
        if L < 55:
            return "dark-orange"
        if L > 80:
            return "peach"
        return "orange"

    # --- Yellows / olives (hue 85-115°) ---
    if h < 115:
        if C < 40 or L < 50:
            if L < 45:
                return "olive"
            if L < 70:
                return "khaki"
            return "cream"
        if L > 85:
            return "light-yellow"
        return "yellow"

    # --- Greens (hue 115-170°) ---
    if h < 170:
        if L < 30:
            return "dark-green"
        if C < 25:
            return "sage"
        if L > 75:
            return "light-green"
        return "green"

    # --- Teal / cyan (hue 170-230°) ---
    if h < 230:
        if L < 40:
            return "dark-teal"
        if L < 65:
            return "teal"
        return "cyan"

    # --- Blues (hue 230-310°) — LAB blue lands here, widest band ---
    if h < 310:
        if L < 25:
            return "navy"
        if L < 45:
            return "dark-blue"
        if L > 75 and C < 40:
            return "light-blue"
        return "blue"

    # --- Purples / magentas (hue 310-340°) ---
    if h < 340:
        if L < 30:
            return "dark-purple"
        if L < 50:
            return "purple"
        if L > 75 and C < 40:
            return "light-pink"
        return "magenta"

    return "color"


def resolve_unique_names(detected: list[dict]) -> list[str]:
    """Given the LAB-named detections, emit a list of unique names per film.

    If two detections still collide (rare — LAB naming is pretty granular),
    we disambiguate by lightness rank. For single-word names (e.g. "orange")
    we prepend dark-/mid-/light-. For names that ALREADY carry a qualifier
    (e.g. "dark-orange", "light-blue"), we append numeric suffixes instead
    of doubling up into "dark-dark-orange".
    """
    from collections import defaultdict

    raw = [c["suggested_name"] for c in detected]
    groups: dict[str, list[int]] = defaultdict(list)
    for i, name in enumerate(raw):
        groups[name].append(i)

    resolved = list(raw)
    for name, indices in groups.items():
        if len(indices) <= 1:
            continue
        # Sort these collisions by LAB L* (dark → light)
        ordered = sorted(indices, key=lambda idx: detected[idx]["lab"][0])
        n = len(ordered)
        already_qualified = "-" in name
        if already_qualified:
            # Don't double up "dark-"/"light-"/"mid-" prefixes. Numeric.
            new_labels = [f"{name}-{k+1}" for k in range(n)]
        elif n == 2:
            new_labels = [f"dark-{name}", f"light-{name}"]
        elif n == 3:
            new_labels = [f"dark-{name}", f"mid-{name}", f"light-{name}"]
        else:
            new_labels = [f"{name}-{k+1}" for k in range(n)]
        for idx, label in zip(ordered, new_labels):
            resolved[idx] = label
    return resolved
