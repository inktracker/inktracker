# 03-Film-Output

## Film Positives for Screen Printing — Technical Reference

Film positives are the photographic intermediate between digital separations and an exposed screen. They must meet strict optical and physical standards to burn a reliable stencil.

---

## 1. Print-Ready Film Specifications

### Optical Density (D-max / D-min)
- **D-max**: blackest area of the film. **Need ≥ 3.5**, pro shops target **3.8–4.0**
  - At 3.5, ~0.03% of UV passes; at 4.0, ~0.01%
  - Below 3.0 = fine dots wash out / underexposed stencils
- **D-min**: clearest area. Target **≤ 0.05**. Above 0.1 = UV blocked in clear areas, stencil fails to wash out

### Density red flags
- Inkjet-on-film without a RIP usually hits only 2.5–3.0 D-max
- "Looks dark on a lightbox" = visual test, NOT a density measurement. Human eyes are non-linear
- At D-max 3.0 vs 3.5, UV transmittance differs by **3×** even though film looks only slightly darker

### Physical properties
- Opaque blacks, no striping or mottling
- Sharp dot edges (no feathering, anti-alias artifacts)
- Dot accuracy ±2% on halftones
- Flat substrate — curl >0.2" across 17" causes misregister

---

## 2. Film DPI and DPI/LPI Ratio

### Standard film DPI
- **360 DPI**: older Epson, budget setups. Adequate for 35–45 LPI
- **720 DPI**: SureColor P800/P900 standard. **Industry norm.** Handles up to 65 LPI cleanly
- **1440 DPI**: overkill for screen printing

### Ratio rule
- **DPI / LPI ≥ 6 → acceptable**
- **DPI / LPI = 8–12 → optimal**
- **DPI / LPI < 6 → visible banding**

Examples:
- 720 DPI ÷ 45 LPI = 16 (excellent)
- 720 DPI ÷ 65 LPI = 11 (excellent)
- 360 DPI ÷ 45 LPI = 8 (good)
- 360 DPI ÷ 65 LPI = 5.5 (marginal)

### 600 vs 720 DPI
Stick to 720 on Epson — it divides cleanly by standard textile LPI values (45, 60). 600 DPI requires RIP reconfiguration to avoid aliasing.

---

## 3. RIP Software

A RIP (Raster Image Processor) sits between your sep files and the printer. It halftones, manages ink volume, applies density curves, handles registration marks.

### AccuRIP (Freehand Graphics)
- Versions: Emerald, Ruby, Black Pearl
- Elliptical and round halftone dots
- "Reprocess" — tweak halftone without reprinting
- De-facto shop standard
- Cost: ~$500–$1200 one-time
- Bundled with Epson P800 Screen Print Edition

### CADlink FilmMaker (Fiery FilmMaker) V11
- Variable Dot Halftoning (VDH) — adjusts dot shape by tone value
- Heavy ink-volume controls → max D-max
- Excellent for dense blacks
- Cost: ~$600–$1500

### Wasatch SoftRIP SP
- Rosette screens for moiré prevention
- Calibration utilities with densitometer support
- Subscription: ~$49–69/month or ~$569/year

### Easy Art / SpotOn
- Beginner-friendly, pre-set presets
- $300–600
- Not recommended for high-volume

### No-RIP (printer driver only)
- Default AM halftone at 45°, no density control
- Produces 2.5–3.0 D-max at best
- Usable for rough proofs, not production

---

## 4. Printers and Inksets

### Epson SureColor P800 (Screen Print Edition)
- 17" width, 2880×1440 native DPI
- Pigment UltraChrome HD
- D-max 4.0 with all-black setup + RIP
- ~40 16"×20" films/hour
- **De facto shop standard**

### Epson SureColor P900
- Same specs as P800 with larger media capacity

### Epson SureColor P700
- 17", 6-color instead of 8, slightly lower D-max
- Budget option

### Stylus Pro 4900
- 44" width, older but still excellent
- Used in wide-format shops

### Pigment vs Dye black
- **Pigment black** (UltraChrome HD): default, stable, D-max 3.8–4.0
- **Dye-based black** (Blackmax, All-Black Ink by Freehand): slightly deeper blacks in some cases, needs curve re-tune

### All-black cartridge setup
Fill every cartridge slot with black ink. All printhead nozzles fire simultaneously on any black pixel → max opacity per pass. Typical combos:
- Epson P800 + Chromaline AccuInk all-black + FilmMaker RIP → D-max 4.0+
- Epson 1430 + 6× refillable Dmax dye + AccuRIP → budget production

---

## 5. Film Media

| Media | D-max | Notes |
|---|---|---|
| Pictorico Pro Ultra Premium OHP | 3.8–4.0 | Best for fine halftones; premium price; check coat side |
| Epson Screen Positive Film | 3.8–4.0 | Made for Epson ecosystem, anti-stick back |
| Fixxons Waterproof | 3.7–3.9 | Anti-curl back, excellent dimensional stability |
| Baselayr Waterproof | 3.6–3.8 | Budget-friendly, fast drying |
| Ryonet Waterproof Premium | 3.5–3.7 | Mid-range, USA-made |

### Choosing film
- Highest D-max: Pictorico Ultra or Epson
- Best registration stability: Fixxons / Baselayr (polyester-based)
- Store in sealed bags, 60–75°F, 40–50% RH

### Coat side
Always confirm coat side before loading — wrong side = smudge.

---

## 6. Output Post-Processing

