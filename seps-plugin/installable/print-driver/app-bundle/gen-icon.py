#!/usr/bin/env python3
"""Generate FilmSeps.icns — the app icon.

Draws a 1024×1024 master PNG (black rounded-square tile with a white
film-reel frame and "FS" wordmark), rasters it to every iconset size, and
composes a .icns file via `iconutil`. Outputs FilmSeps.icns in this dir.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter


HERE = Path(__file__).resolve().parent
MASTER_PX = 1024


# Icon sizes macOS expects inside a .iconset folder (name → px)
ICONSET_SIZES = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size=size)
            except Exception:
                continue
    return ImageFont.load_default()


def _rounded_rect_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def render_master() -> Image.Image:
    """Draw the master 1024×1024 icon — transparent background so corners
    stay rounded after the mask is applied.
    """
    S = MASTER_PX

    # Base tile — deep near-black with a subtle vertical gradient for polish
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    canvas = Image.new("RGB", (S, S), (18, 18, 20))
    draw = ImageDraw.Draw(canvas)

    # Faint gradient from 22 at top to 14 at bottom
    for y in range(S):
        v = int(22 - (8 * y / S))
        draw.line([(0, y), (S, y)], fill=(v, v, v + 1))

    # Accent bar (orange) along the top — shop's highlight color
    accent_h = int(S * 0.035)
    draw.rectangle([0, 0, S, accent_h], fill=(234, 128, 32))

    # "FS" wordmark, large, centered
    font = _load_font(int(S * 0.52))
    text = "FS"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (S - tw) // 2 - bbox[0]
    ty = (S - th) // 2 - bbox[1] + int(S * 0.02)
    draw.text((tx, ty), text, fill=(245, 245, 245), font=font)

    # Subtitle "film seps" small at the bottom
    sub_font = _load_font(int(S * 0.085))
    sub = "film seps"
    sb = draw.textbbox((0, 0), sub, font=sub_font)
    sw = sb[2] - sb[0]
    draw.text(
        ((S - sw) // 2 - sb[0], int(S * 0.80)),
        sub, fill=(180, 180, 180), font=sub_font,
    )

    # Corner registration-cross accents — 4 tiny crosshairs
    cross_color = (234, 128, 32)
    cross_size = int(S * 0.035)
    cross_thick = max(2, int(S * 0.006))
    margin = int(S * 0.055)
    corners = [
        (margin, margin),
        (S - margin, margin),
        (margin, S - margin),
        (S - margin, S - margin),
    ]
    for cx, cy in corners:
        draw.rectangle(
            [cx - cross_size // 2, cy - cross_thick // 2,
             cx + cross_size // 2, cy + cross_thick // 2],
            fill=cross_color,
        )
        draw.rectangle(
            [cx - cross_thick // 2, cy - cross_size // 2,
             cx + cross_thick // 2, cy + cross_size // 2],
            fill=cross_color,
        )

    # Apply rounded-corner mask — macOS "squircle" approximation at ~22% radius
    radius = int(S * 0.224)
    mask = _rounded_rect_mask(S, radius)
    base.paste(canvas, (0, 0), mask)
    return base


def build_icns(out_icns: Path) -> None:
    master = render_master()
    master_png = HERE / "icon_master.png"
    master.save(master_png, format="PNG")

    iconset = HERE / "FilmSeps.iconset"
    iconset.mkdir(exist_ok=True)

    for filename, px in ICONSET_SIZES:
        target = iconset / filename
        if px == MASTER_PX:
            master.save(target, format="PNG")
        else:
            resized = master.resize((px, px), Image.LANCZOS)
            resized.save(target, format="PNG")

    # Convert iconset → .icns
    result = subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(out_icns)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print("iconutil failed:", result.stderr, file=sys.stderr)
        sys.exit(1)

    # Tidy up
    master_png.unlink(missing_ok=True)


if __name__ == "__main__":
    out = HERE / "FilmSeps.icns"
    build_icns(out)
    print(f"wrote {out}")
