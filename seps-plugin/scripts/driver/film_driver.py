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
import logging
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np

log = logging.getLogger("filmseps.driver")
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
    halftone: bool = True        # True = halftone dots; False = solid fill
    # Solid fill is correct for spot-color jobs (each ink is "there or not").
    # Halftoning is correct for sim-process (each ink is a tone map with dot
    # patterns representing coverage %).


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
    """Derive a 0..255 density map for one color in a flat image.

    Used by sim-process mode — each pixel's coverage for an ink is proportional
    to its proximity to the ink's RGB.
    """
    arr = np.array(flat.convert("RGB"), dtype=np.float32)
    target = np.array(target_rgb, dtype=np.float32)
    dist = np.sqrt(((arr - target) ** 2).sum(axis=2))
    # dist=0 → full coverage (255), dist=tolerance → no coverage (0)
    t = max(1.0, float(tolerance))
    coverage = np.clip(1.0 - (dist / t), 0.0, 1.0)
    return (coverage * 255).astype(np.uint8)


def _nearest_ink_masks(
    src: "LoadedSource",
    specs: list[InkSpec],
    garment_color: str,
    max_delta_e: float = 50.0,
) -> dict[str, np.ndarray]:
    """Assign each source pixel to exactly one ink (or background) in LAB.

    Returns a dict: ink name → 2D uint8 mask, 255 where this ink prints,
    0 where it doesn't. Every pixel ends up on exactly one mask or on
    "no ink at all".

    Two failure modes we fix here:

    1. RGB-space nearest-neighbor was perceptually wrong. A dark pixel
       (black fruit center) ended up on the CREAM film because in RGB
       distance, cream was the closest available cluster — even though
       perceptually "black" and "cream" are maximally different. Switching
       to LAB delta-E gives a perceptually accurate match.

    2. If a pixel is very far from ALL detected inks (ΔE > max_delta_e),
       it means the user's palette doesn't include a cluster that matches
       this region — they asked for too few inks. Rather than miscast
       those pixels onto the wrong film (see bug #1 above), we leave them
       UNINKED on every film. Operator sees a blank region where art
       should be and knows to bump their color count.
    """
    from color_detect import rgb_to_lab

    if src.flat is None:
        return {}

    arr = np.array(src.flat.convert("RGB"), dtype=np.float32) / 255.0
    h, w = arr.shape[:2]
    lab = rgb_to_lab(arr.reshape(-1, 3))

    # Build palette LAB — ink centroids + garment at the end
    palette_rgb = np.array(
        [spec.rgb for spec in specs if spec.rgb is not None]
        + [_garment_rgb(garment_color)],
        dtype=np.float32,
    ) / 255.0
    palette_lab = rgb_to_lab(palette_rgb)

    # Per-pixel distance to every palette entry
    diffs = lab[:, None, :] - palette_lab[None, :, :]
    dists = np.sqrt((diffs ** 2).sum(axis=2))
    nearest = dists.argmin(axis=1)
    nearest_dist = dists.min(axis=1)

    # --- FORCE-DARK-TO-KEY ---
    # Pro sep software: any pixel meaningfully darker than the lightest
    # color ink belongs on the key (black) film — pen strokes, outlines,
    # anti-aliased transitions. Skip this bias if there's no key ink in
    # the palette or if one of the color clusters is dark itself (navy,
    # etc.) in which case plain LAB nearest-neighbor is correct.
    key_idx = None
    for i, spec in enumerate(specs):
        # Key = declared pure black OR any ink whose name is "black"
        if spec.name == "black" or spec.rgb == (0, 0, 0):
            key_idx = i
            break
    if key_idx is not None:
        # Threshold = halfway between key L* and the LIGHTEST color ink L*.
        # Pixels darker than the halfway point are closer to key on the
        # lightness axis and should print on the key film.
        key_L = palette_lab[key_idx, 0]
        color_Ls = [palette_lab[i, 0] for i in range(len(specs)) if i != key_idx]
        if color_Ls:
            lightest_L = max(color_Ls)
            halfway = (key_L + lightest_L) / 2
            force_to_key = lab[:, 0] < halfway
            nearest = np.where(force_to_key, key_idx, nearest)
            nearest_dist = np.where(force_to_key, 0.0, nearest_dist)

    # Pixels too far from any ink OR assigned to garment → leave uninked
    too_far = nearest_dist > max_delta_e
    garment_idx = len(specs)
    is_background = (nearest == garment_idx) | too_far

    nearest_2d = nearest.reshape(h, w)
    bg_2d = is_background.reshape(h, w)

    # Report how many pixels we're dropping — high drop rates mean the
    # user should bump their color count.
    total_pixels = h * w
    dropped = int(too_far.sum())
    if total_pixels and dropped / total_pixels > 0.02:
        import logging
        logging.getLogger("filmseps.driver").warning(
            "nearest-ink: dropped %d/%d pixels (%.1f%%) — too far from any ink. "
            "Consider increasing color count; art may need an ink you didn't request.",
            dropped, total_pixels, 100 * dropped / total_pixels,
        )

    masks: dict[str, np.ndarray] = {}
    for i, spec in enumerate(specs):
        if spec.rgb is None:
            continue
        m = (nearest_2d == i) & ~bg_2d
        m = _despeckle_mask(m, spec)
        # Trap: dilate every color mask by 1 pixel so adjacent inks slightly
        # overlap at boundaries. Eliminates the white shirt-color gaps you'd
        # otherwise see at color transitions due to anti-aliased pixels being
        # marked as background. Standard screen-printing technique — pro RIPs
        # call this "trapping" and it's how AccuRIP/FilmMaker prevent
        # registration-gap artifacts on press.
        m = _trap_dilate(m, pixels=1)
        masks[spec.name] = (m.astype(np.uint8)) * 255
    return masks