### Layout / nesting
- Multiple seps on one sheet, ≥0.25" white space between
- All same orientation
- Print in OOP (order of print) sequence

### Registration marks
- At least 2 marks, ideally 3–4 forming a triangle or rectangle around the design
- ≥1" from the outermost ink
- Crosshair or bullseye style
- Identical on all seps (RIP replicates)

### Crop marks
- At corners of bounding box, 0.125–0.25" outside the design
- Thin lines (0.5–1pt) extending inward

### Bleed
- 0.5–1.0" beyond crop marks if the design bleeds to garment edge

### Orientation
- **Right-reading (emulsion-up)**: standard for most exposure units
- **Mirrored (emulsion-down)**: required when burning through mesh
- Default: right-reading unless operator specifies

---

## 7. Workflow Issues & Troubleshooting

### Banding
- Cause: clogged printhead nozzles or dry ink
- Prevention: print small test weekly; auto-park enabled; stable humidity (40–60% RH)
- Fix: run nozzle check + cleaning; power-clean if persistent

### Dot gain / over-inking
- Cause: too much ink volume or porous media
- Fix: build RIP dot-gain curve from a 10% step test; reduce total ink limit

### Misregistration from film shrinkage
- Polyester media: 0.1–0.2% shrink/day — negligible if exposed same day
- Acetate media: much worse — don't use
- Expose films within hours of output for critical jobs

### "Looks dark on a lightbox" — not a density test
- D-max 3.0 and 3.5 look nearly identical to the eye, differ by 3× UV transmittance
- **Always** measure with a transmission densitometer or lux meter

---

## 8. Measuring D-max

### Transmission densitometer
- Techkon DENS, X-Rite iOne, Linshang LS117
- $500–$5000 range
- Measure D-max (solid black), D-min (clear), mid-tone (50% dot)

### Lux meter method
- Baseline illuminance I₀ without film; I with film
- OD = -log₁₀(I/I₀)
- $50–200 meter

### Visual sanity check
- Try to read 8pt newsprint through the film
- Can't read at all = D-max likely ≥3.5
- Barely read = ~3.0 (borderline)
- Clearly read = <3.0 (unacceptable)

---

## 9. Emulsion & Stencil Interaction

### Diazo vs Photopolymer
- **Diazo**: excellent resolution for halftones; narrow exposure latitude; shorter shelf life
- **Photopolymer**: good resolution; forgiving exposure; long shelf life

### Emulsion thickness
- **Thin (1.0–1.5 mil)**: best for halftones, fast wash-out
- **Thick (3+ mil)**: overkill for halftone; causes blooming

### Exposure window
- Over: clear areas harden, stencil won't open
- Under: halftone dots wash away
- Sweet spot: critical exposure × 1.0–1.5 (RIP test wedges calibrate this)

---

## 10. Alternatives

### CTS/LTS (Computer-to-Screen)
- Images directly onto emulsion, no film
- No shrinkage, superior registration
- Capital cost $10K–$50K
- Best for high-volume automatic shops

### DTF (Direct-to-Film)
- Garment transfer method, not prepress. Out of scope.

### Vellum
- D-max 1.5–2.0, too low for production
- Proofs only

---

## 11. Printer + RIP + Ink Recipes

### Recipe 1 — Shop standard
Epson P800 Screen Print Edition + AccuRIP Black Pearl + Pictorico Ultra + UltraChrome HD pigment → D-max 3.9–4.0, ~40 films/hr.

### Recipe 2 — Budget
Epson WorkForce + CADlink FilmMaker + Baselayr Waterproof + CMYK cartridges (RIP all-black override) → D-max 3.6–3.8.

### Recipe 3 — All-black max density
Epson P800 + CIS refillable cartridges loaded with Freehand All-Black Dye + FilmMaker V11 → D-max 4.0+.

### Recipe 4 — Wide format
Stylus Pro 4900 (44") + FilmMaker XL + Pictorico rolls + UltraChrome → D-max 3.8–4.0 at large format.

---

## 12. QC Checklist
- [ ] D-max ≥ 3.5 (measured)
- [ ] D-min ≤ 0.05
- [ ] All halftone dots sharp (check with loupe)
- [ ] Registration marks present & accurate
- [ ] Crop marks correct
- [ ] Right-reading orientation
- [ ] No banding / streaks
- [ ] Flat, no curl
- [ ] Layout preserves ≥0.25" spacing
- [ ] Separation sequence labeled
- [ ] All seps from same printer/media batch
- [ ] Film sealed in sleeve until use

---

## Sources
- ScreenPrinting.com film density blog — https://www.screenprinting.com/blogs/news/black-ink-density-for-film-output
- Screen Printing Magazine densitometry — https://screenprintingmag.com/densitometry-your-guide-to-print-quality-2/
- AccuRIP — https://solutionsforscreenprinters.com/accurip-emerald/
- CADlink FilmMaker — https://cadlink.com/
- Wasatch SoftRIP SP — https://wasatch.com/solutions/screen-printing/
- Epson Screen Positive Film — https://epson.com/For-Work/Paper/Pro-Imaging/Screen-Positive-Film/m/S450133
- Pictorico — https://www.bhphotovideo.com/c/product/545009-REG/
- Fixxons — https://www.fixxons.us/
- Baselayr — https://www.screenprinting.com/products/baselayr-waterproof-film
- X-Rite densitometry primer — https://www.xritephoto.com/documents/literature/en/L7-093_Understand_Dens_en.pdf
- Screen Printing Magazine dot gain article — https://screenprintingmag.com/managing-textile-dot-gain/
