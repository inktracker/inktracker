"""Film sheet layout — places a halftoned channel on a physical sheet with
top/bottom-center registration marks and labels, per shop preferences.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from preferences import (
    REG_MARK_EDGE_MARGIN_IN,
    REG_MARK_LABEL_SIZE_IN,
    REG_MARK_SIZE_IN,
    SheetSize,
    pick_sheet,
)


@dataclass
class FilmLabel:
    """Text that prints next to each reg mark — identifies the film."""
    ink: str            # e.g. "DISCHARGE UNDERBASE"
    mesh: int           # e.g. 156
    index: int | None = None   # print-order index
    job_code: str | None = None

    def render(self) -> str:
        parts = []
        if self.index is not None:
            parts.append(f"{self.index:02d}")
        parts.append(self.ink.upper())
        parts.append(f"{self.mesh} MESH")
        if self.job_code:
            parts.append(self.job_code)
        return "  ·  ".join(parts)


def compose_film_sheet(
    channel: Image.Image,          # grayscale film positive of the ink channel
    print_w_in: float,             # target print width on the garment
    print_h_in: float,
    dpi: int,
    label: FilmLabel,
    sheet: SheetSize | None = None,
    mirror: bool = False,
) -> Image.Image:
    """Place `channel` on a physical film sheet at `dpi`, with reg marks.

    `channel` is the halftoned image at the print size in pixels (i.e. its
    resolution is already dpi * print_inches). We paste it onto the sheet
    canvas centered, then draw reg marks + labels on the top and bottom
    margin strips. Returns a grayscale PIL Image with dpi metadata set.
    """
    if sheet is None:
        sheet = pick_sheet(print_w_in, print_h_in)

    sheet_w_px = int(round(sheet.width_in * dpi))
    sheet_h_px = int(round(sheet.height_in * dpi))
    canvas = Image.new("L", (sheet_w_px, sheet_h_px), 255)

    # Channel should already be at print size; trust its dimensions.
    ch = channel
    if mirror:
        ch = ch.transpose(Image.FLIP_LEFT_RIGHT)

    # Center on the sheet
    cx = (sheet_w_px - ch.size[0]) // 2
    cy = (sheet_h_px - ch.size[1]) // 2
    canvas.paste(ch, (cx, cy))

    _draw_reg_marks(canvas, dpi, sheet, label)
    canvas.info["dpi"] = (dpi, dpi)
    return canvas


def _draw_reg_marks(canvas: Image.Image, dpi: int, sheet: SheetSize, label: FilmLabel) -> None:
    draw = ImageDraw.Draw(canvas)
    w, h = canvas.size

    mark_px = int(round(REG_MARK_SIZE_IN * dpi))
    thick_px = max(1, dpi // 240)  # ~0.004" line
    edge_px = int(round(REG_MARK_EDGE_MARGIN_IN * dpi))

    top_y = edge_px
    bot_y = h - edge_px
    mid_x = w // 2

    for cx, cy in [(mid_x, top_y), (mid_x, bot_y)]:
        # crosshair
        draw.rectangle(
            [cx - mark_px // 2, cy - thick_px // 2,
             cx + mark_px // 2, cy + thick_px // 2],
            fill=0,
        )
        draw.rectangle(
            [cx - thick_px // 2, cy - mark_px // 2,
             cx + thick_px // 2, cy + mark_px // 2],
            fill=0,
        )
        # open circle
        r = int(mark_px * 0.55)
        draw.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            outline=0, width=thick_px,
        )

    # Keep both labels in the edge strip (toward the sheet edge, not the design).
    _draw_label(draw, (mid_x, top_y), label, dpi, above=True)
    _draw_label(draw, (mid_x, bot_y), label, dpi, above=False)


def _draw_label(draw: ImageDraw.ImageDraw, anchor: tuple[int, int],
                label: FilmLabel, dpi: int, above: bool) -> None:
    """Write the film label next to a reg mark."""
    text = label.render()
    size_px = int(round(REG_MARK_LABEL_SIZE_IN * dpi))
    font = _load_font(size_px)

    x, y = anchor
    mark_px = int(round(REG_MARK_SIZE_IN * dpi))
    # 0.6× mark size — keeps the label close enough to the mark that a
    # press operator reads them as one unit, without crashing into it.
    offset = int(mark_px * 0.6)

    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    tx = x - tw // 2
    ty = (y - offset - th) if above else (y + offset)
    draw.text((tx, ty), text, fill=0, font=font)


_FONT_CACHE: dict[int, ImageFont.FreeTypeFont] = {}


def _load_font(size: int) -> ImageFont.ImageFont:
    if size in _FONT_CACHE:
        return _FONT_CACHE[size]
    # Try the common macOS system fonts, fall back to PIL default bitmap.
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            try:
                f = ImageFont.truetype(p, size=size)
                _FONT_CACHE[size] = f
                return f
            except Exception:
                continue
    return ImageFont.load_default()


def save_film_tif(img: Image.Image, path: Path, dpi: int) -> None:
    """Save as uncompressed grayscale TIF with DPI metadata — RIP-friendly."""
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("L").save(
        str(path),
        format="TIFF",
        dpi=(dpi, dpi),
        compression="none",
    )
