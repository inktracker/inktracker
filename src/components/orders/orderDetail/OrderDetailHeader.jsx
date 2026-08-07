import { Fragment } from "react";
import Badge from "../../shared/Badge";
import { fmtDate, O_STATUSES } from "../../shared/pricing";
import { normalizeAssignedPress } from "@/lib/presses/normalizePresses";

// Header + production-progress pipeline for the Order Detail modal. Shows
// the order id / client / job / dates / artwork + press chips, the paid
// badge, and the clickable stage pipeline. Pure decomposition — moved
// verbatim from OrderDetailModal.jsx. Derived display values
// (displayClient, displayJobTitle, artworkFiles) are threaded in.
export default function OrderDetailHeader({
  order,
  qbPushPending = false,
  displayClient,
  displayJobTitle,
  artworkFiles,
  onClose,
  onAdvance,
  onRevert,
  // Read-only (lapsed subscription): the clickable stage pipeline advances /
  // reverts status — a write. Disable those transitions but keep the pipeline
  // fully visible so the operator can still read where the job stands.
  readOnly = false,
}) {
  return (
    <>
      <div className="flex justify-between items-start px-4 sm:px-6 py-5 border-b border-slate-200 dark:border-slate-700">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">
            {order.order_id} {order.quote_id && `· ${order.quote_id}`}
          </div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {displayClient}
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            {displayJobTitle && (
              <div className="text-sm text-slate-500">Job: {displayJobTitle}</div>
            )}
            {(order.order_date || order.date) && (
              <div className="text-sm text-slate-500">Ordered: {fmtDate(order.order_date || order.date)}</div>
            )}
            {order.due_date && (
              <div className="text-sm text-slate-500">Due: {fmtDate(order.due_date)}</div>
            )}
            {artworkFiles.length > 0 && (
              <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-2.5 py-1 rounded-full">
                {artworkFiles.length} artwork file{artworkFiles.length === 1 ? "" : "s"}
              </span>
            )}
            {normalizeAssignedPress(order.assigned_press) && (
              <span className="text-[11px] font-semibold text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">
                {normalizeAssignedPress(order.assigned_press)}
              </span>
            )}
            {order.assigned_operator && (
              <span className="text-[11px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-100 px-2.5 py-1 rounded-full">
                {order.assigned_operator}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Badge s={order.status} />
          {qbPushPending && (
            <span
              className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full"
              title="This order's invoice was edited locally — QuickBooks still shows the previous version. Open the invoice to push the update."
            >
              QB out of date
            </span>
          )}
          {order.paid ? (
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              Paid
            </span>
          ) : (
            <span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">
              Unpaid
            </span>
          )}
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Production Progress Pipeline.
          Chips distributed evenly across the row — connectors use
          flex-1 to absorb extra width. Per-step notes popover was
          removed on 2026-05-12 (Joe's polish pass). stepNotes state
          still persists via handleSaveJobCost so the order's
          step_notes column isn't broken — just no inline editor
          here. */}
      <div className="px-3 sm:px-6 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-x-auto">
        <div className="flex items-center w-full min-w-max sm:min-w-0">
          {O_STATUSES.map((s, i) => {
            const currentIdx = O_STATUSES.indexOf(order.status);
            const done = i < currentIdx;
            const active = i === currentIdx;
            const isLast = i === O_STATUSES.length - 1;
            return (
              <Fragment key={s}>
                <button
                  onClick={() => {
                    if (i === currentIdx) return;
                    if (onAdvance && i === currentIdx + 1) onAdvance(order.id);
                    else if (onRevert && i === currentIdx - 1) onRevert(order.id);
                  }}
                  disabled={readOnly || Math.abs(i - currentIdx) > 1}
                  title={readOnly ? "Your subscription has ended — reactivate to change status." : undefined}
                  className={`flex items-center gap-1 sm:gap-1.5 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-semibold transition whitespace-nowrap ${
                    active ? "bg-teal-600 text-white shadow-sm" :
                    done ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 cursor-pointer" :
                    i === currentIdx + 1 ? "bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-slate-700 hover:border-teal-300 hover:text-teal-600 cursor-pointer" :
                    "bg-white dark:bg-slate-900 text-slate-300 border border-slate-100 dark:border-slate-700"
                  }`}
                >
                  {done && <span>✓</span>}
                  {s}
                </button>
                {!isLast && (
                  <div className={`flex-1 h-0.5 mx-1 sm:mx-2 ${done ? "bg-emerald-300" : "bg-slate-200"}`} />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </>
  );
}
