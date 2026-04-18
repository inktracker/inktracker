#!/usr/bin/env python3
"""Spot-color separation engine.

Reads a layered PSD (exported from Affinity, Photoshop, or anywhere) and
produces one film-ready grayscale TIF per color layer named in the input.

Invoked by the Cowork /prep-spot skill via:

    python3 scripts/engine/spot_sep.py <path-to-input-json>

Input JSON shape (written by /prep-spot skill):
{
  "jobCode": "260417-reno-running-001",
  "sourceFile": "/abs/path/to/prepared.psd",
  "outputDir": "/abs/path/to/films",
  "filmDpi": 360,
  "registrationMarks": true,
  "colors": [
    {"index": 1, "name": "white_underbase", "ink": "white", "meshCount": 156, "purpose": "underbase"},
    {"index": 2, "name": "navy", "ink": "Pantone 289 C", "meshCount": 230},
    ...
  ]
}

Output JSON (next to input, named spot-sep-output.json):
{
  "success": true,
  "films": [...],
  "elapsedSeconds": 12.4,
  "warnings": []
}
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from PIL import Image

from utils import (
    EngineError,
    EngineInput,
    EngineResult,
    FilmResult,
    _add_reg_marks,
    _apply_dpi_metadata,
    film_filename,
    find_color_layers,
    load_layered_psd,
    render_color_as_mask,
    render_layer_as_film,
    save_film,
)


# Supported flat-image formats — handled by the color-masking path instead
# of the layered-PSD path.
FLAT_FORMATS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif"}


def run(input_path: Path) -> EngineResult:
    start = time.time()
    result = EngineResult(success=False)

    try:
        spec = EngineInput.from_file(input_path)
    except Exception as e:
        result.error = f"Could not parse input JSON: {e}"
        return result

    if not spec.colors:
        result.error = "No colors specified in input JSON."
        return result

    src = Path(spec.source_file)
    if not src.exists():
        result.error = f"Source file not found: {src}"
        return result

    is_flat = src.suffix.lower() in FLAT_FORMATS

    if is_flat:
        return _run_flat(spec, src, result, start)
    return _run_layered(spec, src, result, start)


def _run_layered(spec, src, result, start):
    """Original path — layered PSD, match colors by layer name."""
    try:
        psd = load_layered_psd(src)
    except Exception as e:
        result.error = f"Could not open source PSD: {e}"
        return result

    doc_size = (psd.width, psd.height)
    layer_map = find_color_layers(psd, spec.colors)

    output_dir = Path(spec.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    for color in spec.colors:
        if color.name not in layer_map:
            result.warnings.append(
                f"No layer matching '{color.name}' — skipped. "
                f"Check your Affinity layer names."
            )
            continue

        layer = layer_map[color.name]

        try:
            film_img = render_layer_as_film(
                layer, doc_size, spec.film_dpi, spec.registration_marks,
            )
        except Exception as e:
            result.warnings.append(f"Failed to render {color.name}: {e}")
            continue

        filename = film_filename(color.index, color.name, color.mesh_count)
        out_path = output_dir / filename

        try:
            save_film(film_img, out_path, spec.film_dpi)
        except Exception as e:
            result.warnings.append(f"Failed to save {filename}: {e}")
            continue

        result.films.append(FilmResult(
            index=color.index,
            name=filename.replace(".tif", ""),
            path=str(out_path),
            mesh_count=color.mesh_count,
            ink=color.ink,
            purpose=color.purpose,
        ))

    result.success = len(result.films) > 0
    result.elapsed_seconds = time.time() - start
    return result


def _run_flat(spec, src, result, start):
    """Flat-image path — each color spec must include an "rgb" [r,g,b] array.

    The /prep-spot skill runs detect_colors.py first to find the distinct
    colors, asks the user to confirm names/mesh counts, then writes the
    input JSON with "rgb" values and calls this engine.
    """
    try:
        img = Image.open(str(src))
    except Exception as e:
        result.error = f"Could not open source image: {e}"
        return result

    # Check that every color has an rgb value set (from detect_colors step)
    missing_rgb = [c.name for c in spec.colors if not getattr(c, "rgb", None)]
    if missing_rgb:
        result.error = (
            f"Flat-image input requires each color to have an 'rgb' value. "
            f"Missing for: {', '.join(missing_rgb)}. Run detect_colors.py first."
        )
        return result

    output_dir = Path(spec.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    for color in spec.colors:
        try:
            mask = render_color_as_mask(
                img,
                tuple(color.rgb),
                tolerance=getattr(color, "tolerance", 40),
            )

            if spec.film_dpi and spec.film_dpi != img.info.get("dpi", (72, 72))[0]:
                mask = _apply_dpi_metadata(mask, spec.film_dpi)
            if spec.registration_marks:
                mask = _add_reg_marks(mask)

            filename = film_filename(color.index, color.name, color.mesh_count)
            out_path = output_dir / filename
            save_film(mask, out_path, spec.film_dpi)

            result.films.append(FilmResult(
                index=color.index,
                name=filename.replace(".tif", ""),
                path=str(out_path),
                mesh_count=color.mesh_count,
                ink=color.ink,
                purpose=color.purpose,
            ))
        except Exception as e:
            result.warnings.append(f"Failed to render {color.name}: {e}")

    # Sanity check: if the source is lower DPI than the target, warn the user
    src_dpi = img.info.get("dpi", (72, 72))[0]
    if src_dpi and src_dpi < spec.film_dpi * 0.8:
        result.warnings.append(
            f"Source image is {int(src_dpi)} DPI; target is {spec.film_dpi}. "
            f"Films may look soft. For best results, start from art ≥300 DPI."
        )

    result.success = len(result.films) > 0
    result.elapsed_seconds = time.time() - start
    return result


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: spot_sep.py <input-json-path>", file=sys.stderr)
        return 1

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(f"input JSON not found: {input_path}", file=sys.stderr)
        return 1

    result = run(input_path)
    output_path = input_path.with_name("spot-sep-output.json")
    result.write(output_path)

    if result.success:
        print(f"✓ {len(result.films)} films written to {result.films[0].path and Path(result.films[0].path).parent}")
        for f in result.films:
            print(f"  {f.name}.tif  ({f.ink} @ {f.mesh_count})")
    else:
        print(f"✗ spot_sep failed: {result.error or 'see output JSON for warnings'}", file=sys.stderr)

    for w in result.warnings:
        print(f"  warn: {w}", file=sys.stderr)

    return 0 if result.success else 2


if __name__ == "__main__":
    sys.exit(main())
