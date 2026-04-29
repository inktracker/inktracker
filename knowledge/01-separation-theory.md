# 01-Separation-Theory

## Screen Printing Color Separation: A Comprehensive Reference

Color separation is the foundation of professional screen printing. It divides full-color artwork into individual layers — each printed as a separate screen — to build complex images on garments. This document covers the separation methods used by professional print shops, when to deploy each approach, quality tradeoffs, cost implications, and the decision framework printers use to choose the right method for every job.

---

## 1. Spot Color Separations

### What It Is
Spot color separation divides flat vector artwork (logos, text, solid-color graphics) into individual layers, one per color, without halftones or gradients. Each screen prints a single, opaque ink color directly onto the garment.

### When to Use
- Vector art: logos, wordmarks, geometric designs with clean edges
- Flat, solid-color designs: no gradients or photoreal imagery
- Limited palette: 1–5 colors (sometimes up to 8 for complex logos)
- Cost-sensitive work: minimal setup, fast production
- Bright, bold graphics: where color accuracy and vibrancy matter
- Single-color on light garments: minimal complexity

### Strengths
- Simplest to execute — one screen per color, straightforward registration
- Vibrant color — opaque inks deliver saturated, punchy colors
- Fast turnaround — minimal prepress complexity
- Low setup cost — no halftone generation, no color modeling
- Consistent results — less dependent on press operator skill
- Best hand feel — thin ink coverage, softer garment touch

### Limitations
- No gradients or tones
- Color count ceiling: typically 4–6 colors max for practical cost
- No photoreal imagery
- Registration critical: misalignment visible on solid color
- Limited detail: cannot render fine lines or small type without loss

### Underbase and Highlight on Dark Garments
When printing spot colors on dark garments, a white underbase prevents the dark fabric from absorbing or shifting ink color.
- **Underbase**: Solid white layer (often 156 or 230 mesh), flash-cured, creates opaque surface
- **Color layers**: Printed wet-on-wet atop the underbase
- **Highlight**: Final pass of white or opaque highlight ink to brighten specific areas

Gotcha: too thick an underbase kills hand feel and dulls colors. Aim for thin, even coverage.

### Typical Maximum Colors
- Light garments: 4–6 colors
- Dark garments: 4–8 colors (with underbase + possible highlight)
- Most common: 3–4 colors for logos and text

---

## 2. Simulated Process (Sim-Process)

### What It Is
Simulated process is a hybrid approach that uses spot-color halftone screens (not true CMYK) to render photoreal images. Instead of four transparent process inks, it deploys 6–10 spot-color halftone screens: typically white underbase + 5–8 opaque spot colors (black, cyan, magenta, yellow, red, green, gray) + optional highlight white.

### How It Works
1. Image analysis: software identifies dominant color regions and tonal ranges
2. Channel extraction: each color is extracted as a separate channel
3. Halftone generation: each channel is converted to a halftone pattern
4. Palette assignment: colors are mapped to a standard spot-ink palette
5. Underbase first on dark garments, flash-cured, then halftone colors applied
6. Highlight white optional final pass for pop

### Standard Palette
- White underbase (dark garments)
- Black (shadows, dark tones)
- Cyan (light blues, cool tones)
- Magenta (pinks, purples)
- Yellow (warm tones)
- Red (reds, oranges)
- Green (pure greens)
- Gray (optional, mid-tone control)
- Highlight white (optional final)

### Typical Color Counts
- **6-color**: white underbase + black, cyan, magenta, yellow, red — good for moderate detail
- **8-color**: adds green and highlight white — pro standard
- **10-color**: adds gray or secondaries for skin tones — premium detail

### When Sim-Process Beats CMYK
| Factor | Sim-Process | CMYK |
|---|---|---|
| Dark garments | Excellent (opaque ink) | Poor (transparent) |
| Hand feel | Better (thinner) | Heavier (thick white base) |
| Color gamut | Wider | Narrower |
| Press stability | Easier | Harder |

### Quality Tradeoffs vs Separo / ActionSeps / UltraSeps
- **Separo** (cloud + ML): smart extraction, consistent, subscription-only
- **ActionSeps** (PS plugin): integrated, manual control, steep curve, requires Photoshop
- **UltraSeps** (standalone): 8 modes, fast, less fine control

---

## 3. Index Separations (Stochastic / Diffusion Dither)

### What It Is
Converts artwork into stochastic (random-dot) raster using uniform-sized square dots placed closer or farther apart to simulate tone. No halftone grid.

### Pros
- No moiré — random pattern eliminates grid interference
- Works on any garment color
- Fine detail preservation for subtle gradients
- Gamma-independent output

