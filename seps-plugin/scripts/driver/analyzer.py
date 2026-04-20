"""Artwork analysis — studies the source and recommends a sep mode.

Called by the GUI before rendering so the form can be pre-populated with
sensible defaults. The user can always override.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image


@dataclass
class Analysis:
    mode: str                         # "spot-layered" | "spot-flat" | "sim-process"
    reasoning: list[str] = field(default_factory=list)
    distinct_colors: int = 0
    photoreal: bool = False
    has_gradients: bool = False
    has_layers: bool = False
    layer_names: list[str] = field(default_factory=list)
    suggested_color_count: int = 4
    source_size: tuple[int, int] = (0, 0)
    source_dpi: int | None = None


def analyze(path: Path) -> Analysis:
    ext = path.suffix.lower()

    if ext in (".psd", ".psb"):
        return _analyze_psd(path)

    if ext in (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif"):
        return _analyze_flat(path)

    if ext == ".pdf":
        return _analyze_pdf(path)

    return Analysis(mode="spot-flat", reasoning=[f"unknown format {ext}"])


# ---------------------------------------------------------------------------
# Layered PSD
# ---------------------------------------------------------------------------

def _analyze_psd(path: Path) -> Analysis:
    try:
        from psd_tools import PSDImage
    except ImportError:
        return Analysis(mode="spot-flat",
                        reasoning=["psd-tools not installed — treating as flat"])

    psd = PSDImage.open(str(path))
    layer_names: list[str] = []
    for layer in _iter_leaf_layers(psd):
        name = getattr(layer, "name", None)
        if not name:
            continue
        if not getattr(layer, "is_visible", lambda: True)():
            continue
        if name.lower() in ("background", "bg"):
            continue
        layer_names.append(name)

    reasoning = []
    if len(layer_names) >= 2:
        reasoning.append(f"{len(layer_names)} named visible layers — treating each as an ink")
        mode = "spot-layered"
    else:
        reasoning.append("not enough named layers — falling back to flat color detection")
        mode = "spot-flat"

    return Analysis(
        mode=mode,
        reasoning=reasoning,
        distinct_colors=len(layer_names),
        has_layers=len(layer_names) > 0,
        layer_names=layer_names,
        suggested_color_count=len(layer_names) if layer_names else 4,
        source_size=(psd.width, psd.height),
    )


def _iter_leaf_layers(group):
    for layer in group:
        if hasattr(layer, "layers") and layer.layers:
            yield from _iter_leaf_layers(layer)
        else:
            yield layer


# ---------------------------------------------------------------------------
# Flat raster
# ---------------------------------------------------------------------------

def _analyze_flat(path: Path) -> Analysis:
    img = Image.open(str(path))
    img.load()
    dpi = None
    if "dpi" in img.info:
        d = img.info["dpi"]
        dpi = int(d[0] if isinstance(d, tuple) else d)

    return _classify_image(img, dpi)


def _analyze_pdf(path: Path) -> Analysis:
    try:
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(str(path))
        pil = pdf[0].render(scale=2.0).to_pil()
        return _classify_image(pil, 144)
    except Exception:
        return Analysis(mode="spot-flat",
                        reasoning=["could not rasterize PDF — treating as flat"])


def _classify_image(img: Image.Image, dpi: int | None) -> Analysis:
    """Count distinct colors + measure edge density; recommend a mode."""
    # Downscale for speed — analysis doesn't need full res
    thumb = img.convert("RGB").copy()
    thumb.thumbnail((600, 600), Image.LANCZOS)
    arr = np.array(thumb, dtype=np.uint8)

    # --- distinct colors (quantize to 32, count ones that cover >0.5%)
    q = thumb.quantize(colors=32, method=Image.Quantize.MEDIANCUT)
    counts = q.getcolors() or []
    total = thumb.size[0] * thumb.size[1]
    significant = [c for c, _idx in counts if c / total > 0.005]
    distinct = len(significant)

    # --- edge density (photoreal has many edges at many scales)
    gray = np.array(thumb.convert("L"), dtype=np.int16)
    dx = np.abs(np.diff(gray, axis=1))
    dy = np.abs(np.diff(gray, axis=0))
    # Edge fraction: pixels where gradient > threshold
    edge_frac = (
        ((dx > 30).sum() + (dy > 30).sum())
        / (dx.size + dy.size)
    )

    # --- gradient detection: count soft-gradient pixels (0 < grad < 15)
    soft_frac = (
        (((dx > 2) & (dx < 15)).sum() + ((dy > 2) & (dy < 15)).sum())
        / (dx.size + dy.size)
    )

    photoreal = edge_frac > 0.08 or soft_frac > 0.25 or distinct > 14
    has_gradients = soft_frac > 0.15

    reasoning = []
    reasoning.append(f"{distinct} distinct colors detected (≥0.5% coverage each)")
    if has_gradients:
        reasoning.append(f"soft gradients present ({soft_frac:.0%} of pixels)")
    if photoreal:
        reasoning.append("looks photoreal — recommend sim-process")
        mode = "sim-process"
        suggested = min(8, max(4, distinct))
    else:
        reasoning.append("looks like flat illustration — recommend spot-color")
        mode = "spot-flat"
        suggested = max(1, distinct)

    return Analysis(
        mode=mode,
        reasoning=reasoning,
        distinct_colors=distinct,
        photoreal=photoreal,
        has_gradients=has_gradients,
        suggested_color_count=suggested,
        source_size=img.size,
        source_dpi=dpi,
    )
