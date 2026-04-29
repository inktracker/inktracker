# Shop Knowledge Base

Canonical reference for color separation, halftones, film output, and press practice used by the Python sep engine and the Claude skills in this shop. Skills can read from here at runtime to pick LPI, angles, mesh, print order, etc.

## Contents

| # | File | What's in it |
|---|---|---|
| 01 | [separation-theory.md](./01-separation-theory.md) | Spot vs sim-process vs index vs CMYK vs grayscale. When to pick each. Decision tree. Common mistakes. |
| 02 | [halftones.md](./02-halftones.md) | LPI↔mesh rules, dot shapes, screen angles, moiré, dot gain, highlight/shadow cutoffs, recipes by job type. |
| 03 | [film-output.md](./03-film-output.md) | D-max targets, film DPI, RIP software, printers/inks, film media, post-processing, QC checklist. |
| 04 | [inks-mesh-press.md](./04-inks-mesh-press.md) | Ink chemistry, mesh counts, underbase theory, print order recipes, garments, press setup, cure. |

## How the engine should use this

- At job kickoff, the sep skill should consult 01 to pick the separation method from artwork type.
- Once method is known, 02 + 04 drive LPI, dot shape, angle set, mesh counts, and print order.
- 03 drives film DPI, orientation, reg marks, and post-checks.

## Gotcha highlights (read these, always)

1. **D-max ≥ 3.5 on film** — eye test is not a density test.
2. **DPI/LPI ≥ 8** — below 6 = visible banding.
3. **LPI ≤ mesh/4** — violate this and halftones die on press.
4. **22.5° base angle for mono / weave avoidance** — avoid 0/45/90.
5. **Elliptical dots > round** for gradients (no 50% tonal jump).
6. **Highlight dots fail below 3–5%**, shadow dots plug above 85–90% — force cutoffs in the engine.
7. **Underbase ≠ highlight** — underbase is ~all non-garment pixels, highlight is the brightest ~5–15%.
8. **Always flash between underbase and first wet-on-wet color**, never between CMYK passes.
9. **Polyester film, not acetate** — dimensional stability.
10. **Full-size seps, not the native art size** — scale to print size before halftoning.

## Last updated
2026-04-18
