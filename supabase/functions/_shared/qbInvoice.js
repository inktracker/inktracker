// Pure helpers for QuickBooks invoice + customer payload construction.
// All functions here are pure — no I/O, no side effects, no globals.
//
// The Deno edge functions (qbSync, qbWebhook) import from this file so
// the Vitest suite at __tests__/qbInvoice.test.js is the canonical
// behavior contract. Drift in the edge function = test failure.

// ── Income account selection ────────────────────────────────────────────────
// Where InkTracker invoice revenue posts in QB. The shop can pick an account
// explicitly (Account → QuickBooks); when unset we guess by name, then take the
// first Income account, so existing shops keep working (default-until-set).
export const PREFERRED_INCOME_NAMES = ["Sales of Product Income", "Services", "Sales", "Income"];

/**
 * @param {Array<{Id:any,Name:string}>} accounts  Income accounts from QB.
 * @param {string|null} configuredId               The shop's chosen account id.
 * @param {string[]} preferred                     Ordered name fallbacks.
 * @returns {{id: string|null, source: 'configured'|'preferred'|'first'|null}}
 *   `configured` only when the chosen id STILL exists in QB (deleted accounts
 *   fall back to the guess rather than erroring later).
 */
export function pickIncomeAccountId(accounts, configuredId, preferred = PREFERRED_INCOME_NAMES) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (configuredId) {
    const hit = list.find((a) => a && String(a.Id) === String(configuredId));
    if (hit) return { id: String(hit.Id), source: "configured" };
  }
  for (const name of preferred) {
    const hit = list.find((a) => a && a.Name === name);
    if (hit) return { id: String(hit.Id), source: "preferred" };
  }
  if (list.length > 0 && list[0] && list[0].Id != null) {
    return { id: String(list[0].Id), source: "first" };
  }
  return { id: null, source: null };
}

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

// ── Fuzzy customer matching (duplicate prevention) ───────────────────────────
// Exact email + exact DisplayName matching misses real duplicates: a
// QB customer imported/created with a slightly different DisplayName
// format ("Acme - John"), or cosmetic differences (case, whitespace,
// trailing punctuation: "Acme Inc" vs "acme, inc."). These helpers let
// the caller verify a candidate QB row is the SAME logical customer
// without merging genuinely-distinct contacts at one company.

