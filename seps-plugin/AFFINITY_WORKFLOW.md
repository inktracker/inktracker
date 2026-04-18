# Affinity Workflow — for inktracker-seps

Once Adobe is canceled and Affinity is installed, the only meaningful change in daily work is *how you prep files* so the Python sep engine can read them. The commands themselves (`/new-job`, `/prep-spot`, `/prep-sim-process`, `/make-ticket`) are identical.

This is the only page you need to reference.

## The golden rule

**The sep engine reads layers by name.** Name your color layers exactly how you want them to appear on the films.

Good layer names:

- `white_underbase`
- `navy`
- `red`
- `pantone-186-c`
- `black`
- `white_highlight`

Bad layer names:

- `Layer 1`, `Layer 2`
- `Copy of logo`
- `color swatch final final2`

Lowercase, no spaces (use `_` or `-`), and use the ink color as the base name.

## Workflow for a new spot-color job

1. **Open Affinity Designer** (Canva Studio if using the unified app).
2. **Create a new document** at your artwork size (e.g. 12" × 14" for a front print) at 360 DPI.
3. **Draw each color on its own layer.** Name the layers as above.
4. **File → Export**:
   - Preset: **Photoshop (PSD)**
   - Flatten transparency: **Off**
   - Preserve layers: **On**
   - Save as `original.psd` in the job's `artwork/` folder
5. In Cowork, run `/prep-spot <job-code>`.

That's it. Films land in `films/`.

## Workflow for a sim-process job

1. **Open Affinity Photo** (or Designer → Pixel Persona).
2. **Prepare your photoreal image** at 360 DPI, flattened.
3. **File → Export** as PSD or TIFF.
4. **Save as `original.psd`** in `artwork/`.
5. In Cowork, run `/prep-sim-process <job-code>`.

## Color naming reference

These ink names are recognized by the sim-process engine's palette:

| Layer name | Used for |
|------------|----------|
| `white_underbase` | First layer on dark shirts (printed solid, no halftone) |
| `black` | Shadow / line work |
| `red` | Red channel in sim-process |
| `yellow` | Yellow channel |
| `blue` | Blue channel |
| `green` | Green channel |
| `gray` | Mid-tone channel |
| `white_highlight` | Last layer, sits on top of everything (printed solid) |

For spot-color jobs, any layer name works — just use lowercase with `_` or `-`. The engine will match on substring, so `navy` will find a layer called `Navy` or `pantone_289_c_navy`.

## Things Affinity does a little differently

**Spot colors** — Affinity supports spot swatches, but the PSD export doesn't always preserve the swatch names as layer names. If you have a "Pantone 289 C" swatch, manually rename the layer to `pantone-289-c` or `navy` before exporting.

**Vector vs pixel** — If your art is all vector in Affinity Designer, export at a high enough size that the pixel output still looks clean at 360 DPI when rasterized. A good rule: design at final print size × 5 (so for a 12" wide print, work at 60" wide vector art at 72 DPI — it'll rasterize beautifully).

**Transparency** — If a layer has transparency (opacity < 100%), the engine reads it as reduced ink coverage — usually what you want. If you need a solid ink regardless of layer opacity, flatten that layer before exporting.

**Artboards** — If you use artboards in Affinity, export each one separately as its own PSD. The sep engine operates on one doc at a time.

## When something doesn't match up

The `/prep-spot` output JSON always includes a `warnings` array. If a layer is missing, the warning will name it. Fix the layer name in Affinity, re-export, and re-run the command. No cleanup needed — the engine overwrites previous films cleanly.

## Mockups

For the `/make-ticket` flow, you'll want a mockup of the art on a garment. In Affinity:

1. Open a garment mockup template (Bella+Canvas, Gildan, etc — most blank brands publish free PSD mockups)
2. Paste the art onto the garment layer
3. Export as PDF
4. Save in the job's `mockups/` folder as `mockup-front.pdf`

Or: let `/make-ticket` generate a simple mockup automatically using the built-in garment templates in `seps-plugin/templates/garments/`. (Lower-fidelity but instant.)

## Speed comparison

Approximate wall-clock times on a recent MacBook:

| Job type | Old (Photoshop + ActionSeps) | New (Affinity + Python engine) |
|----------|-----------------------------|-------------------------------|
| 4-color spot | ~45s | ~4s |
| 8-color spot | ~60s | ~7s |
| 8-color sim-process | ~90s | ~45s |

Most of the old time was Photoshop launching and saving. The Python engine has no launch overhead.

## When Python engine isn't enough

Some complex photoreal jobs really benefit from a purpose-built tool like ActionSeps. If you find the Python sim-process output looking muddy on a specific art file:

1. Try `/prep-sim-process` with `colorCount: 10` (adds extra channels for depth)
2. If still not right, send that one job through **Separo** ($99/mo web-based sep service — pay only for the month you need it)
3. Download Separo's output, drop the TIFs into the job's `films/` folder, and continue with `/make-ticket` as normal

Even with an occasional Separo month, the annual cost is a fraction of Adobe.
