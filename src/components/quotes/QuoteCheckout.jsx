import { useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { AlertCircle, Loader2, CreditCard, Lock } from "lucide-react";
import { fmtMoney } from "../shared/pricing";

export default function QuoteCheckout({ quote, shopName, totals }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Allow passing pre-computed totals or fall back to quote fields
  const total = totals?.total ?? quote.total ?? 0;
  const sub = totals?.sub ?? quote.subtotal ?? 0;
  const tax = totals?.tax ?? quote.tax ?? 0;
  const disc = parseFloat(quote.discount || 0);

  async function handleCheckout() {
    // Block checkout from iframe
    if (window.self !== window.top) {
      alert("Payment checkout requires opening in a new window. Please open this page directly in your browser.");
      window.open(window.location.href, "_blank");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await base44.functions.invoke("createCheckoutSession", {
        quoteId: quote.id,
        quoteTotal: total,
        customerEmail: quote.customer_email || quote.sent_to || "",
        customerName: quote.customer_name || "Customer",
        shopName: shopName || "Shop",
      });

      if (response.data?.url) {
        window.location.href = response.data.url;
      } else {
        setError(response.data?.error || "Failed to create checkout session.");
      }
    } catch (err) {
      console.error("Checkout error:", err);
      setError(err.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h3 className="text-base font-bold text-slate-900 mb-1">Ready to Approve?</h3>
      <p className="text-sm text-slate-500 mb-5">
        Click below to approve this quote and complete payment. Production begins after payment is received.
      </p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}

      {/* Summary */}
      <div className="bg-slate-50 rounded-xl p-4 mb-5 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Subtotal</span>
          <span className="font-semibold text-slate-800">{fmtMoney(sub)}</span>
        </div>
        {disc > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Discount ({disc}%)</span>
            <span className="font-semibold text-emerald-600">−{fmtMoney(sub - (totals?.afterDisc ?? sub * (1 - disc / 100)))}</span>
          </div>
        )}
        <div className="flex justify-between text-sm pb-2 border-b border-slate-200">
          <span className="text-slate-500">Tax</span>
          <span className="font-semibold text-slate-800">{fmtMoney(tax)}</span>
        </div>
        <div className="flex justify-between pt-1">
          <span className="font-bold text-slate-900">Total Due</span>
          <span className="text-xl font-black text-indigo-700">{fmtMoney(total)}</span>
        </div>
      </div>

      <button
        onClick={handleCheckout}
        disabled={loading}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold py-3.5 rounded-xl transition flex items-center justify-center gap-2 text-base"
      >
        {loading ? (
          <><Loader2 className="w-4 h-4 animate-spin" />Processing...</>
        ) : (
          <><CreditCard className="w-5 h-5" />Approve &amp; Pay {fmtMoney(total)}</>
        )}
      </button>

      <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
        <Lock className="w-3 h-3" />
        Secure payment powered by Stripe
      </div>
    </div>
  );
}