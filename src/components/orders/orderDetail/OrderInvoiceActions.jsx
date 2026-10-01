import { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { MoreHorizontal, CheckCircle2, Truck } from "lucide-react";
import { exportOrderToPDF, previewPdf } from "../../shared/pdfExport";
import ReactivateLink from "../../shared/ReactivateLink";
import { buildOrderActionPlan } from "@/lib/orders/orderActionPlan";

// Order Detail footer — ONE state-driven primary action + a ⋯ More menu
// (Joe, 2026-10-01: the old two-row, 11+-peer-button footer made every click
// a scan). WHICH actions exist and WHEN they're enabled is decided by the
// pure, unit-tested buildOrderActionPlan — the gates there are copied
// verbatim from the old rows (Send only at Completed, Create Invoice only
// when no invoice exists, reads stay enabled under readOnly, Delete last and
// separated, …). This file is only rendering + click-dispatch.
//
// The one stage-relevant exception kept inline: the tri-state Create PO /
// View Pending PO / Ordered button during Order Goods — ordering blanks IS
// that stage's real work, so it sits beside the primary instead of in More.
export default function OrderInvoiceActions({
  order,
  liveOrder,
  customer,
  shopName,
  logoUrl,
  copied,
  copyLink,
  saving,
  onRevert,
  onAdvance,
  onShowInvoice,
  onComplete,
  onTogglePaid,
  onClose,
  onDelete,
  onSendToPartner,
  onOrderFromAC,
  sourcePO,
  prevStatus,
  nextStatus,
  relatedInvoice,
  creatingInvoice,
  qbPushNote,
  callAction,
  advanceWithGoodsGuard,
  handleCreateInvoice,
  handleResyncInvoice,
  handleOpenSend,
  onCreateSlip,
  onPrintTicket,
  onEditOrder,
  editOrderDisabledReason,
  readOnly = false,
  reactivateHref,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const plan = buildOrderActionPlan({
    order,
    relatedInvoice,
    readOnly,
    saving,
    creatingInvoice,
    prevStatus,
    nextStatus,
    editOrderDisabledReason,
    copied,
    has: {
      onRevert: !!onRevert,
      onAdvance: !!onAdvance,
      onShowInvoice: !!onShowInvoice,
      onComplete: !!onComplete,
      onTogglePaid: !!onTogglePaid,
      handleResyncInvoice: !!handleResyncInvoice,
      onCreateSlip: !!onCreateSlip,
      onPrintTicket: !!onPrintTicket,
      onEditOrder: !!onEditOrder,
      copyLink: !!copyLink,
      onPreviewPdf: true,
      onSendToPartner: !!onSendToPartner,
      onDelete: !!onDelete,
    },
  });

  // Key → the existing handler, unchanged behavior.
  const dispatch = {
    advance: () => advanceWithGoodsGuard(),
    createInvoice: () => handleCreateInvoice(),
    send: () => handleOpenSend(),
    revert: () => callAction(onRevert, order.id),
    previewInvoice: () => onShowInvoice(relatedInvoice),
    resyncQb: () => handleResyncInvoice(),
    editOrder: () => onEditOrder(),
    printTicket: () => onPrintTicket(),
    createSlip: () => onCreateSlip(),
    togglePaid: () => callAction(onTogglePaid, order),
    artLink: () => copyLink("art"),
    statusLink: () => copyLink("status"),
    // previewPdf keeps the popup tied to the click gesture (mobile Safari);
    // in-app it renders natively where window.open of a blob is a no-op.
    previewPdf: () => previewPdf(exportOrderToPDF(order, shopName, logoUrl, "blob", customer?.company)),
    sendToPartner: () => onSendToPartner(),
    delete: () => callAction(onDelete, order.id),
  };

  const runMenuItem = (item) => {
    if (!item.keepOpen) setMenuOpen(false);
    dispatch[item.key]?.();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {plan.primary && (
          <button
            onClick={plan.primary.disabled ? undefined : dispatch[plan.primary.key]}
            disabled={plan.primary.disabled}
            title={plan.primary.title}
            className="px-5 py-2.5 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {plan.primary.label}
          </button>
        )}

        {/* Ordering blanks is the Order Goods stage's actual work — inline. */}
        {onOrderFromAC && (liveOrder || order)?.status === "Order Goods" && (
          <ACOrderButton
            order={order}
            sourcePO={sourcePO}
            onOrderFromAC={onOrderFromAC}
            disabled={saving || readOnly}
            readOnly={readOnly}
          />
        )}

        {plan.menu.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-slate-600 border border-slate-300 bg-white hover:bg-slate-50 rounded-xl transition"
            >
              <MoreHorizontal className="w-4 h-4" /> More
            </button>
            {menuOpen && (
              <>
                {/* click-away layer */}
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                {/* Mobile: a FIXED bottom sheet — the old absolute popover was
                    anchored inside the modal's scroll container, so on phones
                    it rendered clipped/off-screen and needed a swipe to find
                    (Joe, 2026-10-01). Fixed positioning escapes the scroll
                    container and lands thumb-reachable at the bottom edge.
                    sm+ keeps the anchored popover above the button. */}
                <div
                  role="menu"
                  className="fixed left-3 right-3 bottom-3 z-50 max-h-[70vh] overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-2xl py-1.5 sm:absolute sm:left-0 sm:right-auto sm:bottom-full sm:mb-2 sm:min-w-[240px] sm:rounded-xl sm:shadow-xl"
                >
                  {plan.menu.map((item) =>
                    item.divider ? (
                      <div key={item.key} className="my-1.5 border-t border-slate-100" />
                    ) : item.href ? (
                      <a
                        key={item.key}
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className="block px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <button
                        key={item.key}
                        role="menuitem"
                        onClick={item.disabled ? undefined : () => runMenuItem(item)}
                        disabled={item.disabled}
                        title={item.title}
                        className={`block w-full text-left px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${
                          item.danger ? "text-red-500 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {item.label}
                      </button>
                    ),
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <ReactivateLink show={readOnly} href={reactivateHref} className="ml-auto" />
        <button
          onClick={onClose}
          className={`${readOnly ? "" : "ml-auto"} px-4 py-2 text-sm font-semibold text-slate-500 rounded-xl hover:bg-slate-100 transition`}
        >
          Close
        </button>
      </div>

      {/* Best-effort QB push outcome (tax hold / push failure). The invoice
          still exists; the operator can Send or fix QB and retry. */}
      {qbPushNote && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {qbPushNote}
        </div>
      )}
    </>
  );
}

// Tri-state button shown during Order Goods.
//   no source PO    → "Create PO" (supplier-aware draft per supplier via
//                      ensurePoDraftsForOrder)
//   draft source PO → "View Pending PO" (links to /PurchaseOrders)
//   submitted PO    → "✓ Ordered" (links there, read-only feel)
// The signal-it-was-ordered behavior is what differentiates this from the
// old SS button which always invited a re-order.
function ACOrderButton({ order, sourcePO, onOrderFromAC, disabled, readOnly = false }) {
  if (sourcePO?.status === "submitted") {
    return (
      <Link
        to={`${createPageUrl("PurchaseOrders")}?po=${sourcePO.id}`}
        title={`Already ordered from ${sourcePO.supplier || "the supplier"}${sourcePO.supplier_order_id ? ` · ${sourcePO.supplier_order_id}` : ""}`}
        className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition"
      >
        <CheckCircle2 className="w-4 h-4" /> Ordered
      </Link>
    );
  }
  if (sourcePO?.status === "draft") {
    return (
      <Link
        to={`${createPageUrl("PurchaseOrders")}?po=${sourcePO.id}`}
        title="A draft PO exists for this order — open it to review and submit"
        className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-amber-700 border border-amber-200 bg-amber-50 rounded-xl hover:bg-amber-100 transition"
      >
        <Truck className="w-4 h-4" /> View Pending PO
      </Link>
    );
  }
  return (
    <button
      onClick={() => onOrderFromAC(order)}
      disabled={disabled}
      title={readOnly
        ? "Your subscription has ended — reactivate to create a PO."
        : "Create a draft PO from this order's line items (one per supplier)"}
      className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-teal-600 border border-teal-200 rounded-xl hover:bg-teal-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Truck className="w-4 h-4" /> Create PO
    </button>
  );
}
