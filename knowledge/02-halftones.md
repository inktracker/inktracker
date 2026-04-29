# 02-Halftones

## Halftones for Screen Printing on Textiles

Halftones are how you fake continuous tone with discrete dots — the only way screen printing can reproduce photos, gradients, and soft shading. This doc is specifically about textile screen printing (not offset litho). Every rule of thumb here accounts for the fact that the substrate is a woven fabric through a stencil on a mesh.

---

## 1. Halftone Fundamentals

### Why halftones exist
Screen printing lays a single solid ink density — there's no "50% red" on-press, there's just red or no red. To fake a midtone, you print a dot pattern small enough that the eye integrates the dots into an average. More ink coverage = darker perceived tone.

### Dot, cell, density
- **Dot**: the printed shape (round, elliptical, square, diamond)
- **Cell**: the grid square each dot lives in
- **Density**: the percentage of the cell filled with ink (0–100%)

### DPI, LPI, cell size
- DPI (film output resolution, dots per inch, e.g. 360 or 720)
- LPI (line screen, lines per inch — how many halftone cells across an inch, e.g. 35–65 for textiles)
- **Cell size (px) = DPI / LPI**
- Gray levels available ≈ cell² + 1

Examples:
- 720 DPI @ 45 LPI → 16 px cell → 257 gray levels (excellent)
- 720 DPI @ 65 LPI → 11 px cell → 122 gray levels (good)
- 360 DPI @ 45 LPI → 8 px cell → 65 gray levels (marginal)
- 360 DPI @ 35 LPI → ~10 px cell → 101 levels (ok)

**Rule**: DPI/LPI ratio should be **≥ 8**, ideally **10–16** for smooth tonal transitions. Below 6 = visible banding.

---

## 2. LPI Selection for Textiles

Textile LPI is much lower than offset (150+ LPI) because mesh, ink, dot gain, and fabric weave all limit what can actually hold on a garment.

### LPI ↔ Mesh relationship
Rule of thumb: **LPI ≤ mesh / 4** (some shops go as low as mesh/5 for safety)

| Mesh | Safe LPI range | Typical use |
|---|---|---|
| 110 | 25–30 | underbase only, no halftones |
| 156 | 35–40 | underbase, bold halftones |
| 200 | 45–50 | mid-tone halftones, athletic numbers |
| 230 | 50–60 | sim-process top colors, photo halftones |
| 305 | 65–75 | fine halftones, highlights, thin lines |
| 355+ | 75–85 | ultra-fine waterbased, very detailed work |

### Fabric-weave upper bound
Even if the mesh allows 65 LPI, the garment's weave (especially cotton jersey) imposes its own pattern. When halftone frequency approaches weave frequency, you get weave-moiré. This is why most textile shops cap at ~55–65 LPI regardless of mesh.

### Practical advice
- **New setup / unknown mesh**: start at 45 LPI on 230 mesh
- **Photoreal on 305 mesh**: 55–65 LPI
- **Bold underbase only**: 35 LPI on 156 mesh
- **Single-color illustration ("mono sim-process")**: 35–45 LPI, 230 mesh is plenty

---

## 3. Dot Shapes

### Round dots
- Simple, universal default
- **Tonal jump at 50%**: round dots merge at 50% coverage creating a visible tonal jump. Midtones look posterized on garments.

### Elliptical dots
- Industry standard for textiles
- Merge gradually (chain-dot formation): no 50% jump
- Minimize dot gain compared to round on textile ink
- Use this whenever possible for gradient work

### Square / diamond
- Square: can print cleanly but look harsh, rarely used
- Diamond/rhombus: good for some fine-detail work, less common

### Rule
**Use elliptical dots for any sim-process or gradient work on textiles.** Only use round for spot halftone or single-color illustration where the tonal jump isn't visible.

---

## 4. Screen Angles

### Why different angles
When you stack halftone screens at the same angle, the dots interfere → moiré. Rotating each color to a different angle breaks the interference.

