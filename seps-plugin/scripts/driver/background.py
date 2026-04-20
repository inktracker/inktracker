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
    explicit_bg_rgb: tuple[int, int, int] | None = None,
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
    if mode == "off" and explicit_bg_rgb is None:
        return None

    w, h = img.size
    mask = np.zeros((h, w), dtype=bool)

    # --- EXPLICIT BACKGROUND COLOR (operator clicked "+ Mark background") ---
    # Flood-fill from the border using the operator-supplied color with TIGHT
    # tolerance so it doesn't eat dark ink pixels. This bypasses corner
    # heuristics entirely since the operator told us exactly what to remove.
    if explicit_bg_rgb is not None:
        rgb = img.convert("RGB")
        arr = np.array(rgb, dtype=np.int16)
        target = np.array(explicit_bg_rgb, dtype=np.int16)
        # Tight tolerance: ~12 per channel. A same-color match anywhere in
        # the image gets marked, then we keep only border-connected regions
        # so interior detail that happens to match the bg color (black pen
        # strokes inside a duck drawn on black paper) is preserved.
        per_channel_tol = 12
        diff = np.max(np.abs(arr - target), axis=2)
        close = diff <= per_channel_tol
        connected = _keep_border_connected(close)
        mask |= connected
        log.info(
            "background: explicit color %s tol=%d → %d/%d border-connected px",
            tuple(int(x) for x in explicit_bg_rgb), per_channel_tol,
            int(connected.sum()), connected.size,
        )
        # Done — operator gave us an exact command; don't also run the
        # corner/garment heuristics (they might over-remove).
        return mask if mask.any() else None

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

        # NEUTRAL-ONLY GUARD: real-world canvases are paper (white / cream /
        # off-white), photo backdrops (gray / black), or scanned-sheet whites.
        # They are essentially never SATURATED colors. If the corners are
        # showing a vivid orange/red/blue/etc., that's almost certainly a
        # design fill (the operator wants it as an ink), not the canvas.
        # Skip auto-strip; operator can mark it manually with "+ Mark
        # background" if they really meant it as bg.
        if _is_saturated(canvas_color):
            log.info(
                "background: corner color %s is saturated — skipping auto-strip "
                "(use + Mark background to override)",
                tuple(int(x) for x in canvas_color),
            )
        else:
            diff = np.abs(arr - canvas_color).sum(axis=2)
            close = diff < color_tolerance * 3
            border_connected = _keep_border_connected(close)
            mask |= border_connected
            log.info(
                "background: neutral canvas %s, flood-filled %d/%d pixels",
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


def _is_saturated(rgb: np.ndarray, chroma_threshold: float = 22.0) -> bool:
    """True if the RGB color has high enough LAB chroma to be a 'real' design
    color (orange, red, navy, teal, etc.) rather than a paper/canvas neutral
    (white, cream, gray, black).

    chroma_threshold of 22 is the empirical line between 'beige/cream paper'
    (~ΔC 5–18) and 'design fills like dusty pinks/teals/golds' (ΔC 25+).
    Pure primaries are ΔC 50+; even desaturated brand colors clear 25.
    """
    try:
        from color_detect import rgb_to_lab
    except Exception:
        return False
    rgb_norm = np.array(rgb, dtype=np.float32).reshape(1, 3) / 255.0
    lab = rgb_to_lab(rgb_norm).reshape(3)
    a, b = float(lab[1]), float(lab[2])
    chroma = float(np.sqrt(a * a + b * b))
    return chroma > chroma_threshold


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
