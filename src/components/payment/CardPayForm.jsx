import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { base44 } from "@/api/supabaseClient";

// Card payment on InkTracker's own pay page, for shops that pass the card
// card surcharge on. Stripe's card form (Payment Element, on the shop's own
// Stripe account) collects the card — the number goes straight to Stripe —
// and InkTracker asks Stripe whether it's a credit or debit card before
// anything is charged. US card rules: the surcharge is for credit cards only,
// shown before the customer pays, with a way out (another card, or bank).
//
//   1. enter card → Continue      (stripePayments cardQuote: nothing charged)
//   2. see invoice + fee = total → Pay  (cardPay)
//   3. the bank's card check (3-D Secure), when it asks for one

const fmt = (cents) => `$${(Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

let stripeJs = null;
/** Stripe.js from Stripe (it must load from js.stripe.com; the CSP allows it). */
function loadStripeJs() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (!stripeJs) {
    stripeJs = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.async = true;
      s.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe.js didn't load")));
      s.onerror = () => { stripeJs = null; reject(new Error("Stripe.js didn't load")); };
      document.head.appendChild(s);
    });
  }
  return stripeJs;
}

/**
 * @param {object} props
 * @param {{publishableKey:string, accountId:string}} props.cardForm  from payRail
 * @param {number|null} props.invoiceCents  for the card form's display only
 * @param {number} props.feePct             the shop's credit-card surcharge (2.99)
 * @param {string|null} [props.shopName]   who charges it (Visa: the merchant)
 * @param {(paymentIntentId:string) => void} props.onPaid
 * @param {() => void} props.onBack         back to card / bank choice
 * @param {() => void} [props.onCheckout]   pay on Stripe's own page instead
 *        (when the card form can't load: ad blockers, strict networks)
 */
export default function CardPayForm({ docType, id, token, cardForm, invoiceCents = null, feePct, shopName = null, onPaid, onBack, onCheckout = null }) {
  const mountRef = useRef(null);
  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState("enter"); // enter | confirm
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState(null); // { invoiceCents, surchargeCents, totalCents, funding, brand, last4, token }
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let element = null;
    loadStripeJs()
      .then((Stripe) => {
        if (!alive || !mountRef.current) return;
        const stripe = Stripe(cardForm.publishableKey, { stripeAccount: cardForm.accountId });
        const elements = stripe.elements({
          mode: "payment",
          amount: Number.isInteger(invoiceCents) && invoiceCents > 0 ? invoiceCents : 100,
          currency: "usd",
          paymentMethodCreation: "manual",
          paymentMethodTypes: ["card"],
          appearance: { theme: "stripe", variables: { colorPrimary: "#0d9488", borderRadius: "10px" } },
        });
        element = elements.create("payment", {
          layout: "tabs",
          // Wallets would hide whether the card is credit or debit behind
          // the wallet sheet; keep it to a plain card.
          wallets: { applePay: "never", googlePay: "never" },
        });
        element.on("ready", () => { if (alive) setReady(true); });
        element.mount(mountRef.current);
        stripeRef.current = stripe;
        elementsRef.current = elements;
      })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => {
      alive = false;
      try { element?.destroy(); } catch { /* already gone */ }
    };
  }, [cardForm.publishableKey, cardForm.accountId, invoiceCents]);

  const call = (action, extra) => base44.functions.invoke("stripePayments", { action, docType, id, token, ...extra }).then((r) => r?.data ?? {});

  async function review() {
    setBusy(true);
    setMessage("");
    try {
      const elements = elementsRef.current;
      const { error: submitError } = await elements.submit();
      if (submitError) { setMessage(submitError.message || "Check your card details."); setBusy(false); return; }
      const { error, confirmationToken } = await stripeRef.current.createConfirmationToken({ elements });
      if (error || !confirmationToken?.id) { setMessage(error?.message || "That card couldn't be read. Please try again."); setBusy(false); return; }
      const d = await call("cardQuote", { confirmationToken: confirmationToken.id });
      if (!d.payable || !Number.isInteger(d.totalCents)) {
        setMessage(d.message || "Card payment isn't available right now. Please try again in a moment.");
      } else {
        setQuote({ ...d, token: confirmationToken.id });
        setStep("confirm");
      }
    } catch {
      setMessage("Card payment isn't available right now. Please try again in a moment.");
    }
    setBusy(false);
  }

  async function pay() {
    setBusy(true);
    setMessage("");
    try {
      const d = await call("cardPay", { confirmationToken: quote.token, expectTotalCents: quote.totalCents });
      if (d.changed) {
        setQuote({ ...quote, ...d });
        setMessage("The amount due changed since this page loaded. Check the new total, then pay.");
      } else if (d.declined) {
        setMessage(d.message || "Your card was declined. Try another card or pay by bank transfer.");
        setStep("enter");
        setQuote(null);
      } else if (d.requiresAction && d.clientSecret) {
        const { error } = await stripeRef.current.handleNextAction({ clientSecret: d.clientSecret });
        if (error) {
          setMessage(error.message || "Your bank didn't confirm the payment. Try again or use another card.");
          setStep("enter");
          setQuote(null);
        } else {
          onPaid(d.paymentIntentId);
          return;
        }
      } else if (d.state && d.paymentIntentId) {
        onPaid(d.paymentIntentId);
        return;
      } else {
        setMessage(d.message || "Card payment isn't available right now. Please try again in a moment.");
        // The card details expired (the page sat open for hours): enter
        // them again rather than pressing a Pay button that can't work.
        if (d.reason === "card_unreadable") { setStep("enter"); setQuote(null); }
      }
    } catch {
      setMessage("We couldn't confirm the payment. Please don't pay again yet: refresh this page in a minute to check.");
    }
    setBusy(false);
  }

  const primary = "w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-3 disabled:opacity-60";
  const link = "inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900";
  const credit = quote?.funding === "credit";
  return (
    <div className="space-y-4">
      <button type="button" className={link} onClick={onBack} disabled={busy}>
        <ArrowLeft className="w-4 h-4" /> Other ways to pay
      </button>

      <div hidden={step !== "enter"}>
        <div ref={mountRef} />
        {loadFailed && (
          <div className="space-y-3 text-sm text-slate-700">
            <div>The card form couldn&rsquo;t load. A browser extension or network filter may be blocking it.</div>
            {onCheckout && (
              <button type="button" className={primary} onClick={onCheckout}>Pay on Stripe&rsquo;s secure page instead</button>
            )}
          </div>
        )}
        {!ready && !message && !loadFailed && (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading card form…</div>
        )}
        {!loadFailed && <div className="mt-3 text-xs text-slate-500">
          {shopName || "The shop"} adds a {feePct}% surcharge to credit cards. Debit cards have no surcharge. You'll see the total before you pay.
        </div>}
        {!loadFailed && <button type="button" className={`${primary} mt-4`} disabled={!ready || busy} onClick={review}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Continue
        </button>}
      </div>

      {step === "confirm" && quote && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
            <div className="flex justify-between px-4 py-2.5"><span className="text-slate-600">Amount due</span><span className="tabular-nums">{fmt(quote.invoiceCents)}</span></div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-slate-600">{credit ? `Credit card surcharge (${feePct}%)` : "Surcharge"}</span>
              <span className="tabular-nums">{credit ? fmt(quote.surchargeCents) : "None (debit card)"}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5 font-bold text-slate-900"><span>Total</span><span className="tabular-nums">{fmt(quote.totalCents)}</span></div>
          </div>
          {quote.last4 && (
            <div className="text-xs text-slate-500">{String(quote.brand || "Card").replace(/^\w/, (c) => c.toUpperCase())} ending {quote.last4}</div>
          )}
          <button type="button" className={primary} disabled={busy} onClick={pay}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Pay {fmt(quote.totalCents)}
          </button>
          <button type="button" className={link} disabled={busy} onClick={() => { setStep("enter"); setQuote(null); setMessage(""); }}>
            Use a different card
          </button>
        </div>
      )}

      {message && (
        <div className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" /> {message}
        </div>
      )}
    </div>
  );
}
