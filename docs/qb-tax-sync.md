# QuickBooks ↔ InkTracker Sales-Tax Sync

**Invariant:** an invoice the customer pays in QuickBooks must reflect what
InkTracker quoted. If the tax differs, InkTracker **holds the invoice** — it does
not mint a payment link and does not email the customer — until a human
reconciles it. This doc explains why the hold happens and exactly how to clear it.

## How tax flows (and why it can diverge)

1. A quote in InkTracker carries a flat `tax_rate` (e.g. 8.265%). InkTracker
   computes `tax = taxable_subtotal × tax_rate`.
2. When you send the quote, InkTracker creates the invoice in QuickBooks. It sends
   **per-line `TAX`/`NON` codes** — never a tax amount. QuickBooks' **Automated
   Sales Tax (AST)** computes the real tax itself from the customer's address,
   nexus, and product taxability.
3. InkTracker reads QB's computed tax back and reconciles it against the quote.

QB's AST is **authoritative** — you cannot force QuickBooks to record an arbitrary
tax amount. So the two agree only when InkTracker's flat `tax_rate` equals the
rate AST derives for that customer. They diverge when:

- the customer is in a **different tax jurisdiction** than the shop's flat rate assumes;
- the shop's flat `tax_rate` is **stale** vs the current jurisdiction rate;
- **taxability differs** — InkTracker marked a line taxable but QB's product/customer
  tax setup says otherwise (or vice-versa);
- the customer's **address or tax-exempt status in QuickBooks is wrong**, so AST
  picks the wrong rate (or $0).

## What the hold looks like

- **Shop notification** (event `qb_tax_mismatch`, severity `alert`):
  *"Invoice on hold — QuickBooks calculated a different sales tax."*
- The **Send** action shows an inline error and does **not** send the customer email.
- In QuickBooks the invoice **exists** (QB had to compute the tax to reveal the
  mismatch) but has **no customer payment link**. It is safe to leave, edit, or
  delete in QB while you reconcile.
- The quote stays in its pre-send status (it is **not** marked `Sent`). Any deposit
  is **not** recorded against the QB invoice yet — that happens on the clean re-sync.

## How to fix it

Work top-down; stop as soon as the numbers agree.

1. **Check the customer in QuickBooks.**
   - Open the customer → confirm the **billing and shipping address** (AST picks the
     rate from the address). A missing/wrong ZIP is the most common cause.
   - Confirm **tax status**: taxable vs. tax-exempt. If they're exempt, the exemption
     belongs on the invoice **lines** (`NON`), not on customer-level `Taxable`
     (that 400s in AST companies).

2. **Match InkTracker's rate to the jurisdiction.**
   - In the quote/invoice, set `tax_rate` to the rate QuickBooks actually computed
     for this customer. The notification states both numbers
     (e.g. *"your quote tax was \$47.09 but QuickBooks computed \$39.10"*); back the
     rate out from QB's tax ÷ taxable subtotal, or read it off the QB invoice.
   - If the customer is **exempt**, set the InkTracker line(s) non-taxable so both
     sides land on $0 tax.

3. **Re-sync.**
   - Hit **Send** again (quote) or the **QB panel → Refresh** (invoice). This takes
     the UPDATE path on the existing QB invoice, recomputes, and reconciles.
   - When the tax matches, InkTracker mints the payment link, records any deposit,
     marks the quote `Sent`, and the customer email goes out.

## What's stored where

| Field | Meaning |
|-------|---------|
| `quotes.tax` / `invoices.tax`, `*.total` | What the **quote billed** (InkTracker's flat rate). |
| `quotes.qb_tax_amount` / `invoices.qb_tax_amount`, `*.qb_total`, `*.qb_subtotal` | What **QuickBooks recorded** (authoritative, written back on every sync). |

When both exist and disagree, **`qb_*` is the source of truth** — it's what the
customer actually pays. The hold exists so they never disagree on a *sent* invoice.

## Code map

- **Detection / hold:** `supabase/functions/qbSync/index.ts` — `createInvoice`
  computes `taxBlocked = reconciliation.taxMismatch`, skips the payment-link mint and
  deposit recording, doesn't advance status, and returns `taxBlocked` + `taxBlockDetail`.
- **Reconcile math (discount-aware):** `supabase/functions/_shared/qbWriteContracts.js`
  — `reconcileQbInvoice` compares sent line amounts + expected tax against QB's
  `Line[]` and `TxnTaxDetail.TotalTax`. `taxMismatch` = lines faithful but total
  diverges > $0.01; `missingTax` = quote expected tax but QB recorded ~$0.
- **Notification copy:** `supabase/functions/_shared/shopNotifications.js` —
  `buildQbDriftNotification`.
- **Frontend hold guards:** `SendQuoteModal.jsx`, `SendInvoiceModal.jsx`,
  `InvoiceDetailModal.jsx` — all check `data.taxBlocked` and refuse to send.

## Tuning the tolerance

The match tolerance is `$0.01` (`DEFAULT_TOLERANCE` in `qbWriteContracts.js`) — tight
enough to catch any real rate difference, loose enough to ignore 4-decimal rounding.
Raise it only with a documented reason; a held invoice is always preferable to a
silently mis-taxed one.
