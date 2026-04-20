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
export PY="${PY:-/usr/bin/python3}"
EOF
echo "wrote $config_dir/env.sh"

# ---- ensure service is executable & symlinked ---
chmod +x "$SERVICE_SRC"
mkdir -p "$HOME/Library/PDF Services"

if [[ -L "$SERVICE_DST" || -e "$SERVICE_DST" ]]; then
  echo "removing existing $SERVICE_DST"
  rm -f "$SERVICE_DST"
fi
ln -s "$SERVICE_SRC" "$SERVICE_DST"
echo "linked $SERVICE_DST -> $SERVICE_SRC"

# ---- deps ---
PY="${PY:-/usr/bin/python3}"
missing=()
for mod in PIL numpy psd_tools pypdfium2; do
  if ! "$PY" -c "import $mod" 2>/dev/null; then
    missing+=("$mod")
  fi
done

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

✓ Installed. Two ways to use it:

1. From any app's Print dialog:
     File → Print → PDF dropdown → "Film Seps"

2. From the command line:
     $PY $DRIVER_DIR/film_driver.py <art.jpg> \\
         --print-width 12 --garment black --print

Output lands in: ~/Downloads/film-seps/<timestamp>-<title>/films/
Printer config:  ~/.config/biota-film-driver/printer.json
EOF
