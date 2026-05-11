// Pure helpers for QuickBooks invoice + customer payload construction.
// All functions here are pure — no I/O, no side effects, no globals.
//
// The Deno edge functions (qbSync, qbWebhook) import from this file so
// the Vitest suite at __tests__/qbInvoice.test.js is the canonical
// behavior contract. Drift in the edge function = test failure.

// ── DocNumber selection ─────────────────────────────────────────────────────
// QB rejects duplicate DocNumber on Invoice creation. When we re-sync a
// quote that already has an invoice in QB, we either UPDATE the existing
// one (preferred — qb_invoice_id known) or CREATE with a versioned number.
//
//   Q-2026-115        ← first sync
//   Q-2026-115-r2     ← second sync if base is taken
//   Q-2026-115-r3
//   …up to r99, then a base36 timestamp suffix as last resort.
export function nextAvailableDocNumber(base, takenList) {
  const taken = new Set((Array.isArray(takenList) ? takenList : []).map((s) => String(s || "")));
  if (!taken.has(String(base))) return String(base);
  for (let n = 2; n <= 99; n++) {
    const candidate = `${base}-r${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Fallback for the (vanishingly unlikely) case where 99 revisions are taken.
  // Uses Date.now() so it's still deterministic per-process per-millisecond,
  // but tests can pass a `now` to lock the value.
  return `${base}-r${Date.now().toString(36).slice(-4)}`;
}

// ── DisplayName for a QB customer ────────────────────────────────────────────
// QB requires a unique DisplayName. We use "{company} ({name})" when both
// are present so personal-name subsidiaries don't collide ("Acme (John)" vs
// "Acme (Jane)"), or just the personal name otherwise.
export function buildQBDisplayName(customer) {
  const company = (customer?.company || "").trim();
  const name    = (customer?.name    || "").trim();
  if (company && name) return `${company} (${name})`;
  if (company)         return company;
  return name;
}

// ── QB Customer body ────────────────────────────────────────────────────────
// Only emits fields with real values — never sends empty strings or null
// (QB returns 400 on some null fields). Tax-exempt customers get
// Taxable=false + TaxExemptionReasonId=16 (Other) per QB's enum.
export function buildQBCustomerBody(customer, displayName) {
  const body = {
    DisplayName: displayName,
    PrintOnCheckName: customer?.company || customer?.name || displayName,
  };
  if (customer?.company) body.CompanyName = customer.company;
  if (customer?.name)    body.GivenName   = customer.name;
  if (customer?.notes)   body.Notes       = customer.notes;
  if (customer?.email)   body.PrimaryEmailAddr = { Address: customer.email };
  if (customer?.phone)   body.PrimaryPhone     = { FreeFormNumber: customer.phone };
  if (customer?.address) body.BillAddr         = { Line1: customer.address };
  if (customer?.tax_id)  body.ResaleNum        = customer.tax_id;
  if (customer?.tax_exempt) {
    body.Taxable = false;
    body.TaxExemptionReasonId = 16;
  }
  return body;
}

// ── Single-quote SQL escaping for QB QBO query strings ─────────────────────
// QB BNF requires '' (two single quotes) to escape a single quote inside
// a string literal. Anything else (e.g. \') silently breaks the query.
export function escapeQbStringLiteral(value) {
  return String(value ?? "").replace(/'/g, "''");
}

// ── Translate our invoicePayload to QBO Line[] ──────────────────────────────
// Inputs:
//   payload          — { lines, discountPercent, discountAmount, discountType }
//   itemIdMap        — Map<string,string> of itemName → QBO Item.Id
//   defaultItemName  — fallback when a line's itemName isn't in the map
//   taxExempt        — when true, every line gets TaxCodeRef='NON' instead of 'TAX'
//
// Discount handling: rather than emit a separate DiscountLineDetail (which
// QB applies BEFORE tax), we distribute the discount proportionally across
// line Amounts so QB taxes the discounted total.
export function buildInvoiceLinesFromPayload(payload, itemIdMap, defaultItemName, taxExempt = false) {
  const lines = [];
  const safeMap = itemIdMap instanceof Map ? itemIdMap : new Map();
  const fallbackId = safeMap.get(defaultItemName);
  const taxCode = taxExempt ? "NON" : "TAX";

  for (const line of payload?.lines ?? []) {
    const qty       = Number(line?.qty)       || 0;
    const unitPrice = Number(line?.unitPrice) || 0;
    const amount    = Number(line?.amount)    || 0;
    if (qty === 0 || amount === 0) continue;

    const itemName = (line?.itemName || defaultItemName || "").trim();
    const itemId   = safeMap.get(itemName) ?? fallbackId;
    if (!itemId) continue;

    lines.push({
      DetailType: "SalesItemLineDetail",
      Amount: Number(amount.toFixed(2)),
      Description: line?.description ?? "",
      SalesItemLineDetail: {
        ItemRef:     { value: itemId },
        UnitPrice:   unitPrice,
        Qty:         qty,
        TaxCodeRef:  { value: taxCode },
      },
    });
  }

  // Apply discount inline rather than as a separate line so QB taxes the
  // post-discount total.
  const discountPct  = Number(payload?.discountPercent) || 0;
  const discountFlat = Number(payload?.discountAmount)  || 0;
  const isFlat       = payload?.discountType === "flat" || discountFlat > 0;

  if ((isFlat && discountFlat > 0) || discountPct > 0) {
    const subtotal = lines.reduce(
      (s, l) => s + (l.DetailType === "SalesItemLineDetail" ? l.Amount : 0),
      0,
    );
    const discountTotal = isFlat
      ? discountFlat
      : Number(((subtotal * discountPct) / 100).toFixed(2));
    const discountLabel = isFlat
      ? ` (less $${discountFlat.toFixed(2)} discount)`
      : ` (less ${discountPct}% discount)`;

    if (subtotal > 0 && discountTotal > 0) {
      let remaining = discountTotal;
      const salesLines = lines.filter((l) => l.DetailType === "SalesItemLineDetail");
      salesLines.forEach((line, i) => {
        const share = i === salesLines.length - 1
          ? remaining
          : Number(((line.Amount / subtotal) * discountTotal).toFixed(2));
        line.Amount = Number((line.Amount - share).toFixed(2));
        line.Description = (line.Description || "") + discountLabel;
        if (line.SalesItemLineDetail) {
          line.SalesItemLineDetail.UnitPrice = Number(
            (line.Amount / (line.SalesItemLineDetail.Qty || 1)).toFixed(4),
          );
        }
        remaining = Number((remaining - share).toFixed(2));
      });
    }
  }

  return lines;
}

// ── Extract a customer-facing payment link from a QBO Invoice response ─────
// Returns null when QB Payments isn't enabled — we deliberately do NOT
// fabricate a `connect.intuit.com/portal/asei/…` URL because that page
// requires the customer to log into their own Intuit account (useless
// for paying). The frontend then routes to Stripe.
export function extractPaymentLink(invoiceData) {
  const inv = invoiceData?.Invoice ?? invoiceData;
  if (!inv) return null;
  const candidates = [
    inv?.payment?.paymentUri,
    inv?.InvoiceLink,
    inv?.paymentUri,
    inv?.Links?.find?.((l) => l.Rel === "payment")?.Href,
  ].filter(Boolean);
  return candidates.length > 0 ? candidates[0] : null;
}

// ── New-order ID generator (used by qbWebhook when auto-converting quotes) ─
// Format: ORD-{year}-{base36-of-now-uppercased-last-5}. `now` is injectable
// for tests so we get deterministic IDs.
export function makeOrderId(now = Date.now()) {
  const year = new Date(now).getFullYear();
  const suffix = now.toString(36).toUpperCase().slice(-5);
  return `ORD-${year}-${suffix}`;
}
