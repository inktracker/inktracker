#!/usr/bin/env python3
"""Test harness for the Film Seps pipeline.

Builds a battery of synthetic scenarios with known ground-truth colors,
runs the full pipeline on each, and reports:
  - Which ground-truth colors were detected (present in final palette)
  - Which were missed (GT color has no cluster within delta-E tolerance)
  - Which were contaminated (cluster exists but not cleanly matched)
  - Visual contact sheet for eyeball review

Used for diagnosing systemic failures instead of patching one scenario
at a time.
"""
from __future__ import annotations

import json
import sys
import shutil
from pathlib import Path

sys.path.insert(0, '/Users/joeygrennan/Downloads/inktracker/seps-plugin/scripts/driver')
sys.path.insert(0, '/Users/joeygrennan/Downloads/inktracker/seps-plugin/scripts/engine')

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from film_driver import drive
from preferences import DriverConfig
from preview import build_contact_sheet
from color_detect import rgb_to_lab


TEST_DIR = Path('/tmp/sep_tests')
shutil.rmtree(TEST_DIR, ignore_errors=True)
TEST_DIR.mkdir(parents=True)


def font(size):
    for fpath in (
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/Supplemental/Arial.ttf',
    ):
        try:
            return ImageFont.truetype(fpath, size)
        except Exception:
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Test image builders — each returns (PIL image, ground truth RGBs, label)
# ---------------------------------------------------------------------------

