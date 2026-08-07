// Edit Order — the pure decision engine (docs/edit-order-design.md).
//
// An order edit is a NEW agreement made explicitly and recorded loudly:
// the editor recomputes money deliberately, linked documents update by
// the decided policies (invoice auto-update with a dated note; quote by
// the shop's order_edit_quote_sync policy), and the change_log triggers
// record every field with the actor. This module holds every rule that
// doesn't need I/O, so the whole decision surface is unit-tested.

const clean = (s) => (typeof s === "string" ? s.trim() : "");
const fmtUsd = (n) => `$${Number(n || 0).toFixed(2)}`;

// ── Lifecycle tiers ─────────────────────────────────────────────────────────
// The linked-document state gates what's editable — not the status label.
export const EDIT_TIERS = Object.freeze({
  UNBILLED: 1,       // no invoice → full edit
  INVOICED: 2,       // local invoice → full edit, invoice auto-updates
  IN_QB: 3,          // QB invoice exists → money edits blocked until phase 2
  PAID_OR_DONE: 4,   // paid / completed → money edits blocked until phase 3
});

export function getOrderEditTier(order, linkedInvoice) {
  if (order?.status === "Completed") {
    return { tier: EDIT_TIERS.PAID_OR_DONE, reason: "This order is completed — history doesn't change. Use Reorder for a new run." };
  }
  if (linkedInvoice?.paid) {
    return { tier: EDIT_TIERS.PAID_OR_DONE, reason: "This order's invoice is paid. Editing paid work arrives with the billing policies (phase 3)." };
  }
  if (linkedInvoice?.qb_invoice_id) {
    // Phase 2: tier 3 is EDITABLE — money edits update the local invoice
    // and mark a push pending; the save flow offers the explicit "Push
    // update to QuickBooks" step (design). Customer switch stays blocked:
    // a QB invoice belongs to a QB customer (void+recreate is phase 3).
    return { tier: EDIT_TIERS.IN_QB, reason: null };
  }
  if (linkedInvoice) return { tier: EDIT_TIERS.INVOICED, reason: null };
  return { tier: EDIT_TIERS.UNBILLED, reason: null };
}

/**
 * What each tier permits. Tier 3's customer lock is the one asymmetry:
 * the QB invoice belongs to a QB customer — switching means void +
 * recreate in QuickBooks (phase 3).
 */
export function tierCapabilities(tier) {
  return {
    canEdit: tier <= EDIT_TIERS.IN_QB,
    canSwitchCustomer: tier <= EDIT_TIERS.INVOICED,
    pushRequired: tier === EDIT_TIERS.IN_QB,
  };
}

// ── Production guards ───────────────────────────────────────────────────────
// goods_progress is keyed `${lineIndex}-${size}` — the map's identity IS
// line position. Once any size is marked ordered/received, structural
// line changes (add/remove/reorder) would silently re-point every mark
// at the wrong garment, so they block; per-size quantity edits reconcile
// against the marks instead.

export function goodsMarkCount(order) {
  return Object.values(order?.checklist?.goods_progress || {})
    .filter((v) => v?.status === "ordered" || v?.status === "received").length;
}

function lineIdentity(li) {
  return li?.id ?? null;
}

export function isStructuralLineChange(originalLines, editedLines) {
  const a = (originalLines || []).map(lineIdentity);
  const b = (editedLines || []).map(lineIdentity);
  if (a.length !== b.length) return true;
  return a.some((id, i) => id !== b[i]);
}

/**
 * Blockers that make a save invalid (hard stops, not warnings).
 * Returns [] when the edit is safe.
 */
export function orderEditBlockers(order, editedLines) {
  const blockers = [];
  const originalLines = order?.line_items || [];
  const gp = order?.checklist?.goods_progress || {};
  const marks = goodsMarkCount(order);

  if (marks > 0 && isStructuralLineChange(originalLines, editedLines)) {
    blockers.push(
      `Goods are already marked ordered/received on this order (${marks} size${marks === 1 ? "" : "s"}). ` +
      `Adding, removing, or reordering garment lines would mis-point those marks — adjust quantities on existing lines instead, ` +
      `or clear the goods progress first.`,
    );
    return blockers; // structural + marked is terminal; per-size checks assume aligned indexes
  }

  editedLines.forEach((li, idx) => {
    const orig = originalLines[idx];
    if (!orig) return;
    const label = clean(li.customTitle) || [li.brand, li.style].filter(Boolean).join(" ") || `Line ${idx + 1}`;

    for (const [size, rawCount] of Object.entries(li?.sizes || {})) {
      const next = parseInt(rawCount) || 0;
      const mark = gp[`${idx}-${size}`]?.status;
      const shortfall = parseInt((li?._shortfall || {})[size]) || 0;
      if (mark === "received" && next < (parseInt(orig?.sizes?.[size]) || 0)) {
        blockers.push(
          `${label} / ${size}: goods are marked RECEIVED for this size — you can't reduce the quantity below what physically arrived. ` +
          `Record a shortfall or adjust the goods progress first.`,
        );
      }
      if (shortfall > next) {
        blockers.push(
          `${label} / ${size}: recorded shortfall (${shortfall}) exceeds the new quantity (${next}). Adjust the shortfall first.`,
        );
      }
    }
    // Sizes REMOVED while carrying a mark
    for (const [size, rawCount] of Object.entries(orig?.sizes || {})) {
      if ((parseInt(rawCount) || 0) <= 0) continue;
      const stillThere = (parseInt(li?.sizes?.[size]) || 0) > 0;
      const mark = gp[`${idx}-${size}`]?.status;
      if (!stillThere && (mark === "ordered" || mark === "received")) {
        blockers.push(
          `${label} / ${size}: this size is marked ${mark} in goods progress — clear that before removing the size.`,
        );
      }
    }
  });

  return blockers;
}

