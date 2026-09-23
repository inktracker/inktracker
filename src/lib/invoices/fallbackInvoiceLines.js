import { getQty } from "@/components/shared/pricing";

// Build QuickBooks invoice lines from raw line items when the primary
// buildQBInvoicePayload can't — QB-pulled rows and order-derived invoices
// whose items lack the sizes/imprints shape it expects. Shared by every
// QB-push fallback (InvoiceDetailModal, SendInvoiceModal, createInvoiceInQB)
// so the three copies can't drift.
//
// Each item's per-line value lives in `lineTotal` (the canonical field for
// these shapes), falling back to `total` / `amount`, and only when NONE of
// those is a real number to the invoice subtotal. Reading total/amount ONLY
// was a money-doubling bug: for `lineTotal`-shaped items every line fell
// through to the invoice total, so each line got stamped with the FULL total.
// (Cold Stream, 2026-09-22: lines 375 and -60 both became 315 → QB $630,
// hand-fixed twice.) Negative discount/credit lines are preserved; only truly
// zero lines are dropped.
export function buildFallbackInvoiceLines(lineItems, invoice) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const fallbackTotal = Number(invoice?.subtotal || invoice?.total || 0);

  if (items.length === 0) {
    return [{
      description: "Invoice",
      qty: 1,
      unitPrice: Number(fallbackTotal.toFixed(2)),
      amount: Number(fallbackTotal.toFixed(2)),
      itemName: "Screen Print",
    }];
  }

  return items
    .map((li) => {
      const qty = getQty(li) || Number(li.qty) || 1;
      const perLine = [li.lineTotal, li.total, li.amount]
        .find((v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)));
      const amount = perLine !== undefined ? Number(perLine) : fallbackTotal;
      return {
        description: [li.brand, li.style, li.garmentColor, li.description].filter(Boolean).join(" ") || "Service",
        qty,
        unitPrice: Number((amount / qty).toFixed(4)),
        amount: Number(amount.toFixed(2)),
        itemName: "Screen Print",
      };
    })
    .filter((l) => Number.isFinite(l.amount) && l.amount !== 0);
}
