"""py2app build config for Film Seps.app.

Invoked by build.sh, which first copies the driver/*.py files into this
directory so py2app sees them alongside launcher.py.

Usage:
    python3 setup.py py2app
"""
from __future__ import annotations

from pathlib import Path

from setuptools import setup


HERE = Path(__file__).resolve().parent

# Build-time dep: configure_printer.py (CLI) is intentionally excluded from
# the bundle — it's a shell/install-time tool, not part of the running app.
DRIVER_MODULES = [
    "gui", "analyzer", "tooltip",
    "film_driver", "halftone", "layout",
    "preferences", "preview", "printer",
    "sources", "dotgain", "submit_films",
]

# If the driver files have been copied next to launcher.py (by build.sh),
# they'll be picked up via `includes`. Absent during `python3 setup.py
# --help`, so we allow empty.
existing = [m for m in DRIVER_MODULES if (HERE / f"{m}.py").exists()]


PLIST = {
    "CFBundleName": "Film Seps",
    "CFBundleDisplayName": "Film Seps",
    "CFBundleExecutable": "Film Seps",
    "CFBundleIdentifier": "co.biota.filmseps",
    "CFBundleVersion": "1.0.0",
    "CFBundleShortVersionString": "1.0",
    "LSMinimumSystemVersion": "11.0",
    "NSHighResolutionCapable": True,
    "NSPrincipalClass": "NSApplication",
    "NSHumanReadableCopyright": "© 2026 Biota MFG",
    # Tell LaunchServices we open art files via drag-drop on the Dock icon
    "CFBundleDocumentTypes": [
        {
            "CFBundleTypeName": "Artwork",
            "CFBundleTypeRole": "Editor",
            "LSHandlerRank": "Alternate",
            "LSItemContentTypes": [
                "public.jpeg",
                "public.png",
                "public.tiff",
                "com.adobe.pdf",
                "com.adobe.photoshop-image",
            ],
        }
    ],
}

OPTIONS = {
    "plist": PLIST,
    "argv_emulation": False,   # we handle argv ourselves
    "strip": True,
    "includes": existing,
    "packages": ["PIL", "numpy", "psd_tools", "pypdfium2"],
    "iconfile": str(HERE / "FilmSeps.icns") if (HERE / "FilmSeps.icns").exists() else None,
    # Drop these — numpy pulls them in but we don't need them and they bloat the app
    "excludes": ["matplotlib", "scipy", "pandas", "tkinter.test", "unittest"],
}

setup(
    app=["launcher.py"],
    name="Film Seps",
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
