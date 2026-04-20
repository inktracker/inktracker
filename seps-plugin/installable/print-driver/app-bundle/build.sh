#!/bin/bash
# Build Film Seps.app as a proper native macOS bundle via py2app.
#
# Orchestrates:
#   1. ensure py2app is installed
#   2. copy driver/*.py alongside launcher.py so py2app can include them
#   3. render the FilmSeps.icns app icon
#   4. run `python3 setup.py py2app` (full bundle mode)
#   5. move Film Seps.app into /Applications/ (fall back to ~/Applications)
#   6. clean up build artifacts

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DRIVER_DIR="$(cd "$HERE/../../../scripts/driver" && pwd)"

# Default PY to python.org 3.13 if nothing was passed in.
if [[ -z "${PY:-}" ]]; then
  for candidate in \
    "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3" \
    "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3" \
    "/usr/local/bin/python3.13" \
    "/usr/local/bin/python3.12"; do
    if [[ -x "$candidate" ]]; then
      PY="$candidate"
      break
    fi
  done
fi
PY="${PY:-/usr/bin/python3}"

# Hard-guard: py2app MUST build against a Python with Tk 8.6 or the bundled
# GUI will be invisible on launch. Apple's 3.9 has Tk 8.5 — refuse to build.
if ! "$PY" -c "import tkinter; assert tkinter.TkVersion>=8.6" 2>/dev/null; then
  echo "✗ $PY has Tk < 8.6 — the GUI will be unusable if we build with this." >&2
  echo "  Run install.sh which detects python.org Python 3.13 for you." >&2
  exit 1
fi

echo "driver: $DRIVER_DIR"
echo "py:     $PY ($("$PY" --version))"
echo "tk:     $("$PY" -c 'import tkinter;print(tkinter.TkVersion)')"

# ---- py2app + pyobjc (needed for drag-drop handling + .app build) ---------
for pkg_import in "py2app:py2app" "objc:pyobjc-core" "AppKit:pyobjc-framework-Cocoa"; do
  mod="${pkg_import%%:*}"
  pkg="${pkg_import##*:}"
  if ! "$PY" -c "import $mod" >/dev/null 2>&1; then
    echo "installing $pkg…"
    "$PY" -m pip install --user --quiet "$pkg"
  fi
done

# ---- stage driver modules next to launcher.py ----------------------------
echo "staging driver modules…"
# Copy everything except configure_printer.py (install-time tool only) and
# any __pycache__.
for f in "$DRIVER_DIR"/*.py; do
  name="$(basename "$f")"
  [[ "$name" == "configure_printer.py" ]] && continue
  cp "$f" "$HERE/$name"
done

# Also stage engine/utils.py — film_driver.plan_flat imports
# detect_flat_colors from it, and without a bundle copy py2app can't resolve
# the import (engine/ lives in a sibling folder, not on sys.path inside
# the frozen .app).
ENGINE_DIR="$(cd "$DRIVER_DIR/../engine" && pwd)"
if [[ -f "$ENGINE_DIR/utils.py" ]]; then
  cp "$ENGINE_DIR/utils.py" "$HERE/utils.py"
fi

# ---- icon -----------------------------------------------------------------
if [[ ! -f "$HERE/FilmSeps.icns" ]]; then
  echo "generating icon…"
  "$PY" "$HERE/gen-icon.py"
fi

# ---- py2app build ---------------------------------------------------------
echo "running py2app (this takes a minute)…"
cd "$HERE"
rm -rf build dist
"$PY" setup.py py2app >"$HERE/py2app.log" 2>&1 || {
  echo "py2app failed — see $HERE/py2app.log" >&2
  tail -30 "$HERE/py2app.log" >&2 || true
  exit 1
}

# ---- install --------------------------------------------------------------
APP_SRC="$HERE/dist/Film Seps.app"
if [[ ! -d "$APP_SRC" ]]; then
  echo "build produced no .app — see $HERE/py2app.log" >&2
  exit 1
fi

# Prefer /Applications when writable, fall back to ~/Applications
if [[ -w /Applications ]]; then
  APP_DST="/Applications/Film Seps.app"
else
  mkdir -p "$HOME/Applications"
  APP_DST="$HOME/Applications/Film Seps.app"
fi

if [[ -d "$APP_DST" ]]; then
  echo "replacing existing $APP_DST"
  rm -rf "$APP_DST"
fi
mv "$APP_SRC" "$APP_DST"
echo "installed: $APP_DST"

# ---- cleanup --------------------------------------------------------------
# Keep FilmSeps.icns + setup.py + launcher.py; remove staged driver copies
# and build artifacts so the source tree stays clean.
for f in "$DRIVER_DIR"/*.py; do
  name="$(basename "$f")"
  [[ "$name" == "configure_printer.py" ]] && continue
  rm -f "$HERE/$name"
done
rm -f "$HERE/utils.py"
rm -rf "$HERE/build" "$HERE/dist" "$HERE/FilmSeps.iconset"

# Register the new app with LaunchServices so it shows up immediately
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$APP_DST" >/dev/null 2>&1 || true

echo ""
echo "✓ built $APP_DST"
open -R "$APP_DST" 2>/dev/null || true
