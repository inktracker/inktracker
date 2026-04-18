---
name: prep-sim-process
description: "Run simulated-process color separation via the Python sep engine (no Adobe required — works with any layered PSD from Affinity or Photoshop). Generates halftone films for photoreal designs on dark garments. Use for 6-10 color photoreal sim-process work."
---

# /prep-sim-process

Automates simulated-process color separation for photoreal art on dark garments. Runs the Python sep engine (`scripts/engine/sim_process.py`), which handles color quantization, halftone dot generation, and film output — no Adobe required.

## Usage

```
/prep-sim-process <job-code | job-folder-path>
```

## What this skill does

### 1. Locate the job and find artwork

Resolve the job code. Read `job.json`.

Look for art in `{job}/artwork/`. Priority:
1. A flattened high-DPI `.psd` (`original.psd` or any .psd)
2. A flattened high-DPI `.png` or `.tif` (at least 300 DPI, ideally 360+)
3. An `.afdesign`/`.afphoto` — user must export to PSD first (see Affinity note in `/prep-spot`)

Sim-process is typically done on a flattened photoreal image. If the art is a layered illustration, that's usually the wrong input for sim-process — ask the user: **"This looks like layered spot-color art. Did you mean to run `/prep-spot` instead?"**

### 2. Confirm sep parameters

Ask (compactly):

```
Sim-process seps for "260417-reno-running-001"

  Garment color: black  (from job.json)
  Color count:   8      (default)
  Underbase:     yes
  Highlight:     yes

OK to proceed, or adjust any?
```

Save answers back to `job.json.garmentColor`, `job.json.separations`.

### 3. Write engine input and invoke

Write `{job}/seps/sim-process-input.json`:

```json
{
  "jobCode": "260417-reno-running-001",
  "sourceFile": "/Users/joeygrennan/jobs/.../artwork/original.psd",
  "outputDir": "/Users/joeygrennan/jobs/.../films",
  "filmDpi": 360,
  "registrationMarks": true,
  "garmentColor": "black",
  "colorCount": 8,
  "includeUnderbase": true,
  "includeHighlight": true,
  "meshCounts": {"underbase": 156, "top": 230, "highlight": 305}
}
```

Run the engine:

```bash
cd ~/Downloads/inktracker/seps-plugin/scripts/engine
python3 sim_process.py "/Users/joeygrennan/jobs/.../seps/sim-process-input.json"
```

The engine builds a standard sim-process palette (white underbase → black, red, yellow, blue, green, gray → white highlight) based on the garment color and color count, then:
- Projects each pixel onto each ink's color axis to get ink density
- Halftones the color channels at LPI = DPI/8 (e.g. 45 LPI at 360 DPI) with per-color screen angles to avoid moiré
- Underbase and highlight print solid (no halftone)
- Writes grayscale TIFs with reg marks

### 4. Read results and update job.json

Read `sim-process-output.json`. Update `job.json`:

```json
"separations": {
  "type": "sim-process",
  "engine": "python-v0.2",
  "colorCount": 8,
  "garmentColor": "black",
  "filmCount": 8,
  "exportedAt": "2026-04-17T14:20:00-07:00"
}
```

### 5. Report

```
✅ Sim-process seps done — 8 films in ~/jobs/.../films/ (47s)

Print order:
  1. 01_white-underbase_156
  2. 02_black_230
  3. 03_red_230
  ...
  8. 08_white-highlight_305

Next: /make-ticket 260417-reno-running-001
     or: open AccuRIP and point it at the films folder.
```

If any channel came out suspiciously empty (< 1% ink coverage), flag it: **"⚠️ The green channel looks empty — is there actual green in this art?"** Ask if the user wants to drop it and re-run.

### 6. Know when to fall back

The Python sim-process engine is good for ~80% of jobs. For very hard photoreal portraits with subtle tonal gradations, the result may not be as crisp as ActionSeps. If the user says the seps look off:

1. First, offer to re-run with different parameters (more/fewer colors, different mesh)
2. If still not acceptable, recommend **Separo** ($99/mo web) for that one job — upload the art, download the seps, drop them in `films/`. This is much cheaper than going back to Adobe for the occasional tough job.

## Notes

- For photoreal portraits or gradient-heavy art, 360 DPI source is the minimum — the engine warns below that.
- The engine never modifies the source file.
- Sim-process on typical 8-color art takes 30-90 seconds on modern Macs. Halftone generation is the bottleneck.
- Unlike ActionSeps, this engine does not do automatic color reduction — the palette is fixed (white, black, red, yellow, blue, green, gray). For exotic palettes, use `/prep-spot` with manually-named layers.
