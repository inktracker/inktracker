#!/usr/bin/env python3
"""Detect the Epson film printer and write a printer.json config.

Invoked by installable/print-driver/install.sh. Can also be run directly:

    python3 configure_printer.py           # interactive
    python3 configure_printer.py --queue EPSON_ET_15000_Series --yes
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from printer import (  # noqa: E402
    CONFIG_PATH,
    PrinterConfig,
    detect_epson_et15000,
    list_options,
    list_queues,
    pick_best_value,
)


# ET-15000 driver tends to expose these option names. `pick_best_value`
# falls back to substring match so a slightly different driver still works.
MEDIA_PREFS = [
    "Epson Matte Paper Heavyweight",
    "Matte Paper - Heavyweight",
    "Premium Presentation Paper Matte",
    "Presentation Paper Matte",
    "Premium Matte",
    "Matte",
    "Photo Paper Glossy",
]
SHEET_13x19_PREFS = ["Super B", "13x19", "SuperB", "A3Plus", "13x19in"]
SHEET_85x11_PREFS = ["Letter", "LetterSmall", "8.5x11", "US Letter"]


def configure(queue: str | None = None, interactive: bool = True) -> PrinterConfig:
    queues = list_queues()
    if not queues:
        raise RuntimeError("No CUPS queues found. Add the printer in System Settings first.")

    if queue is None:
        queue = detect_epson_et15000()

    if queue is None and interactive:
        print("Configured printers:")
        for i, q in enumerate(queues):
            print(f"  {i+1}) {q}")
        pick = input("Pick the ET-15000 queue number (or enter name): ").strip()
        if pick.isdigit():
            idx = int(pick) - 1
            if 0 <= idx < len(queues):
                queue = queues[idx]
        elif pick in queues:
            queue = pick

    if queue is None:
        raise RuntimeError(
            "Could not identify the ET-15000 queue. "
            "Pass --queue <name> or add --yes after setting queue in Settings."
        )

    opts = list_options(queue)

    media = pick_best_value(opts, "MediaType", MEDIA_PREFS) or "Matte"
    sheet_13 = pick_best_value(opts, "PageSize", SHEET_13x19_PREFS) or "Super B"
    sheet_85 = pick_best_value(opts, "PageSize", SHEET_85x11_PREFS) or "Letter"

    cfg = PrinterConfig(
        queue=queue,
        media_type=media,
        quality="5",
        color_model="Gray",
        rendering_intent="saturation",
        sheet_size_13x19=sheet_13,
        sheet_size_85x11=sheet_85,
        disable_color_mgmt=True,
        double_strike=False,
    )

    if interactive:
        print(f"\nResolved printer config for {queue}:")
        print(f"  media: {cfg.media_type}")
        print(f"  sheet 13x19: {cfg.sheet_size_13x19}")
        print(f"  sheet 8.5x11: {cfg.sheet_size_85x11}")
        print(f"  color: {cfg.color_model}  quality: {cfg.quality}")
        print(f"  rendering: {cfg.rendering_intent}")
        ans = input(f"\nSave to {CONFIG_PATH}? [Y/n] ").strip().lower()
        if ans and ans not in ("y", "yes"):
            print("  aborted — no config written")
            return cfg

    cfg.save()
    print(f"  ✓ wrote {CONFIG_PATH}")
    return cfg


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Configure the film-output printer")
    p.add_argument("--queue", help="CUPS queue name (skips detection)")
    p.add_argument("--yes", "-y", action="store_true", help="Non-interactive")
    args = p.parse_args(argv or sys.argv[1:])

    try:
        configure(queue=args.queue, interactive=not args.yes)
    except Exception as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
