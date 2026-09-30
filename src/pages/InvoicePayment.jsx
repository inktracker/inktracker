import { useEffect, useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { AlertCircle, Lock } from "lucide-react";
import { CenteredCardSkeleton } from "@/components/shared/Skeletons";
import OnlinePaymentPanel from "@/components/payment/OnlinePaymentPanel";

// Customer pay page for an INVOICE (order-then-invoice flow) on shops that
// take payment through InkTracker. Opened from the "Pay Invoice" button in
// the invoice email/PDF: /invoicepayment?id=<invoice uuid>&token=<public_token>.
// The amount always comes from the live QuickBooks balance, server-side.

export default function InvoicePayment() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const token = params.get("token");
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id || !token) {
      setError("This payment link is incomplete. Please use the link from your invoice email.");
      setLoading(false);
      return undefined;
    }
    let alive = true;
    base44.functions.invoke("rainforest", { action: "payinSession", docType: "invoice", id, token })
      .then((r) => {
        if (!alive) return;
        if (r?.data?.error || !r?.data) setError("We couldn't find this invoice. Please use the link from your most recent invoice email.");
        else setResult(r.data);
      })
      .catch(() => { if (alive) setError("This page couldn't load. Check your connection and try again."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, token]);

  if (loading) return <CenteredCardSkeleton />;

  const d = result?.display || {};
  const message = error
    || (result?.rail === "qb" ? "Online payment on this page isn't available for this invoice. Please use the pay link in your latest invoice email, or contact the shop." : null)
    || (result && !result.payable ? result.message : null);

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

        {message ? (
          <div className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" /> {message}
          </div>
        ) : (
          <OnlinePaymentPanel session={result} />
        )}

        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Lock className="w-3 h-3" /> Secure payment powered by Rainforest
        </div>
      </div>
    </div>
  );
}
