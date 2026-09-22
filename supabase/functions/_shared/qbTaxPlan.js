// Pure logic for the per-shop "self" QuickBooks tax mode — extracted from
// qbSync so it's unit-testable in isolation (the edge handler only does I/O:
// reading the shop's QB tax capability, then applying this plan).
//
// Two ways a "self"-mode shop's tax lands in QuickBooks:
//   • PROPER — the shop's QB has sales tax ON and a matching rate: reference
//     that manual tax code (TxnTaxCodeRef) so QB records our rate.
//   • LINE  — the shop's QB can't record tax (free/basic tier, sales tax off,
//     or no matching rate): push the exact tax as a NON line so the invoice
//     TOTAL still matches, with every sales line forced NON.
// "qb" mode (and non-self) short-circuits to { mode: "none" } — unchanged AST.

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Decide how to record a self-mode shop's tax.
 * @param {object} a
 * @param {string} a.taxMode          "self" | "qb" | undefined
 * @param {number} a.taxPercent       the quote's tax rate (%)
 * @param {boolean} a.isTaxExempt     customer is tax-exempt in QB
 * @param {boolean} a.usingSalesTax   company has sales tax turned ON
 * @param {string|null} a.matchingTaxCode  a QB tax code id matching the rate, or null
 * @param {number} a.taxAmount        the exact tax to bill (for the LINE path)
 * @returns {{mode:'proper'|'line'|'none', taxCode?:string, lineAmount?:number}}
 */
export function planSelfTax({ taxMode, taxPercent, isTaxExempt, usingSalesTax, matchingTaxCode, taxAmount } = {}) {
  const rate = Number(taxPercent) || 0;
  const isSelf = taxMode === "self" && rate > 0 && !isTaxExempt;
  if (!isSelf) return { mode: "none" };

  // Proper tracked tax ONLY when the company can actually record it (sales tax
  // on) AND a matching rate exists. A matching code with sales tax OFF is
  // useless — QB discards the tax — so that falls through to the line.
  if (usingSalesTax && matchingTaxCode) {
    return { mode: "proper", taxCode: String(matchingTaxCode) };
  }
  return { mode: "line", lineAmount: Math.max(0, round2(taxAmount)) };
}

/**
 * Build the QB "Sales Tax" line for the LINE path. Returns null when there's
 * nothing to bill or no item to hang it on (QB requires an ItemRef).
 */
export function buildTaxLine({ itemRef, amount, ratePct } = {}) {
  const amt = Math.max(0, round2(amount));
  if (!(amt > 0) || !itemRef) return null;
  return {
    DetailType: "SalesItemLineDetail",
    Amount: amt,
    Description: `Sales Tax (${Number(ratePct) || 0}%)`,
    SalesItemLineDetail: {
      ItemRef: itemRef,
      Qty: 1,
      UnitPrice: amt,
      TaxCodeRef: { value: "NON" },
    },
  };
}

// Anchored on the dated prefix so a real shop note that merely mentions
// QuickBooks or an edit survives. Keep in sync with the client stripSyncNotes
// (src/lib/invoices/qbModifiedSync.js).
const SYNC_NOTE = /^\[\d{4}-\d{2}-\d{2}\] Synced from QuickBooks:/;
const ORDER_EDIT_NOTE = /^\[\d{4}-\d{2}-\d{2}\] Updated from order edit:/;

/**
 * Strip INTERNAL audit lines (QB-sync + order-edit "total $X → $Y") from notes
 * before they become the customer-visible QB CustomerMemo. Returns "" when
 * nothing but audit lines remain.
 */
export function stripInternalNotes(notes) {
  if (typeof notes !== "string" || !notes) return "";
  return notes
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !SYNC_NOTE.test(t) && !ORDER_EDIT_NOTE.test(t);
    })
    .join("\n")
    .trim();
}