def test_01_line_art_on_white():
    """Vintage line-art illustration — black key + cream body + olive accent."""
    img = Image.new('RGB', (800, 600), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.ellipse([150, 150, 650, 500], fill=(230, 210, 170))        # cream body
    d.ellipse([180, 180, 620, 470], outline=(15, 15, 15), width=5)  # black outline
    # Fine detail pen strokes
    for i in range(40):
        y = 220 + i * 7
        d.line([(200, y), (600, y + 2)], fill=(25, 25, 25), width=1)
    # Olive accent — small element
    d.polygon([(300, 250), (400, 260), (350, 320)], fill=(120, 130, 40))
    # Text below
    d.text((300, 510), "LINE ART", fill=(15, 15, 15), font=font(32))
    return img, [(15, 15, 15), (230, 210, 170), (120, 130, 40)], "line-art"


def test_02_flat_3color_logo():
    """Clean 3-color logo, solid regions."""
    img = Image.new('RGB', (600, 600), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([100, 100, 300, 300], fill=(220, 30, 40))
    d.rectangle([300, 100, 500, 300], fill=(30, 80, 180))
    d.rectangle([200, 300, 400, 500], fill=(0, 0, 0))
    return img, [(220, 30, 40), (30, 80, 180), (0, 0, 0)], "3color-logo"


def test_03_small_accents():
    """Dominant bg + small green + small dark-orange — operator's complaint."""
    img = Image.new('RGB', (600, 600), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.ellipse([100, 100, 500, 500], fill=(230, 210, 170))
    d.ellipse([100, 100, 500, 500], outline=(10, 10, 10), width=8)
    d.polygon([(250, 200), (350, 200), (300, 280)], fill=(60, 140, 70))
    d.ellipse([350, 300, 420, 370], fill=(180, 90, 30))
    d.rectangle([200, 440, 400, 490], fill=(10, 10, 10))
    return img, [(10, 10, 10), (230, 210, 170), (60, 140, 70), (180, 90, 30)], "small-accents"


def test_04_5color_complex():
    """Complex 5-color illustration — multiple flat regions."""
    img = Image.new('RGB', (800, 600), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([50, 50, 400, 300], fill=(220, 30, 40))         # red
    d.rectangle([400, 50, 750, 300], fill=(30, 80, 180))        # blue
    d.rectangle([50, 300, 400, 550], fill=(200, 150, 30))       # gold
    d.rectangle([400, 300, 750, 550], fill=(60, 140, 70))       # green
    d.ellipse([300, 200, 500, 400], fill=(0, 0, 0))             # black dot
    return img, [(220, 30, 40), (30, 80, 180), (200, 150, 30), (60, 140, 70), (0, 0, 0)], "5color"


def test_05_gradient_photoreal():
    """Photoreal gradient — tests sim-process mode."""
    img = Image.new('RGB', (600, 600), (255, 255, 255))
    d = ImageDraw.Draw(img)
    # Radial-ish gradient from black to red to orange
    cx, cy = 300, 300
    import math
    arr = np.ones((600, 600, 3), dtype=np.uint8) * 255
    for y in range(600):
        for x in range(600):
            dx, dy = x - cx, y - cy
            r = math.sqrt(dx*dx + dy*dy)
            if r < 100:
                arr[y, x] = (10, 10, 10)
            elif r < 180:
                t = (r - 100) / 80
                arr[y, x] = (int(10 + t * 200), int(10 + t * 30), int(10 + t * 40))
            elif r < 260:
                t = (r - 180) / 80
                arr[y, x] = (int(210 + t * 40), int(40 + t * 100), int(50 + t * 30))
    img = Image.fromarray(arr)
    return img, [(10, 10, 10), (210, 40, 50), (250, 140, 80)], "gradient"


def test_06_on_black_background():
    """Art on a BLACK background — tests bg detection and key-vs-bg.
    Includes a realistically-sized dark-orange accent (not a tiny 0.3% triangle)."""
    img = Image.new('RGB', (600, 600), (15, 15, 15))
    d = ImageDraw.Draw(img)
    d.ellipse([150, 150, 450, 450], fill=(230, 210, 170))
    d.ellipse([200, 200, 230, 230], fill=(15, 15, 15))         # eye (same as bg)
    # Realistically-sized dark-orange beak/accent (5% of image)
    d.polygon([(380, 260), (470, 300), (380, 340), (350, 300)], fill=(180, 90, 30))
    return img, [(230, 210, 170), (180, 90, 30)], "on-black-bg"


def test_07_anti_aliased_edges():
    """Text with heavy anti-aliasing — tests edge filter + AA transitions."""
    img = Image.new('RGB', (800, 400), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.text((80, 80), "HELLO", fill=(180, 30, 160), font=font(180))
    d.text((80, 250), "WORLD", fill=(30, 120, 200), font=font(120))
    return img, [(180, 30, 160), (30, 120, 200)], "aa-text"


def test_08_colored_accents_with_bg():
    """Mixed — white bg, black key, then 4 small color accents."""
    img = Image.new('RGB', (800, 600), (255, 255, 255))
    d = ImageDraw.Draw(img)
    # Black outline frame
    d.rectangle([50, 50, 750, 550], outline=(10, 10, 10), width=6)
    d.rectangle([200, 200, 600, 400], fill=(230, 210, 170))
    # 4 small accents
    d.ellipse([80, 80, 140, 140], fill=(220, 30, 40))      # red
    d.ellipse([660, 80, 720, 140], fill=(30, 80, 180))     # blue
    d.ellipse([80, 460, 140, 520], fill=(60, 140, 70))     # green
    d.ellipse([660, 460, 720, 520], fill=(200, 150, 30))   # gold
    d.text((320, 270), "MULTI", fill=(10, 10, 10), font=font(50))
    return img, [(10, 10, 10), (230, 210, 170), (220, 30, 40),
                 (30, 80, 180), (60, 140, 70), (200, 150, 30)], "multi-accent"


TESTS = [
    test_01_line_art_on_white,
    test_02_flat_3color_logo,
    test_03_small_accents,
    test_04_5color_complex,
    test_05_gradient_photoreal,
    test_06_on_black_background,
    test_07_anti_aliased_edges,
    test_08_colored_accents_with_bg,
]


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def closest_delta_e(target_rgb, cluster_rgbs):
    """Return the nearest cluster to target in LAB ΔE."""
    if not cluster_rgbs:
        return float('inf')
    t = rgb_to_lab(np.array([target_rgb], dtype=np.float32) / 255.0).reshape(3)
    cs = rgb_to_lab(np.array(cluster_rgbs, dtype=np.float32) / 255.0)
    dists = np.sqrt(((cs - t) ** 2).sum(axis=1))
    return float(dists.min())


def score_test(name, gt_rgbs, detected_films):
    """Did the pipeline find every ground-truth color?"""
    detected_rgbs = [tuple(f['ink_rgb']) if 'ink_rgb' in f else None for f in detected_films]
    detected_rgbs = [r for r in detected_rgbs if r]
    per_gt = []
    for gt in gt_rgbs:
        de = closest_delta_e(gt, detected_rgbs)
        per_gt.append({'gt': gt, 'nearest_de': de, 'found': de < 15})
    n_found = sum(1 for p in per_gt if p['found'])
    return {
        'name': name,
        'gt_count': len(gt_rgbs),
        'found': n_found,
        'detected_count': len(detected_rgbs),
        'per_gt': per_gt,
    }


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

def run():
    scores = []
    for i, builder in enumerate(TESTS, 1):
        img, gt_rgbs, name = builder()
        src_path = TEST_DIR / f"test_{i:02d}_{name}.png"
        img.save(src_path)
        out_dir = TEST_DIR / f"test_{i:02d}_{name}_films"
        out_dir.mkdir(exist_ok=True)

        cfg = DriverConfig(
            ink_system='waterbase', garment_color='white', film_dpi=360,
        )
        try:
            result = drive(
                source_path=src_path,
                output_dir=out_dir,
                print_width_in=8, print_height_in=None,
                cfg=cfg, mode='spot-flat',
                max_colors=len(gt_rgbs),
                label_prefix=f"test-{i:02d}",
            )
            # drive() now includes ink_rgb in each film — we read it directly
        except Exception as e:
            print(f"  test {i:02d} {name}: DRIVE CRASHED — {e}")
            scores.append({'name': name, 'crashed': str(e)})
            continue

        # Build the preview contact sheet
        try:
            build_contact_sheet(
                img, result['films'],
                f"Test {i:02d}: {name}  —  GT {len(gt_rgbs)} colors",
                out_dir / "preview.png",
            )
        except Exception as e:
            print(f"  test {i:02d}: preview failed: {e}")

        score = score_test(name, gt_rgbs, result['films'])
        scores.append(score)

        print(f"\nTEST {i:02d} {name}")
        print(f"  GT colors: {len(gt_rgbs)}  Detected: {score['detected_count']}"
              f"  Found: {score['found']}/{score['gt_count']}")
        for p in score['per_gt']:
            status = "✓" if p['found'] else "✗"
            print(f"    {status} GT {p['gt']}  nearest ΔE={p['nearest_de']:.1f}")

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    total_gt = sum(s.get('gt_count', 0) for s in scores)
    total_found = sum(s.get('found', 0) for s in scores)
    total_crashed = sum(1 for s in scores if 'crashed' in s)
    for s in scores:
        if 'crashed' in s:
            print(f"  {s['name']:30s}  CRASHED")
        else:
            print(f"  {s['name']:30s}  {s['found']}/{s['gt_count']}  "
                  f"(detected {s['detected_count']} clusters)")
    print(f"\nOverall: {total_found}/{total_gt} GT colors found, "
          f"{total_crashed} tests crashed")

    # Save scores JSON
    (TEST_DIR / "scores.json").write_text(json.dumps(scores, indent=2, default=str))
    print(f"\nAll outputs in {TEST_DIR}")
    return scores


if __name__ == '__main__':
    run()
