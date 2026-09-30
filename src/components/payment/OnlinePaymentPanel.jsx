import { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { loadRainforestScript } from "@/lib/payment/rainforestScript";
import { readApproved } from "@/lib/payment/rainforestEvents";

// The customer-facing card / bank form (Rainforest's payment component) for
// one payin config. Card and bank details go straight to Rainforest; they
// never touch InkTracker. `session` comes from the rainforest edge function's
// payinSession action. After approval the webhook records the payment in
// QuickBooks; this only shows the customer what happened.

const fmt = (cents) => `$${(Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function OnlinePaymentPanel({ session, onPaid }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [declined, setDeclined] = useState("");
  const [paid, setPaid] = useState(null); // { method }

  useEffect(() => {
    let alive = true;
    loadRainforestScript(session.scriptUrl)
      .then(() => { if (alive) setReady(true); })
      .catch(() => { if (alive) setLoadError("The payment form couldn't load. Check your connection and refresh the page."); });
    return () => { alive = false; };
  }, [session.scriptUrl]);

  useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return undefined;
    const onApproved = (e) => {
      const r = readApproved(e.detail);
      setDeclined("");
      setPaid({ method: r.method });
      onPaid?.(r);
    };
    const onDeclined = () => setDeclined("That payment was declined. Check the details or try a different card or account.");
    const onError = () => setDeclined("Something went wrong with that payment. You haven't been charged. Try again.");
    el.addEventListener("approved", onApproved);
    el.addEventListener("declined", onDeclined);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("approved", onApproved);
      el.removeEventListener("declined", onDeclined);
      el.removeEventListener("error", onError);
    };
  }, [ready, onPaid]);

  if (paid) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-sm text-emerald-900">
          <div className="font-semibold">{paid.method === "ach" ? "Bank payment submitted" : "Payment received"}</div>
          <div className="mt-0.5 text-emerald-800">
            {paid.method === "ach"
              ? `Your bank payment of ${fmt(session.amountCents)} usually clears in a few business days. You don't need to do anything else.`
              : `Thanks! ${fmt(session.amountCents)} was paid.`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-semibold text-slate-800">
          {session.kind === "deposit" ? "Deposit due" : session.kind === "balance" ? "Balance due" : "Amount due"}
        </div>
        <div className="text-xl font-bold text-slate-900 tabular-nums">{fmt(session.amountCents)}</div>
      </div>
      {loadError && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {loadError}
        </div>
      )}
      {!ready && !loadError && (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading secure payment form…</div>
      )}
      {ready && (
        <rainforest-payment
          ref={ref}
          session-key={session.sessionKey}
          payin-config-id={session.payinConfigId}
          allowed-methods={session.allowedMethods || "CARD,ACH"}
        />
      )}
      {declined && (
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {declined}
        </div>
      )}
      <div className="text-xs text-slate-500">
        Pay by card or bank account. Your payment details go straight to the payment processor.
      </div>
    </div>
  );
}
