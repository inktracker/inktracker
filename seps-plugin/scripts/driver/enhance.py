"""Pre-separation image enhancement.

Low-quality JPEGs are the most common reason seps turn out bad:
 - 8×8 block compression artifacts create thousands of fake colors
 - Anti-aliased edges add noise that the sep detector picks up as ink
 - Low resolution (<1500 px) produces aliased halftones at 720 DPI

This module runs before the sep detector and cleans those up. Four
levels of aggressiveness; the strongest ("vectorize") posterizes the
image to the user's target palette, producing flat-color regions that
look like vector art even though it's still a bitmap.

Not true vectorization (no SVG output) but gets ~80% of the benefit
for screen-printing purposes: cleaner edges, denser ink regions,
suppressed noise. If we ever want true bitmap→vector we'd add potrace.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image, ImageFilter


log = logging.getLogger("filmseps.enhance")


Level = Literal["none", "light", "strong", "vectorize"]


# Target dimensions for the upscaled canvas. Most JPEGs people drop are
# 600-1500 px; we bring them up so the sep pipeline has enough pixel
# budget to halftone cleanly at 720 DPI.
TARGET_MIN_DIM = 2000


@dataclass
class EnhanceResult:
    image: Image.Image
    level: Level
    upscaled_from: tuple[int, int]
    upscaled_to: tuple[int, int]
    notes: list[str]


def enhance(
    img: Image.Image,
    level: Level = "light",
    target_colors: int | None = None,
    garment_rgb: tuple[int, int, int] | None = None,
) -> EnhanceResult:
    """Return an enhanced copy of `img` ready for sep detection.

    Parameters
    ----------
    img : source image (RGB)
    level : enhancement strength
    target_colors : for "vectorize" — quantize to this many colors + background
    garment_rgb : for "vectorize" — background color (gets its own cluster)
    """
    src_size = img.size
    notes: list[str] = []

    if level == "none":
        return EnhanceResult(img, level, src_size, src_size, ["no enhancement"])

    # --- 1. Upscale small sources so halftones aren't aliased ---
    rgb = img.convert("RGB") if img.mode != "RGB" else img.copy()
    longest = max(rgb.size)
    if longest < TARGET_MIN_DIM:
        scale = TARGET_MIN_DIM / longest
        new_w = int(rgb.size[0] * scale)
        new_h = int(rgb.size[1] * scale)
        rgb = rgb.resize((new_w, new_h), Image.LANCZOS)
        notes.append(f"upscaled {src_size[0]}×{src_size[1]} → {new_w}×{new_h}")
    else:
        notes.append(f"source already {longest}px on long side, no upscale")

    up_size = rgb.size

    # --- 2. Denoise (strength depends on level) ---
    if level == "light":
        # Mild Gaussian — takes the edge off JPEG block noise without
        # smearing details.
        rgb = rgb.filter(ImageFilter.GaussianBlur(radius=0.6))
        notes.append("light gaussian blur (r=0.6)")
    elif level in ("strong", "vectorize"):
        # Median filter is the classic JPEG-artifact remover — it zaps
        # isolated noise pixels without blurring edges. Apply twice
        # for heavier artifacts.
        rgb = rgb.filter(ImageFilter.MedianFilter(size=3))
        rgb = rgb.filter(ImageFilter.MedianFilter(size=3))
        notes.append("2× median filter (r=3)")

    # --- 3. Edge re-sharpen (denoise softens them; bring edges back) ---
    if level in ("light", "strong", "vectorize"):
        # Unsharp mask with a small radius — good for the lightly-blurred
        # result after denoise, without over-ringing.
        rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.5, percent=60, threshold=3))
        notes.append("unsharp mask (r=1.5, 60%)")

    # --- 4. Vectorize: quantize to target palette via LAB k-means ---
    if level == "vectorize":
        if target_colors is None:
            notes.append("vectorize skipped (no target_colors)")
        else:
            garment = garment_rgb or (245, 245, 245)
            rgb = _posterize_to_palette(rgb, target_colors, garment)
            notes.append(f"posterized to {target_colors} inks + garment")

    return EnhanceResult(rgb, level, src_size, up_size, notes)


# ---------------------------------------------------------------------------
# Posterize — every pixel snaps to its nearest ink color
# ---------------------------------------------------------------------------
# This is what makes the output look "vector" — cleanly delimited flat
# regions instead of gradient-y JPEG noise. We reuse the same LAB k-means
# that the sep detector uses, so the posterized output is guaranteed to
# sep into the same N inks downstream.

def _posterize_to_palette(
    img: Image.Image,
    n_colors: int,
    garment_rgb: tuple[int, int, int],
) -> Image.Image:
    """Quantize every pixel in `img` to its nearest centroid in LAB space.

    Returns a new RGB image where every pixel is one of (n_colors + 1)
    discrete values: one of N detected inks, or the garment background.
    """
    from color_detect import detect_ink_colors, rgb_to_lab

    detected = detect_ink_colors(img, n_colors=n_colors, garment_rgb=garment_rgb)
    if not detected:
        return img

    # Build the palette: each ink + garment
    ink_rgbs = [c["rgb"] for c in detected]
    palette_rgb = np.array(ink_rgbs + [garment_rgb], dtype=np.float32) / 255.0
    palette_lab = rgb_to_lab(palette_rgb)

    # Convert source to LAB
    src_arr = np.array(img.convert("RGB"), dtype=np.float32) / 255.0
    h, w = src_arr.shape[:2]
    src_lab = rgb_to_lab(src_arr.reshape(-1, 3))

    # Nearest palette entry per pixel
    diffs = src_lab[:, None, :] - palette_lab[None, :, :]
    dists = np.sqrt((diffs ** 2).sum(axis=2))
    nearest = dists.argmin(axis=1)

    # Remap each pixel to its palette RGB
    palette_rgb_u8 = np.array(ink_rgbs + [garment_rgb], dtype=np.uint8)
    out = palette_rgb_u8[nearest].reshape(h, w, 3)
    return Image.fromarray(out, "RGB")
