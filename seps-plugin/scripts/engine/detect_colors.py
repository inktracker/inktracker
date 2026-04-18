#!/usr/bin/env python3
"""Detect distinct colors in a flat image (PNG, JPG, flat PSD).

Used by the /prep-spot skill when the input isn't a layered PSD. Outputs a
JSON blob listing each color so Claude can ask the user to confirm or rename
before running the full separation.

Usage:
    python3 detect_colors.py <image-path> [max_colors]

Defaults: max_colors=8.

Output (to stdout):
{
  "source": "/path/to/art.png",
  "width": 2400,
  "height": 3000,
  "colors": [
    {
      "rgb": [24, 40, 90],
      "pixel_count": 1800000,
      "fraction": 0.25,
      "suggested_name": "blue"
    },
    ...
  ]
}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

from utils import detect_flat_colors


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: detect_colors.py <image-path> [max_colors]", file=sys.stderr)
        return 1

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"file not found: {path}", file=sys.stderr)
        return 1

    max_colors = int(sys.argv[2]) if len(sys.argv) > 2 else 8

    try:
        if path.suffix.lower() in (".psd", ".psb"):
            from psd_tools import PSDImage
            psd = PSDImage.open(str(path))
            img = psd.composite()
            if img is None:
                print("empty or corrupt PSD", file=sys.stderr)
                return 2
        else:
            img = Image.open(str(path))
    except Exception as e:
        print(f"could not open image: {e}", file=sys.stderr)
        return 2

    colors = detect_flat_colors(img, max_colors=max_colors)

    result = {
        "source": str(path),
        "width": img.size[0],
        "height": img.size[1],
        "mode": img.mode,
        "colors": colors,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
