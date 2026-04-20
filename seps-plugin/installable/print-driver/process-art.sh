#!/bin/bash
# Shared worker — takes a source art file, walks the operator through the
# width/garment/ink dialog, renders films, opens the preview contact sheet,
# asks about single vs double strike, and submits to the Epson.
#
# Used by both:
#   - "Film Seps" PDF Service (receives a PDF from macOS Print dialog)
#   - Film Seps.app droplet   (receives any file from drag-drop)
#
# Usage:
#   process-art.sh <source-file> [document-title]

set -euo pipefail

src="${1:-}"
doc_title="${2:-}"

if [[ -z "$src" ]] || [[ ! -f "$src" ]]; then
  osascript -e 'display alert "Film Seps" message "No source file provided, or the file does not exist." as critical'
  exit 1
fi

# Fall back to the filename if no explicit title
if [[ -z "$doc_title" ]]; then
  doc_title="$(basename "$src")"
fi

# ---- resolve driver path ---------------------------------------------------
env_file="$HOME/.config/biota-film-driver/env.sh"
if [[ -f "$env_file" ]]; then
  # shellcheck disable=SC1090
  source "$env_file"
fi
: "${DRIVER_DIR:=$HOME/Downloads/inktracker/seps-plugin/scripts/driver}"
: "${PY:=/usr/bin/python3}"

if [[ ! -f "$DRIVER_DIR/film_driver.py" ]]; then
  osascript -e "display alert \"Film Seps\" message \"film_driver.py not found at: $DRIVER_DIR\" as critical"
  exit 1
fi

# ---- ask for print size + garment + ink -----------------------------------
read -r -d '' OSA <<'APPLESCRIPT' || true
set sizeChoice to button returned of (display dialog "Print size on garment:" buttons {"Left chest (4\")", "Full front (12\")", "Custom..."} default button "Full front (12\")" with title "Film Seps")

if sizeChoice is "Custom..." then
  set widthStr to text returned of (display dialog "Print width (inches):" default answer "11" with title "Film Seps")
else if sizeChoice is "Left chest (4\")" then
  set widthStr to "4"
else
  set widthStr to "12"
end if

set garmentList to {"black", "white", "navy", "heather", "charcoal", "royal", "red", "natural"}
set garmentChoice to choose from list garmentList with prompt "Garment color:" default items {"black"} with title "Film Seps"
if garmentChoice is false then error number -128
set garmentStr to item 1 of garmentChoice

set inkList to {"waterbase", "discharge"}
set inkChoice to choose from list inkList with prompt "Ink system:" default items {"waterbase"} with title "Film Seps"
if inkChoice is false then error number -128
set inkStr to item 1 of inkChoice

return widthStr & "|" & garmentStr & "|" & inkStr
APPLESCRIPT

answer="$(osascript -e "$OSA" 2>/dev/null || true)"
if [[ -z "$answer" ]]; then
  exit 0
fi

width="$(echo "$answer" | awk -F'|' '{print $1}')"
garment="$(echo "$answer" | awk -F'|' '{print $2}')"
ink="$(echo "$answer" | awk -F'|' '{print $3}')"

if ! [[ "$width" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  osascript -e "display alert \"Film Seps\" message \"Invalid print width: $width\" as critical"
  exit 1
fi

# ---- output dir ------------------------------------------------------------
stamp="$(date +%y%m%d-%H%M%S)"
safe_title="$(echo "$doc_title" | tr -c 'A-Za-z0-9._-' '-' | sed -E 's/-+/-/g; s/^-|-$//g; s/\.[^.]+$//')"
safe_title="${safe_title:-untitled}"
out_root="$HOME/Downloads/film-seps/${stamp}-${safe_title}"
mkdir -p "$out_root/films"

# Copy the source alongside the films for traceability
ext="${src##*.}"
cp "$src" "$out_root/source.$ext"

log="$out_root/film-driver.log"
{
  echo "=== Biota Film Seps ==="
  echo "source:  $src"
  echo "title:   $doc_title"
  echo "width:   $width in"
  echo "garment: $garment"
  echo "ink:     $ink"
  echo "out:     $out_root"
  echo
} > "$log"

# ---- render films + preview -----------------------------------------------
if ! "$PY" "$DRIVER_DIR/film_driver.py" \
    "$out_root/source.$ext" \
    --output-dir "$out_root/films" \
    --print-width "$width" \
    --garment "$garment" \
    --ink-system "$ink" \
    --label-prefix "$safe_title" \
    --preview \
    --json >> "$log" 2>&1; then
  osascript -e "display alert \"Film Seps\" message \"Driver failed. Log: $log\" as critical"
  open "$log"
  exit 2
fi

film_count=$(find "$out_root/films" -maxdepth 1 -name '*.tif' -type f | wc -l | tr -d ' ')

# ---- confirm + strike choice ----------------------------------------------
read -r -d '' PRINT_OSA <<APPLESCRIPT || true
set btn to button returned of (display dialog "Preview just opened — eyeball each sep.

Print $film_count films to the Epson?" buttons {"Cancel", "Single strike", "Double strike"} default button "Single strike" with title "Film Seps")
return btn
APPLESCRIPT
choice="$(osascript -e "$PRINT_OSA" 2>/dev/null || true)"

case "$choice" in
  "Single strike") extra_flags="" ;;
  "Double strike") extra_flags="--double-strike" ;;
  *)
    osascript -e "display notification \"$film_count films ready — not printed\" with title \"Film Seps\""
    open "$out_root/films"
    exit 0
    ;;
esac

# ---- submit to the Epson ---------------------------------------------------
if "$PY" "$DRIVER_DIR/submit_films.py" \
    "$out_root/films" "$safe_title" $extra_flags >> "$log" 2>&1; then
  strike_label="single strike"
  [[ "$extra_flags" == "--double-strike" ]] && strike_label="double strike"
  osascript -e "display notification \"$film_count films sent ($strike_label)\" with title \"Film Seps — printing\""
  open "$out_root/films"
else
  osascript -e "display alert \"Film Seps — print submission failed\" message \"Log: $log\" as critical"
  open "$log"
  exit 3
fi
