---
name: prep-spot
description: "Run spot-color separation on a job's artwork. Accepts layered PSDs (from Affinity) or flat PNG/JPG files — auto-detects colors in flat art. Exports film-ready TIFs labeled with ink name and mesh count. Use for logos, text, and solid-color designs up to 8 colors."
---

# /prep-spot

Automates spot-color separation for simpler jobs — logos, text, solid shapes — with up to 8 discrete ink colors. Accepts two input types:

- **Layered PSD** (exported from Affinity) — each color already on its own named layer
- **Flat PNG, JPG, or TIFF** — colors detected automatically, user confirms names

## Usage

```
/prep-spot <job-code | job-folder-path>
```

Examples:
- `/prep-spot 260417-reno-running-001`
- `/prep-spot ~/jobs/midtown-brewery/260417-midtown-brewery-002`

## What this skill does

### 1. Locate the job and find artwork

Resolve the job code to a folder (search under `config.jobsRoot`). Read `job.json`.

Look for art in `{job}/artwork/`. Priority:
1. `prepared.psd` in `{job}/seps/` (already prepped — skip to step 3)
2. `original.psd` in `artwork/` (Affinity layered export)
3. Any `.psd` in `artwork/`
4. `original.png` / `original.jpg` / any flat raster in `artwork/` → flat-image flow (step 2b)
5. `original.afdesign` or `.afphoto` — these need to be exported first (see Affinity note)

If only an `.afdesign` file is present, stop and ask the user: **"I need a PSD or PNG. In Affinity, either export as PSD with layers, or just copy a PNG into the artwork folder. Then run this again."**

### 2a. For layered PSDs: detect or confirm colors from layers

Open the PSD and list the visible top-level layer names:

```
Found 4 color layers in the art:
  1. white_underbase
  2. navy
  3. red
  4. black

Confirm these are your print colors? (yes / rename / reorder)
```

### 2b. For flat images: auto-detect colors

Run the detection utility:

```bash
cd ~/Downloads/inktracker/seps-plugin/scripts/engine
python3 detect_colors.py "<path-to-png>" 8
```

Parse the JSON output. Each color has an RGB value, pixel count, fraction of image, and a suggested name. Present them to the user:

```
Found 4 distinct colors in the art:
  1. white          (RGB 255,255,255) — 42% of image — suggested: underbase layer
  2. navy blue      (RGB  30,50,120)  — 28% of image
  3. red            (RGB 200,40,40)   — 18% of image
  4. black          (RGB  15,15,15)   —  8% of image

Name these (or confirm)? 1=white_underbase, 2=navy, 3=red, 4=black
```

Offer to:
- Rename any color (e.g., "2 is actually Pantone 289 C, call it pantone-289-c")
- Drop tiny colors that are probably artifacts (e.g., anti-aliasing)
- Add an underbase if not detected (ask: "Shirt color? If dark, I'll add a white underbase as color 1")
- Add a highlight white at the end for pop (ask: "Add a white highlight layer on top?")

### 3. Ask for mesh counts and ink calls

Default mesh counts from `config.json`. Let the user override per color. Ask for specific ink calls for non-standard colors ("Pantone 289 C", "Athletic Gold").

Print order defaults: `white_underbase` first → darkest to lightest → `white_highlight` last.

### 4. Write engine input and invoke

**For layered PSDs**, write `{job}/seps/spot-sep-input.json` without `rgb`:

```json
{
  "jobCode": "260417-reno-running-001",
  "sourceFile": "/abs/path/to/original.psd",
  "outputDir": "/abs/path/to/films",
  "filmDpi": 360,
  "registrationMarks": true,
  "colors": [
    { "index": 1, "name": "white_underbase", "ink": "white", "meshCount": 156, "purpose": "underbase" },
    { "index": 2, "name": "navy", "ink": "Pantone 289 C", "meshCount": 230 }
  ]
}
```

**For flat images**, include `rgb` from detect_colors output:

```json
{
  "jobCode": "260417-reno-running-001",
  "sourceFile": "/abs/path/to/original.png",
  "outputDir": "/abs/path/to/films",
  "filmDpi": 360,
  "registrationMarks": true,
  "colors": [
    { "index": 1, "name": "white_underbase", "ink": "white", "meshCount": 156, "rgb": [255,255,255], "purpose": "underbase" },
    { "index": 2, "name": "navy", "ink": "Pantone 289 C", "meshCount": 230, "rgb": [30,50,120], "tolerance": 40 }
  ]
}
```

The `tolerance` field controls how strict the color matching is (default 40 — higher catches more pixels, lower is stricter). For tightly-drawn vector art, 25-35 is good. For photo-ish art with gradients or anti-aliasing, 40-55.

Run the engine via Bash:

```bash
cd ~/Downloads/inktracker/seps-plugin/scripts/engine
python3 spot_sep.py "/abs/path/to/spot-sep-input.json"
```

If `python3 --version` < 3.10 or deps are missing, the engine prints an install hint. First run requires:

```bash
python3 -m pip install -r ~/Downloads/inktracker/seps-plugin/scripts/engine/requirements.txt
```

### 5. Read results and update job.json

Read `{job}/seps/spot-sep-output.json`. Update `job.json`:

```json
"separations": {
  "type": "spot",
  "sourceType": "layered" | "flat",
  "engine": "python-v0.2",
  "colors": [...],
  "filmCount": 5,
  "exportedAt": "2026-04-17T11:04:22-07:00"
}
```

### 6. Report and suggest next step

```
✅ Spot seps done — 5 films in films/  (4.2s)

Print order:
  1. white_underbase @ 156
  2. navy (Pantone 289 C) @ 230
  3. red (Pantone 032 C) @ 230
  4. black @ 230
  5. white_highlight @ 305

Next: /make-ticket 260417-reno-running-001
```

## Error handling

- **Engine missing deps** — surface the pip install command directly.
- **Layer name mismatch (layered PSDs)** — any layer the engine couldn't find shows up in `warnings`. Suggest renaming in Affinity.
- **Color match too broad/narrow (flat images)** — if a film has too much or too little ink, offer to re-run with a different tolerance.
- **More than 8 colors detected** — ask the user to drop minor colors or consider `/prep-sim-process` instead.
- **Low-res source** — engine warns below 300 DPI. Ask if the user wants to proceed anyway or find a higher-res version.

## Notes

- The Python engine is ~10-20× faster than the old Photoshop+ActionSeps flow (no application launch overhead).
- Flat-image color matching uses Euclidean RGB distance with optional feather — works well for flat logo art and vector exports. For photo-quality art, use `/prep-sim-process` instead.
- The skill never writes into the original artwork folder. All output goes to `films/` and engine intermediate files live in `seps/`.
