// Quote-level "Additional fees" — one-off named charges with a custom amount
// and a taxable flag. Distinct from the per-piece "extras" system (see
// extras.js): these are flat, whole-order charges the shop types into a quote
// (e.g. "Estimated shipping — $25", "Rush — $40").
//
// Storage: quotes.additional_charges jsonb
//   [{ id, label, amount, taxable }]
//
// Math contract (mirrored in QuoteEditorModal save, calcQuoteTotals, the
// customer QuotePayment view, and the PDF export):
//   * taxable charges     → added to the taxed base (tax applies)
//   * non-taxable charges → added to the total AFTER tax
// So: total = (afterDiscount + setup + taxableCharges) * (1+rate) + nonTaxableCharges

/**
 * Normalize a raw additional_charges array into clean rows. Drops fully-empty
 * rows (no label and zero amount) so half-typed editor rows don't persist.
 * @param {*} charges
 * @returns {Array<{id:string,label:string,amount:number,taxable:boolean}>}
 */
export function normalizeAdditionalCharges(charges) {
  if (!Array.isArray(charges)) return [];
  return charges
    .map((c) => ({
      id: c?.id || "",
      label: typeof c?.label === "string" ? c.label : "",
      amount: Number.isFinite(Number(c?.amount)) ? Number(c.amount) : 0,
      taxable: !!c?.taxable,
    }))
    .filter((c) => c.label.trim() !== "" || c.amount !== 0);
}

/**
 * Sum additional charges into taxable / non-taxable buckets.
 * @param {*} charges raw or normalized array
 * @returns {{ taxable:number, nonTaxable:number, total:number, list:Array }}
 */
export function sumAdditionalCharges(charges) {
  const list = normalizeAdditionalCharges(charges);
  let taxable = 0;
  let nonTaxable = 0;
  for (const c of list) {
    if (c.taxable) taxable += c.amount;
    else nonTaxable += c.amount;
  }
  return { taxable, nonTaxable, total: taxable + nonTaxable, list };
}
