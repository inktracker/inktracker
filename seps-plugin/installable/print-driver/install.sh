#!/bin/bash
# Installer for the Biota "Film Seps" PDF Service.
#
# Symlinks the PDF Service hook into ~/Library/PDF Services/, writes an
# env file pointing at the driver directory, and verifies Python deps.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DRIVER_DIR="$(cd "$HERE/../../scripts/driver" && pwd)"
SERVICE_SRC="$HERE/Film Seps"
SERVICE_DST="$HOME/Library/PDF Services/Film Seps"

# ---- write env file ---
config_dir="$HOME/.config/biota-film-driver"
mkdir -p "$config_dir"
cat > "$config_dir/env.sh" <<EOF
# Written by install.sh — edit if you move the driver.
export DRIVER_DIR="$DRIVER_DIR"
export INSTALL_DIR="$HERE"
export PY="${PY:-/usr/bin/python3}"
EOF
echo "wrote $config_dir/env.sh"

# ---- ensure service is executable & symlinked ---
chmod +x "$SERVICE_SRC" "$HERE/process-art.sh"
mkdir -p "$HOME/Library/PDF Services"

if [[ -L "$SERVICE_DST" || -e "$SERVICE_DST" ]]; then
  echo "removing existing $SERVICE_DST"
  rm -f "$SERVICE_DST"
fi
ln -s "$SERVICE_SRC" "$SERVICE_DST"
echo "linked $SERVICE_DST -> $SERVICE_SRC"

# ---- remove any earlier py2app Film Seps.app (it depended on Apple's
# system Tk, which is non-functional on current macOS). We're back on
# the simple osascript-compiled droplet — it uses native macOS dialogs
# + Preview.app for the sep-approval flow, so no Tk anywhere.
for legacy in "/Applications/Film Seps.app" "$HOME/Applications/Film Seps.app"; do
  if [[ -d "$legacy" ]]; then
    echo "removing existing $legacy"
    rm -rf "$legacy"
  fi
done

# ---- compile droplet.applescript → Film Seps.app ---
APP_SRC="$HERE/droplet.applescript"
if [[ -w /Applications ]]; then
  APP_DST="/Applications/Film Seps.app"
else
  mkdir -p "$HOME/Applications"
  APP_DST="$HOME/Applications/Film Seps.app"
fi

if command -v osacompile >/dev/null 2>&1; then
  osacompile -o "$APP_DST" "$APP_SRC"
  echo "built $APP_DST"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
    -f "$APP_DST" >/dev/null 2>&1 || true
  open -R "$APP_DST" 2>/dev/null || true
else
  echo "osacompile not found — skipped .app build" >&2
fi

# ---- deps ---
PY="${PY:-/usr/bin/python3}"
missing=()
for mod in PIL numpy psd_tools pypdfium2; do
  if ! "$PY" -c "import $mod" 2>/dev/null; then
    missing+=("$mod")
  fi
done

# Auto-install any missing deps so the user doesn't have to
if (( ${#missing[@]} > 0 )); then
  echo "installing missing deps: ${missing[*]}"
  "$PY" -m pip install --user --quiet -r "$DRIVER_DIR/requirements.txt" || true
  # Re-check
  still_missing=()
  for mod in "${missing[@]}"; do
    if ! "$PY" -c "import $mod" 2>/dev/null; then
      still_missing+=("$mod")
    fi
  done
  missing=("${still_missing[@]}")
fi

if (( ${#missing[@]} > 0 )); then
  echo
  echo "Python deps missing: ${missing[*]}"
  echo "Install with:"
  echo "  $PY -m pip install -r '$DRIVER_DIR/requirements.txt'"
  echo
else
  echo "deps OK"
fi

# ---- detect the Epson film printer & write printer.json ---
echo
echo "Detecting film printer (Epson ET-15000)…"
if "$PY" "$DRIVER_DIR/configure_printer.py"; then
  :
else
  echo
  echo "  skipped — you can configure it later with:"
  echo "    $PY '$DRIVER_DIR/configure_printer.py'"
fi

cat <<EOF

✓ Installed. Three ways to use it:

1. Native app — launch "Film Seps" from Launchpad or Spotlight.
   (Find it in /Applications/ or ~/Applications/ and drag to the Dock for
   one-click access. Drag any art file onto the icon to open it directly.)

2. From any app's Print dialog:
     File → Print → PDF dropdown → "Film Seps"

3. From the command line:
     $PY $DRIVER_DIR/film_driver.py <art.jpg> \\
         --print-width 12 --garment black --print

Output lands in: ~/Downloads/film-seps/<timestamp>-<title>/films/
Printer config:  ~/.config/biota-film-driver/printer.json
EOF
