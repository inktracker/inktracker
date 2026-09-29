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
 * Notify on the TRANSITION into disagreement — repeated webhook
 * deliveries and edits that keep QB in agreement stay quiet.
 *
 * FIRST MIRROR (priorQbTotal == null): this used to return
 * shouldNotify:false unconditionally, on the theory that a row with no
 * prior mirror has nothing to compare against. That silently swallowed
 * the single most common case. Invoices created FROM InkTracker get
 * qb_total stamped at create time (qbSync createInvoice), so they
 * always have a prior — but rows imported by pullInvoices never get
 * qb_total written at all, only `total`. So every import-born invoice
 * sat at qb_total = NULL until the shop's first QB-side edit, and that
 * edit was exactly the one the guard suppressed.
 *
 * Lisa Gotts INV-2026-OW0M1-r3 (2026-07-28, QB invoice 3746): edited
 * $5000 → $4995 in QBO, Invoice/Update webhook arrived and mirrored,
 * the invoice modal showed the "Modified in QuickBooks" banner — and
 * no bell notification was ever written. prod `notifications` had zero
 * qb_invoice_modified rows, ever.
 *
 * A first mirror that lands in disagreement is real news, and it is
 * not noisy: pullInvoices sets local `total` FROM the QB total, so an
 * untouched imported invoice agrees and stays quiet. It only fires
 * once the shop actually changes the invoice in QuickBooks.
 *
 * LINE CHANGES: detection is no longer total-only. A QB edit that
 * leaves the total alone — a garment color corrected from Black to
 * Gray, a fixed typo, quantity moved between lines — used to produce
 * nothing at all. When the line snapshot moves, that is news on its own
 * and notifies regardless of whether the total budged.
 *
 * @param {object} args
 * @param {number|string|null} args.localTotal    the row's as-sold total
 * @param {number|string|null} args.priorQbTotal  qb_total mirror BEFORE this event
 * @param {number|string|null} args.freshQbTotal  live TotalAmt from the webhook fetch
 * @param {Array|null} [args.priorLines]          qb_line_snapshot BEFORE this event
 * @param {Array|null} [args.freshLines]          snapshot built from the webhook fetch
 * @returns {{ qbChanged, diverges, firstMirror, lineChanges, linesChanged, shouldNotify }}
 */
export function detectQbInvoiceModification({
  localTotal,
  priorQbTotal,
  freshQbTotal,
  priorLines = null,
  freshLines = null,
}) {
  const lineChanges = diffQbLineSnapshots(priorLines, freshLines);
  const linesChanged = lineChanges.length > 0;

  // Number(null) is 0, so the null check must come before coercion.
  const fresh = freshQbTotal == null ? NaN : Number(freshQbTotal);
  if (!Number.isFinite(fresh)) {
    return {
      qbChanged: false,
      diverges: false,
      firstMirror: false,
      lineChanges,
      linesChanged,
      shouldNotify: false,
    };
  }
  // Cents-rounded deltas — raw float subtraction turns a 1¢ move into
  // 0.010000000000005 and trips the > tolerance check.
  const centsDelta = (a, b) => Math.abs(Number((Number(a) - Number(b)).toFixed(2)));
  const firstMirror = priorQbTotal == null;
  const qbChanged = firstMirror
    ? false
    : centsDelta(priorQbTotal, fresh) > QB_MODIFIED_TOLERANCE;
  const diverges = localTotal != null && centsDelta(localTotal, fresh) > QB_MODIFIED_TOLERANCE;
  return {
    qbChanged,
    diverges,
    firstMirror,
    lineChanges,
    linesChanged,
    // Money divergence OR any line-level edit. The line arm needs no
    // divergence check: QB's line text IS the authority for what the
    // customer sees on their invoice, so any change to it is worth
    // telling the shop about.
    shouldNotify: (diverges && (qbChanged || firstMirror)) || linesChanged,
  };
}

// ── QB line-state snapshot + diff ──────────────────────────────────────
//
// Detection used to be total-only, so a QB-side edit that left the total
// alone was invisible: change a garment color from Black to Gray, fix a
// typo, move quantity between lines, and InkTracker said nothing.
//
// The snapshot is deliberately COMPACT and deliberately NOT a
// replacement for line_items. QuickBooks stores one flat Description
// string per line ("Comfort Colors 9360 Blue Spruce | S:1, M:2, … |
// ChooChoo's Text / Left Chest / Screen Print"), which is a one-way
// projection of the rich local line (garmentColor, sizes, sizePrices,
// imprints, artwork, supplier costs). Parsing that string back into
// structured fields is exactly the data-loss path #579 had to undo, so
// we snapshot it to DETECT and DESCRIBE changes, never to overwrite the
// local itemization.

const lineKey = (l) => String(l?.Id ?? "");

