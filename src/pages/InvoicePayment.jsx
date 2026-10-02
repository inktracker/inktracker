import { useEffect, useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { CenteredCardSkeleton } from "@/components/shared/Skeletons";
import OnlinePaymentPanel, { PaidNotice, readPaidReturn } from "@/components/payment/OnlinePaymentPanel";
import { isQBPaymentLink } from "@/lib/payment/resolveCheckoutTarget";

// Customer pay page for an INVOICE (order-then-invoice flow) on shops that
// take payment through InkTracker. Opened from the "Pay Invoice" button in
// the invoice email/PDF: /invoicepayment?id=<invoice uuid>&token=<public_token>.
//
// Loading the page only reads InkTracker's own records (payRail): email link
// scanners open these links, and each checkout costs a Stripe and QuickBooks
// round trip. Checkout opens when the customer picks card or bank, and the
// amount always comes from the live QuickBooks balance.

export default function InvoicePayment() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const token = params.get("token");
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [paidReturn] = useState(() => readPaidReturn());

  useEffect(() => {
    if (!id || !token) {
      setError("This payment link is incomplete. Please use the link from your invoice email.");
      setLoading(false);
      return undefined;
    }
    let alive = true;
    base44.functions.invoke("stripePayments", { action: "payRail", docType: "invoice", id, token })
      .then((r) => {
        if (!alive) return;
        if (r?.data?.error || !r?.data) setError("We couldn't find this invoice. Please use the link from your most recent invoice email.");
        else setInfo(r.data);
      })
      .catch(() => { if (alive) setError("This page couldn't load. Check your connection and try again."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, token]);

  if (loading) return <CenteredCardSkeleton />;

  const d = info?.display || {};
  // The shop went back to QuickBooks payments: send the customer there.
  const qbPayLink = info?.rail === "qb" && isQBPaymentLink(info?.qbPayLink) ? info.qbPayLink : null;
  const blocked = error
    || (info?.rail === "qb" && !qbPayLink && !info?.paid
      ? `${d.shopName || "The shop"} now takes payment through QuickBooks. Please contact ${d.shopName || "the shop"} for a new pay link.`
      : null);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        {(d.shopName || d.logoUrl) && (
          <div className="flex items-center gap-3">
            {d.logoUrl && <img src={d.logoUrl} alt="" className="h-10 w-auto max-w-[120px] object-contain" />}
            {d.shopName && <div className="text-base font-bold text-slate-900">{d.shopName}</div>}
          </div>
        )}
        <div>
          <h1 className="text-lg font-bold text-slate-900">Pay invoice{d.docNumber ? ` ${d.docNumber}` : ""}</h1>
          {d.customerName && <div className="text-sm text-slate-500">For {d.customerName}</div>}
        </div>

        {blocked ? (
          <div className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" /> {blocked}
          </div>
        ) : qbPayLink && !info?.paid ? (
          <a href={qbPayLink} className="block w-full text-center rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-3">
            Pay this invoice
          </a>
        ) : info?.paid ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <CheckCircle2 className="w-4 h-4" /> This invoice is paid. Thank you!
          </div>
        ) : paidReturn ? (
          <PaidNotice docType="invoice" id={id} token={token} paid={paidReturn}
            fallback={<OnlinePaymentPanel docType="invoice" id={id} token={token} pricing={info?.pricing} />} />
        ) : (
          <OnlinePaymentPanel docType="invoice" id={id} token={token} pricing={info?.pricing} />
        )}
      </div>
    </div>
  );
}
