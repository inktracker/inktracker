// Display labels for a quote imprint. The imprint's raw fields mean different
// things depending on the decoration technique, and getting the label wrong is
// how an embroidery quote ends up showing "Ink Colors" or "2 colors" (where 2
// is actually a stitch-tier index, not a color count). One module so every
// surface — editor, saved-quote preview, PDF, customer page — agrees.
//
//   imp.technique === "Embroidery":
//     imp.pantones → THREAD colors
//     imp.colors   → 1-based index into the shop's stitch tiers (NOT a count)
//   otherwise (Screen Print, DTF, …):
//     imp.pantones → INK colors
//     imp.colors   → number of ink colors

// Mirrors DEFAULT_EMB_STITCH_TIERS in components/shared/pricing.jsx. Used as
// the fallback when a surface has no shop pricing config (e.g. the
// customer-facing QuotePayment page, which never receives pricing_config).
export const DEFAULT_STITCH_TIERS = ["Under 5K", "5K-10K", "10K-15K", "15K+"];

export function isEmbroideryImprint(imp) {
  return imp?.technique === "Embroidery";
}

/**
 * Display label for an imprint's color list, e.g. "Thread Colors" or
 * "Ink Colors". No trailing colon — callers add their own punctuation.
 */
export function imprintColorLabel(imp) {
  return isEmbroideryImprint(imp) ? "Thread Colors" : "Ink Colors";
}

/**
 * The stitch-tier label for an embroidery imprint. `imp.colors` is a 1-based
 * index into the shop's configured stitch tiers; falls back to the defaults
 * and clamps out-of-range indices to the nearest tier (matching the pricing
 * engine's getEmbroideryPPP behavior).
 */
export function stitchTierLabel(imp, stitchTiers) {
  const tiers = Array.isArray(stitchTiers) && stitchTiers.length ? stitchTiers : DEFAULT_STITCH_TIERS;
  const idx = Math.min(Math.max((Number(imp?.colors) || 1) - 1, 0), tiers.length - 1);
  return tiers[idx];
}

/**
 * Technique-correct count descriptor for an imprint's decoration:
 *   Embroidery → "5K-10K stitches"   (the stitch tier, never a color count)
 *   otherwise  → "3 colors" / "1 color"
 * Returns "" when there's nothing meaningful to show.
 */
export function imprintCountText(imp, stitchTiers) {
  if (isEmbroideryImprint(imp)) {
    return `${stitchTierLabel(imp, stitchTiers)} stitches`;
  }
  const n = Number(imp?.colors) || 0;
  if (n <= 0) return "";
  return `${n} color${n === 1 ? "" : "s"}`;
}
