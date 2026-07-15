import { MessageSquare, CheckCircle2, Package } from "lucide-react";
import ReactivateLink from "../../shared/ReactivateLink";

// Row 1 of the Order Detail footer: workflow actions (status flow +
// invoice create/preview/send + QB link + mark-paid + close) and the
// best-effort QB push note. All handlers + state are owned by the parent
// and threaded in. Pure decomposition — moved verbatim from
// OrderDetailModal.jsx.
export default function OrderInvoiceActions({
  order,
  saving,
  onRevert,
  onAdvance,
  onShowInvoice,
  onComplete,
  onTogglePaid,
  onClose,
  prevStatus,
  nextStatus,
  relatedInvoice,
  creatingInvoice,
  qbPushNote,
  callAction,
  advanceWithGoodsGuard,
  handleCreateInvoice,
  handleOpenSend,
  onCreateSlip,
  // Read-only (lapsed subscription): disable the write actions in this row
  // (status flow, Create Invoice → QB, Send, Mark Paid). Preview Invoice /
  // View in QB / Close are reads and stay enabled. Defaults keep writable
  // users unchanged.
  readOnly = false,
  reactivateHref,
}) {
  const roTitle = "Your subscription has ended — reactivate to make changes.";
  return (
    <>
      {/* Row 1: workflow actions (status flow + payment) */}
      <div className="flex flex-wrap items-center gap-2">
        {onRevert && prevStatus && (
          <button
            onClick={() => callAction(onRevert, order.id)}
            disabled={saving || readOnly}
            title={readOnly ? roTitle : undefined}
            className="px-3 py-2 text-sm font-semibold text-slate-500 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← {prevStatus}
          </button>
        )}
        {onAdvance && nextStatus && (
          <button
            onClick={advanceWithGoodsGuard}
            disabled={saving || readOnly}
            title={readOnly ? roTitle : undefined}
            className="px-4 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : `${order.status} Complete →`}
          </button>
        )}
        {/* Invoice action — three states:
              1. Order Completed + invoice exists → "Preview Invoice" (opens InvoiceDetailModal via parent)
              2. Order Completed + no invoice    → "Create Invoice" (calls onComplete)
              3. Order Completed + invoice has qb_invoice_id → also show "View in QB" link
            The "Create" path was previously labeled "Convert to Invoice" and
            ran on every click — Joe found that this duplicated invoices when
            a quote had already been invoiced via the Send-Quote-via-QB flow.
            The dedup guard is enforced at three layers now:
              - This UI gate (no Create button when invoice exists)
              - handleComplete's pre-fetch + buildOrderCompletionPlan
              - DB unique index on (shop_owner, order_id) in
                20260519_invoices_no_duplicates.sql */}
        {order.status === "Completed" && relatedInvoice && (
          <>
            {onShowInvoice && (
              <button
                onClick={() => onShowInvoice(relatedInvoice)}
                className="px-4 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition"
              >
                Preview Invoice
              </button>
            )}
            {/* Send the invoice to the customer (Resend email + QB pay
                link when one exists). Reuses the standard Send flow; for
                already-paid invoices it sends the PDF as a receipt. */}
            <button
              onClick={handleOpenSend}
              disabled={readOnly}
              title={readOnly ? roTitle : undefined}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MessageSquare className="w-4 h-4" /> Send
            </button>
            {relatedInvoice.qb_invoice_id && (
              <a
                href={`https://qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(relatedInvoice.qb_invoice_id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 text-sm font-semibold text-[#2CA01C] border border-[#2CA01C] rounded-xl hover:bg-[#2CA01C]/5 transition"
              >
                View in QB
              </a>
            )}
          </>
        )}
        {order.status === "Completed" && !relatedInvoice && onComplete && (
          <button
            onClick={handleCreateInvoice}
            disabled={saving || creatingInvoice || readOnly}
            title={readOnly ? roTitle : undefined}
            className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creatingInvoice ? "Creating…" : "Create Invoice"}
          </button>
        )}
        {/* Packing slip — finished orders only. Opens the confirm-quantities
            modal (ordered minus recorded misprints, editable) before the
            price-free PDF preview. */}
        {order.status === "Completed" && onCreateSlip && (
          <button
            onClick={onCreateSlip}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-teal-700 border border-teal-300 bg-teal-50 hover:bg-teal-100 rounded-xl transition"
          >
            <Package className="w-4 h-4" /> Create Slip
          </button>
        )}
        {onTogglePaid && (
          <button
            onClick={() => callAction(onTogglePaid, order)}
            disabled={saving || readOnly}
            title={readOnly ? roTitle : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl border transition disabled:opacity-50 disabled:cursor-not-allowed ${
              order.paid
                ? "text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                : "text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {order.paid ? "Unmark Paid" : "Mark Paid"}
          </button>
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
