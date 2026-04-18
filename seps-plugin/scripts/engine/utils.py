"""Shared utilities for the inktracker sep engine.

Handles:
  - Loading layered PSDs (exported from Affinity or Photoshop)
  - Writing film-ready TIFs (grayscale, high-DPI, with reg marks)
  - Safe file naming
  - JSON I/O for the skill <-> engine handoff
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw


# --------------------------------------------------------------------------- #
# Data classes
# --------------------------------------------------------------------------- #

@dataclass
class ColorSpec:
    """A single ink color in the separation."""
    index: int
    name: str
    ink: str
    mesh_count: int
    purpose: str = "color"  # "underbase" | "highlight" | "color"
    rgb: tuple | None = None  # Required for flat-image input; None for layered-PSD
    tolerance: int = 40  # RGB distance tolerance for flat-image masking

    @classmethod
    def from_dict(cls, d: dict) -> "ColorSpec":
        rgb = d.get("rgb")
        if rgb is not None:
            rgb = tuple(int(v) for v in rgb)
        return cls(
            index=int(d["index"]),
            name=d["name"],
            ink=d.get("ink", d["name"]),
            mesh_count=int(d.get("meshCount", 230)),
            purpose=d.get("purpose", "color"),
            rgb=rgb,
            tolerance=int(d.get("tolerance", 40)),
        )


@dataclass
class FilmResult:
    """Record of a single film TIF that was written."""
    index: int
    name: str
    path: str
    mesh_count: int
    ink: str
    purpose: str

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "name": self.name,
            "path": self.path,
            "meshCount": self.mesh_count,
            "ink": self.ink,
            "purpose": self.purpose,
        }


@dataclass
class EngineInput:
    """Parsed input JSON passed from a Cowork skill."""
    job_code: str
    source_file: str
    output_dir: str
    film_dpi: int = 360
    registration_marks: bool = True
    garment_color: str = "black"
    colors: list[ColorSpec] = field(default_factory=list)
    # sim-process only:
    color_count: int = 8
    include_underbase: bool = True
    include_highlight: bool = True
    mesh_counts: dict = field(default_factory=lambda: {
        "underbase": 156, "top": 230, "highlight": 305
    })

    @classmethod
    def from_file(cls, path: str | Path) -> "EngineInput":
        data = json.loads(Path(path).read_text())
        return cls(
            job_code=data["jobCode"],
            source_file=data["sourceFile"],
            output_dir=data["outputDir"],
            film_dpi=int(data.get("filmDpi", 360)),
            registration_marks=bool(data.get("registrationMarks", True)),
            garment_color=data.get("garmentColor", "black"),
            colors=[ColorSpec.from_dict(c) for c in data.get("colors", [])],
            color_count=int(data.get("colorCount", 8)),
            include_underbase=bool(data.get("includeUnderbase", True)),
            include_highlight=bool(data.get("includeHighlight", True)),
            mesh_counts=data.get("meshCounts", {
                "underbase": 156, "top": 230, "highlight": 305
            }),
        )


@dataclass
class EngineResult:
    success: bool
    films: list[FilmResult] = field(default_factory=list)
    elapsed_seconds: float = 0.0
    warnings: list[str] = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "films": [f.to_dict() for f in self.films],
            "elapsedSeconds": round(self.elapsed_seconds, 2),
            "warnings": self.warnings,
            "error": self.error,
        }

    def write(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2))


# --------------------------------------------------------------------------- #
# File naming
# --------------------------------------------------------------------------- #

_SAFE_RE = re.compile(r"[^a-zA-Z0-9]+")


def safe_name(s: str) -> str:
    """Turn any string into a filesystem-safe slug."""
    return _SAFE_RE.sub("-", s).strip("-").lower()


def film_filename(index: int, name: str, mesh_count: int) -> str:
    """Standard film name: 01_white-underbase_156.tif"""
    return f"{index:02d}_{safe_name(name)}_{mesh_count}.tif"


# --------------------------------------------------------------------------- #
# PSD loading (works on Affinity- or Photoshop-exported layered PSDs)
# --------------------------------------------------------------------------- #

def load_layered_psd(path: str | Path):
    """Return the psd_tools PSDImage for a source PSD.

    Accepts either a .psd or falls back to a single-layer load for .png/.tif.
    """
    path = Path(path)
    if path.suffix.lower() in (".psd", ".psb"):
        try:
            from psd_tools import PSDImage
        except ImportError as e:
            raise RuntimeError(
                "psd-tools not installed. Run: pip install -r requirements.txt"
            ) from e
        return PSDImage.open(str(path))
    raise ValueError(
        f"Unsupported source file: {path.suffix}. "
        "Export your Affinity file as a layered PSD and point the engine at that."
    )


def find_color_layers(psd, color_specs: list[ColorSpec]) -> dict[str, object]:
    """Match each ColorSpec to a PSD layer by name (case-insensitive, substring).

    Returns a dict of {color_name: layer}. Layers not found are left out.
    """
    name_to_layer = {}
    flat_layers = list(_iter_layers(psd))

    for spec in color_specs:
        target = safe_name(spec.name)
        best = None
        for layer in flat_layers:
            if layer.name is None:
                continue
            ln = safe_name(layer.name)
            if ln == target:
                best = layer
                break
            if target in ln or ln in target:
                # fallback: substring match
                if best is None:
                    best = layer
        if best is not None:
            name_to_layer[spec.name] = best
    return name_to_layer


def _iter_layers(group):
    """Yield all image layers recursively from a PSD or group."""
    for layer in group:
        if hasattr(layer, "layers"):
            yield from _iter_layers(layer)
        else:
            yield layer


# --------------------------------------------------------------------------- #
# Film output
# --------------------------------------------------------------------------- #

def render_layer_as_film(
    layer, doc_size: tuple[int, int], dpi: int, reg_marks: bool
) -> Image.Image:
    """Render one layer into a grayscale film-ready image at the given DPI.

    The layer is composited onto a white canvas (film positive convention),
    with ink areas rendered as black. Registration marks are added outside
    the artwork bounds if enabled.
    """
    doc_w, doc_h = doc_size

    # Composite the layer onto a transparent doc-sized canvas
    canvas = Image.new("RGBA", doc_size, (0, 0, 0, 0))
    layer_img = layer.composite() if hasattr(layer, "composite") else layer.topil()
    if layer_img is None:
        # empty layer
        return _blank_film(doc_size, dpi, reg_marks)

    # Position the layer on the canvas using its offset (Affinity/Photoshop use
    # layer.left/top for positioning).
    left = getattr(layer, "left", 0)
    top = getattr(layer, "top", 0)
    canvas.paste(layer_img, (left, top), layer_img if layer_img.mode == "RGBA" else None)

    # Convert to grayscale — we want density of ink, so we use the alpha
    # channel if present (a fully opaque pixel = full ink coverage), else
    # we invert the luminance.
    if canvas.mode == "RGBA":
        alpha = canvas.split()[3]
        # Film positive: ink area = black = full density. Alpha=255 -> black.
        gray = Image.eval(alpha, lambda v: 255 - v)
    else:
        gray = canvas.convert("L")
        gray = Image.eval(gray, lambda v: 255 - v)

    gray = _apply_dpi_metadata(gray, dpi)

    if reg_marks:
        gray = _add_reg_marks(gray)
    return gray


def _blank_film(doc_size, dpi, reg_marks):
    """Fallback: empty white film with just reg marks (if enabled)."""
    img = Image.new("L", doc_size, 255)
    img = _apply_dpi_metadata(img, dpi)
    if reg_marks:
        img = _add_reg_marks(img)
    return img


def _apply_dpi_metadata(img: Image.Image, dpi: int) -> Image.Image:
    img.info["dpi"] = (dpi, dpi)
    return img


def _add_reg_marks(img: Image.Image) -> Image.Image:
    """Draw 4 corner registration crosses on a grayscale film."""
    work = img.copy()
    draw = ImageDraw.Draw(work)
    w, h = work.size
    margin = 30
    size = 20
    thick = 2

    corners = [
        (margin, margin),
        (w - margin, margin),
        (margin, h - margin),
        (w - margin, h - margin),
    ]
    for cx, cy in corners:
        draw.rectangle(
            [cx - size // 2, cy - thick // 2, cx + size // 2, cy + thick // 2],
            fill=0,
        )
        draw.rectangle(
            [cx - thick // 2, cy - size // 2, cx + thick // 2, cy + size // 2],
            fill=0,
        )
    return work


def save_film(img: Image.Image, path: str | Path, dpi: int) -> None:
    """Save a film as an uncompressed grayscale TIF with DPI metadata."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("L").save(
        str(path),
        format="TIFF",
        dpi=(dpi, dpi),
        compression="none",
    )