def _trap_dilate(mask: np.ndarray, pixels: int = 1) -> np.ndarray:
    """4-neighbor binary dilation by `pixels`. Grows each True region
    outward so adjacent ink masks overlap by `pixels` at their boundaries."""
    out = mask.copy()
    for _ in range(pixels):
        d = out.copy()
        d[1:, :] |= out[:-1, :]
        d[:-1, :] |= out[1:, :]
        d[:, 1:] |= out[:, :-1]
        d[:, :-1] |= out[:, 1:]
        out = d
    return out


def _despeckle_mask(mask: np.ndarray, spec: "InkSpec") -> np.ndarray:
    """Morphological opening — remove isolated 1-2 pixel specks that
    printers can't hold and that come from JPEG noise / anti-aliasing.

    Uses a 3×3 erosion + 3×3 dilation (opening). Implemented in pure
    numpy via 4-neighbor propagation so we don't need scipy/cv2. Applied
    uniformly to every film; cheap on typical sizes.

    We skip despeckle for the key/black film — thin pen strokes there
    are REAL linework and shouldn't get eroded away.
    """
    if spec.name == "black" or spec.rgb == (0, 0, 0):
        return mask

    # Erode: pixel stays True only if all 4 neighbors are also True
    e = mask.copy()
    e[1:, :] &= mask[:-1, :]
    e[:-1, :] &= mask[1:, :]
    e[:, 1:] &= mask[:, :-1]
    e[:, :-1] &= mask[:, 1:]

    # Dilate back out: restores the shape minus any specks smaller than
    # the structuring element
    d = e.copy()
    d[1:, :] |= e[:-1, :]
    d[:-1, :] |= e[1:, :]
    d[:, 1:] |= e[:, :-1]
    d[:, :-1] |= e[:, 1:]

    return d


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

    Uses LAB-space K-means clustering (color_detect.detect_ink_colors) —
    perceptually uniform, robust against anti-aliased edges, and filters
    garment pixels out BEFORE clustering so every returned centroid is a
    real ink.
    """
    from color_detect import detect_ink_colors, resolve_unique_names

    garment_rgb = _garment_rgb(cfg.garment_color)

    detected = detect_ink_colors(
        src.flat, n_colors=max_colors, garment_rgb=garment_rgb,
    )
    if not detected:
        raise RuntimeError("No distinct ink colors detected in flat image")

    names = resolve_unique_names(detected)

    angles = assign_angles(len(detected))
    out: list[InkSpec] = []
    for i, (color, name) in enumerate(zip(detected, names), start=1):
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


def _is_dark_garment(name: str) -> bool:
    """Auto-underbase trigger — compute the garment's LAB L* and return
    True for anything below 50 (i.e. needs a white underbase to hold
    color inks). Covers black/navy/charcoal/royal/red/brown/dark-gray.
    """
    rgb = _garment_rgb(name)
    # Approximate relative luminance; cheaper than full LAB conversion
    r, g, b = rgb
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    return luma < 128


def _build_underbase(masks: dict[str, np.ndarray], choke_pixels: int = 1) -> np.ndarray | None:
    """Union of every existing color mask, then erode by `choke_pixels` so
    white underbase doesn't peek out from under color inks at edges.

    Returns a uint8 mask (0/255). The underbase prints SOLID first on press,
    providing the opaque white base that color inks sit on top of.
    """
    if not masks:
        return None
    arrays = list(masks.values())
    union = arrays[0] > 0
    for a in arrays[1:]:
        union |= a > 0
    # Morphological erosion for the choke
    for _ in range(choke_pixels):
        e = union.copy()
        e[1:, :] &= union[:-1, :]
        e[:-1, :] &= union[1:, :]
        e[:, 1:] &= union[:, :-1]
        e[:, :-1] &= union[:, 1:]
        union = e
    return (union.astype(np.uint8)) * 255


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
    # Scale density to print-size pixels.
    #
    # The mask we get from _nearest_ink_masks is effectively binary (0/255)
    # after despeckle + trap dilation. A naked LANCZOS upscale of a binary
    # mask at ~9× (common when a 950px JPEG is being printed at 12" × 720DPI
    # = ~8600px) produces visibly stair-stepped pixelated edges on the film.
    #
    # Fix: anti-alias the mask before the upscale. Blur so the edges become
    # soft (Gaussian falloff), upscale the soft mask with LANCZOS (which
    # interpolates gradients smoothly), then threshold back to binary. The
    # upscaled threshold boundary follows the smooth gradient instead of
    # the original pixel grid — clean curves, no stair-step.
    #
    # This is what commercial RIPs do internally. The radius scales with
    # how much upscale we're doing; 0.8px on a 1000px source gives us ~7px
    # transition on an 8000px target, which is narrow enough to stay sharp
    # but wide enough to kill aliasing.
    target_w = int(round(print_w_in * cfg.film_dpi))
    target_h = int(round(print_h_in * cfg.film_dpi))

    src_h, src_w = density.shape
    upscale_factor = max(target_w / src_w, target_h / src_h)
    mask_img = Image.fromarray(density, mode="L")

    is_solid = spec.purpose in ("underbase", "highlight") or not spec.halftone

    if is_solid and upscale_factor > 1.5:
        # Blur radius proportional to upscale. Cap at 2.0 so we don't erode
        # fine features when the upscale is enormous.
        from PIL import ImageFilter

        blur_r = min(2.0, 0.5 + 0.15 * upscale_factor)
        soft = mask_img.filter(ImageFilter.GaussianBlur(radius=blur_r))
        soft = soft.resize((target_w, target_h), Image.LANCZOS)
        soft_arr = np.array(soft, dtype=np.uint8)
        # Threshold at 128 — for a symmetric gaussian falloff this recovers
        # the geometric edge position exactly.
        d_arr = np.where(soft_arr >= 128, 255, 0).astype(np.uint8)
    else:
        d = mask_img.resize((target_w, target_h), Image.LANCZOS)
        d_arr = np.array(d, dtype=np.uint8)

    if is_solid:
        # Solid fill — pixels above the density midpoint print as solid ink,
        # pixels below are clear film. No dot pattern. This is the correct
        # rendering for spot-color work and for underbase/highlight layers.
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
    user_palette: list[dict] | None = None,
    auto_bg_detect: bool = True,
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
        # Layered spot colors: solid fills — each layer is "this ink is here".
        for spec in specs:
            if spec.purpose == "color":
                spec.halftone = False
    elif mode in ("spot-flat", "sim-process"):
        if src.flat is None:
            # Flatten layers to composite
            src = _flatten_layers(src)

        # AUTO BACKGROUND DETECTION: if the source image has a distinct
        # canvas color (sampled from the 4 corners) that differs from the
        # target garment, the art was drawn on a paper/canvas that's NOT
        # the shirt. Those pixels should be treated as background, not
        # clustered as an ink.
        #
        # Classic failure case this fixes: a duck illustration drawn on a
        # BLACK canvas, printed on a WHITE shirt. Previously, the detector
        # would only filter pixels near white (garment) and cluster the
        # black canvas as a dominant "ink," starving real colors of slots.
        #
        # Callers that already pre-processed the image (the GUI does this
        # explicitly via the bg module) should pass auto_bg_detect=False.
        if auto_bg_detect:
            src = _auto_apply_bg_detection(src, cfg)

        if user_palette:
            # Operator curated the palette via the GUI — use exactly their
            # selection. Skip k-means; build specs directly from the list.
            specs = _specs_from_user_palette(user_palette, cfg)
            log.info("using user-curated palette: %d inks", len(specs))
        else:
            specs = plan_flat(src, cfg, max_colors=max_colors)
        if mode == "spot-flat":
            # True spot color — each pixel belongs to one ink (or background),
            # no halftone, no tone ramp. render_ink() below sees halftone=False
            # and emits a solid fill. Density maps are computed via nearest-ink
            # assignment (below) for clean, non-overlapping masks.
            for spec in specs:
                spec.halftone = False
    else:
        raise ValueError(f"Unknown mode: {mode}")

    if not specs:
        raise RuntimeError("No ink specs were resolved — nothing to render")

    # For spot-flat mode, precompute nearest-ink binary masks once — each
    # pixel in the flat source gets assigned to its closest ink (or garment
    # background). This is how real spot-color seps work: no overlapping
    # coverage, no sparse gaps, each ink prints as a solid where it's needed.
    nearest_masks: dict[str, np.ndarray] | None = None
    if mode == "spot-flat":
        nearest_masks = _nearest_ink_masks(src, specs, cfg.garment_color)

        # AUTO UNDERBASE: dark garments need a white underbase printed first
        # so color inks (which are translucent) show up properly. Standard
        # screen-printing technique. The underbase is the UNION of all
        # non-garment ink masks (everywhere an ink will print), slightly
        # choked so white doesn't peek out from under color at edges.
        if _is_dark_garment(cfg.garment_color) and nearest_masks:
            underbase_mask = _build_underbase(nearest_masks, choke_pixels=1)
            if underbase_mask is not None and (underbase_mask > 0).sum() > 100:
                ub_spec = InkSpec(
                    index=0,
                    name="white_underbase",
                    ink="white underbase",
                    mesh=DEFAULT_MESH[cfg.ink_system]["underbase"],
                    purpose="underbase",
                    angle_deg=0.0,
                    lpi=0,
                    rgb=(255, 255, 255),
                    halftone=False,
                )
                specs.insert(0, ub_spec)
                nearest_masks = {"white_underbase": underbase_mask, **nearest_masks}
                # Renumber indices so the underbase is film 01
                for new_i, s in enumerate(specs, start=1):
                    s.index = new_i
                log.info("auto-underbase: added for %s garment", cfg.garment_color)

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
            if nearest_masks is not None and spec.name in nearest_masks:
                density = nearest_masks[spec.name]
            else:
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
                "ink_rgb": list(spec.rgb) if spec.rgb else None,
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


def _specs_from_user_palette(
    palette: list[dict],
    cfg: DriverConfig,
) -> list[InkSpec]:
    """Turn an operator-approved palette list into InkSpecs.

    Skips the detection step entirely — what the user ticked in the GUI is
    what they get on film, in the order they ticked it. Angles are assigned
    from the shop's 30°-separation set.
    """
    mesh = DEFAULT_MESH[cfg.ink_system]["color"]
    lpi = pick_lpi(mesh, cfg.ink_system)
    angles = assign_angles(len(palette))
    specs: list[InkSpec] = []
    for i, entry in enumerate(palette, start=1):
        rgb = tuple(entry["rgb"])
        name = entry.get("suggested_name") or entry.get("name") or f"ink-{i}"
        specs.append(InkSpec(
            index=i, name=name, ink=name, mesh=mesh, purpose="color",
            angle_deg=angles[i - 1] if i - 1 < len(angles) else 0.0,
            lpi=lpi, rgb=rgb, halftone=True,
        ))
    return specs


def _auto_apply_bg_detection(src: LoadedSource, cfg: DriverConfig) -> LoadedSource:
    """Detect a distinct canvas color in the source and replace those pixels
    with the garment color so downstream filters drop them.

    Skips when src.flat is None, when corners disagree (no clear canvas),
    or when the canvas color is already very close to the garment color
    (in which case regular garment filtering already handles it).
    """
    if src.flat is None:
        return src
    try:
        from background import detect_background_mask, apply_background_mask
    except Exception:
        return src
    garment_rgb = _garment_rgb(cfg.garment_color)
    mask = detect_background_mask(src.flat, garment_rgb=garment_rgb, mode="auto")
    if mask is None or not mask.any():
        return src
    coverage = mask.sum() / mask.size
    # Only apply if the detected bg is a meaningful portion of the image
    # (>5%). Below that it's probably just edge noise, not a real canvas.
    if coverage < 0.05:
        return src
    log.info("auto-bg: replacing %.1f%% of pixels (canvas distinct from garment)",
             coverage * 100)
    new_flat = apply_background_mask(src.flat, mask, garment_rgb)
    return LoadedSource(
        layers=src.layers, flat=new_flat,
        doc_size=src.doc_size, dpi=src.dpi,
    )


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


def _source_has_alpha(path: Path) -> bool:
    """True if the raw source file carries real transparency info."""
    ext = path.suffix.lower()
    if ext in (".psd", ".psb", ".pdf"):
        return False
    try:
        with Image.open(str(path)) as im:
            return im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
    except Exception:
        return False


def _load_source_keep_alpha(path: Path) -> Image.Image:
    """Same as _load_source_thumbnail but preserves alpha for PNG/TIF."""
    ext = path.suffix.lower()
    if ext in (".psd", ".psb", ".pdf"):
        return _load_source_thumbnail(path)
    img = Image.open(str(path))
    if img.mode in ("RGBA", "LA"):
        return img.convert("RGBA")
    return img.convert("RGB")


if __name__ == "__main__":
    sys.exit(main())
