# Proposed Upgrades — Skills + Engine

Concrete changes to make the shop flow reflect what the knowledge base says. Grouped by priority.

---

## Priority 1 — Correctness / safety (ship next)

### P1.1 — Engine: expose LPI, angle, dot shape in input JSON
Today `sim_process.py` hard-codes `lpi = dpi // 8` and pulls angles from `SCREEN_ANGLES` dict. There's no way for a skill to override these without monkey-patching. Fix by adding to `EngineInput`:

```json
"lpi": 35,                       // optional, default dpi/8
"dotShape": "elliptical",        // round | elliptical | square | diamond
"angleOverrides": {"black": 22.5, "red": 52.5, ...}
```

Default dot shape should become `elliptical` — round's 50% tonal jump is visible in textile printing.

### P1.2 — Engine: print size + upscale
Artwork at native 1024×1536 will halftone at whatever LPI it's given, but the result is only a ~2.8" × 4.3" print at 360 DPI. Engine should accept:

```json
"printSize": {"widthIn": 12, "heightIn": 18}
```

And upscale the source to `(width_in × film_dpi) × (height_in × film_dpi)` using Lanczos before halftoning. Warn if source resolution is <300 DPI at the target print size.

### P1.3 — Engine: highlight channel semantics
Current behavior: underbase and highlight use identical `extract_ink_density` → identical output. For B&W and sim-process art, highlight should be thresholded to the top X% luminance (default 90% threshold, configurable). Add:

```json
"highlightThreshold": 235,   // 0-255, or "auto"
"highlightChoke": 2          // shrink by N px to avoid bleed
```

### P1.4 — Engine: 3% / 85% cutoffs
After density extraction, force:
- `density < 0.03 * 255` → 0 (highlight hold)
- `density > 0.85 * 255` → 255 (shadow plug prevention)

Add config:
```json
"highlightCutoff": 0.03,
"shadowCutoff": 0.85
```

### P1.5 — Skill: prep-sim-process must ask for specs
Currently it confirms garment color, color count, underbase/highlight — but **not** print size, LPI, angle. Add to the prompt in step 2:

```
Print size (W×H inches)?
LPI (default 45)?
Dot shape (round / elliptical — default elliptical)?
Base angle (default 22.5° for mono, 15°+ for multicolor)?
Film DPI (default 720)?
```

Use the LPI↔mesh safety table (02-halftones) to sanity-check the combo — refuse if LPI > mesh/4.

### P1.6 — Skill: prep-spot same treatment
`prep-spot` currently skips print size and halftone settings. Even spot-color jobs often have halftone fades. Same additions.

---

## Priority 2 — Quality / polish

### P2.1 — Engine: AM vs FM mode
For dark-garment gradient work, FM (index-style) beats AM halftone (no moiré, better on coarse weave). Add:

```json
"halftoneMode": "am",  // "am" | "fm"
"fmDotSizePx": 1
```

### P2.2 — Engine: dot-gain curve support
Most shops need to compensate 5–8% in midtones. Add:

```json
"dotGainCurve": [[0,0],[10,8],[30,22],[50,40],[70,60],[85,80],[100,100]]
```

Optional; apply as a LUT before halftoning.

### P2.3 — Engine: proper elliptical dots
Current engine uses round dots only (`radius = cell_size * 0.5 * ratio`). Add chain-dot elliptical: at each cell, draw an ellipse with axis ratio ~1.4:1 oriented along the screen angle.

### P2.4 — Skill: D-max / RIP awareness
`prep-sim-process` and `prep-spot` should note in their output that TIFs are halftone bitmaps requiring a RIP (AccuRIP, FilmMaker) or all-black ink print setup to hit D-max ≥3.5. Straight inkjet driver = D-max 2.5–3.0 and halftones fail.

### P2.5 — Skill: registration marks verified for multi-film
Today the engine adds reg marks via `_add_reg_marks`. Verify that they're placed at consistent absolute positions across all films (NOT relative to the density map), so they stay registered across sep files that may have different bounding boxes.

---

## Priority 3 — Process / workflow

### P3.1 — Skill: new-job should request print specs up front
Garment color, garment type, print location, print size — these determine the sep path. Today `new-job` only captures customer + description. Add a follow-up block.

### P3.2 — KB-aware defaults in skills
Skills should `Read` the mesh/ink cheat sheet from `04-inks-mesh-press.md` and the LPI table from `02-halftones.md` rather than hard-coding values in the skill prompts.

### P3.3 — Make-ticket: include sep specs
Production ticket should list LPI, angles, dot shape, and print size alongside mesh counts. Currently it lists only ink + mesh.

### P3.4 — Pre-flight checklist in engine output
Engine should emit a QC block:
- Source DPI at target print size
- D-max-required note (≥3.5)
- LPI/mesh safety check result
- Angle-set moiré check
- Highlight/shadow dot % of min/max

### P3.5 — Test-print / soft-proof preview
Engine should render a small sRGB composite of what the seps *should look like* when printed — visual sanity check for the operator before sending to film.

---

## Priority 4 — Future / nice-to-have

- Automated palette reduction for index seps (median-cut on source art)
- Per-ink dot-gain curves measured from real press tests (live feedback loop)
- Integration with AccuRIP for direct film output instead of saving TIFs
- Moiré prediction — warn if angles + LPI + estimated fabric frequency are likely to beat
- Separo API fallback: if the engine's output looks poor (low contrast, blown highlights), offer to resubmit to Separo automatically

---

## Specific corrections to the 260418-nevada-muay-thai-001 run

This current job got the priorities wrong; documenting what was missed so the fixes land:
- ✗ No print-size confirmed (defaulted small)
- ✗ No LPI/angle asked up front (used engine default 45 LPI / 45° — required driver rewrite to honor 35 LPI / 22.5°)
- ✗ Source never upscaled in the stock engine path
- ✗ Highlight channel initially duplicated underbase (fixed in driver)
- ✗ Round dots (50% tonal jump) — should be elliptical
- ✗ No D-max / RIP note delivered
- ✓ Reg marks present
- ✓ Correct mesh counts (156 / 230 / 305)
- ✓ Print order correct (underbase → color → highlight)