# --------------------------------------------------------------------------- #
# Flat-image color detection (for PNG/JPG input)
# --------------------------------------------------------------------------- #

def detect_flat_colors(
    img: Image.Image,
    max_colors: int = 8,
    min_pixel_fraction: float = 0.005,
    ignore_transparent: bool = True,
) -> list[dict]:
    """Detect the distinct colors in a flat image.

    Uses Pillow's quantize() method (median-cut palette reduction), then
    filters out colors that occupy less than min_pixel_fraction of the image
    (usually anti-aliasing artifacts or JPEG noise).

    Returns a list of dicts, most prominent color first:
        [{"rgb": (r, g, b), "pixel_count": N, "fraction": 0.42}, ...]
    """
    import numpy as np

    if img.mode == "RGBA":
        # Optionally drop fully-transparent pixels so they don't count as a color
        if ignore_transparent:
            rgba = np.array(img)
            opaque_mask = rgba[..., 3] > 32
            if not opaque_mask.any():
                return []
            # Pillow can't quantize an image with transparency reliably, so
            # replace transparent pixels with white (paper) before quantize
            rgba[~opaque_mask] = [255, 255, 255, 255]
            img = Image.fromarray(rgba, "RGBA").convert("RGB")
        else:
            img = img.convert("RGB")
    else:
        img = img.convert("RGB")

    # Quantize the image to at most max_colors colors
    pal_img = img.quantize(colors=max_colors, method=Image.Quantize.MEDIANCUT)
    palette = pal_img.getpalette()  # flat list [r,g,b,r,g,b,...]
    counts = pal_img.getcolors()  # list of (pixel_count, palette_index)
    total = img.size[0] * img.size[1]

    results = []
    for count, idx in counts or []:
        fraction = count / total
        if fraction < min_pixel_fraction:
            continue
        r, g, b = palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]
        results.append({
            "rgb": (int(r), int(g), int(b)),
            "pixel_count": int(count),
            "fraction": round(fraction, 4),
            "suggested_name": _suggest_color_name(r, g, b),
        })

    # Sort most-prominent first
    results.sort(key=lambda c: -c["pixel_count"])
    return results


