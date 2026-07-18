import { useState } from "react";
import ModalBackdrop from "../shared/ModalBackdrop";
import { O_STATUSES, fmtMoney } from "../shared/pricing";

// Collects the two inputs an imported-invoice order can't infer:
// the PRODUCTION due date (QB's DueDate is a payment due date — never
// pre-fill from it) and the starting production status. The heavy
// lifting (dedupe decision, order create, backlink write) lives in
// Invoices.jsx handleAddToProduction — this modal is inputs-only.
export default function AddToProductionModal({ invoice, busy, onConfirm, onClose }) {
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState("Art Approval");

  return (
    <ModalBackdrop onClose={busy ? () => {} : onClose} z="z-[130]">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Add to Production</h2>
          <p className="text-xs text-slate-500 mt-1">
            Creates a production order for invoice {invoice.invoice_id} ({fmtMoney(Number(invoice.total) || 0)})
            so it shows on the schedule. The invoice stays linked — a QuickBooks payment marks both paid.
          </p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label htmlFor="atp-due" className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Production due date
            </label>
            <input
              id="atp-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              When the job needs to be done — not the invoice&apos;s payment due date.
            </p>
          </div>
          <div>
            <label htmlFor="atp-status" className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Starting status
            </label>
            <select
              id="atp-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"
            >
              {O_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-xs font-semibold text-slate-500 hover:text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ dueDate: dueDate || null, status })}
            disabled={busy}
            className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Adding…" : "Add to Production"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
