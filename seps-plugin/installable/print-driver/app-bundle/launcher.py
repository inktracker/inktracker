#!/usr/bin/env python3
"""Entry point for Film Seps.app.

py2app wraps this as the app's main executable. At runtime the driver
modules live next to this file inside Film Seps.app/Contents/Resources/.
"""
from __future__ import annotations

import sys
from pathlib import Path


def _prep_path() -> None:
    """Make the driver modules importable in both frozen and dev runs."""
    here = Path(__file__).resolve().parent

    # When frozen by py2app, the bundle's build step copies driver/*.py
    # next to this launcher. When running from source (direct `python3
    # launcher.py` for dev), the driver dir is three levels up + scripts/driver.
    candidates = [
        here,  # frozen layout
        here.parent.parent.parent / "scripts" / "driver",  # dev layout
    ]
    for p in candidates:
        if (p / "gui.py").exists():
            sys.path.insert(0, str(p))
            return
    # Last-chance fallback: assume the script folder itself
    sys.path.insert(0, str(here))


def main() -> int:
    _prep_path()
    from gui import main as gui_main  # noqa: WPS433 — import after path prep
    return gui_main(sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