// Normalize a name for comparison: lowercased, punctuation→space,
// whitespace collapsed, trimmed.
export function normalizeForMatch(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// True when a QB customer row is the same logical customer as `customer`.
// Decisive on email. Otherwise compares normalized company + contact:
//   - company AND name present → BOTH must match (distinct contacts at the
//     same company are NOT merged), with a DisplayName-format fallback.
//   - company only / name only → that single field matches (same behavior
//     as the existing exact-DisplayName match, just normalized).
export function customerIdentityMatches(qbRow, customer) {
  if (!qbRow || !customer) return false;

  const email = isLikelyEmail(customer.email) ? customer.email.trim().toLowerCase() : "";
  const rowEmail = (qbRow?.PrimaryEmailAddr?.Address || "").trim().toLowerCase();
  if (email && rowEmail && email === rowEmail) return true;

  const company = normalizeForMatch(customer.company);
  const name = normalizeForMatch(customer.name);
  const rowCompany = normalizeForMatch(qbRow.CompanyName);
  const rowGiven = normalizeForMatch(qbRow.GivenName);
  const rowDisplay = normalizeForMatch(qbRow.DisplayName);

  if (company && name) {
    if (rowCompany === company && rowGiven === name) return true;
    // DisplayName "company (name)" formatting fallback.
    return rowDisplay === normalizeForMatch(`${customer.company} (${customer.name})`);
  }
  if (company) return rowCompany === company || rowDisplay === company;
  if (name) return rowGiven === name || rowDisplay === name;
  return false;
}

// ── Email format guard ──────────────────────────────────────────────────────
// QB validates email per RFC 822 and returns 400 (ValidationFault) when
// the value doesn't look like an email. The InkTracker customers table
// allows free-text in the email column, and we've seen names like
// "Danielle Walton" end up there from past imports or typos. Passing
// that into PrimaryEmailAddr / BillEmail makes the entire QB sync
// fail — better to omit the field than block the whole operation.
//
// Minimal check (something@something.something) — intentionally lax;
// the goal is "definitely not an email" rejection, not full RFC 822
// validation (QB does that). False positives like "a@b.c" still hit
// QB which will accept or reject per its own rules.
export function isLikelyEmail(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^\S+@\S+\.\S+$/.test(trimmed);
}

// ── QB Customer body ────────────────────────────────────────────────────────
// Only emits fields with real values — never sends empty strings or null
// (QB returns 400 on some null fields).
//
// We do NOT send any tax fields on the CUSTOMER (no Taxable, no
// TaxExemptionReasonId). Two separate QB gotchas converged here:
//   1. TaxExemptionReasonId — QB's valid enum is 1–15. We previously
//      hardcoded 16, which QB rejected (400 code 2030, "Id should be a
//      valid number. Supplied value:16").
//   2. Taxable=false — in QBO companies with Automated Sales Tax (every
//      modern US company file), customer-level Taxable is NOT settable via
//      the API and QB rejects it with a business-validation 400, blocking
//      customer creation entirely for every tax-exempt customer.
// Exemption is enforced where it actually drives the math: on the invoice
// LINES, which get TaxCodeRef "NON" whenever the customer is tax-exempt or
// the quote's tax rate is 0 (see handleCreateInvoice). That yields a $0-tax
// invoice without poking the AST-protected customer fields. We still don't
// capture a reason code from the shop, so there's nothing valid to send.
//
// Email is gated by isLikelyEmail so junk values (names, phone numbers,
// stray text) don't crash QB customer creation with a ValidationFault.
export function buildQBCustomerBody(customer, displayName) {
  const body = {
    DisplayName: displayName,
    PrintOnCheckName: customer?.company || customer?.name || displayName,
  };
  if (customer?.company) body.CompanyName = customer.company;
  if (customer?.name)    body.GivenName   = customer.name;
  if (customer?.notes)   body.Notes       = customer.notes;
  if (isLikelyEmail(customer?.email)) body.PrimaryEmailAddr = { Address: customer.email.trim() };
  if (customer?.phone)   body.PrimaryPhone     = { FreeFormNumber: customer.phone };
  if (customer?.address) body.BillAddr         = { Line1: customer.address };
  if (customer?.tax_id)  body.ResaleNum        = customer.tax_id;
  return body;
}

// ── Single-quote SQL escaping for QB QBO query strings ─────────────────────
// QB BNF requires '' (two single quotes) to escape a single quote inside
// a string literal. Anything else (e.g. \') silently breaks the query.
export function escapeQbStringLiteral(value) {
  return String(value ?? "").replace(/'/g, "''");
}

// ── Revision suffix helpers ────────────────────────────────────────────────
// Re-syncs produce DocNumbers like "Q-2026-115-r2", "Q-2026-115-r3" so QB
// doesn't reject a duplicate. When we later pull invoices back into
// InkTracker, we want all revisions of a single quote to land on ONE
// invoice row instead of multiplying. Pure helpers — keeps the qbSync
// edge function uncluttered and lets us unit-test the regex.

/**
 * Returns the base DocNumber with any trailing -r<digits> suffix removed.
 * "Q-2026-115-r2" → "Q-2026-115"; "Q-2026-115" → "Q-2026-115" (unchanged).
 * Treats null/undefined as "".
 */
export function stripDocNumberRevision(docNumber) {
  return String(docNumber ?? "").replace(/-r\d+$/i, "");
}

/**
 * True when a DocNumber carries an -r<digits> revision suffix.
 */
export function isRevisionDocNumber(docNumber) {
  return /-r\d+$/i.test(String(docNumber ?? ""));
}

// ── Invoice paid-state predicate ───────────────────────────────────────────
// "Paid" in QBO = TotalAmt > 0 AND Balance === 0. Centralized so the
// createInvoice resync path, pullInvoices, and any future caller use the
// same definition. A $0 invoice should never read as "paid" — those are
// drafts with no line items.

/**
 * Returns true when the QB Invoice object represents a fully-paid
 * invoice. Accepts the raw Invoice payload (TotalAmt + Balance fields).
 */
export function isQbInvoicePaid(invoice) {
  if (!invoice) return false;
  const total = Number(invoice.TotalAmt ?? 0);
  const balance = Number(invoice.Balance ?? 0);
  return total > 0 && balance === 0;
}

// ── UPDATE-failure shape ────────────────────────────────────────────
//
// Why this exists: until 2026-05-30, handleCreateInvoice silently
// fell through to CREATE when an UPDATE on an existing qb_invoice_id
// failed. Result: Shana Krochmal's Q-2026-F4O5 → Q-2026-F4O5-r2
// duplication — original orphaned UNPAID in InkTracker, payment
// landed on the -r2 in QB, books visibly diverged.
//
// New contract: if we have a qb_invoice_id and the update fails, we
// refuse to create a duplicate. We return a structured failure that
// the frontend renders with actionable guidance (Refresh, or fix in
// QB) — but we DO NOT mint a new invoice unilaterally.
//
// The function isolates the failure-payload shape so the rule is
// testable without spinning up Deno + Supabase + a QB mock.
export function buildUpdateFailureResponse({
  qbInvoiceId,
  qbDocNumber,
  existingPaymentLink,
  updateErrMessage,
}) {
  if (!qbInvoiceId) throw new Error("buildUpdateFailureResponse: qbInvoiceId required");
  return {
    qbInvoiceId,
    qbDocNumber:        qbDocNumber || null,
    paymentLink:        existingPaymentLink || null,
    updateFailed:       true,
    updateFailureReason: updateErrMessage || "unknown",
    // The message renders in the operator's banner. Keep it crisp and
    // actionable. Mention the exact action (Refresh button) so they
    // don't go hunting.
    message:
      `Couldn't update the existing QuickBooks invoice ` +
      `(${qbDocNumber || `Id ${qbInvoiceId}`}). ` +
      `Use the Refresh button to re-pull current state from QuickBooks, ` +
      `or fix the invoice in QuickBooks directly. ` +
      `InkTracker refused to create a duplicate invoice. ` +
      (updateErrMessage ? `Underlying error: ${updateErrMessage}` : ""),
  };
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

  for (const line of payload?.lines ?? []) {
    const qty       = Number(line?.qty)       || 0;
    const unitPrice = Number(line?.unitPrice) || 0;
    const amount    = Number(line?.amount)    || 0;
    if (qty === 0 || amount === 0) continue;

    const itemName = (line?.itemName || defaultItemName || "").trim();
    const itemId   = safeMap.get(itemName) ?? fallbackId;
    if (!itemId) continue;

    // Per-line taxability: a line is taxed unless it's explicitly taxable:false
    // (e.g. non-taxable shipping). Tax-exempt customers get NON on everything.
    // _taxable / _isFee are transient hints for the caller (qbSync) to finalize
    // the tax code and exclude fees from discount spreading; they are deleted
    // before the invoice is sent to QuickBooks.
    const isTaxable = line?.taxable !== false;
    const lineTaxCode = taxExempt || !isTaxable ? "NON" : "TAX";

    lines.push({
      DetailType: "SalesItemLineDetail",
      Amount: Number(amount.toFixed(2)),
      Description: line?.description ?? "",
      _taxable: isTaxable,
      _isFee: !!line?.isFee,
      SalesItemLineDetail: {
        ItemRef:     { value: itemId },
        UnitPrice:   unitPrice,
        Qty:         qty,
        TaxCodeRef:  { value: lineTaxCode },
      },
    });
  }

  // Apply discount inline rather than as a separate line so QB taxes the
  // post-discount total.
  const discountPct  = Number(payload?.discountPercent) || 0;
  const discountFlat = Number(payload?.discountAmount)  || 0;
  const isFlat       = payload?.discountType === "flat" || discountFlat > 0;

  if ((isFlat && discountFlat > 0) || discountPct > 0) {
    // Discounts apply to garment lines only — NOT setup/additional fees
    // (mirrors calcQuoteTotals, where setup + fees are added post-discount).
    const subtotal = lines.reduce(
      (s, l) => s + (l.DetailType === "SalesItemLineDetail" && !l._isFee ? l.Amount : 0),
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
      const salesLines = lines.filter((l) => l.DetailType === "SalesItemLineDetail" && !l._isFee);
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
  // QBO has used several different field names for the customer-
  // facing share link across API revisions. The modern format is
  // `connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-…`
  // and lives on `InvoiceLink` when fetched with ?include=invoiceLink.
  // Older sandboxes / shapes used `payment.paymentUri` or a `Links`
  // array. Check all known variants in priority order — the modern
  // share link wins if present.
  const candidates = [
    inv?.InvoiceLink,
    inv?.invoiceLink,
    inv?.SharableLink,
    inv?.sharableLink,
    inv?.shareableLink,
    inv?.payment?.paymentUri,
    inv?.paymentUri,
    inv?.Links?.find?.((l) => l?.Rel === "payment")?.Href,
    inv?.Links?.find?.((l) => l?.rel === "payment")?.href,
  ].filter(Boolean);
  return candidates.length > 0 ? candidates[0] : null;
}

// ── Build the URL for POST /invoice/{id}/send ──────────────────────────────
// QBO's only way to mint the customer-facing share link (the scs-v1-… URL the
// payment portal lives at). The `sendTo` query param doubles as the recipient
// of the email QBO inevitably sends — we use the real customer's email so
// the portal pre-fills their address (QBO snapshots that at mint time and
// doesn't refresh it on later updates; see project_qb_payment_flow_canonical
// memory for the back-story).
//
// `baseUrl` is injected (rather than hardcoded) so this helper stays pure
// and the edge function can wire in `QB_BASE`.
export function buildQbSendInvoiceUrl(baseUrl, realmId, invoiceId, sendTo) {
  if (!baseUrl)   throw new Error("buildQbSendInvoiceUrl: baseUrl required");
  if (!realmId)   throw new Error("buildQbSendInvoiceUrl: realmId required");
  if (!invoiceId) throw new Error("buildQbSendInvoiceUrl: invoiceId required");
  if (!sendTo)    throw new Error("buildQbSendInvoiceUrl: sendTo required");
  const base = String(baseUrl).replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(String(realmId))}/invoice/${encodeURIComponent(String(invoiceId))}/send?sendTo=${encodeURIComponent(String(sendTo))}&minorversion=65`;
}

// ── New-order ID generator (used by qbWebhook when auto-converting quotes) ─
// Format: ORD-{year}-{base36-of-now-uppercased-last-5}. `now` is injectable
// for tests so we get deterministic IDs.
export function makeOrderId(now = Date.now()) {
  const year = new Date(now).getFullYear();
  const suffix = now.toString(36).toUpperCase().slice(-5);
  return `ORD-${year}-${suffix}`;
}

// ── pullInvoices customer-field resolution ──────────────────────────────────
// NEVER downgrade an existing local customer link to null just because the
// QB customer isn't mapped locally. That exact behavior re-buried the
// beloved's invoices on 2026-06-10: their QB CustomerRef pointed at an
// inactive QB customer with no local mapping, so the sync overwrote a
// freshly repaired customer_id with null. QB is authoritative for which QB
// customer an invoice belongs to — but absence of a local mapping is OUR
// gap, not evidence the local link is wrong.
export function resolveInvoiceCustomerFields(custMatch, existingRow, qbCustomerName) {
  if (custMatch) {
    return {
      customer_id: custMatch.id,
      customer_name: custMatch.name || qbCustomerName || "Unknown",
    };
  }
  if (existingRow && existingRow.customer_id) {
    return {
      customer_id: existingRow.customer_id,
      customer_name: existingRow.customer_name || qbCustomerName || "Unknown",
    };
  }
  return { customer_id: null, customer_name: qbCustomerName || "Unknown" };
}
