import { useEffect, useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { AlertCircle, CheckCircle2, CreditCard, Loader2, Lock } from "lucide-react";
import { CenteredCardSkeleton } from "@/components/shared/Skeletons";
import OnlinePaymentPanel from "@/components/payment/OnlinePaymentPanel";

// Customer pay page for an INVOICE (order-then-invoice flow) on shops that
// take payment through InkTracker. Opened from the "Pay Invoice" button in
// the invoice email/PDF: /invoicepayment?id=<invoice uuid>&token=<public_token>.
//
// Loading the page only reads InkTracker's own records (payRail): email link
// scanners open these links, and each payment session costs a Rainforest and
// QuickBooks round trip. The session is opened when the customer clicks Pay,
// and the amount always comes from the live QuickBooks balance.

export default function InvoicePayment() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const token = params.get("token");
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const [session, setSession] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!id || !token) {
      setError("This payment link is incomplete. Please use the link from your invoice email.");
      setLoading(false);
      return undefined;
    }
    let alive = true;
    base44.functions.invoke("rainforest", { action: "payRail", docType: "invoice", id, token })
      .then((r) => {
        if (!alive) return;
        if (r?.data?.error || !r?.data) setError("We couldn't find this invoice. Please use the link from your most recent invoice email.");
        else setInfo(r.data);
      })
      .catch(() => { if (alive) setError("This page couldn't load. Check your connection and try again."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, token]);

  async function openPayment() {
    setOpening(true);
    setNotice("");
    try {
      const r = await base44.functions.invoke("rainforest", { action: "payinSession", docType: "invoice", id, token });
      const d = r?.data;
      if (d?.payable && d.sessionKey && d.payinConfigId) setSession(d);
      else setNotice(d?.message || "Online payment isn't available right now. Please contact the shop.");
    } catch {
      setNotice("Online payment isn't available right now. Please try again in a moment.");
    } finally {
      setOpening(false);
    }
  }

  if (loading) return <CenteredCardSkeleton />;

  const d = info?.display || {};
  const blocked = error
    || (info?.rail === "qb" ? "Online payment on this page isn't available for this invoice. Please use the pay link in your latest invoice email, or contact the shop." : null);

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
        ) : info?.paid ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <CheckCircle2 className="w-4 h-4" /> This invoice is paid. Thank you!
          </div>
        ) : session ? (
          <OnlinePaymentPanel key={session.sessionKey} session={session} onReopen={() => { setSession(null); openPayment(); }} />
        ) : (
          <>
            {notice && (
              <div className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" /> {notice}
              </div>
            )}
            <button
              type="button"
              onClick={openPayment}
              disabled={opening}
              className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-bold py-4 rounded-xl transition flex items-center justify-center gap-2 text-base"
            >
              {opening ? <><Loader2 className="w-5 h-5 animate-spin" /> Opening payment…</> : <><CreditCard className="w-5 h-5" /> Pay invoice</>}
            </button>
          </>
        )}

        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Lock className="w-3 h-3" /> Secure payment powered by Rainforest
        </div>
      </div>
    </div>
  );
}
