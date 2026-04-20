"""Background detection — separate canvas from print.

Distinguishes the artwork's "canvas" (the paper/background the design was
drawn on) from the "print" (the actual design content that should be
inked).

Two situations where this matters:

 1. Source has an alpha channel (transparent PNG, layered PSD) — fully
    transparent pixels are obviously background. Just respect the alpha.

 2. Source is opaque (JPEG, flat PNG) but drawn on a non-white paper,
    a colored card, or a scanned sheet. The "canvas" is the region
    connected to the image border that's roughly uniform in color.
    Flood-fill from the corners to find it.

Once the background is detected, we replace those pixels with the
user's garment color in the source image — that way all our existing
garment-aware filtering (detect_ink_colors drops them during clustering,
_nearest_ink_masks drops them during mask building) handles it correctly
with zero extra logic downstream.
"""
from __future__ import annotations

import logging
from typing import Literal

import numpy as np
from PIL import Image


log = logging.getLogger("filmseps.background")


Mode = Literal["off", "auto", "alpha-only"]


def detect_background_mask(
    img: Image.Image,
    garment_rgb: tuple[int, int, int] | None = None,
    mode: Mode = "auto",
    color_tolerance: int = 25,
) -> np.ndarray | None:
    """Return a (H, W) boolean mask — True where the pixel is canvas/bg.

    Returns None when mode="off" or no background is confidently detected.

    Parameters
    ----------
    img : source image (any mode)
    garment_rgb : shirt color — pixels matching this are also treated as bg
    mode : "off" | "auto" | "alpha-only"
    color_tolerance : RGB Euclidean tolerance for corner-color matching
    """
    if mode == "off":
        return None

    w, h = img.size
    mask = np.zeros((h, w), dtype=bool)

    # --- 1. Alpha channel (if present) ---
    alpha_found = False
    if img.mode in ("RGBA", "LA"):
        alpha_arr = np.array(img.split()[-1])
        transparent = alpha_arr < 32  # < 1/8 opacity = background
        if transparent.any():
            mask |= transparent
            alpha_found = True
            log.info("background: alpha channel — %d/%d pixels transparent",
                     int(transparent.sum()), transparent.size)

    if mode == "alpha-only":
        return mask if alpha_found else None

    # --- 2. Border-connected flood-fill ---
    rgb = img.convert("RGB")
    arr = np.array(rgb, dtype=np.int16)
    corners = [arr[0, 0], arr[0, w - 1], arr[h - 1, 0], arr[h - 1, w - 1]]
    # Average the corner colors; if they agree within tolerance, that's
    # probably the canvas color. If they disagree wildly, there's no
    # single "canvas" and we skip this step.
    corners_arr = np.array(corners, dtype=np.int16)
    max_spread = np.ptp(corners_arr, axis=0).max()
    if max_spread > color_tolerance * 2:
        log.info(
            "background: corners disagree by %d — no uniform canvas detected",
            max_spread,
        )
    else:
        canvas_color = corners_arr.mean(axis=0).astype(np.int16)
        diff = np.abs(arr - canvas_color).sum(axis=2)
        close = diff < color_tolerance * 3  # tolerance is per-channel; sum is 3x

        # Keep only the regions of `close` that are connected to the image
        # border. A white patch in the center (e.g. white eye in a design)
        # should stay as ink, not get excluded as bg.
        border_connected = _keep_border_connected(close)
        mask |= border_connected
        log.info(
            "background: canvas color %s, flood-filled %d/%d pixels",
            tuple(int(x) for x in canvas_color),
            int(border_connected.sum()), border_connected.size,
        )

    # --- 3. Garment color (belt and suspenders) ---
    if garment_rgb is not None:
        garment = np.array(garment_rgb, dtype=np.int16)
        arr = np.array(img.convert("RGB"), dtype=np.int16)
        matches_garment = np.abs(arr - garment).sum(axis=2) < color_tolerance * 3
        # Only include garment-matching pixels that touch the border too
        mask |= _keep_border_connected(matches_garment)

    if not mask.any():
        return None
    return mask


def _keep_border_connected(mask: np.ndarray) -> np.ndarray:
    """Return the connected component of `mask` that touches the image border.

    Iterative dilation: seed with border pixels that are True in `mask`,
    then repeatedly OR in 4-connected neighbors, clipped to `mask`.
    Converges in O(image diameter) iterations — fast enough for our sizes
    and zero external dependencies.
    """
    if not mask.any():
        return mask

    h, w = mask.shape

    # Seed = border pixels that are True in the input mask
    seed = np.zeros_like(mask)
    seed[0, :] = mask[0, :]
    seed[-1, :] = mask[-1, :]
    seed[:, 0] = mask[:, 0]
    seed[:, -1] = mask[:, -1]

    while True:
        new_seed = seed.copy()
        new_seed[1:, :] |= seed[:-1, :]
        new_seed[:-1, :] |= seed[1:, :]
        new_seed[:, 1:] |= seed[:, :-1]
        new_seed[:, :-1] |= seed[:, 1:]
        new_seed &= mask
        if np.array_equal(new_seed, seed):
            return seed
        seed = new_seed


def apply_background_mask(
    img: Image.Image,
    bg_mask: np.ndarray,
    replacement_rgb: tuple[int, int, int],
) -> Image.Image:
    """Return a new image with all background pixels set to `replacement_rgb`.

    Used so our existing garment-aware filtering downstream picks those
    pixels up as "shirt showing through" and drops them from every sep.
    """
    rgb = img.convert("RGB")
    arr = np.array(rgb, dtype=np.uint8)
    arr[bg_mask] = replacement_rgb
    return Image.fromarray(arr, "RGB")
