#!/usr/bin/env python3
"""Biota film-output print driver.

Usage:
    film_driver.py <artwork> [options]

Orchestrates: source load → per-ink density extraction → elliptical
halftone with shop-correct angles/cutoffs/dot-gain → sheet layout with
reg marks → TIF output ready for the Epson P800.

The driver is the canonical entry point. The macOS PDF Service hook and
the existing Cowork skills (prep-spot, prep-sim-process) should call this
instead of invoking the engine directly.

Examples
--------
  # Layered PSD, defaults, 12" wide print on black shirt
  film_driver.py artwork.psd --print-width 12 --garment black

  # Flat PNG, photoreal (sim-process mode), discharge underbase
  film_driver.py photo.png --mode sim-process --print-width 11 \\
      --garment black --ink-system discharge

  # From macOS Print dialog (PDF, auto-detect colors)
  film_driver.py /tmp/print.pdf --print-width 10 -o ./films
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
from PIL import Image

# Allow running either as `python film_driver.py ...` or as a module
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
# Also allow importing engine utils for flat-image color detection
_ENGINE = _HERE.parent / "engine"
if str(_ENGINE) not in sys.path:
    sys.path.insert(0, str(_ENGINE))

from halftone import halftone, solid_film  # noqa: E402
from layout import FilmLabel, compose_film_sheet, save_film_tif  # noqa: E402
from preferences import (  # noqa: E402
    DEFAULT_MESH,
    DriverConfig,
    SheetSize,
    assign_angles,
    pick_lpi,
    pick_sheet,
    FILM_DPI_DEFAULT,
)
from preview import build_contact_sheet, open_in_preview  # noqa: E402
from printer import PrintJob, PrinterConfig, submit_many  # noqa: E402
from sources import LoadedSource, NamedLayer, load  # noqa: E402


# ---------------------------------------------------------------------------
# Ink spec — per-ink resolved config after shop-defaults + overrides
# ---------------------------------------------------------------------------

@dataclass
class InkSpec:
    index: int
    name: str                    # layer name or suggested color name
    ink: str                     # ink display name (e.g. "Pantone 289 C")
    mesh: int
    purpose: str                 # underbase | color | highlight
    angle_deg: float
    lpi: int
    rgb: tuple[int, int, int] | None = None
    tolerance: int = 40          # for flat-image color masking


# ---------------------------------------------------------------------------
# Density extraction
# ---------------------------------------------------------------------------

def layer_density(layer: NamedLayer) -> np.ndarray:
    """Derive a 0..255 ink-coverage map from a layer's alpha channel."""
    img = layer.image
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    alpha = np.array(img.split()[3], dtype=np.uint8)
    return alpha  # 255 = fully covered, 0 = transparent


