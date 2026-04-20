"""Shop preferences — defaults for the Biota shop (waterbase + discharge).

Mirrors knowledge/shop-preferences.md. Anything here can be overridden by
CLI flags or a per-job config; these are the baseline values the driver
applies when the caller doesn't specify.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

InkSystem = Literal["waterbase", "discharge"]
Purpose = Literal["underbase", "color", "highlight"]


# ---- Film output -----------------------------------------------------------

FILM_DPI_DEFAULT = 720          # Epson P800/P900 standard
FILM_DPI_MIN_ACCEPTABLE = 360   # shop floor for low-LPI mono jobs


# ---- Halftone --------------------------------------------------------------

DOT_SHAPE = "elliptical"        # shop standard; never round
DOT_ASPECT = 1.4                # 1.4:1 chain-dot
BASE_ANGLE = 22.5               # mono / primary color — dodges fabric weave

# Multi-screen angle set — 30° separation, base 22.5°
ANGLE_SET = [22.5, 52.5, 82.5, 7.5, 37.5, 67.5]

HIGHLIGHT_HOLD = 0.03           # dots smaller than 3% are forced to 0
SHADOW_PLUG = 0.87              # dots larger than 87% are forced to 100


# ---- Mesh → LPI (waterbase, shop cap 280) ---------------------------------

# (min_lpi, target_lpi, max_lpi) per mesh count
MESH_LPI_WATERBASE = {
    110: (20, 25, 30),
    156: (30, 35, 40),
    200: (40, 45, 50),
    230: (45, 55, 60),
    280: (55, 60, 65),
}
# Waterbase can run slightly higher than plastisol at the same mesh;
# the table above reflects shop experience, not the generic KB.

# Discharge cuts dot gain to ~0, so it tolerates the top of the range.
MESH_LPI_DISCHARGE = {
    156: (30, 40, 45),
    200: (40, 50, 55),
    230: (45, 55, 60),
    280: (55, 65, 70),
}

MESH_CAP = 280


# ---- Default mesh per layer purpose ---------------------------------------

DEFAULT_MESH = {
    "waterbase": {
        "underbase": 156,
        "color": 230,
        "highlight": 280,
    },
    "discharge": {
        "underbase": 156,
        "color": 230,
        "highlight": 230,
    },
}


# ---- Dot-gain LUTs (input % → output film %) -------------------------------
#
# Curves are sparse; the driver linearly interpolates between anchors.
# Values are the film dot that lands on the garment as the target dot after
# dot gain. So at 30% target on waterbase (5% gain), we write ~25% on film.

DOT_GAIN_WATERBASE = {
    # target_pct -> film_pct
    0.00: 0.00,
    0.03: 0.03,
    0.10: 0.08,
    0.20: 0.17,
    0.30: 0.25,
    0.40: 0.34,
    0.50: 0.43,
    0.60: 0.52,
    0.70: 0.62,
    0.80: 0.74,
    0.87: 0.82,
    1.00: 1.00,
}

# Discharge has near-zero dot gain — identity curve.
DOT_GAIN_DISCHARGE = {i / 100.0: i / 100.0 for i in range(0, 101, 10)}


# ---- Sheet sizes (physical film sheet, not artwork) -----------------------

@dataclass
class SheetSize:
    name: str
    width_in: float
    height_in: float
    usable_w_in: float  # design area after reg-mark margin
    usable_h_in: float


SHEET_SMALL = SheetSize("8.5x11", 8.5, 11.0, 7.5, 10.0)
SHEET_LARGE = SheetSize("13x19", 13.0, 19.0, 12.0, 18.0)


def pick_sheet(print_w_in: float, print_h_in: float) -> SheetSize:
    """Per shop-preferences: 8.5x11 only if design fits 7.5x10, else 13x19.

    The design's largest dimension must be ≤10" AND smallest ≤7.5".
    """
    long_side = max(print_w_in, print_h_in)
    short_side = min(print_w_in, print_h_in)
    if long_side <= SHEET_SMALL.usable_h_in and short_side <= SHEET_SMALL.usable_w_in:
        return SHEET_SMALL
    return SHEET_LARGE


# ---- Registration marks ---------------------------------------------------

REG_MARK_SIZE_IN = 0.15
REG_MARK_LABEL_SIZE_IN = 0.2
REG_MARK_EDGE_MARGIN_IN = 0.45


# ---- Per-ink screen angle assignment --------------------------------------

def assign_angles(color_count: int, base: float = BASE_ANGLE) -> list[float]:
    """Pick `color_count` halftone angles from the shop's angle set.

    Always takes them in the stored order so mono (count=1) = 22.5°, two-
    color = 22.5/52.5, etc. If caller needs > 6, we wrap.
    """
    if color_count <= 0:
        return []
    if color_count <= len(ANGLE_SET):
        return ANGLE_SET[:color_count]
    # Wrap with +15° offset — keeps separation even at 7+ colors
    extra = color_count - len(ANGLE_SET)
    return ANGLE_SET + [(a + 15) % 180 for a in ANGLE_SET[:extra]]


# ---- LPI picker -----------------------------------------------------------

def pick_lpi(mesh: int, ink_system: InkSystem = "waterbase") -> int:
    """Pick a target LPI for this mesh + ink system.

    Falls back to mesh/4 if the mesh isn't in the canonical table.
    Caps at the nearest tabled mesh below `mesh` so we never exceed the
    safe window for that screen.
    """
    table = MESH_LPI_DISCHARGE if ink_system == "discharge" else MESH_LPI_WATERBASE
    if mesh in table:
        return table[mesh][1]
    # Nearest tabled mesh ≤ the requested mesh
    eligible = [m for m in table if m <= mesh]
    if eligible:
        return table[max(eligible)][1]
    return max(20, mesh // 4)


# ---- Job-level resolved config --------------------------------------------

@dataclass
class DriverConfig:
    """Resolved driver config after defaults + overrides are merged."""
    ink_system: InkSystem = "waterbase"
    garment_color: str = "black"
    film_dpi: int = FILM_DPI_DEFAULT
    dot_shape: str = DOT_SHAPE
    dot_aspect: float = DOT_ASPECT
    highlight_hold: float = HIGHLIGHT_HOLD
    shadow_plug: float = SHADOW_PLUG
    apply_dot_gain: bool = True
    registration_marks: bool = True
    sheet_size: SheetSize | None = None   # auto-picked if None
    mirror: bool = False                  # right-reading by default
    label_prefix: str = ""                # e.g. job code shown on reg label
