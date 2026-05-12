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

  const fmt = (n) => `$${Number(n).toFixed(2)}`;
  // Signed money formatter — places +/- BEFORE the dollar sign so
  // "-$5.00" renders correctly (vs "$-5.00" which is awkward to read).
  const fmtSigned = (n) => {
    const x = Number(n);
    return `${x >= 0 ? "+" : "-"}$${Math.abs(x).toFixed(2)}`;
  };

  const title = "QuickBooks invoice doesn't match";
  const body =
    `Quote ${quoteId}: InkTracker sent ${fmt(sentTotal)} but QuickBooks recorded ${fmt(qbTotal)} ` +
    `(${fmtSigned(totalDrift)} drift). ` +
    `This should never happen — please review the invoice in QuickBooks. ` +
    (reconciliation.issues?.length
      ? `Details: ${reconciliation.issues.join(" | ")}`
      : "");

  return buildNotificationRow({
    shopOwner,
    eventType: "qb_reconciliation_drift",
    severity:  reconciliation.severity === "fatal" ? "alert" : "warning",
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
      issues:         reconciliation.issues ?? [],
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
