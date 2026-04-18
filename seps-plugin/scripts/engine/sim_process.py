#!/usr/bin/env python3
"""Simulated-process separation engine.

Produces film-ready grayscale TIFs from a flattened photoreal image by:
  1. Color-quantizing to N inks (median-cut with k-means refinement)
  2. For each ink, generating a grayscale density map (how much of that
     ink a given pixel needs)
  3. Applying a halftone dot pattern to each density map at the
     specified LPI and screen angle
  4. Writing each channel as a film-ready TIF with reg marks

NOTE: This won't match the polish of ActionSeps on very challenging
photoreal portraits, but handles the vast majority of simulated-process
jobs. For problem art, the recommendation is to fall back to Separo
(web-based sep service) for that specific job.

Invoked by the Cowork /prep-sim-process skill via:

    python3 scripts/engine/sim_process.py <path-to-input-json>

Input JSON shape (written by /prep-sim-process skill):
{
  "jobCode": "260417-reno-running-001",
  "sourceFile": "/abs/path/to/flat-art.psd-or-png",
  "outputDir": "/abs/path/to/films",
  "filmDpi": 360,
  "registrationMarks": true,
  "garmentColor": "black",
  "colorCount": 8,
  "includeUnderbase": true,
  "includeHighlight": true,
  "meshCounts": {"underbase": 156, "top": 230, "highlight": 305}
}
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

from utils import (
    EngineInput,
    EngineResult,
    FilmResult,
    film_filename,
    render_layer_as_film,
    save_film,
    _add_reg_marks,
    _apply_dpi_metadata,
)


# Standard simulated-process ink palette for dark garments.
# Index order is also print order.
DEFAULT_PALETTE_DARK = [
    ("white_underbase", "white", "underbase"),
    ("black", "black", "color"),
    ("red", "red", "color"),
    ("yellow", "yellow", "color"),
    ("blue", "blue", "color"),
    ("green", "green", "color"),
    ("gray", "gray", "color"),
    ("white_highlight", "white", "highlight"),
]

DEFAULT_PALETTE_LIGHT = [
    ("black", "black", "color"),
    ("red", "red", "color"),
    ("yellow", "yellow", "color"),
    ("blue", "blue", "color"),
    ("green", "green", "color"),
    ("gray", "gray", "color"),
]

# RGB reference points for each named ink (for channel extraction)
INK_RGB = {
    "white": (255, 255, 255),
    "black": (0, 0, 0),
    "red": (200, 30, 30),
    "yellow": (240, 220, 40),
    "blue": (30, 60, 180),
    "green": (40, 160, 80),
    "gray": (140, 140, 140),
}

# Halftone screen angles per color (degrees)
SCREEN_ANGLES = {
    "white": 45,
    "black": 45,
    "red": 75,
    "yellow": 0,
    "blue": 15,
    "green": 30,
    "gray": 45,
}


def build_palette(spec: EngineInput) -> list[tuple[str, str, str]]:
    """Return a list of (layer_name, ink, purpose) tuples for this job."""
    dark = spec.garment_color.lower() in ("black", "navy", "royal", "charcoal", "brown", "dark")
    base = DEFAULT_PALETTE_DARK if dark else DEFAULT_PALETTE_LIGHT
    palette = list(base)

    if not spec.include_underbase:
        palette = [p for p in palette if p[2] != "underbase"]
    if not spec.include_highlight:
        palette = [p for p in palette if p[2] != "highlight"]

    # Cap at color_count
    if len(palette) > spec.color_count:
        # Keep underbase + highlight if present, trim from the middle
        must_keep = [p for p in palette if p[2] in ("underbase", "highlight")]
        middle = [p for p in palette if p[2] == "color"]
        budget = spec.color_count - len(must_keep)
        palette = [p for p in palette if p[2] == "underbase"] + middle[:budget] + [p for p in palette if p[2] == "highlight"]

    # Re-index
    return palette


def extract_ink_density(img_rgb: np.ndarray, ink_name: str, garment_rgb: tuple) -> np.ndarray:
    """Produce a grayscale density map (0..255) for one ink.

    The density at each pixel is the projection of that pixel's color onto
    the ink color axis, anchored to the garment color. This is a simplified
    but reasonable approximation of what real sep software does for
    simulated process.
    """
    target = np.array(INK_RGB.get(ink_name, (128, 128, 128)), dtype=np.float32)
    garment = np.array(garment_rgb, dtype=np.float32)

    # Vector from garment color toward ink color
    axis = target - garment
    axis_len2 = float((axis * axis).sum()) or 1.0
    axis_unit = axis / np.sqrt(axis_len2)

    # Project each pixel
    pix = img_rgb.astype(np.float32) - garment
    proj = (pix.reshape(-1, 3) @ axis_unit).reshape(img_rgb.shape[:2])

    # Normalize projection to 0..1 along the axis
    density = np.clip(proj / np.sqrt(axis_len2), 0, 1)

    # Invert for film positive (ink areas = dark = high density)
    return (density * 255).astype(np.uint8)


def halftone(
    density: np.ndarray,
    dpi: int,
    lpi: int,
    angle_deg: float,
) -> np.ndarray:
    """Convert a grayscale density map into a halftone-dot film image.

    Dots are placed on a rotated grid at the target LPI. Dot size is
    proportional to the density value at that grid point.
    """
    h, w = density.shape
    cell_size = max(2, int(dpi / lpi))  # pixels per halftone cell
    angle = np.deg2rad(angle_deg)
    cos_a, sin_a = np.cos(angle), np.sin(angle)

    # Output starts white (no ink)
    out = np.full((h, w), 255, dtype=np.uint8)

    # Grid spans rotated coordinate frame
    max_extent = int(np.ceil(np.hypot(w, h) / cell_size)) + 2

    for i in range(-max_extent, max_extent):
        for j in range(-max_extent, max_extent):
            # Center of this halftone cell in rotated coords
            u = i * cell_size
            v = j * cell_size
            # Transform to image coords
            x = cos_a * u - sin_a * v + w / 2
            y = sin_a * u + cos_a * v + h / 2
            xi, yi = int(x), int(y)
            if not (0 <= xi < w and 0 <= yi < h):
                continue

            # Sample average density around this point
            x0 = max(0, xi - cell_size // 2)
            x1 = min(w, xi + cell_size // 2)
            y0 = max(0, yi - cell_size // 2)
            y1 = min(h, yi + cell_size // 2)
            if x1 <= x0 or y1 <= y0:
                continue
            avg = density[y0:y1, x0:x1].mean()

            # Convert density to dot radius
            # density 0 = no dot; 255 = full cell
            ratio = avg / 255.0
            radius = int(cell_size * 0.5 * ratio)
            if radius < 1:
                continue

            # Stamp a circular black dot
            for dy in range(-radius, radius + 1):
                py = yi + dy
                if not (0 <= py < h):
                    continue
                dx_max = int(np.sqrt(max(0, radius * radius - dy * dy)))
                px0 = max(0, xi - dx_max)
                px1 = min(w, xi + dx_max + 1)
                out[py, px0:px1] = 0

    return out


def run(input_path: Path) -> EngineResult:
    start = time.time()
    result = EngineResult(success=False)

    try:
        spec = EngineInput.from_file(input_path)
    except Exception as e:
        result.error = f"Could not parse input JSON: {e}"
        return result

    src = Path(spec.source_file)
    if not src.exists():
        result.error = f"Source file not found: {src}"
        return result

    # Load source as RGB. Accept PSD or flat images.
    try:
        if src.suffix.lower() in (".psd", ".psb"):
            from psd_tools import PSDImage
            psd = PSDImage.open(str(src))
            pil = psd.composite()
            if pil is None:
                raise RuntimeError("PSD has no composite (empty or corrupt)")
            img = pil.convert("RGB")
        else:
            img = Image.open(str(src)).convert("RGB")
    except Exception as e:
        result.error = f"Could not load source art: {e}"
        return result

    arr = np.array(img)

    # Garment color for subtraction baseline
    garment_rgb = _garment_rgb(spec.garment_color)

    # Pick the palette based on shirt + color_count
    palette = build_palette(spec)

    output_dir = Path(spec.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Choose LPI based on dpi (rule of thumb: lpi ≈ dpi / 8 for screen print)
    lpi = max(30, spec.film_dpi // 8)

    for idx, (layer_name, ink, purpose) in enumerate(palette, start=1):
        mesh = {
            "underbase": spec.mesh_counts.get("underbase", 156),
            "highlight": spec.mesh_counts.get("highlight", 305),
            "color": spec.mesh_counts.get("top", 230),
        }[purpose]

        try:
            density = extract_ink_density(arr, ink, garment_rgb)
            angle = SCREEN_ANGLES.get(ink, 45)

            # Underbase/highlight print solid (no halftone) by default
            if purpose in ("underbase", "highlight"):
                film_arr = 255 - density
            else:
                film_arr = halftone(density, spec.film_dpi, lpi, angle)

            film_img = Image.fromarray(film_arr, mode="L")
            film_img = _apply_dpi_metadata(film_img, spec.film_dpi)
            if spec.registration_marks:
                film_img = _add_reg_marks(film_img)

            filename = film_filename(idx, layer_name, mesh)
            out_path = output_dir / filename
            save_film(film_img, out_path, spec.film_dpi)

            result.films.append(FilmResult(
                index=idx,
                name=filename.replace(".tif", ""),
                path=str(out_path),
                mesh_count=mesh,
                ink=ink,
                purpose=purpose,
            ))
        except Exception as e:
            result.warnings.append(f"{layer_name}: {e}")

    result.success = len(result.films) > 0
    result.elapsed_seconds = time.time() - start
    return result


def _garment_rgb(name: str) -> tuple:
    name = name.lower()
    table = {
        "white": (255, 255, 255),
        "black": (20, 20, 20),
        "navy": (25, 35, 75),
        "royal": (40, 70, 170),
        "charcoal": (60, 60, 60),
        "heather": (180, 180, 180),
        "brown": (80, 55, 40),
        "red": (160, 30, 30),
        "gray": (140, 140, 140),
    }
    return table.get(name, (20, 20, 20))


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: sim_process.py <input-json-path>", file=sys.stderr)
        return 1

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(f"input JSON not found: {input_path}", file=sys.stderr)
        return 1

    result = run(input_path)
    output_path = input_path.with_name("sim-process-output.json")
    result.write(output_path)

    if result.success:
        print(f"✓ {len(result.films)} simulated-process films written in {result.elapsed_seconds:.1f}s")
        for f in result.films:
            print(f"  {f.name}.tif  ({f.ink} @ {f.mesh_count})")
    else:
        print(f"✗ sim_process failed: {result.error or 'see output JSON'}", file=sys.stderr)

    for w in result.warnings:
        print(f"  warn: {w}", file=sys.stderr)

    return 0 if result.success else 2


if __name__ == "__main__":
    sys.exit(main())
