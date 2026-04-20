#!/usr/bin/env python3
"""Submit already-rendered film TIFs to the Epson via CUPS.

Used by the macOS PDF Service hook after the operator approves the preview.
Takes a films/ directory and pushes every TIF to the configured printer
with shop-locked options.

    submit_films.py <films_dir> <title> [--double-strike] [--dry-run]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from PIL import Image  # noqa: E402

from printer import PrinterConfig, PrintJob, submit_many  # noqa: E402


def detect_sheet(tif_path: Path) -> str:
    im = Image.open(str(tif_path))
    dpi = im.info.get("dpi", (720, 720))[0] or 720
    long_in = max(im.size) / dpi
    return "13x19" if long_in > 10.5 else "8.5x11"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("films_dir", type=Path)
    p.add_argument("title")
    p.add_argument("--double-strike", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--printer", default=None, help="Override CUPS queue")
    args = p.parse_args(argv or sys.argv[1:])

    tifs = sorted(args.films_dir.glob("*.tif"))
    if not tifs:
        print(f"no .tif files in {args.films_dir}", file=sys.stderr)
        return 1

    cfg = PrinterConfig.load()
    if args.printer:
        cfg.queue = args.printer
    if args.double_strike:
        cfg.double_strike = True

    sheet = detect_sheet(tifs[0])
    jobs = [
        PrintJob(path=t, title=f"{args.title} — {t.stem}", sheet_name=sheet)
        for t in tifs
    ]
    results = submit_many(cfg, jobs, dry_run=args.dry_run)

    ok = sum(1 for r in results if r.get("status") == "submitted")
    dry = sum(1 for r in results if r.get("status") == "dry-run")
    fail = sum(1 for r in results if r.get("status") == "failed")

    for r in results:
        badge = {"submitted": "✓", "dry-run": "·", "failed": "✗"}.get(r.get("status"), "?")
        pass_tag = f" pass {r.get('pass')}" if cfg.double_strike else ""
        jid = r.get("job_id") or ""
        print(f"{badge} {r.get('film', '?')}{pass_tag} {jid}")

    print(f"\n{ok} submitted, {dry} dry-run, {fail} failed")
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
