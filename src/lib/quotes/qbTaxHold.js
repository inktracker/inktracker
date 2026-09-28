// QuickBooks tax hold — read side (pure).
//
// qbSync createInvoice writes quotes/invoices.qb_tax_hold while a created
// QB invoice is held because QuickBooks computed a materially different
// sales tax (a dollar or more; sub-dollar rounding is adopted
// automatically). The hold used to exist only in the session that hit it,
// plus a bell notification nobody read — so a held quote looked normal on
// every later open and the customer never got sent anything. This is the
// one place the UI reads that state: the quote/invoice modals render a
// blocking banner from it and the quotes list shows a chip.
//
// Shape written by _shared/qbTaxAutoAdopt.js buildTaxHoldState:
//   { quoted_tax, qb_tax, tax_drift, quoted_total, qb_total, missing_tax, held_at }

/**
 * @param {object} row  a quote or invoice row
 * @returns {{ quotedTax:number, qbTax:number, taxDrift:number, quotedTotal:number,
 *             qbTotal:number, missingTax:boolean, heldAt:string|null } | null}
 */
export function qbTaxHoldState(row) {
  const h = row?.qb_tax_hold;
  if (!h || typeof h !== "object") return null;
  const qbTotal = Number(h.qb_total);
  if (!Number.isFinite(qbTotal)) return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    quotedTax:   n(h.quoted_tax),
    qbTax:       n(h.qb_tax),
    taxDrift:    n(h.tax_drift),
    quotedTotal: n(h.quoted_total),
    qbTotal,
    missingTax:  h.missing_tax === true,
    heldAt:      typeof h.held_at === "string" ? h.held_at : null,
  };
}
