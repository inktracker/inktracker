"""Named shop-ink catalog.

Standard screen-printing inks with tuned RGB values, mesh-count defaults,
and screen-angle suggestions. This is the "Pick inks" palette — the
operator checks which inks they're actually printing and we build the
separation against exactly those.

Replaces auto-detected k-means centroids for production jobs where the
printer knows their ink system up front. Matches how ActionSeps and
Separation Studio NXT ship: a named palette, not "let the software
figure it out."

Why these RGB values
--------------------
Each RGB was chosen to be the SRGB centroid of a typical Plastisol ink
in that hue family — not the pure primary. Real shop inks are less
saturated than pure RGB primaries:

  - "Red" is ~ Pantone Warm Red / PMS 185 — not FF0000
  - "Yellow" is ~ PMS 116 — slight cast, not FFFF00
  - "Blue" is ~ PMS 286 (royal) — not 0000FF
  - "Green" is ~ PMS 355 — slight yellow bias, not 00FF00

Tuning them to real ink centroids makes the LAB ΔE extractor produce
masks that match the ink actually laid down on press. If we used pure
primaries, a "slightly orange red" pixel would sit far from our red
centroid and print at low density — when in real life it'd print
perfectly on a standard red ink.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class NamedInk:
    key: str                      # short machine name ("red", "lemon-yellow")
    display: str                  # "Red" — shown in the UI
    rgb: tuple[int, int, int]     # LAB-centroid RGB for extraction
    category: str = "color"       # "color" | "neutral" | "specialty"


# Ordered roughly by frequency of use on dark garments. Neutrals last.
NAMED_INKS: tuple[NamedInk, ...] = (
    # --- Primaries & common PMS families ---
    NamedInk("red",          "Red",          (200,  40,  45), "color"),
    NamedInk("orange",       "Orange",       (230, 105,  30), "color"),
    NamedInk("yellow",       "Yellow",       (240, 195,  40), "color"),
    NamedInk("lemon-yellow", "Lemon Yellow", (245, 225,  70), "color"),
    NamedInk("green",        "Green",        ( 60, 140,  65), "color"),
    NamedInk("kelly-green",  "Kelly Green",  ( 70, 165,  70), "color"),
    NamedInk("teal",         "Teal",         ( 25, 140, 140), "color"),
    NamedInk("turquoise",    "Turquoise",    ( 40, 170, 180), "color"),
    NamedInk("blue",         "Royal Blue",   ( 35,  75, 180), "color"),
    NamedInk("navy",         "Navy",         ( 30,  45,  90), "color"),
    NamedInk("light-blue",   "Light Blue",   (100, 160, 210), "color"),
    NamedInk("purple",       "Purple",       (110,  50, 150), "color"),
    NamedInk("magenta",      "Magenta",      (195,  50, 130), "color"),
    NamedInk("pink",         "Pink",         (225, 130, 170), "color"),
    NamedInk("brown",        "Brown",        (115,  75,  45), "color"),
    NamedInk("tan",          "Tan",          (200, 170, 130), "color"),
    NamedInk("skin-tone",    "Skin Tone",    (220, 185, 150), "color"),

    # --- Neutrals ---
    NamedInk("black",        "Black",        ( 20,  20,  20), "neutral"),
    NamedInk("cool-gray",    "Cool Gray",    (130, 135, 140), "neutral"),
    NamedInk("warm-gray",    "Warm Gray",    (145, 135, 125), "neutral"),
    NamedInk("white",        "White",        (242, 242, 242), "neutral"),
)


# Keyed lookup for palette resolution
BY_KEY: dict[str, NamedInk] = {ink.key: ink for ink in NAMED_INKS}


def resolve(key: str) -> NamedInk | None:
    return BY_KEY.get(key)


# Sensible defaults for a new named-ink job — 4-color process-ish.
# Operator can tick/untick from here.
DEFAULT_SELECTION: tuple[str, ...] = ("black", "red", "yellow", "blue")
