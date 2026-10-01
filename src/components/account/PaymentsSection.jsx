import { useState, useEffect, useCallback } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { resetPaymentStatus } from "@/lib/payment/usePaymentRail";

// InkTracker payments (Stripe): customers pay on Stripe's checkout instead of
// a QuickBooks link, at the same price as QuickBooks. Three steps: sign up
// (on Stripe's own page; the shop gets its own Stripe account), pick the
// QuickBooks accounts payouts are booked to, turn it on. Everything is
// enforced server-side by the `stripePayments` edge function; this card
// only reflects it. Refunds, disputes and payout detail live in the shop's
// own Stripe dashboard.

const STEPS = [
  { n: 1, title: "Set up your Stripe account" },
  { n: 2, title: "Choose your QuickBooks accounts" },
  { n: 3, title: "Turn it on" },
];

const STAGE_TEXT = {
  in_progress: "Sign-up isn't finished yet. Pick up where you left off.",
  in_review: "Submitted. Stripe is checking your details, which usually takes a few minutes and sometimes a day or two. You'll see it here when it's done.",
  needs_information: "Stripe needs a bit more information. Open the sign-up again to finish it.",
  declined: "This Stripe account can't be used for InkTracker payments (it wasn't approved, or it was disconnected). Customers keep paying through QuickBooks.",
  suspended: "Your Stripe account is on hold. Customers pay through QuickBooks until it's sorted out in your Stripe dashboard.",
};

const STRIPE_DASHBOARD = "https://dashboard.stripe.com/payments";

