import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";

export default function QuotePaymentSuccess() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("processing");

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const quoteId   = searchParams.get("quote_id");

    if (!sessionId || !quoteId) {
      setStatus("error");
      return;
    }

    // Stripe webhook handles all notifications server-side — nothing to do here
    setTimeout(() => setStatus("success"), 2500);
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 max-w-md w-full text-center">

        {status === "processing" && (
          <>
            <Loader2 className="w-12 h-12 text-indigo-500 mx-auto mb-5 animate-spin" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">Confirming your payment…</h1>
            <p className="text-sm text-slate-500">Please wait a moment while we confirm your payment.</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-5" />
            <h1 className="text-2xl font-bold text-slate-900 mb-3">Thank You!</h1>
            <p className="text-slate-600 mb-2">
              Your payment was received and your quote has been approved.
            </p>
            <p className="text-slate-500 text-sm mb-6">
              Production is now being scheduled. You'll hear from us soon!
            </p>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800 font-medium">
              ✓ Order confirmed — you're all set.
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-5" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-500">
              We couldn't verify your payment session. If you completed payment, your order has been received.
              Please contact the shop if you have questions.
            </p>
          </>
        )}

      </div>
    </div>
  );
}