### Cons
- Minimum 6–10 colors needed (fewer = posterized)
- Visible dot pattern up close
- Less forgiving of registration error
- Premium setup cost

### When Index Wins
- Gradient-heavy designs
- Very fine detail in photos
- Dark garments with photorealism
- Short-run specialty

---

## 4. CMYK Process Printing

### What It Is
Four transparent spot inks (Cyan, Magenta, Yellow, Black) applied wet-on-wet. No underbase. Inks overlap and optically mix.

### When It's Right
- White or light shirts
- Short-run photo work
- Budget-friendly photoreal on light fabrics

### Why It Struggles on Dark
- Transparent inks require heavy white base → stiff plasticky hand
- Flash-cure between underbase and CMYK breaks wet-on-wet blending
- Limited gamut vs opaque sim-process

### Variants
| Approach | Colors | Hand Feel |
|---|---|---|
| 4-Color CMYK | C/M/Y/K | Good |
| CMYK + White Underbase | 5 | Heavy |
| CMYK + White + Highlight White | 6 | Better |

---

## 5. Grayscale / Monochrome Sim-Process

### What It Is
Single color (usually halftoned black) over white underbase on dark garments, or black on white. Halftone dots of varying sizes simulate tones.

### Grey ink vs Halftoned Black
- **Grey ink**: solid grey over white base; washed look; requires grey ink inventory
- **Halftoned black**: finely halftoned black dots; crisper; standard black ink; lower cost

Most shops use halftoned black for superior detail and lower cost.

### Technical
- Mesh: 230–305
- Underbase: white plastisol flashed on dark garments
- Better hand feel than 4-color on darks

---

## 6. Color Count Cost/Quality

### Per-Screen Costs
- Screen prep: $20–50
- Ink: $5–15 per 100 shirts
- Press time: 5–15 sec per extra color per shirt
- Labor: registration, flash, cleanup

### Diminishing Returns
| Colors | Setup | Quality | Notes |
|---|---|---|---|
| 1–2 | Low | Excellent | Sharp |
| 3–4 | Low-Med | Excellent | Most common |
| 5–6 | Medium | Very Good | Pro standard |
| 7–8 | Med-High | Excellent | Best quality |
| 9–10 | High | Excellent | Diminishing ROI |
| 11+ | Very High | Marginal | Rarely worth it |

**Key insight**: wise color choices beat high color counts. Halftones > more colors.

---

## 7. Decision Tree

### Step 1 — Artwork type
- Vector flat → Spot color path
- Photoreal / gradient → Sim-process or index

### Step 2A — Spot color
- 1–3 colors → Spot
- 4–6 → Spot (still economical)
- 7–8 → Consider sim-process
- 9+ → Sim-process or index

### Step 2B — Photoreal/Gradient
- White/light shirt → CMYK (budget) or sim-process (quality)
- Dark shirt → Sim-process (opaque) or index (stochastic)
- Gradient-heavy → Index preferred
- B&W photo → Grayscale/mono sim-process

### Step 3 — Budget
- Small run, low budget → CMYK on light, grayscale on dark
- Medium run → Spot 1–4 or 6–8 sim-process
- Large run, quality-first → 6–8 sim-process or index
- Premium → 8–10 sim-process, index with detailed gradients

---

## 8. Gotchas & Common Mistakes

1. **Confusing sim-process with spot color** — sim-process is halftone-based; close up, you see dots
2. **No flash-cure between underbase and CMYK** — causes muddy colors; always flash
3. **Over-thick underbase** — thick plasticky feel, dulls colors. Thin + even is better
4. **Ignoring registration tolerance** — use choke/spread for multi-color
5. **Index with too few colors** — posterized look; need 6–10
6. **Halftone moiré on coarse fabric** — use index or reduce LPI
7. **CMYK on dark garments** — always fails; use sim-process
8. **Mismatched mesh counts** — underbase coarse (156), detail fine (230–305)
9. **No trapping between adjacent colors** — 1/16" gap appears; always trap

---

## 9. Sources
- Color-Separation.com — https://color-separation.com/
- ScreenPrinting.com blog — https://www.screenprinting.com/
- Screen Printing Magazine — https://screenprintingmag.com/
- Separo — https://separo.io/
- ActionSeps — https://actionseps.com/
- UltraSeps — https://www.ultraseps.com/
- Freehand Graphics — https://solutionsforscreenprinters.com/color-separation/
- Printavo blog — https://www.printavo.com/blog/
- Thomas Trimingham articles (Screen Printing magazine)
- Scott Fresener / T-Biz Network — https://t-biznetwork.com/
