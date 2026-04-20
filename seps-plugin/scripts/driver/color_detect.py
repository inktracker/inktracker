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

def detect_ink_colors(
    img: Image.Image,
    n_colors: int,
    garment_rgb: tuple[int, int, int],
    downsample_to: int = 400,
    garment_delta_e: float = 15.0,
    min_fraction: float = 0.003,
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

    # --- RGB → LAB ---
    lab = rgb_to_lab(pixels)
    garment_lab = rgb_to_lab(
        np.array(garment_rgb, dtype=np.float32).reshape(1, 3) / 255.0
    ).reshape(3)

    # --- drop garment pixels (background) ---
    dist_to_garment = np.sqrt(((lab - garment_lab) ** 2).sum(axis=1))
    is_ink_pixel = dist_to_garment > garment_delta_e
    ink_lab = lab[is_ink_pixel]
    log.info(
        "detect_ink_colors: %d/%d pixels are ink (garment Δe > %.1f)",
        int(is_ink_pixel.sum()), len(pixels), garment_delta_e,
    )

    if len(ink_lab) < 50:
        # Too few ink pixels — probably the garment color is wrong. Fall
        # back to clustering all pixels (user can re-detect if needed).
        ink_lab = lab
        log.warning("detect_ink_colors: <50 ink pixels found — clustering all")

    # --- K-means ---
    k = max(1, min(n_colors, len(ink_lab)))
    centers_lab, labels = _kmeans(ink_lab, k=k)

    # --- build results ---
    total_ink = len(ink_lab)
    results = []
    for i, c_lab in enumerate(centers_lab):
        count = int((labels == i).sum())
        if count == 0:
            continue
        fraction = count / total_ink
        if fraction < min_fraction:
            continue
        # Convert centroid LAB back to RGB for display + masking
        c_rgb = (lab_to_rgb(c_lab.reshape(1, 3)).reshape(3) * 255)
        c_rgb = tuple(int(round(v)) for v in c_rgb)
        results.append({
            "rgb": c_rgb,
            "lab": tuple(float(v) for v in c_lab),
            "pixel_count": count,
            "fraction": round(fraction, 4),
            "suggested_name": _suggest_lab_name(c_lab),
        })

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
    we disambiguate by lightness rank: ORDER-RAW-1 becomes dark-ORANGE,
    the middle one stays ORANGE, the lightest becomes light-ORANGE.
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
        if n == 2:
            labels = [f"dark-{name}", f"light-{name}"]
        elif n == 3:
            labels = [f"dark-{name}", f"mid-{name}", f"light-{name}"]
        else:
            labels = [f"{name}-{k+1}" for k in range(n)]
        for idx, label in zip(ordered, labels):
            resolved[idx] = label
    return resolved
