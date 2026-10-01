// One-next-step plan for the Order Detail footer (Joe, 2026-10-01: "things
// are starting to feel clunky"). The old bar rendered up to 11 peer buttons
// at once; almost all were wrong for the order's current stage. This helper
// decides THE one primary action from state, and which remaining actions
// belong in the ⋯ More menu — pure and unit-tested so the visibility gates
// (which all predate this change) can never silently drift:
//   - Preview Invoice / View in QB: whenever a linked invoice exists, any
//     status (invoice-born orders carry one from day one).
//   - Send: only at Completed (mid-production sends would change when
//     customers get billed).
//   - Create Invoice: only at Completed with no invoice (dedup guard layer 1).
//   - Create Slip: Completed only. Print Ticket: every status.
//   - readOnly (lapsed subscription): write actions disabled, reads stay.
//
// Returns { primary, menu }:
//   primary: { key, label, disabled, title } | null
//   menu:    [{ key, label, disabled, title, href? }, ...] in display order.
export function buildOrderActionPlan({
  order,
  relatedInvoice = null,
  readOnly = false,
  saving = false,
  creatingInvoice = false,
  prevStatus = null,
  nextStatus = null,
  editOrderDisabledReason = null,
  copied = null, // "art" | "status" | null — drives the Copied! label swap
  has = {}, // handlers the parent threaded in: onRevert, onAdvance, onShowInvoice, onComplete, onTogglePaid, handleResyncInvoice, onCreateSlip, onPrintTicket, onEditOrder, copyLink, onPreviewPdf, onSendToPartner, onDelete
} = {}) {
  const roTitle = "Your subscription has ended — reactivate to make changes.";
  const completed = order?.status === "Completed";
  const menu = [];

  // ── The one primary action ──────────────────────────────────────────
  let primary = null;
  if (!completed && has.onAdvance && nextStatus) {
    primary = {
      key: "advance",
      label: saving ? "Saving…" : `Finish ${order?.status || ""} →`,
      disabled: saving || readOnly,
      title: readOnly ? roTitle : undefined,
    };
  } else if (completed && !relatedInvoice && has.onComplete) {
    primary = {
      key: "createInvoice",
      label: creatingInvoice ? "Creating…" : (order?.floor_completed_at ? "Create Invoice & finish" : "Create Invoice"),
      disabled: saving || creatingInvoice || readOnly,
      title: readOnly ? roTitle : undefined,
    };
  } else if (completed && relatedInvoice) {
    primary = {
      key: "send",
      label: order?.paid ? "Send Receipt" : "Send Invoice",
      disabled: readOnly,
      title: readOnly ? roTitle : undefined,
    };
  }

  // ── Everything else, tucked into ⋯ More (same gates as the old bar) ──
  if (has.onRevert && prevStatus) {
    menu.push({ key: "revert", label: `← Back to ${prevStatus}`, disabled: saving || readOnly, title: readOnly ? roTitle : undefined });
  }
  if (relatedInvoice && has.onShowInvoice) {
    menu.push({ key: "previewInvoice", label: "Preview Invoice", disabled: false });
  }
  if (relatedInvoice?.qb_invoice_id) {
    menu.push({
      key: "viewQb",
      label: "View in QuickBooks",
      disabled: false,
      href: `https://qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(relatedInvoice.qb_invoice_id)}`,
    });
  }
  if (relatedInvoice && has.handleResyncInvoice) {
    menu.push({
      key: "resyncQb",
      label: creatingInvoice ? "Syncing…" : (relatedInvoice.qb_invoice_id ? "Resync with QuickBooks" : "Sync to QuickBooks"),
      disabled: creatingInvoice || readOnly,
      title: readOnly ? roTitle : "Create or update this invoice in QuickBooks",
    });
  }
  if (has.onEditOrder) {
    menu.push({
      key: "editOrder",
      label: "Edit Order",
      disabled: !!editOrderDisabledReason || readOnly,
      title: editOrderDisabledReason || (readOnly ? roTitle : undefined),
    });
  }
  if (has.onPrintTicket) {
    menu.push({ key: "printTicket", label: "Print Ticket", disabled: false });
  }
  if (completed && has.onCreateSlip) {
    menu.push({ key: "createSlip", label: "Create Packing Slip", disabled: false });
  }
  if (has.onTogglePaid) {
    menu.push({
      key: "togglePaid",
      label: order?.paid ? "Unmark Paid" : "Mark Paid",
      disabled: saving || readOnly,
      title: readOnly ? roTitle : undefined,
    });
  }

  // ── Utility section (the old footer row 2, same gates) ──────────────
  const utility = [];
  if (has.copyLink) {
    // keepOpen: the "Copied!" label swap must be visible, so these two
    // don't dismiss the menu on click.
    utility.push({ key: "artLink", label: copied === "art" ? "Copied!" : "Copy Art Approval Link", disabled: false, keepOpen: true });
    utility.push({ key: "statusLink", label: copied === "status" ? "Copied!" : "Copy Status Link", disabled: false, keepOpen: true });
  }
  if (has.onPreviewPdf) {
    utility.push({ key: "previewPdf", label: "Preview Order PDF", disabled: false });
  }
  if (has.onSendToPartner) {
    utility.push({ key: "sendToPartner", label: "Send to Partner", disabled: false, title: "Offer this order — or specific lines — to a partner shop" });
  }
  if (utility.length && menu.length) menu.push({ key: "divider-utility", divider: true });
  menu.push(...utility);

  // ── Danger, always last and visually separated ──────────────────────
  if (has.onDelete) {
    if (menu.length) menu.push({ key: "divider-danger", divider: true });
    menu.push({
      key: "delete",
      label: saving ? "Deleting…" : "Delete Order",
      disabled: saving || readOnly,
      title: readOnly ? roTitle : "Delete order",
      danger: true,
    });
  }

  return { primary, menu };
}