// ── Warnings (soft — save proceeds after acknowledgement) ───────────────────

export function orderEditWarnings(order, editedLines, { sourcePO } = {}) {
  const warnings = [];
  if (sourcePO) {
    warnings.push(
      `Purchase order ${sourcePO.po_number || ""} was built from this order's previous quantities — it is NOT auto-edited (a submitted PO is a real commitment). Review it after saving.`.replace("  ", " "),
    );
  }
  if (order?.art_approved && imprintsChanged(order?.line_items, editedLines)) {
    warnings.push(
      "Artwork/imprints changed — the customer's art approval was for the OLD art, so approval will be cleared and they'll need to re-approve.",
    );
  }
  return warnings;
}

// Art-approval reset: any change to the imprints arrays (art, locations,
// techniques, colors) invalidates the customer's sign-off. Quantity-only
// edits keep it.
export function imprintsChanged(originalLines, editedLines) {
  const proj = (lines) => JSON.stringify((lines || []).map((li) => li?.imprints ?? []));
  return proj(originalLines) !== proj(editedLines);
}

// ── Patch builders ──────────────────────────────────────────────────────────

const NOTE_DATE = (today) => `[${today}]`;

/**
 * Dated shop-facing note line appended to existing notes (the
 * buildSyncNote pattern — history accumulates, never overwrites).
 */
export function appendNote(existingNotes, line) {
  const prior = clean(existingNotes);
  return prior ? `${prior}\n${line}` : line;
}

/**
 * All patches an order edit produces. Money fields for `edited` arrive
 * ALREADY recomputed by the caller (the modal runs the pricing engine);
 * this function decides where they propagate.
 *
 * quoteSyncPolicy: 'keep_historical' (default) | 'sync_to_order'
 */
export function buildEditPatches({ order, edited, linkedInvoice, quote, quoteSyncPolicy = "keep_historical", today }) {
  const clearArt = order?.art_approved && imprintsChanged(order?.line_items, edited?.line_items);

  const orderPatch = {
    line_items: edited.line_items,
    customer_id: edited.customer_id,
    customer_name: edited.customer_name,
    due_date: edited.due_date ?? order.due_date ?? null,
    job_title: edited.job_title ?? order.job_title ?? "",
    notes: edited.notes ?? order.notes ?? "",
    subtotal: edited.subtotal,
    tax: edited.tax,
    total: edited.total,
    ...(clearArt ? { art_approved: false, art_approved_by: null, art_approved_at: null } : {}),
  };

  let invoicePatch = null;
  if (linkedInvoice && !linkedInvoice.paid) {
    // Tiers 2 AND 3 — DECIDED: auto-update the local invoice with the
    // dated shop-facing note. Tier 3 additionally marks qb_push_pending:
    // local truth is now NEWER than QuickBooks, and the flag both drives
    // the "Push update" flow and suppresses the Match banner (which
    // would tell the shop to revert their own edit).
    invoicePatch = {
      ...(linkedInvoice.qb_invoice_id ? { qb_push_pending: true } : {}),
      line_items: edited.line_items,
      subtotal: edited.subtotal,
      tax: edited.tax,
      total: edited.total,
      customer_id: edited.customer_id,
      customer_name: edited.customer_name,
      notes: appendNote(
        linkedInvoice.notes,
        `${NOTE_DATE(today)} Updated from order edit: total ${fmtUsd(linkedInvoice.total)} → ${fmtUsd(edited.total)}`,
      ),
    };
  }

  let quotePatch = null;
  if (quote) {
    if (quoteSyncPolicy === "sync_to_order") {
      quotePatch = {
        line_items: edited.line_items,
        subtotal: edited.subtotal,
        tax: edited.tax,
        total: edited.total,
        notes: appendNote(
          quote.notes,
          `${NOTE_DATE(today)} Updated to match order edit: total ${fmtUsd(quote.total)} → ${fmtUsd(edited.total)}`,
        ),
      };
    } else {
      // keep_historical — the quote stays the ORIGINAL agreement; one
      // dated marker (added once, not per edit) so nobody mistakes it
      // for current.
      const marker = `Order ${order.order_id} edited after conversion — this quote reflects the ORIGINAL agreement.`;
      if (!clean(quote.notes).includes(marker)) {
        quotePatch = { notes: appendNote(quote.notes, `${NOTE_DATE(today)} ${marker}`) };
      }
    }
  }

  return {
    orderPatch,
    invoicePatch,
    quotePatch,
    artApprovalCleared: !!clearArt,
    moneyDelta: Number((Number(edited.total || 0) - Number(order.total || 0)).toFixed(2)),
  };
}

// ── Stale-write guard ───────────────────────────────────────────────────────
// Snapshot at open, compare on save against a fresh read. Field-scoped so
// background qb_* mirror writes don't false-positive.
const CONFLICT_FIELDS = ["line_items", "customer_id", "due_date", "job_title", "notes", "total", "status"];

export function editConflict(openedSnapshot, freshRow) {
  if (!openedSnapshot || !freshRow) return false;
  return CONFLICT_FIELDS.some(
    (f) => JSON.stringify(openedSnapshot[f] ?? null) !== JSON.stringify(freshRow[f] ?? null),
  );
}
