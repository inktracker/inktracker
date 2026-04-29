# Shop Preferences — Biota

Standing preferences that override generic KB defaults. Skills and engine should read this first.

## Ink system
- **Primary**: Water-based inks on cotton
- **Secondary**: Discharge inks on reactive-dyed 100% cotton
- **Never**: Plastisol (out of scope for this shop)

## Implications (default unless overridden)

### Dot gain
- Waterbase dot gain is **~5% at 30% dot** (plastisol would be ~15%)
- Discharge dot gain is **near-zero** (activating dye, not depositing ink)
- Use waterbase/discharge LUT in engine, never plastisol curve

### Mesh counts
**Shop cap: 280 mesh max. Default range 156–230.** Waterbase needs higher mesh than plastisol, but this shop keeps screens in the 156–230 range with 280 as a ceiling.

| Layer | Waterbase mesh | Discharge mesh |
|---|---|---|
| Underbase / base | 156–200 | 156 |
| Mid halftone color | 200–230 | 200–230 |
| Highlight / fine detail | 230–280 | 230 |

### LPI (line screen)
Waterbase tolerates higher LPI than plastisol. With 280-mesh cap:

| Mesh | Waterbase LPI | Plastisol LPI (reference) |
|---|---|---|
| 156 | 30–40 | 25–35 |
| 200 | 40–50 | 30–40 |
| 230 | 45–55 | 35–45 |
| 280 | 55–65 | 45–55 |

### Underbase strategy
- **On black/dark reactive-dyed cotton**: use a **tonal halftoned discharge underbase** as the base. This removes the shirt's dye in a graduated way — ultra-soft hand and real tonal range. No need for a solid plastisol-style white base.
- **On blends / pigment-dyed / synthetics**: discharge won't work → fall back to a **tonal halftoned waterbase white** underbase.
- **Never default to a solid white underbase** for illustration-style sim-process — it's the flat/beginner look.
- Discharge base angle: keep ≥30° off the top-color halftone angle (e.g. discharge 52.5° + black 22.5°).

### Cure
- Waterbase: thorough heat cure (320°F for plastisol-curable waterbase; 300°F for air-dry + heat-set formulations) + dryer belt speed to get ≥60s at temp
- Discharge: activator must be mixed into ink 4–6h before print; cure at 325°F for 60s+; requires high airflow dryer to carry off moisture

## Default halftone parameters
Unless the artwork or user explicitly overrides:
- **Dot shape**: elliptical, 1.4:1 aspect (chain-dot) — never round
- **Base angle**: 22.5° for mono / primary color
- **Multi-screen angle set**: 22.5°, 52.5°, 82.5°, 7.5°, 37.5°, 67.5° (30° separation)
- **Highlight hold**: 3%
- **Shadow plug**: 87%
- **Film DPI**: 720 preferred (360 acceptable for LPI ≤ 45)

## Registration marks
- **Placement**: top-center and bottom-center of the sheet (on the sheet margin, not on the halftone). Never four corners — four corners read as a "box" around the design at low zoom.
- **Mark**: crosshair + small open circle (aids alignment).
- **Label**: next to each mark, ink name and mesh count (e.g. "DISCHARGE UNDERBASE — 156 mesh"). Top and bottom both carry the same label so orientation is unambiguous.
- **Size**: ~0.15" mark, ~0.2" label text, positioned ~0.45" from sheet edge.

## Film page size (sheet size)
Films must be output on a physical printer sheet. Defaults:
- **13×19** — default for all jobs (Epson P800/P900 wide-format)
- **8.5×11** — use only when the design (with 0.5" reg-mark margin each side) fits within **7.5×10 usable area**

Decision: if `max(print_w, print_h) ≤ 10` AND `min(print_w, print_h) ≤ 7.5` → 8.5×11, else → 13×19.

Film canvas = sheet size at film DPI, halftone centered, reg marks on design perimeter.

## Pre-flight checklist (always)
Before running any sep:
1. **Confirm garment color** — drives underbase strategy (dark → discharge or WB white underbase; light → no underbase).
2. **Confirm garment fiber** — 100% reactive-dyed cotton for discharge; blends/poly → waterbase only.
3. **Confirm print size & location** — full front, left chest, back, etc. Width drives the scale.
4. **Find the highest-res source available** — check Downloads / Drive for any `.psd`, `.ai`, `.png` variant of the same name. Source should be ≥ target print size × film DPI (e.g. ≥8640 px wide for a 12"@720DPI print, ideally with ~2× headroom for anti-alias fidelity). If only a low-res source exists, warn the user before running.
5. **Detect content bbox first** — crop to the actual design content before upscaling. Never treat the full PSD/artwork canvas as the print extent — empty canvas margin will render as solid ink.
6. **Aspect preserve** — scale the cropped content to target print width; let height fall where it will.

## Quality ceiling
User has stated "aim for highest quality possible — always." Defaults should lean toward:
- Higher LPI (within mesh/4 rule)
- Higher film DPI (720)
- Tonal halftoned underbase (not solid)
- Proper cutoffs and dot-gain compensation
- Soft-proof preview on every run for visual QC
- Never ship a sep without at least one verification pass

## Fallback quality
When the Python engine can't hit the target (photoreal portraits, subtle skin tones, tough gradients), recommend:
- Separo (cloud, ML-based) for that specific job — acknowledge the engine's ceiling and route to a better tool rather than ship a mediocre sep.

## Folder structure (file system)

Jobs live in Google Drive under:

```
~/My Drive/clients/<Client Name>/Artwork/<Job Title>/
    original.psd (or .ai source)
    films/
    seps/
    mockups/
    job.json
```

Rules:
- Client folder name: **human-readable, Title Case, with spaces** (e.g. "Nevada Muay Thai"). Never slugify.
- Before creating a client folder, **check for an existing one first** (case-insensitive). Reuse it.
- Inside each client folder, keep an `Artwork/` subfolder that holds one subfolder per job.
- Job Title: short, descriptive, Title Case (e.g. "Rolando", "Summer Tee 2026"). Not the slug/code.
- Do NOT create per-customer `~/jobs/` folders — everything lives in Drive.

## Updated
2026-04-18 — Initial standing preference set (waterbase + discharge, no plastisol; Title Case client folders; `Artwork/Job Title/` nesting in Drive).