async function call(action, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  const { data, error } = await base44.functions.invoke("stripePayments", { action, accessToken: session.access_token, ...extra });
  if (error) throw new Error(error.message || String(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

// Back from Stripe (?payments=return|refresh after sign-up, or
// ?payments=oauth&code&state after "I already have a Stripe account"):
// read it once and drop it from the address bar so a refresh doesn't repeat it.
function takeReturnMarker() {
  try {
    const url = new URL(window.location.href);
    const v = url.searchParams.get("payments");
    if (!v) return null;
    const out = { kind: v, code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error_description") || url.searchParams.get("error") };
    for (const k of ["payments", "code", "state", "scope", "error", "error_description"]) url.searchParams.delete(k);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    return out;
  } catch {
    return null;
  }
}

export default function PaymentsSection() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [accounts, setAccounts] = useState(null);
  const [bankId, setBankId] = useState("");
  const [feeId, setFeeId] = useState("");
  const [feesOn, setFeesOn] = useState(false);
  const [bankFeePct, setBankFeePct] = useState("1");
  const [feesAck, setFeesAck] = useState(false);
  const syncFees = (d) => {
    setFeesOn(Boolean(d?.customerFees?.enabled));
    setBankFeePct(String(d?.customerFees?.bankFeeSetting ?? 1));
    setFeesAck(false);
  };

  const apply = useCallback((d) => {
    setState(d);
    resetPaymentStatus();
  }, []);

  useEffect(() => {
    let alive = true;
    const back = takeReturnMarker();
    const first = back?.kind === "oauth"
      ? (back.code && back.state
        ? call("finishConnect", { code: back.code, state: back.state }).then((d) => { notify.success("Stripe account connected"); return d; })
        : (back.error && notify.error("Stripe account not connected", back.error), call("status")))
      : call(back ? "refreshStatus" : "status");
    first
      .then((d) => { if (alive) { setState(d); setBankId(d.qbBankAccountId || ""); setFeeId(d.qbFeeAccountId || ""); syncFees(d); } })
      .catch(() => { if (alive) setState(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const run = async (action, extra, after) => {
    setBusy(action);
    try {
      const d = await call(action, extra);
      if (after) after(d); else apply(d);
    } catch (e) {
      notify.error(e.message || "That didn't work. Try again.");
    } finally {
      setBusy("");
    }
  };

  const loadAccounts = () => run("qbAccounts", {}, (d) => {
    setAccounts(d);
    if (!feeId && d.suggestedFeeAccountId) setFeeId(d.suggestedFeeAccountId);
  });

  // Stripe hosts the sign-up; we come back to ?payments=return.
  const openSignUp = () => run("startOnboarding", {}, (d) => { window.location.assign(d.url); });
  // An existing Stripe account: Stripe's connect page, back to ?payments=oauth.
  const connectExisting = () => run("connectExisting", {}, (d) => { window.location.assign(d.url); });

  if (loading) return <div className="text-xs text-slate-400">Loading payments…</div>;
  if (!state) return <div className="text-xs text-slate-500">Payments settings couldn't be loaded. Refresh to try again.</div>;

  const btn = "bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50";
  const ghost = "text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50";
  const selectCls = "w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white";

  const stage = state.stage;
  const approved = stage === "active";
  const step = !approved ? 1 : !state.qbAccountsMapped ? 2 : 3;
  const on = state.rail === "processor";

  const toggle = () => {
    const want = !state.enabled;
    const msg = want
      ? "Turn on InkTracker payments?\n\nCustomers will pay through Stripe instead of QuickBooks. QuickBooks pay links are turned off on new and updated invoices. Payments are still recorded in QuickBooks for you."
      : "Turn off InkTracker payments?\n\nNew and updated invoices go back to using QuickBooks pay links. Quotes and invoices you already sent with an InkTracker pay link need to be re-sent so customers get a QuickBooks pay link.";
    if (!window.confirm(msg)) return;
    run("setEnabled", { enabled: want }, (d) => { apply(d); notify.success(want ? "Customers now pay through Stripe" : "Back to QuickBooks payments"); });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-xs text-slate-600 max-w-prose">
          Let customers pay quotes and invoices by card or bank on Stripe's checkout. Your cost stays what QuickBooks charges:
          {" "}<span className="font-semibold">{state.pricing?.card} by card, {state.pricing?.ach} by bank</span> (on card payments under about $330, Stripe's 30¢ makes it a few cents more). Every payment is recorded in QuickBooks for you.
        </div>
        {state.testMode && <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">Stripe test mode</span>}
        {on
          ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">Payments ON</span>
          : <span className="text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">Using QuickBooks</span>}
      </div>

      {state.testMode && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          Stripe is in test mode. Only quotes and invoices with TEST or DEMO in the customer or job name use Stripe; everything else keeps paying through QuickBooks, and test payments aren't recorded in your QuickBooks.
        </div>
      )}

      {!state.payingPlan && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          InkTracker payments are available on a paid plan.
        </div>
      )}

      {state.planLapsed && state.enabled && (
        <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          {state.paymentsPausedForPlan
            ? "Your InkTracker plan has ended, so new quotes and invoices use QuickBooks pay links. Payouts, refunds and disputes keep working in your Stripe dashboard. Renew in Billing & Plan to switch InkTracker payments back on."
            : `Your InkTracker plan has ended. Customers can keep paying on InkTracker until ${state.paymentsPauseOn}; after that, new quotes and invoices use QuickBooks pay links. Renew in Billing & Plan to keep them.`}
        </div>
      )}

      {state.enabled && !approved && state.canToggle && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
          <span>InkTracker payments are switched on but paused until your account is active again. Customers pay through QuickBooks meanwhile.</span>
          <button className={ghost} disabled={!!busy} onClick={toggle}>{busy === "setEnabled" ? "Saving…" : "Turn off"}</button>
        </div>
      )}

      {["active", "suspended"].includes(state.stage) && (
        <div className="text-xs text-slate-600 rounded-lg border border-slate-200 px-3 py-2">
          Refunds, disputes and what's in each payout are in your Stripe dashboard.{" "}
          <a href={STRIPE_DASHBOARD} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-700 hover:text-teal-800">Open Stripe</a>
        </div>
      )}

      {state.payingPlan && (
        <ol className="space-y-3">
          {STEPS.map((s) => {
            const done = step > s.n || (s.n === 3 && on);
            const active = step === s.n && !done;
            return (
              <li key={s.n} className={`rounded-lg border px-3 py-2.5 ${active ? "border-teal-300 bg-teal-50/40" : done ? "border-emerald-100 bg-emerald-50/30" : "border-slate-100 bg-slate-50/50"}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${done ? "bg-emerald-600 text-white" : active ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-600"}`}>
                    {done ? "✓" : s.n}
                  </span>
                  <span className={`text-xs font-bold ${done ? "text-emerald-800" : active ? "text-teal-900" : "text-slate-600"}`}>{s.title}</span>
                </div>

                {s.n === 1 && !approved && (
                  <div className="mt-2 pl-7 space-y-2 text-xs text-slate-600">
                    {STAGE_TEXT[stage] && <div>{STAGE_TEXT[stage]}</div>}
                    {stage === "declined" && state.canStartOver ? (
                      <button className={btn} disabled={!!busy} onClick={openSignUp}>
                        {busy === "startOnboarding" ? "Opening Stripe…" : "Set up a new Stripe account"}
                      </button>
                    ) : ["not_started", "in_progress", "needs_information"].includes(stage) && (
                      <>
                        {stage === "not_started" && (
                          <div>
                            About 10 minutes on Stripe's site. Have your EIN, the owner's date of birth and your bank details ready. We fill in your shop details for you.
                            {state.canConnectExisting && " Already on Stripe? Connect that account instead. Payouts that mix in your other Stripe sales are left for you to record in QuickBooks."}
                          </div>
                        )}
                        {state.canToggle ? (
                          <div className="flex items-center gap-3 flex-wrap">
                            <button className={btn} disabled={!!busy} onClick={openSignUp}>
                              {busy === "startOnboarding" ? "Opening Stripe…" : stage === "not_started" ? "Set up with Stripe" : "Continue sign-up"}
                            </button>
                            {stage === "not_started" && state.canConnectExisting && (
                              <button className={ghost} disabled={!!busy} onClick={connectExisting}>
                                {busy === "connectExisting" ? "Opening Stripe…" : "I already have a Stripe account"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div>The shop owner sets this up.</div>
                        )}
                      </>
                    )}
                    {stage === "in_review" && (
                      <button className={ghost} disabled={!!busy} onClick={() => run("refreshStatus")}>
                        {busy === "refreshStatus" ? "Checking…" : "Check status"}
                      </button>
                    )}
                  </div>
                )}

                {s.n === 2 && approved && (
                  <div className="mt-2 pl-7 space-y-2 text-xs text-slate-600">
                    <div>Payouts are recorded as QuickBooks deposits into your bank account, with processing fees booked to an expense account.</div>
                    {!state.canMapAccounts ? (
                      <div>The owner or a manager picks these.</div>
                    ) : !accounts ? (
                      <button className={ghost} disabled={!!busy} onClick={loadAccounts}>
                        {busy === "qbAccounts" ? "Loading…" : state.qbAccountsMapped ? "Change accounts" : "Choose accounts"}
                      </button>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
                        <label className="space-y-1">
                          <span className="block font-semibold text-slate-700">Bank account payouts land in</span>
                          <select id="payments-bank-account" className={selectCls} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                            <option value="">Choose…</option>
                            {accounts.banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="block font-semibold text-slate-700">Expense account for fees</span>
                          <select id="payments-fee-account" className={selectCls} value={feeId} onChange={(e) => setFeeId(e.target.value)}>
                            <option value="">Choose…</option>
                            {accounts.expenses.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </label>
                        <div>
                          <button className={btn} disabled={!!busy || !bankId || !feeId}
                            onClick={() => run("saveQbAccounts", { bankAccountId: bankId, feeAccountId: feeId }, (d) => { apply(d); setAccounts(null); notify.success("QuickBooks accounts saved"); })}>
                            {busy === "saveQbAccounts" ? "Saving…" : "Save accounts"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {s.n === 3 && approved && state.qbAccountsMapped && (
                  <div className="mt-2 pl-7 space-y-2 text-xs text-slate-600">
                    <div>
                      {on
                        ? "Customers pay by card or bank through Stripe. QuickBooks pay links are off on new and updated invoices."
                        : "When this is on, quote and invoice emails link to InkTracker's payment page (Stripe checkout) instead of QuickBooks."}
                    </div>
                    {state.canToggle && (
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 space-y-2 max-w-xl">
                        <label className="flex items-center gap-2 font-semibold text-slate-700">
                          <input type="checkbox" checked={feesOn} onChange={(e) => { setFeesOn(e.target.checked); setFeesAck(false); }} />
                          Customers pay the processing fee
                        </label>
                        <div>
                          Quotes and invoices show your price with a note about the fee. On the pay page the customer sees the exact fee before paying: {state.pricing?.card || "2.99%"} on credit cards (none on debit cards, by card network rules) and your bank fee below. QuickBooks still records the invoice amount; the fees customers pay are booked on the payout deposit.
                        </div>
                        {feesOn && (
                          <label className="flex items-center gap-2 flex-wrap" htmlFor="payments-bank-fee">
                            <span className="text-slate-700">Bank transfer fee</span>
                            <input id="payments-bank-fee" type="number" min="0" max="1" step="0.25" inputMode="decimal"
                              className="w-20 text-sm border border-slate-200 rounded-lg px-2 py-1 bg-white"
                              value={bankFeePct} onChange={(e) => setBankFeePct(e.target.value)} />
                            <span>% (0 to 1; a bank payment costs you 1%)</span>
                          </label>
                        )}
                        {feesOn && !state.customerFees?.enabled && (
                          <label className="flex items-start gap-2">
                            <input type="checkbox" className="mt-0.5" checked={feesAck} onChange={(e) => setFeesAck(e.target.checked)} />
                            <span>
                              Card surcharges are allowed where my business operates, and I've given any notice the card networks require (Visa asks merchants to tell their processor before they start). A few states ban or cap surcharges; check yours if you're not sure.
                            </span>
                          </label>
                        )}
                        {feesOn && state.cardSurchargeReady === false && (
                          <div className="text-slate-500">The card fee isn't available yet. Until it is, only the bank fee applies.</div>
                        )}
                        <button className={ghost}
                          disabled={!!busy
                            || (feesOn && !state.customerFees?.enabled && !feesAck)
                            || (feesOn === Boolean(state.customerFees?.enabled) && Number(bankFeePct) === Number(state.customerFees?.bankFeeSetting ?? 1))}
                          onClick={() => run("setCustomerFees", { enabled: feesOn, bankFeePct: Number(bankFeePct), acknowledged: feesAck },
                            (d) => { apply(d); syncFees(d); notify.success(feesOn ? "Customers now pay the processing fee" : "Processing fee off: you pay it"); })}>
                          {busy === "setCustomerFees" ? "Saving…" : "Save"}
                        </button>
                      </div>
                    )}
                    {state.canToggle ? (
                      <button className={on ? ghost : btn} disabled={!!busy} onClick={toggle}>
                        {busy === "setEnabled" ? "Saving…" : on ? "Turn off (go back to QuickBooks)" : "Turn on InkTracker payments"}
                      </button>
                    ) : (
                      <div>Only the shop owner can turn this on or off.</div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
