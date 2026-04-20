# Biota Film-Output Print Driver

A standalone color-separation driver that takes artwork (PSD, PNG, JPG, PDF) and
emits press-ready film TIFs for the Epson P800 — using shop-correct halftone
angles, elliptical chain-dots, highlight/shadow cutoffs, waterbase or discharge
dot-gain compensation, and a physical 8.5×11 or 13×19 sheet layout with
top/bottom-center registration marks and labels.

## What it does differently from the old engine

| Concern           | Old `engine/`                | This `driver/`                             |
|-------------------|------------------------------|--------------------------------------------|
| Dot shape         | Round stamp                  | Elliptical 1.4:1 chain-dot (threshold tile)|
| Angles            | CMYK-ish (C15/M75/Y0/K45)    | Shop set: 22.5, 52.5, 82.5, 7.5, 37.5, 67.5|
| Cutoffs           | none                         | 3% highlight hold, 87% shadow plug         |
| Dot gain          | none                         | Waterbase LUT (~5% at 30%), discharge ≈ 0  |
| LPI               | `dpi/8`                      | `pick_lpi(mesh, ink_system)` — mesh table  |
| DPI default       | 360                          | 720 (Epson P800 standard)                  |
| Sheet             | artwork-sized film           | 8.5×11 (fits ≤7.5×10) or 13×19             |
| Reg marks         | 4 corners, no labels         | Top/bottom-center, crosshair+circle, labels|
| PDF input         | not supported                | pypdfium2 (or `sips` fallback)             |

## CLI

```sh
python3 film_driver.py <artwork> --print-width <in> [options]
```

### Required

- `<artwork>` — path to a PSD/PSB, PNG/JPG/TIF, or PDF
- `--print-width N` — final print width on the garment in inches

### Common options

| Flag                    | Default     | Notes                                          |
|-------------------------|-------------|------------------------------------------------|
| `--print-height N`      | auto aspect | Override preserved aspect if you need to stretch |
| `--garment NAME`        | `black`     | black/white/navy/royal/charcoal/heather/...    |
| `--ink-system NAME`     | `waterbase` | `waterbase` or `discharge`                     |
| `--film-dpi N`          | `720`       | 360 is the floor; 720 is shop standard         |
| `--mode MODE`           | `auto`      | `spot-layered` / `spot-flat` / `sim-process`   |
| `--sheet SIZE`          | `auto`      | force `8.5x11` or `13x19`                      |
| `--no-dot-gain`         | off         | disable inverse-gain warp (rare)               |
| `--mirror`              | off         | emulsion-down output                           |
| `--label-prefix TEXT`   | ""          | shown on each reg-mark label (e.g. job code)   |
| `--max-colors N`        | 8           | ceiling for flat-color auto-detect             |
| `-o, --output-dir DIR`  | `./films`   | where the TIFs go                              |
| `--json`                | off         | also write `driver-output.json`                |

### Examples

```sh
# Layered PSD with named layers — one film per layer
python3 film_driver.py jobs/260417-reno/artwork.psd \
    --print-width 12 --garment black --label-prefix 260417-reno

# Flat PNG, discharge underbase on reactive-dyed black
python3 film_driver.py photo.png --mode sim-process \
    --print-width 11 --garment black --ink-system discharge

# From macOS Print dialog (PDF handed in by the service hook)
python3 film_driver.py /tmp/print.pdf --print-width 10 -o ./films --json
```

## Modes

- **`spot-layered`** — layered PSD/PSB. Each visible layer = one ink.
  Layer name drives ink name & purpose (`underbase`, `highlight`, or color).
- **`spot-flat`** — flat raster/PDF. Auto-detects distinct colors, filters
  out the garment color, assigns angles from the shop's 30°-separation set.
- **`sim-process`** — same as `spot-flat` but with `--max-colors` up to 8,
  ordered by prominence. Suitable for photoreal on dark garments when
  layer-by-layer sep prep is too much work.
- **`auto`** (default) — pick layered if the source has layers, else flat.

## Layer-name conventions

When running `spot-layered`, layer names drive placement and purpose:

| Layer name contains  | Purpose    | Mesh (waterbase) | Halftone? |
|----------------------|------------|------------------|-----------|
| `underbase`, `base`  | underbase  | 156              | solid     |
| `highlight`, `_hi`   | highlight  | 280              | solid     |
| (anything else)      | color      | 230              | yes       |

So a layered PSD with `white_underbase`, `red`, `blue`, `black`, `white_highlight`
gets the full 5-film setup with correct angles and meshes automatically.

## Output

Each film is a single TIF on a full physical sheet:

```
films/
  01_white_underbase_156.tif   — solid, 156 mesh, no halftone
  02_red_230.tif               — halftoned at 22.5° / 55 LPI, 230 mesh
  03_blue_230.tif              — halftoned at 52.5° / 55 LPI, 230 mesh
  04_black_230.tif             — halftoned at 82.5° / 55 LPI, 230 mesh
  05_white_highlight_280.tif   — solid, 280 mesh, no halftone
  driver-output.json           — index (only when --json is passed)
```

TIF spec: grayscale (`L`), uncompressed, 720 DPI metadata, film-positive polarity
(ink = 0, clear = 255). Ready to hand to the printer driver at 100% scale.

## Install

```sh
pip install -r requirements.txt
```

On macOS, the `installable/print-driver/install.sh` script symlinks a
"Film Seps" entry into the Print dialog — see
[../../installable/print-driver/](../../installable/print-driver/).

## When NOT to use this driver

- **Photoreal portraits that need real simulated process** — the flat-color
  auto-detect here is coarse; push through Separo for those jobs.
- **Plastisol work** — this shop doesn't run plastisol. Curves & mesh
  defaults are tuned for waterbase + discharge.
- **Fine multicolor halftones at LPI > 65** — the shop caps mesh at 280,
  which per shop preferences caps LPI at ~65.

## Calibration

The dot-gain LUT in `preferences.py` encodes the shop's current waterbase
behavior. To recalibrate:

1. Print a 0/10/20/…/100% step wedge at your target mesh + LPI
2. Measure each step's printed % with a densitometer (or calibrated scan)
3. Update `DOT_GAIN_WATERBASE` anchors in `preferences.py` so `target→film`
   values produce an on-press linear ramp
