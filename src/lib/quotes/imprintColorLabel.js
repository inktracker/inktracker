// The `pantones` field on an imprint stores the colors the customer specified,
// but what those colors ARE depends on the decoration technique:
//   • Embroidery  → THREAD colors
//   • everything else (Screen Print, DTF, …) → INK colors
// Same underlying field; only the label differs. This lived inline in the
// LineItemEditor (correct) but every downstream surface — the saved-quote
// detail modal, the PDF, the customer email — hardcoded "Ink Colors", so an
// embroidery quote showed "Thread Colors" while editing and reverted to
// "Ink Colors" everywhere after. One helper so the label can't drift again.

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