### Conventional CMYK angles
- Cyan: 15°
- Magenta: 75°
- Yellow: 0°
- Black (K): 45°

30° separation between the three dominant colors (C, M, K); Y at 0° because yellow is visually weakest, moiré there is nearly invisible.

### Sim-process angle sets (Ryonet / ActionSeps defaults, 6-color)
- White underbase: (solid, no halftone)
- Black: 22.5°
- Red: 52.5°
- Yellow: 82.5°  *(or 7.5°)*
- Blue: 7.5°  *(or 82.5°)*
- Green: 37.5°
- Gray: 67.5°
- Highlight white: (solid)

Each halftone color is 30° apart from its neighbors. 22.5° base angle (rather than 0°) keeps the dot grid from aligning with the fabric weave.

### Custom-palette rules
1. Keep **≥ 30° separation** between any two halftone colors
2. **Avoid multiples of 45°** (they align with standard fabric weave)
3. **22.5° is the workhorse for mono/single-color jobs** — far enough from 0°/45°/90° to dodge weave moiré
4. Put the weakest/lightest color (yellow) on the angle most prone to interference — our eyes miss moiré in yellow

---

## 5. Moiré

### Three sources in textile printing
1. **Screen-to-screen** — halftones from two color films interfering with each other. Fix: stagger angles by ≥30°
2. **Screen-to-fabric** — halftone pattern beating with fabric weave. Fix: avoid 0°/45°/90°, stay at 22.5° base; reduce LPI; switch to FM (index)
3. **Halftone-to-halftone** at the same color — e.g. running a 45° screen on a perfectly aligned mesh. Fix: rotate screens ±3° during pin-registration

### Detection
- Visible wavy / plaid / shimmer pattern under normal viewing distance
- Photograph the test print; moiré often shows more on camera sensors than in person (bayer interference)
- Run a full gradient (0–100%) test print; moiré usually shows worst in the 30–70% midtones

### Why angles alone don't fix weave moiré
Fabric weave frequency varies by garment. A given angle might work on 18-singles cotton but beat with a 30-singles ring-spun. Fixes: reduce LPI, switch to elliptical dot (softer merge), or switch to FM (index).

---

## 6. Dot Gain

### What it is
Dots enlarge between film and finished print. A 30% dot on film might print as a 45% dot.

### Sources
- Ink spreading through mesh (biggest factor)
- Squeegee pressure
- Fabric fiber absorption
- Flash-cure softening

### Typical dot gain on plastisol/textile
- 10% dot → 15–20% printed
- 30% dot → 45–55% printed
- 50% dot → 60–70% printed
- 70% dot → ~80% printed
- 85%+ usually "plugs" (fills to 100%)

### Compensation
Professional RIPs (AccuRIP, FilmMaker) apply **dot-gain curves** that hold back the film dot to land at the target printed dot. Typical curve: subtract 5–8% from midtones on film. Your Python engine would benefit from an optional dot-gain curve table per mesh/ink.

### The 3% floor
Dots smaller than 3–5% don't hold on textile — the stencil opens but the ink doesn't transfer cleanly through weave + flash. Highlights below 3% should be treated as 0%.

### The 85% ceiling
Dots larger than 85–90% plug into solid — midtone dots merge into the solid background. Shadows above 85% should be forced to 100%.

---

## 7. AM vs FM Halftones

### AM (Amplitude Modulated, classical halftone)
- Regular grid, dot **size** varies with tone
- Predictable, good registration
- Susceptible to moiré
- Best for well-defined color regions

### FM (Frequency Modulated, stochastic, "index")
- Random dot positions, dot **count** varies with tone — dots are all the same size
- No grid = no moiré
- Handles gradients beautifully on dark garments
- Worse registration tolerance — any misregister is obvious

### When to switch to FM
- Dark garment + smooth gradient = FM wins
- Coarse/loose fabric weave = FM avoids weave moiré
- Short-run premium work where setup time is budgeted

---

## 8. Highlight Hold and Shadow Plug

