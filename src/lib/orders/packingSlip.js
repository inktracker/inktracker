// Pure helpers for the packing-slip flow (PackingSlipModal +
// exportPackingSlipToPDF). Kept out of the component so the count math —
// the part that decides what the customer is told shipped — is unit-tested
// without mounting React or jsPDF.

/**
 * Initial per-line, per-size ship counts for the confirm-quantities modal:
 * ordered qty minus recorded misprints (`li._shortfall`), floored at 0.
 * Keyed by line-item INDEX (older orders' line items may lack ids).
 *
 * @param {object} order  Order with line_items[].sizes / ._shortfall
 * @returns {Record<number, Record<string, number>>}
 */
export function initialSlipQuantities(order) {
  const out = {};
  (order?.line_items || []).forEach((li, idx) => {
    const sizes = li.sizes || {};
    const short = li._shortfall || {};
    out[idx] = {};
    for (const s of Object.keys(sizes)) {
      const ordered = parseInt(sizes[s], 10) || 0;
      const missed = parseInt(short[s], 10) || 0;
      out[idx][s] = Math.max(0, ordered - missed);
    }
  });
  return out;
}

/** Sum every size across every line of a quantities map. */
export function totalSlipUnits(quantities) {
  return Object.values(quantities || {}).reduce(
    (sum, sizes) =>
      sum + Object.values(sizes || {}).reduce((a, b) => a + (parseInt(b, 10) || 0), 0),
    0,
  );
}