/**
 * Compact snapshot of a QB invoice's sales lines: [{ i, d, q, a }] —
 * line Id, Description, Qty, Amount. Discount / subtotal / tax lines
 * are excluded (they aren't sales lines and their movement is already
 * covered by the total comparison).
 */
export function buildQbLineSnapshot(freshInvoice) {
  const lines = Array.isArray(freshInvoice?.Line) ? freshInvoice.Line : [];
  return lines
    .filter((l) => l && l.DetailType === "SalesItemLineDetail")
    .map((l) => ({
      i: lineKey(l),
      d: String(l.Description ?? l.SalesItemLineDetail?.ItemRef?.name ?? ""),
      q: Number(l.SalesItemLineDetail?.Qty ?? 0),
      a: Number(l.Amount ?? 0),
    }));
}

const shortDesc = (s, max = 60) => {
  const t = String(s ?? "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Human-readable diff between two line snapshots. Returns [] when
 * nothing changed (or when there's no prior snapshot to compare).
 * Matches lines by QB line Id, falling back to position when QB
 * reissues ids. Each entry is one sentence the shop can act on.
 */
export function diffQbLineSnapshots(prior, fresh) {
  if (!Array.isArray(prior) || !Array.isArray(fresh)) return [];
  const changes = [];
  const priorById = new Map(prior.filter((l) => l?.i).map((l) => [l.i, l]));
  const seen = new Set();

  fresh.forEach((line, idx) => {
    const before = (line?.i && priorById.get(line.i)) || prior[idx];
    if (before) seen.add(before);
    const label = `Line ${idx + 1}`;
    if (!before) {
      changes.push(`${label} added in QuickBooks: "${shortDesc(line.d)}"`);
      return;
    }
    if (String(before.d ?? "") !== String(line.d ?? "")) {
      changes.push(`${label} description: "${shortDesc(before.d)}" → "${shortDesc(line.d)}"`);
    }
    if (Number(before.q ?? 0) !== Number(line.q ?? 0)) {
      changes.push(`${label} quantity: ${Number(before.q ?? 0)} → ${Number(line.q ?? 0)}`);
    }
    if (Math.abs(Number((Number(before.a ?? 0) - Number(line.a ?? 0)).toFixed(2))) > QB_MODIFIED_TOLERANCE) {
      changes.push(`${label} amount: ${fmt(before.a ?? 0)} → ${fmt(line.a ?? 0)}`);
    }
  });

  prior.forEach((line) => {
    if (!seen.has(line)) changes.push(`A line was removed in QuickBooks: "${shortDesc(line.d)}"`);
  });

  return changes;
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
    qb_line_snapshot: buildQbLineSnapshot(freshInvoice),
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
export function buildQbModifiedNotification({
  shopOwner,
  ref,
  rowId,
  relatedEntity,
  qbInvoiceId,
  localTotal,
  freshQbTotal,
  lineChanges = [],
  totalDiverges = true,
}) {
  const changes = Array.isArray(lineChanges) ? lineChanges : [];
  // Lead with whichever kind of change actually happened. A line-only
  // edit that left the total alone must NOT open with a money sentence
  // — that reads as a billing change the shop then can't find.
  const moneyLine = totalDiverges
    ? `QuickBooks now shows ${fmt(freshQbTotal)}; InkTracker has ${fmt(localTotal)}. `
    : `The invoice total is unchanged at ${fmt(freshQbTotal)}. `;
  // Cap the enumeration — a re-typed invoice can change every line and
  // the bell body is not the place for a 20-item list.
  const shown = changes.slice(0, 3);
  const detail = shown.length
    ? `What changed: ${shown.join("; ")}` +
      (changes.length > shown.length ? `; and ${changes.length - shown.length} more.` : ".") + " "
    : "";
  const action = totalDiverges
    ? `Open the invoice and click "Match to QuickBooks" to adopt QuickBooks' numbers, ` +
      `or review the change in QuickBooks if it wasn't intentional. `
    : `Open the invoice to review the change. Line edits made in QuickBooks are not ` +
      `applied to InkTracker's itemization automatically — update the line here if it should match. `;

  return buildNotificationRow({
    shopOwner,
    eventType: "qb_invoice_modified",
    severity: "warning",
    title: `Invoice ${ref} was modified in QuickBooks`,
    body:
      moneyLine + detail + action +
      `QuickBooks is the billing authority — what the customer pays follows the QB invoice.`,
    relatedEntity,
    relatedId: rowId,
    metadata: {
      qb_invoice_id: qbInvoiceId ?? null,
      qb_total: Number(freshQbTotal),
      local_total: Number(localTotal),
      line_changes: changes,
    },
  });
}

// ── Automatic adoption of QB-side edits ────────────────────────────────
//
// The consent step above assumed every QB-side edit is a surprise the shop
// must approve. In practice (Kato's invoice 1261, Q-2026-XFWN, Reagan's
// volunteer tee, 2026-09) the shop made the edit in QBO ON PURPOSE, never
// clicked Match, and the row then sat as "drift" for weeks. When
// InkTracker's own copy has NOT moved since the last mirror (local total ==
// prior qb_total — nothing was edited locally, so there is nothing to
// conflict with), QB's edit is the only truth in play and adopting it is
// the only thing the Match button would ever do. Auto-adopt in that case
// and tell the shop it happened. Consent is still required when local and
// QB have BOTH moved (a true conflict), and when the ONLY change is sales
// tax of a dollar or more — that is a billing decision, not a line edit,
// and it stays with the shop (qbTaxAutoAdopt.js owns the sub-dollar case).

/** Tax-only movements at or above this stay consent-based. */
export const AUTO_ADOPT_TAX_MAX = 1.0;

/**
 * @param {object} args
 * @param {number|string|null} args.localTotal      as-sold total on the row
 * @param {number|string|null} args.priorQbTotal    qb_total mirror BEFORE this event
 * @param {number|string|null} args.priorQbSubtotal qb_subtotal mirror BEFORE this event
 * @param {number|string|null} args.freshQbTotal    live TotalAmt
 * @param {number|string|null} args.freshQbTax      live TxnTaxDetail.TotalTax
 * @param {boolean} [args.pushPending]              qb_push_pending — local truth is newer
 * @param {boolean} [args.qbEditsAuthoritative]     shop opted into "QB edits win"
 * @returns {{ autoAdopt: boolean, reason: string }}
 */
export function decideQbEditAdoption({
  localTotal,
  priorQbTotal,
  priorQbSubtotal,
  freshQbTotal,
  freshQbTax,
  pushPending = false,
  // Per-shop "Let QuickBooks invoice edits win automatically" (Account →
  // QuickBooks). OFF (default) → a real line/discount edit made in QB stays a
  // DECISION (the shop is told and can Match), so an unexpected QB change is
  // flagged. ON → the shop runs pricing through QB, so those edits adopt
  // silently. Penny/tax-rounding noise auto-adopts either way — it's never a
  // decision. Tax-only dollar-plus changes stay a decision regardless.
  qbEditsAuthoritative = false,
}) {
  const centsDelta = (a, b) => Math.abs(Number((Number(a) - Number(b)).toFixed(2)));
  if (pushPending) return { autoAdopt: false, reason: "push_pending" };
  if (localTotal == null || priorQbTotal == null) return { autoAdopt: false, reason: "no_prior_mirror" };
  const fresh = freshQbTotal == null ? NaN : Number(freshQbTotal);
  if (!Number.isFinite(fresh)) return { autoAdopt: false, reason: "no_fresh_total" };
  if (centsDelta(fresh, localTotal) <= QB_MODIFIED_TOLERANCE) return { autoAdopt: false, reason: "agrees" };
  // Local moved away from the last mirror → both sides changed → conflict.
  if (centsDelta(localTotal, priorQbTotal) > QB_MODIFIED_TOLERANCE) return { autoAdopt: false, reason: "local_changed" };
  // Tax-only edit of a dollar or more: the customer's bill changed by tax
  // the shop never quoted. That stays a consent decision.
  const freshTax = Number(freshQbTax ?? 0) || 0;
  const freshSubtotal = Number((fresh - freshTax).toFixed(2));
  const priorSubtotal = priorQbSubtotal == null ? null : Number(priorQbSubtotal);
  const subtotalMoved = priorSubtotal == null || centsDelta(freshSubtotal, priorSubtotal) > QB_MODIFIED_TOLERANCE;
  if (!subtotalMoved && centsDelta(fresh, priorQbTotal) >= AUTO_ADOPT_TAX_MAX) {
    return { autoAdopt: false, reason: "tax_only_change" };
  }
  // A real line/discount edit (subtotal moved by a dollar-plus) only adopts
  // silently for QB-authoritative shops; everyone else gets a decision.
  if (subtotalMoved && !qbEditsAuthoritative) {
    return { autoAdopt: false, reason: "line_edit_needs_review" };
  }
  return { autoAdopt: true, reason: subtotalMoved ? "qb_line_edit" : "qb_penny_tax" };
}

/**
 * Reconcile-time adopt decision. Unlike decideQbEditAdoption, this works off
 * the LIVE QB invoice + the current row, independent of the (possibly stale)
 * stored qb_total — the nightly backstop can't trust the mirror, and a
 * mirror-without-adopt leaves local != qb_total which the "local_changed"
 * guard would forever read as a conflict. Sub-dollar drift is handled
 * upstream (pennyDriftAdoptPatch); this decides the dollar-plus case:
 *   - shop not QB-authoritative        → don't adopt (alert; stays a decision)
 *   - tax-only dollar-plus change       → don't adopt (stays a decision)
 *   - subtotal/discount edit, shop ON   → adopt QB's total (QB wins)
 */
export function decideReconcileAdopt({ rowTotal, rowTax, freshQbTotal, freshQbTax, qbEditsAuthoritative = false }) {
  const centsDelta = (a, b) => Math.abs(Number((Number(a) - Number(b)).toFixed(2)));
  const fresh = freshQbTotal == null ? NaN : Number(freshQbTotal);
  if (!Number.isFinite(fresh)) return { adopt: false, reason: "no_fresh_total" };
  if (rowTotal == null) return { adopt: false, reason: "no_local_total" };
  if (centsDelta(fresh, rowTotal) <= QB_MODIFIED_TOLERANCE) return { adopt: false, reason: "agrees" };
  if (!qbEditsAuthoritative) return { adopt: false, reason: "not_authoritative" };
  const freshTax = Number(freshQbTax ?? 0) || 0;
  const freshSubtotal = Number((fresh - freshTax).toFixed(2));
  const rowSubtotal = Number((Number(rowTotal) - Number(rowTax ?? 0)).toFixed(2));
  const subtotalMoved = centsDelta(freshSubtotal, rowSubtotal) > QB_MODIFIED_TOLERANCE;
  if (!subtotalMoved && centsDelta(fresh, rowTotal) >= AUTO_ADOPT_TAX_MAX) {
    return { adopt: false, reason: "tax_only_change" };
  }
  return { adopt: true, reason: subtotalMoved ? "qb_line_edit" : "qb_penny_tax" };
}

/**
 * As-sold money patch that adopts QB's fresh numbers — the server-side
 * twin of buildQuoteAdoptPatch / buildAdoptPatches (src/lib). total, tax,
 * tax_rate only; subtotal is left alone (local subtotal is pre-discount,
 * QB's is post-discount). Invoices get the same dated sync-note line the
 * Match button appends (customer surfaces strip it via stripSyncNotes).
 * Any tax hold is cleared: QB's number is now the row's number.
 */
export function buildQbAdoptPatch(freshInvoice, row, { table = "quotes", today } = {}) {
  const qbTotal = Number(freshInvoice?.TotalAmt);
  if (!Number.isFinite(qbTotal)) return null;
  const qbTax = Number(freshInvoice?.TxnTaxDetail?.TotalTax ?? 0) || 0;
  const qbSubtotal = Number((qbTotal - qbTax).toFixed(2));
  const taxRate = qbSubtotal > 0 ? Number(((qbTax / qbSubtotal) * 100).toFixed(4)) : 0;
  const patch = { total: qbTotal, tax: qbTax, tax_rate: taxRate, qb_tax_hold: null };
  if (table === "invoices") {
    const date = today || new Date().toISOString().split("T")[0];
    const centsDelta = (a, b) => Math.abs(Number((Number(a) - Number(b)).toFixed(2)));
    let line = `[${date}] Synced from QuickBooks: total ${fmt(row?.total ?? 0)} → ${fmt(qbTotal)}`;
    if (centsDelta(row?.tax ?? 0, qbTax) > QB_MODIFIED_TOLERANCE) line += `, tax ${fmt(row?.tax ?? 0)} → ${fmt(qbTax)}`;
    const prior = typeof row?.notes === "string" ? row.notes.trim() : "";
    patch.notes = prior ? `${prior}\n${line}` : line;
  }
  return patch;
}

/**
 * Info-level bell row for an auto-adopted QB edit: the shop is told what
 * happened and that nothing is waiting on them.
 */
export function buildQbAutoSyncedNotification({
  shopOwner,
  ref,
  rowId,
  relatedEntity,
  qbInvoiceId,
  priorTotal,
  freshQbTotal,
  lineChanges = [],
}) {
  const changes = Array.isArray(lineChanges) ? lineChanges : [];
  const shown = changes.slice(0, 3);
  const detail = shown.length
    ? `What changed: ${shown.join("; ")}` +
      (changes.length > shown.length ? `; and ${changes.length - shown.length} more.` : ".") + " "
    : "";
  return buildNotificationRow({
    shopOwner,
    eventType: "qb_invoice_synced",
    severity: "info",
    title: `Invoice ${ref} updated from QuickBooks`,
    body:
      `QuickBooks changed this invoice to ${fmt(freshQbTotal)} (was ${fmt(priorTotal)}). ` +
      `InkTracker's total now matches — nothing to do. ` + detail +
      `Line edits made in QuickBooks are not applied to InkTracker's itemization.`,
    relatedEntity,
    relatedId: rowId,
    metadata: {
      qb_invoice_id: qbInvoiceId ?? null,
      qb_total: Number(freshQbTotal),
      prior_total: Number(priorTotal),
      line_changes: changes,
      auto_adopted: true,
    },
  });
}
