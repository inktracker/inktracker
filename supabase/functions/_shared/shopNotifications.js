// Shop-facing notifications written by edge functions.
//
// Called with the service-role Supabase client. Inserts a row into
// public.notifications which the nav bell + notifications dropdown
// reads via RLS (shop_owner = auth email).
//
// Pure-ish: the actual insert is async, but everything before it
// (validation, payload shaping) is deterministic and testable.

const VALID_SEVERITIES = Object.freeze(["info", "warning", "alert"]);

/**
 * Build the row that goes into public.notifications. Pure function —
 * validates inputs strictly so a bad call here doesn't write garbage
 * to a table that the user will see. Throws on missing required
 * fields rather than silently writing a row with null/empty values.
 *
 * @returns {{shop_owner: string, event_type: string, severity: string,
 *           title: string, body: string, metadata: object,
 *           related_entity?: string, related_id?: string}}
 */
export function buildNotificationRow(input) {
  if (!input || typeof input !== "object") {
    throw new Error("buildNotificationRow: input required");
  }
  const { shopOwner, eventType, severity, title, body, relatedEntity, relatedId, metadata } = input;

  if (!shopOwner || typeof shopOwner !== "string") {
    throw new Error("buildNotificationRow: shopOwner required (non-empty string)");
  }
  if (!eventType || typeof eventType !== "string") {
    throw new Error("buildNotificationRow: eventType required (non-empty string)");
  }
  if (!VALID_SEVERITIES.includes(severity)) {
    throw new Error(`buildNotificationRow: severity must be one of ${VALID_SEVERITIES.join("/")}, got ${JSON.stringify(severity)}`);
  }
  if (!title || typeof title !== "string") {
    throw new Error("buildNotificationRow: title required (non-empty string)");
  }

  const row = {
    shop_owner: shopOwner,
    event_type: eventType,
    severity,
    title,
    body: typeof body === "string" ? body : "",
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
  if (relatedEntity) row.related_entity = String(relatedEntity);
  if (relatedId)     row.related_id     = String(relatedId);
  return row;
}

/**
 * Specialized builder for QB reconciliation drift. Wraps the generic
 * builder with a human-readable title/body derived from the
 * reconciliation result.
 *
 * @param {object} args
 * @param {string} args.shopOwner
 * @param {string} args.quoteId        Human-readable quote id (e.g. "Q-2026-115")
 * @param {string} args.quoteRowId     The quotes.id used as the related_id
 * @param {string} [args.qbInvoiceId]  QB's Invoice.Id, for the metadata
 * @param {object} args.reconciliation The reconcileQbInvoice() result
 */
export function buildQbDriftNotification({ shopOwner, quoteId, quoteRowId, qbInvoiceId, reconciliation }) {
  if (!reconciliation || typeof reconciliation !== "object") {
    throw new Error("buildQbDriftNotification: reconciliation required");
  }

  const sentTotal  = Number.isFinite(reconciliation.sentTotal) ? reconciliation.sentTotal : 0;
  const qbTotal    = Number.isFinite(reconciliation.qbTotal)   ? reconciliation.qbTotal   : 0;
  const totalDrift = Number.isFinite(reconciliation.totalDrift) ? reconciliation.totalDrift : 0;
  const sentTax    = Number.isFinite(reconciliation.sentTax) ? reconciliation.sentTax : 0;
  const qbTax      = Number.isFinite(reconciliation.qbTax)   ? reconciliation.qbTax   : 0;
  const taxDrift   = Number.isFinite(reconciliation.taxDrift) ? reconciliation.taxDrift : Number((qbTax - sentTax).toFixed(2));

  const fmt = (n) => `$${Number(n).toFixed(2)}`;
  // Signed money formatter — places +/- BEFORE the dollar sign so
  // "-$5.00" renders correctly (vs "$-5.00" which is awkward to read).
  const fmtSigned = (n) => {
    const x = Number(n);
    return `${x >= 0 ? "+" : "-"}$${Math.abs(x).toFixed(2)}`;
  };

  // Tax mismatch reads VERY differently from integrity drift, so it gets
  // its own copy + event type. A tax mismatch is QB's tax engine landing on
  // a different number than the quote — NOT "QB altered our data". As of the
  // tax-sync hardening it also HOLDS the invoice (no payment link minted, the
  // customer send is blocked), so the copy is now actionable, not advisory.
  // Severity 'drift'/'fatal' always falls to the integrity copy.
  const isTaxMismatch =
    reconciliation.severity === "tax-mismatch" ||
    (reconciliation.taxMismatch &&
      reconciliation.severity !== "drift" &&
      reconciliation.severity !== "fatal");

  let eventType, severity, title, body;
  if (isTaxMismatch) {
    eventType = "qb_tax_mismatch";
    // Blocks the customer send, so it's an alert, not a passive warning.
    severity  = "alert";
    // Both sub-cases hold the invoice. Shared, concrete fix steps.
    const fixSteps =
      `Fix: (1) In QuickBooks, open the customer and confirm their billing/shipping address ` +
      `and tax status (taxable vs exempt) — Automated Sales Tax picks the rate from the address. ` +
      `(2) In InkTracker, set this quote's tax rate to match the customer's jurisdiction. ` +
      `(3) Re-sync the invoice (Send again, or QB panel → Refresh). Full guide: docs/qb-tax-sync.md.`;
    if (reconciliation.missingTax) {
      // The dangerous case: customer was quoted tax, QB recorded none.
      title = "Invoice on hold — QuickBooks recorded no sales tax";
      body =
        `Quote ${quoteId}: your quote included ${fmt(sentTax)} sales tax but QuickBooks recorded ${fmt(qbTax)}. ` +
        `The invoice was NOT sent to the customer — sending it would collect no tax and under-report your books. ` +
        fixSteps;
    } else {
      title = "Invoice on hold — QuickBooks calculated a different sales tax";
      body =
        `Quote ${quoteId}: your quote tax was ${fmt(sentTax)} but QuickBooks computed ${fmt(qbTax)} ` +
        `(${fmtSigned(taxDrift)} off; invoice total ${fmt(qbTotal)} vs quoted ${fmt(sentTotal)}). ` +
        `The invoice was NOT sent to the customer, so they can't be charged a tax you didn't quote. ` +
        fixSteps;
    }
  } else {
    // Line-amount / total integrity drift (or fatal) — QB altered numbers
    // we sent. This genuinely should never happen.
    eventType = "qb_reconciliation_drift";
    severity  = reconciliation.severity === "fatal" ? "alert" : "warning";
    title = "QuickBooks invoice doesn't match";
    body =
      `Quote ${quoteId}: InkTracker sent ${fmt(sentTotal)} but QuickBooks recorded ${fmt(qbTotal)} ` +
      `(${fmtSigned(totalDrift)} drift). ` +
      `This should never happen — please review the invoice in QuickBooks. ` +
      (reconciliation.issues?.length
        ? `Details: ${reconciliation.issues.join(" | ")}`
        : "");
  }

  return buildNotificationRow({
    shopOwner,
    eventType,
    severity,
    title,
    body,
    relatedEntity: "quote",
    relatedId:     quoteRowId,
    metadata: {
      quote_id:       quoteId,
      qb_invoice_id:  qbInvoiceId ?? null,
      sent_subtotal:  reconciliation.sentSubtotal,
      qb_subtotal:    reconciliation.qbSubtotal,
      subtotal_drift: reconciliation.subtotalDrift,
      sent_total:     sentTotal,
      qb_total:       qbTotal,
      total_drift:    totalDrift,
      sent_tax:       reconciliation.sentTax,
      qb_tax:         reconciliation.qbTax,
      tax_drift:      reconciliation.taxDrift,
      missing_tax:    Boolean(reconciliation.missingTax),
      tax_mismatch:   Boolean(reconciliation.taxMismatch),
      issues:         reconciliation.issues ?? [],
    },
  });
}

/**
 * Shop-facing notification for POST-CREATION books drift caught by the nightly
 * reconcile scan (NOT the sync-time integrity check). This is a DIFFERENT
 * situation from buildQbDriftNotification's "this should never happen" copy: by
 * the time the nightly scan runs, the invoice has usually been edited in
 * QuickBooks AFTER it was created (a shipping charge added, a line changed, QB's
 * tax engine) — which is normal, not a bug. So the tone is a calm heads-up with
 * the reconciliation options, never an alarm. Goes to the SHOP (their bell), so
 * they hear it directly instead of the operator being the only one who knows.
 *
 * @param {object} args
 * @param {string} args.shopOwner
 * @param {string} args.ref        Human id (quote_id "Q-2026-9Q31" or invoice_id)
 * @param {string} args.rowId      quotes.id / invoices.id — used as related_id
 * @param {string} [args.qbInvoiceId]
 * @param {number} args.total      Local (as-sold) total
 * @param {number} args.qbTotal    QuickBooks' current total
 * @param {number} args.drift      Signed local - qb (negative = QB is higher)
 * @param {string} args.source     "quotes" | "invoices"
 */
export function buildBooksDriftNotification({ shopOwner, ref, rowId, qbInvoiceId, total, qbTotal, drift, source }) {
  const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
  const localTotal = Number(total) || 0;
  const quickbooksTotal = Number(qbTotal) || 0;
  const signedDrift = Number.isFinite(drift)
    ? Number(drift)
    : Number((localTotal - quickbooksTotal).toFixed(2));
  const absDrift = Math.abs(signedDrift);
  // drift = local - qb, so drift < 0 means QuickBooks is HIGHER than the quote.
  const qbHigher = signedDrift < 0;
  const relatedEntity = source === "invoices" ? "invoice" : "quote";
  const docLabel = relatedEntity === "invoice" ? "invoice" : "quote";

  const title = "Heads up — your QuickBooks total changed";
  const body =
    `${ref}: QuickBooks shows ${fmt(quickbooksTotal)}, ${fmt(absDrift)} ${qbHigher ? "higher" : "lower"} ` +
    `than your ${docLabel} (${fmt(localTotal)}) — usually a QuickBooks edit like an added shipping line. ` +
    `Your customer is billed the QuickBooks amount. To match them up, update this ${docLabel} or ` +
    `fix it in QuickBooks. Nothing's broken — payment still goes through.`;

  return buildNotificationRow({
    shopOwner,
    eventType: "qb_books_drift",
    severity: "warning",
    title,
    body,
    relatedEntity,
    relatedId: rowId,
    metadata: {
      ref,
      qb_invoice_id: qbInvoiceId ?? null,
      local_total: localTotal,
      qb_total: quickbooksTotal,
      drift: signedDrift,
      source: source || "quotes",
    },
  });
}

/**
 * Insert a notification row using the service-role Supabase client.
 * Swallows errors with a console.error — a failed notification must
 * NEVER cause the originating sync/webhook to fail.
 */
export async function recordShopNotification(supabase, input) {
  let row;
  try {
    row = buildNotificationRow(input);
  } catch (err) {
    console.error(`[shopNotifications] Invalid notification — not inserted: ${err.message}`);
    return { ok: false, error: err.message };
  }
  try {
    const { error } = await supabase.from("notifications").insert(row);
    if (error) {
      console.error(`[shopNotifications] DB insert failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[shopNotifications] Insert threw: ${err?.message ?? err}`);
    return { ok: false, error: String(err?.message ?? err) };
  }
}
