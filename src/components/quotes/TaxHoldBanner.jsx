// QuickBooks tax-hold surfaces: the blocking banner (quote + invoice
// modals) and the list chip. Reads quotes/invoices.qb_tax_hold via
// qbTaxHoldState; the hold itself is written by qbSync createInvoice and
// cleared by "Use QuickBooks' tax" (acceptQbTax), a clean re-sync, or the
// penny auto-adopt. Replaces the qb_tax_mismatch bell notification
// (2026-09-28): the decision belongs where the send happens, not in a
// notification tray. Layout follows the feedback rule: a solid action, no
// AI-pill outline chips; window.confirm is not needed because the button
// itself IS the explicit consent (same as the old held-send button).
import { fmtMoney } from "../shared/pricing";
import { qbTaxHoldState } from "@/lib/quotes/qbTaxHold";

export function TaxHoldBanner({ hold, entity = "quote", onAccept, accepting = false, readOnly = false, acceptLabel }) {
  if (!hold) return null;
  const noun = entity === "invoice" ? "invoice" : "quote";
  return (
    <div
      role="alert"
      className="text-[12px] text-rose-900 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5 mt-1 space-y-2"
    >
      <div>
        <span className="font-semibold">On hold — QuickBooks calculated a different sales tax.</span>{" "}
        {hold.missingTax ? (
          <>
            This {noun} estimated {fmtMoney(hold.quotedTax)} in tax but QuickBooks recorded none
            (customer may be tax-exempt in QuickBooks, or the address has no tax). Nothing has been sent to the customer.
          </>
        ) : (
          <>
            QuickBooks computed {fmtMoney(hold.qbTax)} for this customer&rsquo;s address; the {noun} estimated{" "}
            {fmtMoney(hold.quotedTax)} ({fmtMoney(Math.abs(hold.taxDrift))} {hold.taxDrift > 0 ? "more" : "less"}).
            QuickBooks total {fmtMoney(hold.qbTotal)} vs {fmtMoney(hold.quotedTotal)} here. Nothing has been sent to the customer.
          </>
        )}
      </div>
      <div className="text-[11px] text-rose-800">
        Use QuickBooks&rsquo; number (it follows the customer&rsquo;s address and tax status), or fix the {noun}&rsquo;s tax rate /
        the customer&rsquo;s QuickBooks tax setup and re-sync.
      </div>
      {!readOnly && onAccept && (
        <button
          type="button"
          onClick={onAccept}
          disabled={accepting}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#2CA01C] hover:bg-[#238516] px-3 py-1.5 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {accepting ? "Applying…" : (acceptLabel || `Use QuickBooks' tax (${fmtMoney(hold.qbTotal)})`)}
        </button>
      )}
    </div>
  );
}

/** List chip — same visual weight as the other MetaTags, rose so it reads as blocking. */
export function TaxHoldChip({ row }) {
  const hold = qbTaxHoldState(row);
  if (!hold) return null;
  return (
    <span
      title={`On hold: QuickBooks calculated ${fmtMoney(hold.qbTax)} sales tax vs ${fmtMoney(hold.quotedTax)} estimated. Open to resolve — nothing has been sent to the customer.`}
      className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5 whitespace-nowrap"
    >
      Tax hold
    </span>
  );
}
