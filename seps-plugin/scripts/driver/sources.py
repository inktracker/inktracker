"""Unified source loader for the driver.

Accepts PSD/PSB (layered), PNG/JPG/TIF (flat), or PDF (from macOS Print).
Returns either:
  - a list of named layers (for layered input), or
  - a single flat RGB image with an auto-detected color list (for flat input).

The PDF path expects a single-page PDF (Print dialog usually emits one page
per sep, though we gracefully handle multi-page by combining pages as
separate layers named "page-1", "page-2", etc.).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image


# Flat raster formats we accept directly
FLAT_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif"}
PSD_EXT = {".psd", ".psb"}
PDF_EXT = {".pdf"}


@dataclass
class NamedLayer:
    """One named image layer from a layered source."""
    name: str
    image: Image.Image   # RGBA, doc-sized canvas with the layer pasted in place


@dataclass
class LoadedSource:
    """The driver's view of the source, after loading.

    For layered inputs, `layers` is populated and `flat` is None.
    For flat inputs, `flat` is populated and `layers` is empty.
    `doc_size` is the pixel size of the canvas the artwork lives on.
    `dpi` is the native DPI if known (for scaling to print size).
    """
    layers: list[NamedLayer]
    flat: Image.Image | None
    doc_size: tuple[int, int]
    dpi: int | None


def load(path: Path, pdf_render_dpi: int = 400) -> LoadedSource:
    ext = path.suffix.lower()
    if ext in PSD_EXT:
        return _load_psd(path)
    if ext in FLAT_EXT:
        return _load_flat(path)
    if ext in PDF_EXT:
        return _load_pdf(path, pdf_render_dpi)
    raise ValueError(f"Unsupported source format: {ext}")


# --- PSD / PSB --------------------------------------------------------------

def _load_psd(path: Path) -> LoadedSource:
    from psd_tools import PSDImage
    psd = PSDImage.open(str(path))
    w, h = psd.width, psd.height

    named: list[NamedLayer] = []
    for layer in _iter_leaf_layers(psd):
        if layer.name is None:
            continue
        if not getattr(layer, "is_visible", lambda: True)():
            continue
        img = layer.composite() if hasattr(layer, "composite") else layer.topil()
        if img is None:
            continue
        # Place at layer offset on a doc-sized RGBA canvas
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        left = getattr(layer, "left", 0) or 0
        top = getattr(layer, "top", 0) or 0
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        canvas.paste(img, (left, top), img)
        named.append(NamedLayer(name=layer.name, image=canvas))

    # DPI: PSDs rarely expose it reliably through psd-tools; assume 300.
    return LoadedSource(layers=named, flat=None, doc_size=(w, h), dpi=None)


def _iter_leaf_layers(group) -> Iterable:
    for layer in group:
        if hasattr(layer, "layers") and layer.layers:
            yield from _iter_leaf_layers(layer)
        else:
            yield layer


# --- Flat raster ------------------------------------------------------------

def _load_flat(path: Path) -> LoadedSource:
    img = Image.open(str(path))
    img.load()
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    dpi = None
    if "dpi" in img.info:
        d = img.info["dpi"]
        dpi = int(d[0]) if isinstance(d, tuple) else int(d)
    return LoadedSource(layers=[], flat=img, doc_size=img.size, dpi=dpi)


# --- PDF -------------------------------------------------------------------

def _load_pdf(path: Path, render_dpi: int) -> LoadedSource:
    """Rasterize a PDF into a flat RGB image (or multi-page layers).

    Tries pypdfium2 first (pure-Python wheel); falls back to macOS `sips`
    via subprocess if not installed.
    """
    try:
        return _load_pdf_pdfium(path, render_dpi)
    except ImportError:
        return _load_pdf_sips(path, render_dpi)


def _load_pdf_pdfium(path: Path, render_dpi: int) -> LoadedSource:
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(path))
    scale = render_dpi / 72.0

    if len(pdf) == 1:
        page = pdf[0]
        pil = page.render(scale=scale).to_pil().convert("RGB")
        return LoadedSource(
            layers=[], flat=pil, doc_size=pil.size, dpi=render_dpi,
        )

    # Multi-page: treat each page as its own layer (named "page-N").
    w = h = 0
    layers: list[NamedLayer] = []
    for i, page in enumerate(pdf, start=1):
        pil = page.render(scale=scale).to_pil().convert("RGBA")
        w = max(w, pil.size[0])
        h = max(h, pil.size[1])
        layers.append(NamedLayer(name=f"page-{i}", image=pil))

    # Pad all layers to common doc size
    for lyr in layers:
        if lyr.image.size != (w, h):
            canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            canvas.paste(lyr.image, (0, 0), lyr.image)
            lyr.image = canvas

    return LoadedSource(layers=layers, flat=None, doc_size=(w, h), dpi=render_dpi)


def _load_pdf_sips(path: Path, render_dpi: int) -> LoadedSource:
    """Fallback: use macOS `sips` to rasterize the PDF to PNG."""
    import shutil
    import subprocess
    import tempfile

    if not shutil.which("sips"):
        raise RuntimeError(
            "Neither pypdfium2 nor macOS `sips` is available. "
            "Install pypdfium2: pip install pypdfium2"
        )

    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "page.png"
        subprocess.run(
            [
                "sips", "-s", "format", "png",
                "--resampleHeightWidthMax", str(render_dpi * 30),  # generous cap
                "-s", "dpiWidth", str(render_dpi),
                "-s", "dpiHeight", str(render_dpi),
                str(path), "--out", str(out),
            ],
            check=True, capture_output=True,
        )
        img = Image.open(str(out)).convert("RGB")
        img.load()
        return LoadedSource(layers=[], flat=img, doc_size=img.size, dpi=render_dpi)
