"""Dot-gain compensation — build an input->output LUT from sparse anchors."""

from __future__ import annotations

import numpy as np

from preferences import DOT_GAIN_DISCHARGE, DOT_GAIN_WATERBASE, InkSystem


def build_lut(ink_system: InkSystem = "waterbase") -> np.ndarray:
    """Return a 256-entry uint8 LUT that maps a target dot % (0..255) to the
    film dot value to write so that after on-press gain we land at the target.

    We INVERT the gain curve: for a target printed % `t`, find the film %
    `f` such that on-press(f) ≈ t. The sparse anchors in preferences.py are
    already stored as target->film pairs, so we just interpolate.
    """
    anchors = DOT_GAIN_DISCHARGE if ink_system == "discharge" else DOT_GAIN_WATERBASE
    keys = sorted(anchors.keys())
    vals = [anchors[k] for k in keys]

    xs = np.linspace(0, 1, 256)
    film_pct = np.interp(xs, keys, vals)

    # LUT converts "target dot" density (0=no ink, 255=solid) to film dot
    # at the same polarity. Film positive polarity is handled later in
    # halftoning — the LUT only warps the magnitude.
    lut = np.clip(film_pct * 255.0, 0, 255).astype(np.uint8)
    return lut


def apply_cutoffs(
    density: np.ndarray,
    highlight_hold: float,
    shadow_plug: float,
) -> np.ndarray:
    """Force dots below highlight_hold to 0 and above shadow_plug to 255.

    `density` is 0..255 where 255 = solid ink / full coverage.
    """
    lo = int(highlight_hold * 255)
    hi = int(shadow_plug * 255)
    out = density.copy()
    out[out < lo] = 0
    out[out > hi] = 255
    return out


def apply_dot_gain(density: np.ndarray, ink_system: InkSystem) -> np.ndarray:
    """Warp a target-density map through the inverse dot-gain curve."""
    lut = build_lut(ink_system)
    return lut[density]
