"""Preview contact sheet — shows the source art next to each rendered film.

Called between rendering and printing. The operator opens the PNG in
Preview.app, eyeballs the separation, and confirms (or cancels).
"""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont

from layout import _load_font


TILE_W = 420   # each film tile width in the preview (px)
TILE_GAP = 32
LABEL_H = 48
HEADER_H = 64
BG = (240, 240, 240)
LABEL_BG = (255, 255, 255)
LABEL_FG = (30, 30, 30)
SOURCE_BORDER = (200, 100, 30)    # orange — visually distinguishes the source tile
FILM_BORDER = (60, 60, 60)


def build_contact_sheet(
    source_image: Image.Image,
    films: Sequence[dict],      # [{index, name, path, ink, mesh, purpose, angle, lpi}, ...]
    header: str,
    out_path: Path,
) -> Path:
    """Build a contact-sheet PNG showing the source + every film tile.

    Layout: horizontal row of tiles (with wrap) — source first, then films
    in print order. Each tile is `TILE_W` wide; tile height matches the
    source aspect so everything stays proportional.
    """
    # Resolve film images from disk
    film_imgs = []
    for f in films:
        try:
            img = Image.open(f["path"]).convert("L")
            film_imgs.append((f, img))
        except Exception:
            continue

    # Reference aspect: use the source's own aspect ratio
    src_w, src_h = source_image.size
    aspect = src_h / max(1, src_w)
    tile_h = int(TILE_W * aspect)

    tiles: list[Image.Image] = []
    # 1) source tile
    tiles.append(_make_tile(
        source_image, (TILE_W, tile_h),
        title="SOURCE",
        subtitle=f"{src_w}×{src_h}",
        border=SOURCE_BORDER,
    ))
    # 2) film tiles
    for meta, film in film_imgs:
        title = f"{meta['index']:02d}  {meta['ink'].upper()}"
        parts = [f"{meta['mesh']} mesh"]
        if meta.get("angle") is not None:
            parts.append(f"{meta['lpi']} LPI @ {meta['angle']}°")
        parts.append(meta["purpose"])
        subtitle = "  ·  ".join(parts)
        tiles.append(_make_tile(
            film, (TILE_W, tile_h),
            title=title,
            subtitle=subtitle,
            border=FILM_BORDER,
        ))

    # Tile into rows — fit 3 tiles per row if that looks reasonable
    per_row = _pick_per_row(len(tiles))
    rows = [tiles[i:i + per_row] for i in range(0, len(tiles), per_row)]

    row_w = per_row * TILE_W + (per_row - 1) * TILE_GAP
    tile_block_h = tile_h + LABEL_H + TILE_GAP
    total_h = HEADER_H + len(rows) * tile_block_h + TILE_GAP
    total_w = row_w + 2 * TILE_GAP

    sheet = Image.new("RGB", (total_w, total_h), BG)
    draw = ImageDraw.Draw(sheet)

    # Header text
    header_font = _load_font(28)
    draw.text((TILE_GAP, 20), header, fill=(20, 20, 20), font=header_font)

    # Paste tiles
    y = HEADER_H
    for row in rows:
        x = TILE_GAP
        for tile in row:
            sheet.paste(tile, (x, y))
            x += TILE_W + TILE_GAP
        y += tile_block_h

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(str(out_path), format="PNG")
    return out_path


def _make_tile(
    img: Image.Image,
    size: tuple[int, int],
    title: str,
    subtitle: str,
    border: tuple[int, int, int],
) -> Image.Image:
    """Build one tile: image area + label strip below."""
    tile_w, tile_h = size
    tile = Image.new("RGB", (tile_w, tile_h + LABEL_H), LABEL_BG)

    # Fit image into tile area preserving aspect
    img_rgb = img.convert("RGB") if img.mode != "RGB" else img
    img_thumb = img_rgb.copy()
    img_thumb.thumbnail((tile_w - 4, tile_h - 4), Image.LANCZOS)
    ox = (tile_w - img_thumb.size[0]) // 2
    oy = (tile_h - img_thumb.size[1]) // 2
    tile.paste(img_thumb, (ox, oy))

    draw = ImageDraw.Draw(tile)
    # 2-px border around the image area in the tile color
    draw.rectangle([0, 0, tile_w - 1, tile_h - 1], outline=border, width=2)

    # Label strip
    draw.rectangle([0, tile_h, tile_w, tile_h + LABEL_H - 1],
                   fill=LABEL_BG, outline=border, width=2)
    title_font = _load_font(18)
    sub_font = _load_font(14)
    draw.text((10, tile_h + 4), title, fill=LABEL_FG, font=title_font)
    draw.text((10, tile_h + 26), subtitle, fill=(110, 110, 110), font=sub_font)
    return tile


def _pick_per_row(n: int) -> int:
    """Choose tiles-per-row so rows stay readable on a ~1600px display."""
    if n <= 3:
        return n
    if n <= 6:
        return 3
    if n <= 8:
        return 4
    return 4


def open_in_preview(path: Path) -> None:
    """Open the contact sheet in Preview.app (macOS only)."""
    import subprocess
    subprocess.run(["open", "-a", "Preview", str(path)], check=False)
