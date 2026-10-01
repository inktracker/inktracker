import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, CreditCard, Landmark, Loader2, Lock } from "lucide-react";
import { base44 } from "@/api/supabaseClient";

// The customer's "how would you like to pay?" step for a shop on InkTracker
// payments. Each choice opens Stripe Checkout (on the shop's own Stripe
// account) for the LIVE QuickBooks balance; card and bank details go straight
// to Stripe and never touch InkTracker. Stripe sends the customer back to
// this same page with ?paid=card|ach (see PaidNotice). The webhook records
// the payment in QuickBooks; this only gets the customer there.

const fmt = (cents) => `$${(Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * What the customer sees when Stripe sends them back after paying. Shown only
 * once the server confirms that Checkout really completed for THIS document
 * (a URL alone proves nothing); otherwise the pay options come back.
 */
export function PaidNotice({ docType, id, token, paid, fallback = null }) {
  const [state, setState] = useState("checking"); // checking | paid | processing | unconfirmed
  useEffect(() => {
    let alive = true;
    base44.functions.invoke("stripePayments", { action: "paidStatus", docType, id, token, sessionId: paid?.sessionId })
      .then((r) => { if (alive) setState(r?.data?.confirmed ? r.data.state : "unconfirmed"); })
      .catch(() => { if (alive) setState("unconfirmed"); });
    return () => { alive = false; };
  }, [docType, id, token, paid?.sessionId]);

  if (state === "checking") {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Checking your payment…</div>;
  }
  if (state === "unconfirmed") return fallback;
  const bank = state === "processing";
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 flex items-start gap-3">
      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
      <div className="text-sm text-emerald-900">
        <div className="font-semibold">{bank ? "Bank payment submitted" : "Payment received"}</div>
        <div className="mt-0.5 text-emerald-800">
          {bank
            ? "Thanks! Bank payments usually clear in about 4 business days. You don't need to do anything else."
            : "Thanks! Your card payment went through."}
        </div>
      </div>
    </div>
  );
}

/** { method, sessionId } from ?paid=card|ach&session_id=… after Stripe Checkout, else null. */
export function readPaidReturn() {
  try {
    const q = new URLSearchParams(window.location.search);
    const method = q.get("paid");
    if (method !== "card" && method !== "ach") return null;
    return { method, sessionId: q.get("session_id") || "" };
  } catch {
    return null;
  }
}

/**
 * @param {object} props
 * @param {{bankDiscountPct?:number, cardCents?:number, bankCents?:number, bankSavingsCents?:number}} [props.pricing]
 *        from payRail: the shop's bank-transfer discount and, for a plain
 *        full payment, the exact card / bank amounts
 */
export default function OnlinePaymentPanel({ docType, id, token, kind = null, amountCents = null, pricing = null }) {
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  async function pay(method) {
    setBusy(method);
    setNotice("");
    try {
      const r = await base44.functions.invoke("stripePayments", { action: "payinSession", docType, id, token, method });
      const d = r?.data;
      if (d?.payable && d.checkoutUrl) {
        // Stripe Checkout can't run inside a frame (an embedded preview);
        // give it its own window there.
        if (window.self !== window.top) window.open(d.checkoutUrl, "_blank", "noopener");
        else window.location.assign(d.checkoutUrl);
        return; // leaving the page; keep the spinner
      }
      setNotice(d?.message || "Online payment isn't available right now. Please contact the shop.");
    } catch {
      setNotice("Online payment isn't available right now. Please try again in a moment.");
    }
    setBusy("");
  }

  const pct = Number(pricing?.bankDiscountPct) || 0;
  const exact = Number.isInteger(pricing?.cardCents) && Number.isInteger(pricing?.bankCents);
  const cardLine = exact ? fmt(pricing.cardCents) : null;
  const bankLine = exact
    ? `${fmt(pricing.bankCents)}${pricing.bankSavingsCents > 0 ? ` · save ${fmt(pricing.bankSavingsCents)}` : ""}`
    : pct > 0 ? `Save ${pct}%` : null;
  const choice = "w-full flex items-center gap-3 rounded-xl border border-slate-200 bg-white hover:border-teal-400 hover:bg-teal-50/40 px-4 py-3 text-left transition disabled:opacity-60";
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-semibold text-slate-800">
          {kind === "deposit" ? "Pay your deposit" : kind === "balance" ? "Pay the balance" : "How would you like to pay?"}
        </div>
        {Number.isInteger(amountCents) && amountCents > 0 && (
          <div className="text-lg font-bold text-slate-900 tabular-nums">{fmt(amountCents)}</div>
        )}
      </div>
      <button type="button" className={choice} disabled={!!busy} onClick={() => pay("card")}>
        {busy === "card" ? <Loader2 className="w-5 h-5 animate-spin text-teal-600" /> : <CreditCard className="w-5 h-5 text-teal-600" />}
        <span className="flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">Pay by card</span>
            {cardLine && <span className="text-sm font-bold text-slate-900 tabular-nums">{cardLine}</span>}
          </span>
          <span className="block text-xs text-slate-500">Credit or debit card</span>
        </span>
      </button>
      <button type="button" className={choice} disabled={!!busy} onClick={() => pay("ach")}>
        {busy === "ach" ? <Loader2 className="w-5 h-5 animate-spin text-teal-600" /> : <Landmark className="w-5 h-5 text-teal-600" />}
        <span className="flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">Pay by bank transfer</span>
            {bankLine && <span className={`text-sm font-bold tabular-nums ${pct > 0 ? "text-emerald-700" : "text-slate-900"}`}>{bankLine}</span>}
          </span>
          <span className="block text-xs text-slate-500">
            {pct > 0 ? `${pct}% off for paying from your bank account. ` : "From your bank account. "}Clears in about 4 business days.
          </span>
        </span>
      </button>
      {notice && (
        <div className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" /> {notice}
        </div>
      )}
      <div className="text-xs text-slate-500">
        {exact ? "Amounts include sales tax. " : "You'll see the exact amount, including sales tax, before you pay. "}
        {pct > 0 ? "The card price is the invoice price; paying by bank takes the discount off." : ""}
      </div>
      <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
        <Lock className="w-3 h-3" /> Secure checkout by Stripe. Your card and bank details go straight to Stripe.
      </div>
    </div>
  );
}
