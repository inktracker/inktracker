"""Elliptical halftone renderer.

Replaces the round-dot stamper in the old engine with a proper threshold-
map AM halftone using an elliptical 1.4:1 chain-dot spot function, rotated
to a per-color screen angle.

The output is film-positive polarity: ink area = black = 0, no ink = 255.
"""

from __future__ import annotations

import numpy as np

from dotgain import apply_cutoffs, apply_dot_gain
from preferences import (
    DOT_ASPECT,
    InkSystem,
)


def _spot_function(u: np.ndarray, v: np.ndarray, aspect: float) -> np.ndarray:
    """Elliptical chain-dot spot function.

    Inputs u, v are normalized cell coordinates in [-0.5, 0.5].
    Returns a float array in 0..1 — the threshold at which a given cell
    position turns on as the dot grows. Smaller values = center of the dot
    (turns on first); larger = cell edge (turns on last).

    For a chain dot, the dots grow elliptically until they touch along
    the long axis (at ~50%), then the "link" fills while corners remain
    open. We use a simple elliptical distance and map to 0..1.
    """
    # aspect>1 stretches along u
    a = aspect
    b = 1.0
    # Signed distance on ellipse; normalize so that distance=1 at the
    # corner (u=v=0.5).
    # Corner distance = sqrt((0.5/a)^2 + (0.5/b)^2); use that to scale.
    corner = np.sqrt((0.5 / a) ** 2 + (0.5 / b) ** 2)
    d = np.sqrt((u / a) ** 2 + (v / b) ** 2) / corner
    return np.clip(d, 0.0, 1.0)


def build_threshold_tile(cell_size: int, angle_deg: float, aspect: float) -> np.ndarray:
    """Build a square threshold tile (uint8 0..255) for this screen.

    The tile covers one rotated halftone cell. We sample the spot function
    in rotated cell-coordinates, so rotating the source image by -angle and
    tiling the threshold is equivalent to rotating the threshold itself.
    """
    size = max(3, cell_size)
    ys, xs = np.meshgrid(
        np.linspace(-0.5, 0.5, size, endpoint=False),
        np.linspace(-0.5, 0.5, size, endpoint=False),
        indexing="ij",
    )
    d = _spot_function(xs, ys, aspect)
    # Map 0..1 distance to 1..254 threshold. We avoid 0 (so d=0 never prints
    # a stray dot) and 255 (so d=255 always fills the cell — no seam).
    tile = np.clip(1 + d * 253.0, 1, 254).astype(np.uint8)
    return tile


def halftone(
    density: np.ndarray,
    dpi: int,
    lpi: int,
    angle_deg: float,
    aspect: float = DOT_ASPECT,
    ink_system: InkSystem = "waterbase",
    highlight_hold: float = 0.03,
    shadow_plug: float = 0.87,
    apply_gain: bool = True,
) -> np.ndarray:
    """Render a grayscale density map as an AM elliptical halftone.

    Parameters
    ----------
    density : (H, W) uint8 array, 0..255 where 255 = full ink coverage
    dpi     : film output resolution in DPI
    lpi     : target line screen in LPI
    angle_deg : screen angle in degrees
    aspect  : dot aspect ratio (1.4 = chain dot)
    ink_system : "waterbase" or "discharge" — drives dot-gain LUT
    highlight_hold, shadow_plug : cutoffs (fraction, 0..1)

    Returns
    -------
    (H, W) uint8, film-positive: 0 = ink, 255 = clear film
    """
    if density.ndim != 2:
        raise ValueError("density must be 2D grayscale")

    h, w = density.shape

    d = apply_cutoffs(density, highlight_hold, shadow_plug)
    if apply_gain:
        d = apply_dot_gain(d, ink_system)

    # Cell size in pixels
    cell_size = max(3, int(round(dpi / float(lpi))))

    tile = build_threshold_tile(cell_size, angle_deg, aspect)

    # Rotate the density to align with the screen instead of rotating the
    # tile — this is cheaper and avoids stitching artifacts at tile edges.
    rad = np.deg2rad(angle_deg)
    cos_a, sin_a = np.cos(rad), np.sin(rad)

    # Output grid coords
    yy, xx = np.indices((h, w))
    cx, cy = w / 2.0, h / 2.0
    # Rotate each pixel into "screen space"
    sx = cos_a * (xx - cx) + sin_a * (yy - cy) + cx
    sy = -sin_a * (xx - cx) + cos_a * (yy - cy) + cy

    # Tile-local coords
    ti = np.mod(sy.astype(np.int64), cell_size)
    tj = np.mod(sx.astype(np.int64), cell_size)
    thresh = tile[ti, tj]

    # A pixel turns on (ink) when density > threshold.
    # Film positive: ink = 0, clear = 255.
    ink_mask = d > thresh
    out = np.where(ink_mask, 0, 255).astype(np.uint8)
    return out


def solid_film(density: np.ndarray) -> np.ndarray:
    """Render a solid (non-halftoned) layer to film polarity.

    density: 0..255 where 255=full coverage. Output: 0..255 film-positive
    (ink=0, clear=255). We invert and leave continuous tone — the exposure
    unit treats >50% as a hard edge anyway for solid layers.
    """
    return (255 - density).astype(np.uint8)
