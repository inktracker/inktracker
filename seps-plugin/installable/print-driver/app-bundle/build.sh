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
PY="${PY:-/usr/bin/python3}"

echo "driver: $DRIVER_DIR"
echo "py:     $PY"

# ---- py2app ---------------------------------------------------------------
if ! "$PY" -c "import py2app" >/dev/null 2>&1; then
  echo "installing py2app…"
  "$PY" -m pip install --user --quiet py2app
fi

# ---- stage driver modules next to launcher.py ----------------------------
echo "staging driver modules…"
# Copy everything except configure_printer.py (install-time tool only) and
# any __pycache__.
for f in "$DRIVER_DIR"/*.py; do
  name="$(basename "$f")"
  [[ "$name" == "configure_printer.py" ]] && continue
  cp "$f" "$HERE/$name"
done

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
rm -rf "$HERE/build" "$HERE/dist" "$HERE/FilmSeps.iconset"

# Register the new app with LaunchServices so it shows up immediately
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$APP_DST" >/dev/null 2>&1 || true

echo ""
echo "✓ built $APP_DST"
open -R "$APP_DST" 2>/dev/null || true
