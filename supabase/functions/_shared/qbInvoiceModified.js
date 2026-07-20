// QB-side invoice modification — detection + shop notification (pure).
//
// QuickBooks fires Invoice/Update webhooks whenever a shop edits an
// invoice inside QBO. Historically qbWebhook fetched the fresh invoice
// and only checked paid state, discarding edited amounts — QB-side
// changes then coasted invisibly until the nightly reconcile (Kato's
// $300 line, 2026-07-18). Now the webhook mirrors the fresh numbers
// onto the local rows' qb_* columns immediately and, when the edit
// makes QB disagree with InkTracker's as-sold total, notifies the SHOP
// in-app: "modified in QuickBooks — sync?". The as-sold totals are
// NEVER rewritten automatically (quote-snapshot invariant): the shop
// consents via the Sync from QuickBooks button, which adopts QB's
// numbers explicitly.

import { extractPaymentLink, isQbInvoicePaid } from "./qbInvoice.js";
import { buildNotificationRow } from "./shopNotifications.js";

export const QB_MODIFIED_TOLERANCE = 0.01;

/**
 * Decide whether a fresh QB total warrants a shop notification.
 * Notify only on the TRANSITION (QB's number moved since our last
 * mirror) into disagreement — repeated webhook deliveries or edits
 * that keep QB in agreement stay quiet.
 *
 * @param {object} args
 * @param {number|string|null} args.localTotal    the row's as-sold total
 * @param {number|string|null} args.priorQbTotal  qb_total mirror BEFORE this event
 * @param {number|string|null} args.freshQbTotal  live TotalAmt from the webhook fetch
 * @returns {{ qbChanged: boolean, diverges: boolean, shouldNotify: boolean }}
 */
export function detectQbInvoiceModification({ localTotal, priorQbTotal, freshQbTotal }) {
  // Number(null) is 0, so the null check must come before coercion.
  const fresh = freshQbTotal == null ? NaN : Number(freshQbTotal);
  if (!Number.isFinite(fresh)) return { qbChanged: false, diverges: false, shouldNotify: false };
  // Cents-rounded deltas — raw float subtraction turns a 1¢ move into
  // 0.010000000000005 and trips the > tolerance check.
  const centsDelta = (a, b) => Math.abs(Number((Number(a) - Number(b)).toFixed(2)));
  const qbChanged = priorQbTotal == null
    ? false // first mirror write — nothing to compare against, don't notify
    : centsDelta(priorQbTotal, fresh) > QB_MODIFIED_TOLERANCE;
  const diverges = localTotal != null && centsDelta(localTotal, fresh) > QB_MODIFIED_TOLERANCE;
  return { qbChanged, diverges, shouldNotify: qbChanged && diverges };
}

/**
 * qb_* mirror patch for a quotes or invoices row from the fresh QB
 * invoice. Money STATE only — never touches as-sold total/tax/line
 * fields. paid flips forward only (never un-pays; refunds are a
 * separate flow).
 */
export function buildQbMirrorPatch(freshInvoice, currentRow) {
  if (!freshInvoice) return null;
  const qbTotal = Number(freshInvoice.TotalAmt ?? 0);
  const qbTax = Number(freshInvoice?.TxnTaxDetail?.TotalTax ?? 0);
  const patch = {
    qb_subtotal: Number((qbTotal - qbTax).toFixed(2)),
    qb_tax_amount: qbTax,
    qb_total: qbTotal,
    qb_synced_at: new Date().toISOString(),
  };
  const link = extractPaymentLink(freshInvoice);
  if (link) patch.qb_payment_link = link;
  if (isQbInvoicePaid(freshInvoice) && !currentRow?.paid && "paid" in (currentRow ?? {})) {
    patch.paid = true;
    patch.paid_date = patch.qb_synced_at.split("T")[0];
  }
  return patch;
}

// Matches audit lines the frontend's buildSyncNote appends to invoice
// notes ("[YYYY-MM-DD] Synced from QuickBooks: …"). Keep in lockstep
// with SYNC_NOTE_LINE in src/lib/invoices/qbModifiedSync.js.
const SYNC_NOTE_LINE = /^\[\d{4}-\d{2}-\d{2}\] Synced from QuickBooks:.*$/;

/**
 * Merge QB's CustomerMemo with the sync-audit lines already on the
 * local row. pullInvoices overwrites notes from QB for import-born
 * rows — without this, a Sync-All erases the shop's sync history from
 * exactly the invoices most likely to have one.
 */
export function mergeNotesPreservingSyncLines(qbMemo, existingNotes) {
  const syncLines = (typeof existingNotes === "string" ? existingNotes : "")
    .split("\n")
    .filter((line) => SYNC_NOTE_LINE.test(line.trim()));
  const memo = (typeof qbMemo === "string" ? qbMemo : "").trim();
  const parts = [memo, ...syncLines].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;

/**
 * In-app notification row for a QB-side modification. related_entity /
 * related_id point at the local row so the bell can deep-link.
 */
export function buildQbModifiedNotification({ shopOwner, ref, rowId, relatedEntity, qbInvoiceId, localTotal, freshQbTotal }) {
  return buildNotificationRow({
    shopOwner,
    eventType: "qb_invoice_modified",
    severity: "warning",
    title: `Invoice ${ref} was modified in QuickBooks`,
    body:
      `QuickBooks now shows ${fmt(freshQbTotal)}; InkTracker has ${fmt(localTotal)}. ` +
      `Open the invoice and click "Sync from QuickBooks" to adopt QuickBooks' numbers, ` +
      `or review the change in QuickBooks if it wasn't intentional. ` +
      `QuickBooks is the billing authority — what the customer pays follows the QB invoice.`,
    relatedEntity,
    relatedId: rowId,
    metadata: { qb_invoice_id: qbInvoiceId ?? null, qb_total: Number(freshQbTotal), local_total: Number(localTotal) },
  });
}
