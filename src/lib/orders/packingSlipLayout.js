// Packing-slip layout: page sizes + the pure data model both renderers draw.
//
// Two sizes, because one page shape can't serve both jobs (Joe, 2026-08-17:
// the full-page slip "looks a bit silly... way too big for a packing slip at
// 4x6"):
//
//   letter — 8.5 × 11, the paperwork copy that goes in the box or the file.
//   4x6    — thermal/label stock, the copy that gets slapped on the carton.
//            Same information, ruthlessly condensed: no logo, no notes block,
//            tighter leading, sizes inline.
//
// Everything here is pure so the fit math is testable without a browser or a
// PDF engine — the renderers only turn this model into ink.

export const SLIP_SIZES = {
  letter: {
    id: "letter",
    label: '8.5" × 11"',
    hint: "Paperwork copy — full header, logo, notes",
    // jsPDF format string + orientation
    format: "letter",
    orientation: "portrait",
    margin: 15,
    showLogo: true,
    showNotes: true,
    // Font sizes / leading (mm) for the full-page layout
    font: { title: 10, sub: 8, sizes: 8.5, total: 11 },
    lead: { title: 4.5, sub: 4, sizes: 6.5 },
  },
  "4x6": {
    id: "4x6",
    label: '4" × 6" label',
    hint: "Carton label — condensed, no logo",
    // 4 × 6 inches in mm; jsPDF takes [width, height] with unit mm.
    format: [101.6, 152.4],
    orientation: "portrait",
    margin: 5,
    showLogo: false,
    showNotes: false,
    font: { title: 8, sub: 6.5, sizes: 7, total: 9 },
    lead: { title: 3.4, sub: 3, sizes: 4.6 },
  },
};

export function slipSize(id) {
  return SLIP_SIZES[id] || SLIP_SIZES.letter;
}

/**
 * Normalize an order + the operator's confirmed counts into the rows a slip
 * prints. Mirrors the existing full-page logic exactly: union of ordered
 * sizes and any size the packer added, zero-qty rows dropped, line total =
 * sum of what actually ships.
 */
export function buildSlipLines(order, finalQuantities) {
  const lines = [];
  (order?.line_items || []).forEach((li, idx) => {
    const confirmed = finalQuantities?.[idx];
    const orderedSizes = li.sizes || {};
    const sizeKeys = [...new Set([...Object.keys(orderedSizes), ...Object.keys(confirmed || {})])];
    const sizes = sizeKeys
      .map((s) => ({
        size: s,
        qty: confirmed ? (parseInt(confirmed[s], 10) || 0) : (parseInt(orderedSizes[s], 10) || 0),
      }))
      .filter((r) => r.qty > 0);
    if (sizes.length === 0) return;
    const title = [li.style, li.garmentColor || li.color].filter(Boolean).join(" — ") || "Item";
    const sub = li.productName || li.description || li.garmentName || "";
    lines.push({
      title,
      sub: sub && sub !== title ? sub : "",
      sizes,
      total: sizes.reduce((sum, r) => sum + r.qty, 0),
    });
  });
  return lines;
}

export function slipGrandTotal(lines) {
  return (lines || []).reduce((sum, l) => sum + l.total, 0);
}

/**
 * Height (mm) one line will consume in a given size config. Used to decide
 * page breaks before drawing, so a line never straddles two labels.
 */
export function lineHeight(line, cfg) {
  const { lead } = cfg;
  return lead.title + (line.sub ? lead.sub : 0) + lead.sizes;
}

/**
 * Split lines into pages that fit `usableHeight` (mm of body area after the
 * header and before the total block). Pure — this is the piece that actually
 * decides whether a 4×6 label reads well or overflows.
 */
export function paginateSlipLines(lines, cfg, usableHeight) {
  const pages = [];
  let current = [];
  let used = 0;
  for (const line of lines) {
    const h = lineHeight(line, cfg);
    if (current.length > 0 && used + h > usableHeight) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += h;
  }
  if (current.length > 0 || pages.length === 0) pages.push(current);
  return pages;
}
