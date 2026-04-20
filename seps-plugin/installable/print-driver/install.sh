#!/bin/bash
# Installer for the Biota "Film Seps" app + PDF Service.
#
# Strategy:
#   1. Find a Python that ships working Tk 8.6 (python.org Python 3.13 does;
#      Apple's system Python 3.9 does NOT — its Tk 8.5 is deprecated and
#      renders empty windows).
#   2. Install/verify Python deps against that Python.
#   3. Build Film Seps.app via py2app so the GUI window is a real bundle.
#   4. Link the PDF Service hook for the Print-dialog entry.
#   5. Detect the Epson film printer and write printer.json.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DRIVER_DIR="$(cd "$HERE/../../scripts/driver" && pwd)"
SERVICE_SRC="$HERE/Film Seps"
SERVICE_DST="$HOME/Library/PDF Services/Film Seps"

# --------------------------------------------------------------------------
# 1. Find a Python with a working Tk
# --------------------------------------------------------------------------
# Candidates in preferred order. python.org framework Python ships a correctly
# bundled Tk 8.6; Apple's /usr/bin/python3 is Tk 8.5 / deprecated / renders
# empty windows — unusable for our GUI.
PY_CANDIDATES=(
  "${PY:-}"   # honor explicit override
  "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
  "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"
  "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3"
  "/opt/homebrew/bin/python3.13"
  "/opt/homebrew/bin/python3.12"
  "/usr/local/bin/python3.13"
  "/usr/local/bin/python3.12"
)

PY=""
for candidate in "${PY_CANDIDATES[@]}"; do
  [[ -z "$candidate" ]] && continue
  [[ -x "$candidate" ]] || continue
  # Must be 3.11+ AND ship Tk 8.6+
  if "$candidate" -c "import sys,tkinter; assert sys.version_info>=(3,11) and tkinter.TkVersion>=8.6" 2>/dev/null; then
    PY="$candidate"
    break
  fi
done

if [[ -z "$PY" ]]; then
  cat >&2 <<EOF

✗ No Python with a working Tk was found.

Install Python 3.13 from python.org (one-time, ~2 min):
  https://www.python.org/downloads/macos/

Then re-run this installer. The GUI needs Tk 8.6+ and Apple's shipped
Python 3.9 only has the deprecated Tk 8.5, which renders empty windows.
EOF
  exit 1
fi

echo "using Python: $PY ($("$PY" --version))  [Tk $("$PY" -c 'import tkinter;print(tkinter.TkVersion)')]"

# --------------------------------------------------------------------------
# 2. Install/verify Python deps
# --------------------------------------------------------------------------
REQUIRED=(PIL numpy psd_tools pypdfium2 py2app objc AppKit)
missing=()
for mod in "${REQUIRED[@]}"; do
  if ! "$PY" -c "import $mod" 2>/dev/null; then
    missing+=("$mod")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "installing missing deps: ${missing[*]}"
  # Map import names → pip package names
  pip_pkgs=()
  for mod in "${missing[@]}"; do
    case "$mod" in
      PIL) pip_pkgs+=("Pillow") ;;
      objc) pip_pkgs+=("pyobjc-core") ;;
      AppKit) pip_pkgs+=("pyobjc-framework-Cocoa") ;;
      *)    pip_pkgs+=("$mod") ;;
    esac
  done
  "$PY" -m pip install --user --quiet "${pip_pkgs[@]}" || {
    echo "✗ pip install failed — aborting" >&2
    exit 1
  }
  # Re-verify
  still_missing=()
  for mod in "${missing[@]}"; do
    "$PY" -c "import $mod" 2>/dev/null || still_missing+=("$mod")
  done
  if (( ${#still_missing[@]} > 0 )); then
    echo "✗ still missing after install: ${still_missing[*]}" >&2
    exit 1
  fi
fi
echo "all deps OK"

# --------------------------------------------------------------------------
# 3. Write env file (Film Seps PDF Service reads this)
# --------------------------------------------------------------------------
config_dir="$HOME/.config/biota-film-driver"
mkdir -p "$config_dir"
cat > "$config_dir/env.sh" <<EOF
# Written by install.sh — edit if you move the driver.
export DRIVER_DIR="$DRIVER_DIR"
export INSTALL_DIR="$HERE"
export PY="$PY"
EOF
echo "wrote $config_dir/env.sh"

chmod +x "$SERVICE_SRC" "$HERE/process-art.sh"
mkdir -p "$HOME/Library/PDF Services"

if [[ -L "$SERVICE_DST" || -e "$SERVICE_DST" ]]; then
  rm -f "$SERVICE_DST"
fi
ln -s "$SERVICE_SRC" "$SERVICE_DST"
echo "linked PDF Service: $SERVICE_DST"

# --------------------------------------------------------------------------
# 4. Remove any legacy Film Seps.app and rebuild via py2app
# --------------------------------------------------------------------------
for legacy in "/Applications/Film Seps.app" "$HOME/Applications/Film Seps.app"; do
  if [[ -d "$legacy" ]]; then
    echo "removing existing $legacy"
    rm -rf "$legacy"
  fi
done

BUILD_SCRIPT="$HERE/app-bundle/build.sh"
if [[ ! -x "$BUILD_SCRIPT" ]]; then
  echo "✗ $BUILD_SCRIPT missing — can't build .app" >&2
  exit 1
fi

echo ""
echo "Building Film Seps.app via py2app (this takes ~1 minute)…"
PY="$PY" "$BUILD_SCRIPT"

# --------------------------------------------------------------------------
# 5. Detect the Epson film printer & write printer.json
# --------------------------------------------------------------------------
echo ""
echo "Detecting film printer (Epson ET-15000)…"
if ! "$PY" "$DRIVER_DIR/configure_printer.py"; then
  echo "  skipped — run later with:"
  echo "    $PY '$DRIVER_DIR/configure_printer.py'"
fi

cat <<EOF

✓ Installed.

1. Launch Film Seps from Launchpad/Spotlight, or drag the app to your Dock.
   Drop any art file on the icon to open it directly.

2. From any other app's Print dialog:
     File → Print → PDF dropdown → "Film Seps"

3. From the command line:
     $PY $DRIVER_DIR/film_driver.py <art.jpg> \\
         --print-width 12 --garment black --print

Output lands in: ~/Downloads/film-seps/<timestamp>-<title>/films/
Printer config:  ~/.config/biota-film-driver/printer.json
Log:             ~/Library/Logs/FilmSeps.log
EOF