### Minimum dot size (highlight hold)
- 3–5% on textile — below that, dots fail
- Higher for lower-mesh (5% on 156 mesh)
- Lower for high-mesh fine work (3% on 305 mesh)

### Maximum dot size (shadow plug)
- 85–90% — above that, dots merge to solid
- RIP should force shadow dots ≥85% to 100%

### Linearization
Build a correction curve: print a 0/10/20…/100% step wedge, measure the actual printed densities, and back-compute the inverse curve to apply to all future film output. Most RIPs have this built-in; custom engines should support it.

---

## 9. Practical Recipes

### Recipe: 1-color B&W sim-process on dark
- Mesh: 230
- Film DPI: 720 (acceptable: 360)
- LPI: 35
- Angle: 22.5°
- Dot: round or elliptical
- Highlight/shadow cutoff: 4% / 87%
- Underbase: 156 mesh, solid
- Highlight white (optional): 305 mesh, threshold ≥95% luminance

### Recipe: 6-color sim-process on dark
- Mesh: 156 (underbase), 230 (color screens), 305 (highlight white)
- Film DPI: 720
- LPI: 45–55
- Dot: elliptical
- Angles: black 22.5, red 52.5, yellow 82.5, blue 7.5, green 37.5 (skip yellow or blue if dropping to 5 colors)
- Cutoffs: 4% / 87%

### Recipe: CMYK on white
- Mesh: 305 all (or 230/305 mix)
- Film DPI: 720
- LPI: 55–65
- Dot: elliptical
- Angles: C 15°, M 75°, Y 0°, K 45°
- Cutoffs: 3% / 88%

### Recipe: Index (FM) on dark
- Mesh: 230–305
- Dot: FM stochastic, single-pixel dots at DPI
- No angle needed
- 6–10 spot colors
- Higher mesh works well because dot size ≤ single pixel

---

## 10. Quick-Reference Tables

### LPI by Mesh (textile)
| Mesh | Min LPI | Target LPI | Max LPI |
|---|---|---|---|
| 110 | 20 | 25 | 30 |
| 156 | 30 | 35 | 40 |
| 200 | 40 | 45 | 50 |
| 230 | 45 | 55 | 60 |
| 305 | 55 | 65 | 75 |

### Angle sets by color count (on-dark sim-process)
| # Colors (halftone screens) | Angles |
|---|---|
| 1 (mono) | 22.5° |
| 2 | 22.5°, 52.5° |
| 3 | 22.5°, 52.5°, 82.5° |
| 4 (no yellow) | 22.5°, 52.5°, 82.5°, 7.5° |
| 5 | 22.5°, 52.5°, 82.5°, 7.5°, 37.5° |
| 6 | 22.5°, 52.5°, 82.5°, 7.5°, 37.5°, 67.5° |

### Troubleshooting matrix
| Symptom | Likely cause | Fix |
|---|---|---|
| Visible moiré | Weave or angle | Reduce LPI; shift base angle from 0/45/90; switch to FM |
| Blown highlights | Sub-3% dots failing | Raise highlight cutoff; switch to higher mesh |
| Plugged shadows | >85% dots merging | Force shadow cutoff to 100%; reduce LPI |
| Banding in gradients | DPI/LPI ratio too low | Bump film DPI to 720; drop LPI |
| 50% tonal jump | Round dots | Switch to elliptical |
| Fuzzy dot edges | Low D-max film | See film-output doc, raise D-max; use RIP |

---

## 11. Sources
- Thomas Trimingham articles — https://screenprintingmag.com/author/thomas-trimingham/
- Douglas Grigar halftone writeups — via t-biznetwork.com
- Don Copeland / Ryonet training — https://www.screenprinting.com/
- AccuRIP docs — https://solutionsforscreenprinters.com/
- CADlink FilmMaker docs — https://cadlink.com/
- Wasatch SoftRIP SP — https://wasatch.com/solutions/screen-printing/
- UltraSeps user guides — https://www.ultraseps.com/
