// Small chips that ride next to an order's status Badge in the office views.
//
// NeedsInvoicingFlag — the Shop Floor marked the job Completed (production
// done, completed_date stamped) but the money side hasn't run: no invoice,
// no performance rows. Cleared by runOrderCompletion when the office clicks
// Create Invoice on the order. Lives on orders.floor_completed_at.
export function needsInvoicing(order) {
  return !!(order && order.status === "Completed" && order.floor_completed_at);
}

export function NeedsInvoicingFlag({ order, className = "" }) {
  if (!needsInvoicing(order)) return null;
  return (
    <span
      title="Finished on the shop floor. Open the order and click Create Invoice to finish it."
      className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5 whitespace-nowrap ${className}`}
    >
      Needs invoicing
    </span>
  );
}