def flat_density(flat: Image.Image, target_rgb: tuple[int, int, int], tolerance: int) -> np.ndarray:
    """Derive a 0..255 density map for one color in a flat image."""
    arr = np.array(flat.convert("RGB"), dtype=np.float32)
    target = np.array(target_rgb, dtype=np.float32)
    dist = np.sqrt(((arr - target) ** 2).sum(axis=2))
    # dist=0 → full coverage (255), dist=tolerance → no coverage (0)
    t = max(1.0, float(tolerance))
    coverage = np.clip(1.0 - (dist / t), 0.0, 1.0)
    return (coverage * 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Plan — decide which inks, mesh, angles for a source
# ---------------------------------------------------------------------------

def plan_layered(src: LoadedSource, cfg: DriverConfig) -> list[InkSpec]:
    """Build an InkSpec list from a layered source.

    Layer name conventions we recognize for purpose inference:
      - "underbase" / "base" / "white_underbase" → underbase
      - "highlight" / "white_highlight"          → highlight
      - anything else                            → color
    """
    colors: list[InkSpec] = []
    non_solid: list[str] = []

    # First pass: classify
    classified = []
    for i, layer in enumerate(src.layers):
        purpose = classify_layer(layer.name)
        classified.append((layer, purpose))
        if purpose == "color":
            non_solid.append(layer.name)

    angles = assign_angles(len(non_solid))
    angle_iter = iter(angles)

    for i, (layer, purpose) in enumerate(classified, start=1):
        mesh = DEFAULT_MESH[cfg.ink_system][purpose]
        if purpose == "color":
            angle = next(angle_iter)
            lpi = pick_lpi(mesh, cfg.ink_system)
        else:
            angle = 0.0
            lpi = 0
        colors.append(InkSpec(
            index=i,
            name=layer.name,
            ink=layer.name,
            mesh=mesh,
            purpose=purpose,
            angle_deg=angle,
            lpi=lpi,
        ))
    return colors


def plan_flat(src: LoadedSource, cfg: DriverConfig, max_colors: int = 8) -> list[InkSpec]:
    """Build an InkSpec list from a flat image by auto-detecting colors.

    The user tells us how many ink colors they want (max_colors, from the
    dialog). We quantize to max_colors+2 so the quantizer has room to carve
    out the garment color plus some margin, then drop the single detected
    color closest to the garment, then keep top-max_colors by coverage.
    """
    from utils import detect_flat_colors  # engine util

    garment_rgb = _garment_rgb(cfg.garment_color)

    # Quantize to N + 2 so the garment color + one small noise cluster can
    # be removed without losing real inks.
    detected = detect_flat_colors(src.flat, max_colors=max_colors + 2)
    if not detected:
        raise RuntimeError("No distinct colors detected in flat image")

    # Drop colors that are both "near the garment" AND dominant. The garment
    # is almost always the most-covered color in the image — so when several
    # detected colors are near-garment (e.g. white 255,255,255 and off-white
    # 254,255,249), drop the one with highest coverage (it's the shirt
    # background) and keep the others (they're genuine ink highlights).
    if len(detected) > 1:
        near = [
            (i, c) for i, c in enumerate(detected)
            if _color_dist(c["rgb"], garment_rgb) < 60
        ]
        if near:
            # Pick the most-covered near-garment color — that's the shirt.
            near.sort(key=lambda p: -p[1].get("pixel_count", 0))
            garment_idx = near[0][0]
            detected.pop(garment_idx)

    # Sort by coverage (most dominant first), take the top N
    detected.sort(key=lambda c: -c.get("pixel_count", 0))
    filtered = detected[:max_colors]

    if not filtered:
        filtered = detected

    # Dedupe + enrich names. When two auto-detected colors fall in the same
    # hue bucket (e.g. three shades of orange), _suggest_color_name returns
    # the same string for all of them, and we'd end up with ORANGE / ORANGE /
    # ORANGE on the films — useless at the light table. Resolve collisions
    # by appending a luminance-ordered suffix (dark / mid / light).
    names = _resolve_color_names(filtered)

    angles = assign_angles(len(filtered))
    out: list[InkSpec] = []
    for i, (color, name) in enumerate(zip(filtered, names), start=1):
        purpose = "color"
        mesh = DEFAULT_MESH[cfg.ink_system]["color"]
        lpi = pick_lpi(mesh, cfg.ink_system)
        out.append(InkSpec(
            index=i, name=name, ink=name, mesh=mesh,
            purpose=purpose, angle_deg=angles[i - 1], lpi=lpi,
            rgb=tuple(color["rgb"]),
        ))
    return out


def _resolve_color_names(detected: list[dict]) -> list[str]:
    """Return a list of unique, descriptive names for the detected colors.

    If every detected color has a distinct suggested_name, use them as-is.
    When two or more share the same bucket, sort those by luminance and
    add `dark-` / `light-` / `-2` / `-3` suffixes so no two films collide.
    """
    raw = [(c.get("suggested_name") or f"color-{i+1}") for i, c in enumerate(detected)]

    # Group indices by bucket name
    from collections import defaultdict
    groups: dict[str, list[int]] = defaultdict(list)
    for i, name in enumerate(raw):
        groups[name].append(i)

    resolved = list(raw)
    for name, indices in groups.items():
        if len(indices) <= 1:
            continue
        # Sort these indices by luminance (dark → light)
        def lum(idx: int) -> float:
            r, g, b = detected[idx]["rgb"]
            return 0.299 * r + 0.587 * g + 0.114 * b

        ordered = sorted(indices, key=lum)
        n = len(ordered)
        if n == 2:
            labels = [f"dark-{name}", f"light-{name}"]
        elif n == 3:
            labels = [f"dark-{name}", f"mid-{name}", f"light-{name}"]
        else:
            # 4+ — just number them dark→light
            labels = [f"{name}-{k+1}" for k in range(n)]
        for idx, label in zip(ordered, labels):
            resolved[idx] = label
    return resolved


def classify_layer(name: str) -> str:
    n = (name or "").lower()
    if "underbase" in n or n in ("base", "white_base", "wb"):
        return "underbase"
    if "highlight" in n or n.endswith("_hi"):
        return "highlight"
    return "color"


def _garment_rgb(name: str) -> tuple[int, int, int]:
    table = {
        "white": (245, 245, 245),
        "black": (20, 20, 20),
        "navy": (25, 35, 75),
        "royal": (40, 70, 170),
        "charcoal": (60, 60, 60),
        "heather": (180, 180, 180),
        "red": (160, 30, 30),
        "gray": (140, 140, 140),
        "natural": (230, 220, 200),
    }
    return table.get((name or "black").lower(), (20, 20, 20))


def _color_dist(a, b) -> float:
    return float(np.sqrt(sum((ai - bi) ** 2 for ai, bi in zip(a, b))))


# ---------------------------------------------------------------------------
# Render one ink → film TIF
# ---------------------------------------------------------------------------

def render_ink(
    density: np.ndarray,
    spec: InkSpec,
    cfg: DriverConfig,
    print_w_in: float,
    print_h_in: float,
    sheet: SheetSize,
    label_prefix: str = "",
) -> Image.Image:
    """Full pipeline for one ink channel — halftone → sheet layout."""
    # Scale density to print-size pixels
    target_w = int(round(print_w_in * cfg.film_dpi))
    target_h = int(round(print_h_in * cfg.film_dpi))
    d = Image.fromarray(density, mode="L").resize(
        (target_w, target_h), Image.LANCZOS,
    )
    d_arr = np.array(d, dtype=np.uint8)

    if spec.purpose in ("underbase", "highlight"):
        film_arr = solid_film(d_arr)
    else:
        film_arr = halftone(
            d_arr,
            dpi=cfg.film_dpi,
            lpi=spec.lpi,
            angle_deg=spec.angle_deg,
            aspect=cfg.dot_aspect,
            ink_system=cfg.ink_system,
            highlight_hold=cfg.highlight_hold,
            shadow_plug=cfg.shadow_plug,
            apply_gain=cfg.apply_dot_gain,
        )

    channel = Image.fromarray(film_arr, mode="L")
    label = FilmLabel(
        ink=spec.ink,
        mesh=spec.mesh,
        index=spec.index,
        job_code=label_prefix or None,
    )
    return compose_film_sheet(
        channel,
        print_w_in=print_w_in,
        print_h_in=print_h_in,
        dpi=cfg.film_dpi,
        label=label,
        sheet=sheet,
        mirror=cfg.mirror,
    )


# ---------------------------------------------------------------------------
# Top-level drive
# ---------------------------------------------------------------------------

ProgressCb = "callable(step: str, current: int, total: int) -> None"


def drive(
    source_path: Path,
    output_dir: Path,
    print_width_in: float,
    print_height_in: float | None,
    cfg: DriverConfig,
    mode: str = "auto",
    max_colors: int = 8,
    label_prefix: str = "",
    progress=None,
) -> dict:
    """Run the driver end-to-end on a single source.

    Optional `progress(step, current, total)` callback fires at each major
    step so a GUI can update a progress bar.

    Returns a dict suitable for JSON serialization:
      { success, films: [...], warnings: [...] }
    """
    def emit(step: str, cur: int = 0, total: int = 0) -> None:
        if progress:
            try:
                progress(step, cur, total)
            except Exception:
                pass

    start = time.time()
    emit("loading source")
    src = load(source_path)

    # Decide mode
    if mode == "auto":
        mode = "spot-layered" if src.layers else "spot-flat"

    emit(f"planning inks ({mode})")
    if mode == "spot-layered":
        if not src.layers:
            raise RuntimeError("spot-layered requires a layered source (PSD/PSB)")
        specs = plan_layered(src, cfg)
    elif mode in ("spot-flat", "sim-process"):
        if src.flat is None:
            # Flatten layers to composite
            src = _flatten_layers(src)
        specs = plan_flat(src, cfg, max_colors=max_colors)
    else:
        raise ValueError(f"Unknown mode: {mode}")

    if not specs:
        raise RuntimeError("No ink specs were resolved — nothing to render")

    # Compute aspect & print size
    doc_w, doc_h = src.doc_size
    aspect = doc_h / max(1, doc_w)
    if print_height_in is None:
        print_height_in = print_width_in * aspect

    sheet = cfg.sheet_size or pick_sheet(print_width_in, print_height_in)

    output_dir.mkdir(parents=True, exist_ok=True)

    films_out = []
    warnings: list[str] = []
    total_inks = len(specs)

    for i, spec in enumerate(specs, start=1):
        emit(f"rendering {spec.ink} ({spec.mesh} mesh)", i, total_inks)

        try:
            density = _density_for_spec(spec, src)
        except Exception as e:
            warnings.append(f"density: {spec.name}: {e}")
            continue

        try:
            sheet_img = render_ink(
                density, spec, cfg,
                print_w_in=print_width_in,
                print_h_in=print_height_in,
                sheet=sheet,
                label_prefix=label_prefix,
            )
            filename = _film_filename(spec)
            out_path = output_dir / filename
            save_film_tif(sheet_img, out_path, cfg.film_dpi)
            films_out.append({
                "index": spec.index,
                "name": filename.removesuffix(".tif"),
                "path": str(out_path),
                "ink": spec.ink,
                "mesh": spec.mesh,
                "purpose": spec.purpose,
                "angle": spec.angle_deg if spec.purpose == "color" else None,
                "lpi": spec.lpi if spec.purpose == "color" else None,
            })
        except Exception as e:
            warnings.append(f"render: {spec.name}: {e}")

    elapsed = time.time() - start
    return {
        "success": len(films_out) > 0,
        "sheet": {
            "name": sheet.name,
            "width_in": sheet.width_in,
            "height_in": sheet.height_in,
        },
        "print_size_in": [print_width_in, print_height_in],
        "film_dpi": cfg.film_dpi,
        "ink_system": cfg.ink_system,
        "films": films_out,
        "warnings": warnings,
        "elapsed_seconds": round(elapsed, 2),
    }


def _density_for_spec(spec: InkSpec, src: LoadedSource) -> np.ndarray:
    if spec.rgb is not None:
        assert src.flat is not None
        return flat_density(src.flat, spec.rgb, spec.tolerance)
    # Layered — find by name
    for lyr in src.layers:
        if lyr.name == spec.name:
            return layer_density(lyr)
    raise RuntimeError(f"Could not resolve density source for {spec.name}")


def _flatten_layers(src: LoadedSource) -> LoadedSource:
    """Composite all RGBA layers into a single RGB image."""
    if src.flat is not None:
        return src
    base = Image.new("RGBA", src.doc_size, (255, 255, 255, 255))
    for lyr in src.layers:
        base.alpha_composite(lyr.image)
    return LoadedSource(layers=[], flat=base.convert("RGB"),
                        doc_size=src.doc_size, dpi=src.dpi)


def _film_filename(spec: InkSpec) -> str:
    safe = "".join(c if c.isalnum() else "-" for c in spec.name.lower())
    safe = "-".join(filter(None, safe.split("-")))
    return f"{spec.index:02d}_{safe}_{spec.mesh}.tif"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="film-driver",
        description="Biota film-output print driver (waterbase/discharge).",
    )
    p.add_argument("source", type=Path, help="PSD/PSB/PNG/JPG/TIF/PDF artwork")
    p.add_argument("-o", "--output-dir", type=Path, default=None,
                   help="Where to write the TIF films (default: ./films next to source)")
    p.add_argument("--print-width", type=float, required=True,
                   help="Final print width on garment, in inches")
    p.add_argument("--print-height", type=float, default=None,
                   help="Final print height in inches (default: preserve aspect)")
    p.add_argument("--mode", choices=["auto", "spot-layered", "spot-flat", "sim-process"],
                   default="auto")
    p.add_argument("--garment", default="black",
                   help="Garment color name (drives underbase & flat filtering)")
    p.add_argument("--ink-system", choices=["waterbase", "discharge"],
                   default="waterbase")
    p.add_argument("--film-dpi", type=int, default=FILM_DPI_DEFAULT)
    p.add_argument("--sheet", choices=["auto", "8.5x11", "13x19"], default="auto")
    p.add_argument("--no-dot-gain", action="store_true")
    p.add_argument("--mirror", action="store_true",
                   help="Mirror films (emulsion-down exposure)")
    p.add_argument("--label-prefix", default="",
                   help="Text shown on each reg-mark label (e.g. job code)")
    p.add_argument("--max-colors", type=int, default=8,
                   help="Max auto-detected colors for flat/sim-process input")
    p.add_argument("--json", action="store_true",
                   help="Write a driver-output.json next to the TIFs and print it to stdout")

    # Preview + print flags
    p.add_argument("--preview", dest="preview", action="store_true", default=True,
                   help="Build a contact-sheet preview.png and open it (default)")
    p.add_argument("--no-preview", dest="preview", action="store_false",
                   help="Skip the preview step")
    p.add_argument("--print", dest="do_print", action="store_true",
                   help="Submit the films to CUPS after rendering (with confirm prompt)")
    p.add_argument("--yes", "-y", action="store_true",
                   help="Skip the print-confirm prompt (use with --print)")
    p.add_argument("--dry-run", action="store_true",
                   help="With --print: build the lp command but don't submit")
    p.add_argument("--double-strike", action="store_true",
                   help="With --print: submit each film twice for denser D-max")
    p.add_argument("--printer", default=None,
                   help="Override the CUPS queue name from printer.json")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])

    if not args.source.exists():
        print(f"source not found: {args.source}", file=sys.stderr)
        return 1

    output_dir = args.output_dir or (args.source.parent / "films")

    sheet_override = None
    if args.sheet == "8.5x11":
        from preferences import SHEET_SMALL
        sheet_override = SHEET_SMALL
    elif args.sheet == "13x19":
        from preferences import SHEET_LARGE
        sheet_override = SHEET_LARGE

    cfg = DriverConfig(
        ink_system=args.ink_system,
        garment_color=args.garment,
        film_dpi=args.film_dpi,
        apply_dot_gain=not args.no_dot_gain,
        mirror=args.mirror,
        sheet_size=sheet_override,
        label_prefix=args.label_prefix,
    )

    try:
        result = drive(
            source_path=args.source,
            output_dir=output_dir,
            print_width_in=args.print_width,
            print_height_in=args.print_height,
            cfg=cfg,
            mode=args.mode,
            max_colors=args.max_colors,
            label_prefix=args.label_prefix,
        )
    except Exception as e:
        print(f"✗ film-driver failed: {e}", file=sys.stderr)
        return 2

    if args.json:
        out_json = output_dir / "driver-output.json"
        out_json.write_text(json.dumps(result, indent=2))

    if result["success"]:
        print(f"✓ {len(result['films'])} films written to {output_dir} "
              f"({result['sheet']['name']} @ {result['film_dpi']} DPI, "
              f"{result['elapsed_seconds']}s)")
        for f in result["films"]:
            suffix = ""
            if f.get("angle") is not None:
                suffix = f"  {f['lpi']} LPI @ {f['angle']}°"
            print(f"  {f['index']:02d} {f['name']:30s} [{f['mesh']} mesh]{suffix}")
    else:
        print(f"✗ no films produced", file=sys.stderr)

    for w in result.get("warnings", []):
        print(f"  warn: {w}", file=sys.stderr)

    if not result["success"]:
        return 2

    # ---- Preview step -----------------------------------------------------
    if args.preview:
        try:
            src_img = _load_source_thumbnail(args.source)
            preview_path = output_dir / "preview.png"
            header = f"{args.label_prefix or args.source.stem} — {args.print_width}\" on {args.garment} ({args.ink_system})"
            build_contact_sheet(src_img, result["films"], header, preview_path)
            open_in_preview(preview_path)
            print(f"  preview: {preview_path}")
        except Exception as e:
            print(f"  warn: preview failed: {e}", file=sys.stderr)

    # ---- Print step -------------------------------------------------------
    if args.do_print:
        try:
            cfg = PrinterConfig.load()
        except Exception as e:
            print(f"✗ could not load printer config: {e}", file=sys.stderr)
            return 3

        if args.printer:
            cfg.queue = args.printer
        if args.double_strike:
            cfg.double_strike = True

        if not args.yes:
            passes = "2× double-strike" if cfg.double_strike else "1×"
            prompt = (f"\nPrint {len(result['films'])} films ({passes}) to "
                      f"{cfg.queue}? [y/N] ")
            answer = input(prompt).strip().lower()
            if answer not in ("y", "yes"):
                print("  skipped print step")
                return 0

        jobs = [
            PrintJob(
                path=Path(f["path"]),
                title=f"{args.label_prefix or args.source.stem} — {f['name']}",
                sheet_name=result["sheet"]["name"],
            )
            for f in result["films"]
        ]
        submit_results = submit_many(cfg, jobs, dry_run=args.dry_run)

        failed = [r for r in submit_results if r.get("status") == "failed"]
        print()
        for r in submit_results:
            badge = {"submitted": "✓", "dry-run": "·", "failed": "✗"}.get(r.get("status"), "?")
            pass_tag = f"  pass {r.get('pass')}" if cfg.double_strike else ""
            jid = r.get("job_id") or ""
            print(f"  {badge} {r.get('film','?')} {pass_tag} {jid}")

        if failed:
            print(f"\n✗ {len(failed)} submissions failed — check printer queue", file=sys.stderr)
            for r in failed:
                print(f"  {r.get('film')}: {r.get('stderr','')}", file=sys.stderr)
            return 4

    return 0


def _load_source_thumbnail(path: Path) -> Image.Image:
    """Small helper — returns an RGB image of the source suitable for the
    preview tile. PDFs are rendered at low DPI; PSDs composited; flat images
    opened directly.
    """
    ext = path.suffix.lower()
    if ext in (".psd", ".psb"):
        from psd_tools import PSDImage
        psd = PSDImage.open(str(path))
        img = psd.composite()
        return img.convert("RGB") if img else Image.new("RGB", (400, 400), (240, 240, 240))
    if ext == ".pdf":
        try:
            import pypdfium2 as pdfium
            pdf = pdfium.PdfDocument(str(path))
            return pdf[0].render(scale=1.5).to_pil().convert("RGB")
        except Exception:
            return Image.new("RGB", (400, 400), (240, 240, 240))
    img = Image.open(str(path))
    return img.convert("RGB")


if __name__ == "__main__":
    sys.exit(main())