def _suggest_color_name(r: int, g: int, b: int) -> str:
    """Return a short, human-friendly name for an RGB color."""
    # Easy cases
    if r > 240 and g > 240 and b > 240:
        return "white"
    if r < 30 and g < 30 and b < 30:
        return "black"
    if abs(r - g) < 15 and abs(g - b) < 15:
        if r < 100:
            return "dark-gray"
        if r > 180:
            return "light-gray"
        return "gray"

    # Hue-based naming
    import colorsys
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hue_deg = h * 360

    if s < 0.2:
        return "gray"
    if hue_deg < 15 or hue_deg >= 345:
        return "red"
    if hue_deg < 45:
        return "orange"
    if hue_deg < 70:
        return "yellow"
    if hue_deg < 160:
        return "green"
    if hue_deg < 200:
        return "cyan"
    if hue_deg < 260:
        return "blue"
    if hue_deg < 290:
        return "purple"
    if hue_deg < 345:
        return "pink"
    return "color"


def render_color_as_mask(
    img: Image.Image,
    target_rgb: tuple[int, int, int],
    tolerance: int = 40,
    feather: int = 1,
) -> Image.Image:
    """Produce a grayscale density mask for one color in a flat image.

    Pixels close to target_rgb become dark (full ink); pixels far away
    become white (no ink). This is the flat-image equivalent of a layer's
    alpha channel — drives the film output.
    """
    import numpy as np

    src = img.convert("RGB")
    arr = np.array(src, dtype=np.float32)
    target = np.array(target_rgb, dtype=np.float32)

    # Euclidean distance in RGB space (simple, works well for distinct colors)
    dist = np.sqrt(((arr - target) ** 2).sum(axis=2))
    # 0 distance -> full ink (0 in film), tolerance distance -> no ink (255)
    density = np.clip(dist / tolerance, 0, 1) * 255
    density = density.astype(np.uint8)

    mask = Image.fromarray(density, mode="L")
    if feather > 0:
        from PIL import ImageFilter
        mask = mask.filter(ImageFilter.GaussianBlur(radius=feather))
    return mask


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #

class EngineError(Exception):
    pass
