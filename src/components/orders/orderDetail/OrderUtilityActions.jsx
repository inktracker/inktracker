import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Link2, Eye, Trash2, CheckCircle2, Truck, Handshake } from "lucide-react";
import { exportOrderToPDF } from "../../shared/pdfExport";
import ReactivateLink from "../../shared/ReactivateLink";

// Row 2 of the Order Detail footer: utility actions (share art/status
// links, preview PDF, create AS Colour PO, delete). Includes the
// tri-state ACOrderButton. Pure decomposition — moved verbatim from
// OrderDetailModal.jsx. Handlers + state stay owned by the parent.
export default function OrderUtilityActions({
  order,
  liveOrder,
  customer,
  shopName,
  logoUrl,
  copied,
  copyLink,
  onOrderFromAC,
  sourcePO,
  saving,
  onDelete,
  callAction,
  // Offer this order to a partner shop. Undefined unless the caller is a
  // shop/admin/manager on a writable order (parent gates it the same way it
  // gates onEditOrder), so this component doesn't need the role/readOnly logic.
  onSendToPartner,
  // Read-only (lapsed subscription): disable the write actions (create AS
  // Colour PO, delete order). Share-link / Preview PDF are reads and stay on.
  readOnly = false,
  reactivateHref,
}) {
  const roTitle = "Your subscription has ended — reactivate to make changes.";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => copyLink("art")}
        title="Share art approval link"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 transition"
      >
        <Link2 className="w-3.5 h-3.5" />
        {copied === "art" ? "Copied!" : "Art Approval Link"}
      </button>
      <button
        onClick={() => copyLink("status")}
        title="Share status link"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 transition"
      >
        <Link2 className="w-3.5 h-3.5" />
        {copied === "status" ? "Copied!" : "Status Link"}
      </button>
      {/* Preview opens the PDF in a new tab; the browser's
          native viewer has its own Download button, so we don't
          render a separate "Download PDF" pill here (matches
          Quote + Invoice modals). */}
      <button
        onClick={async () => {
          const url = await exportOrderToPDF(order, shopName, logoUrl, "blob", customer?.company);
          if (url) window.open(url, "_blank");
        }}
        title="Preview PDF"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 transition"
      >
        <Eye className="w-3.5 h-3.5" /> Preview
      </button>
      {onSendToPartner && (
        <button
          onClick={onSendToPartner}
          title="Offer this order — or specific lines — to a partner shop"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-700 border border-teal-300 bg-teal-50 rounded-lg hover:bg-teal-100 transition"
        >
          <Handshake className="w-3.5 h-3.5" /> Send to Partner
        </button>
      )}
      {/* The Create PO button only makes sense while the order is
          actively at the Order Goods stage — once blanks are in,
          placing a new PO from the same order is noise. Limits
          the footer to actions that are relevant to the current
          stage. */}
      {onOrderFromAC && liveOrder.status === "Order Goods" && (
        <ACOrderButton order={order} sourcePO={sourcePO} onOrderFromAC={onOrderFromAC} disabled={saving || readOnly} readOnly={readOnly} />
      )}
      <ReactivateLink show={readOnly} href={reactivateHref} className="ml-auto" />
      {onDelete && (
        <button
          onClick={() => callAction(onDelete, order.id)}
          disabled={saving || readOnly}
          title={readOnly ? roTitle : "Delete order"}
          className={`${readOnly ? "" : "ml-auto"} inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-400 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          {saving ? "Deleting…" : "Delete"}
        </button>
      )}
    </div>
  );
}

// Tri-state button beside Delete in the order footer.
//   no source PO       → "Order from AS Colour" (opens ACOrderModal)
//   draft source PO    → "View Pending PO" (links to /PurchaseOrders)
//   submitted PO       → "✓ Ordered" (links to /PurchaseOrders, read-only feel)
//
// The signal-it-was-ordered behaviour is what differentiates this from
// the old SS button which always invited a re-order.
function ACOrderButton({ order, sourcePO, onOrderFromAC, disabled, readOnly = false }) {
  if (sourcePO?.status === "submitted") {
    return (
      <Link
        to={createPageUrl("PurchaseOrders")}
        title={`Already ordered from AS Colour${sourcePO.supplier_order_id ? ` · ${sourcePO.supplier_order_id}` : ""}`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition"
      >
        <CheckCircle2 className="w-3.5 h-3.5" /> Ordered
      </Link>
    );
  }
  if (sourcePO?.status === "draft") {
    return (
      <Link
        to={createPageUrl("PurchaseOrders")}
        title="A draft PO exists for this order — open Purchase Orders to review and submit"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 border border-amber-200 bg-amber-50 rounded-lg hover:bg-amber-100 transition"
      >
        <Truck className="w-3.5 h-3.5" /> View Pending PO
      </Link>
    );
  }
  return (
    <button
      onClick={() => onOrderFromAC(order)}
      disabled={disabled}
      title={readOnly
        ? "Your subscription has ended — reactivate to create a PO."
        : "Create a draft AS Colour PO from this order's line items"}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Truck className="w-3.5 h-3.5" /> Create PO
    </button>
  );
}
