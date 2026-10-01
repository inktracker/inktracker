import { useState, useEffect, useCallback, useRef } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { loadRainforestScript } from "@/lib/payment/rainforestScript";
import { resetPaymentStatus } from "@/lib/payment/usePaymentRail";

// InkTracker payments (Rainforest): customers pay on InkTracker instead of a
// QuickBooks link, at the same price as QuickBooks. Three steps: sign up
// (Rainforest's own form, embedded), pick the QuickBooks accounts payouts are
// booked to, turn it on. Everything is enforced server-side by the
// `rainforest` edge function; this card only reflects it.

const STEPS = [
  { n: 1, title: "Sign up for payments" },
  { n: 2, title: "Choose your QuickBooks accounts" },
  { n: 3, title: "Turn it on" },
];

const STAGE_TEXT = {
  in_review: "Submitted. Rainforest usually approves within two business days. You'll see it here when it's done.",
  needs_information: "Rainforest needs a bit more information. Open the sign-up again to finish it.",
  declined: "This payments application was closed: it wasn't approved, or it wasn't finished within 120 days. Customers keep paying through QuickBooks.",
  suspended: "Your payments account is on hold. Customers pay through QuickBooks until it's resolved.",
};

async function call(action, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  const { data, error } = await base44.functions.invoke("rainforest", { action, accessToken: session.access_token, ...extra });
  if (error) throw new Error(error.message || String(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

function OnboardingForm({ session, onSubmitted, onReopen }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState(false);

  useEffect(() => {
    let alive = true;
    loadRainforestScript(session.scriptUrl)
      .then(() => { if (alive) setReady(true); })
      .catch((e) => { if (alive) setLoadError(e.message); });
    return () => { alive = false; };
  }, [session.scriptUrl]);

  useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return undefined;
    const handler = () => onSubmitted();
    // The sign-up session lasts an hour; an owner who steps away to find
    // their EIN comes back to an expired form. Offer a fresh one.
    const onError = () => setFormError(true);
    el.addEventListener("submitted", handler);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("submitted", handler);
      el.removeEventListener("error", onError);
    };
  }, [ready, onSubmitted]);

  if (loadError) return <div className="text-xs text-red-700">{loadError}. Refresh the page and try again.</div>;
  if (!ready) return <div className="text-xs text-slate-400">Loading the sign-up form…</div>;
  return (
    <div className="space-y-2">
      {formError && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
          <span>The sign-up form stopped working. It may have timed out. What you entered so far is saved.</span>
          <button type="button" className="font-semibold text-teal-700 hover:text-teal-800 shrink-0" onClick={onReopen}>Reopen sign-up</button>
        </div>
      )}
    <rainforest-merchant-onboarding
      ref={ref}
      session-key={session.sessionKey}
      merchant-id={session.merchantId}
      merchant-application-id={session.merchantApplicationId}
      terms-and-conditions-url={session.termsUrl}
    />
    </div>
  );
}

// The shop's payments and payouts, shown by Rainforest's own report
// components (their portal is for InkTracker, not shops). Refunds and dispute
// responses happen here; the session decides who may do them (owner only).
function PaymentActivity() {
  const [tab, setTab] = useState("payments");
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    call("activitySession")
      .then(async (d) => {
        await loadRainforestScript(d.scriptUrl);
        if (alive) { setSession(d); setReady(true); }
      })
      .catch((e) => { if (alive) setError(e.message || "Payments couldn't load."); });
    return () => { alive = false; };
  }, []);

  if (error) return <div className="text-xs text-red-700">{error}</div>;
  if (!ready || !session) return <div className="text-xs text-slate-400">Loading payments…</div>;
  const filters = JSON.stringify({ merchant_id: session.merchantId });
  const tabCls = (t) => `text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === t ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-slate-100"}`;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className={tabCls("payments")} onClick={() => setTab("payments")}>Payments</button>
        <button type="button" className={tabCls("payouts")} onClick={() => setTab("payouts")}>Payouts</button>
        <span className="text-[11px] text-slate-500">
          {session.canAct
            ? "Open a payment to refund it or respond to a dispute."
            : "Only the shop owner can refund payments or respond to disputes."}
        </span>
      </div>
      <div className="overflow-x-auto">
        {tab === "payments" ? (
          session.canAct
            ? <rainforest-payment-report key="p" session-key={session.sessionKey} data-filters={filters} show-chargeback-respond-button="" />
            : <rainforest-payment-report key="p" session-key={session.sessionKey} data-filters={filters} />
        ) : (
          <rainforest-deposit-report key="d" session-key={session.sessionKey} data-filters={filters} />
        )}
      </div>
    </div>
  );
}

export default function PaymentsSection() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [onboarding, setOnboarding] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [bankId, setBankId] = useState("");
  const [feeId, setFeeId] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);

  const apply = useCallback((d) => {
    setState(d);
    resetPaymentStatus();
  }, []);

  useEffect(() => {
    let alive = true;
    call("status")
      .then((d) => { if (alive) { setState(d); setBankId(d.qbBankAccountId || ""); setFeeId(d.qbFeeAccountId || ""); } })
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

  const onSubmitted = useCallback(() => {
    setOnboarding(null);
    call("refreshStatus").then(apply).catch(() => {});
    notify.success("Sign-up submitted");
  }, [apply]);

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
      ? "Turn on InkTracker payments?\n\nCustomers will pay on InkTracker instead of QuickBooks. QuickBooks pay links are turned off on new and updated invoices. Payments are still recorded in QuickBooks for you."
      : "Turn off InkTracker payments?\n\nNew and updated invoices go back to using QuickBooks pay links. Quotes and invoices you already sent with an InkTracker pay link need to be re-sent so customers get a QuickBooks pay link.";
    if (!window.confirm(msg)) return;
    run("setEnabled", { enabled: want }, (d) => { apply(d); notify.success(want ? "Customers now pay on InkTracker" : "Back to QuickBooks payments"); });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-xs text-slate-600 max-w-prose">
          Let customers pay quotes and invoices on InkTracker. They pay what they pay through QuickBooks today:
          {" "}<span className="font-semibold">{state.pricing?.card} by card, {state.pricing?.ach} by bank</span>. Every payment is recorded in QuickBooks for you.
        </div>
        {on
          ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">Payments ON</span>
          : <span className="text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">Using QuickBooks</span>}
      </div>

      {!state.payingPlan && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          InkTracker payments are available on a paid plan.
        </div>
      )}

      {state.planLapsed && state.enabled && (
        <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          {state.paymentsPausedForPlan
            ? "Your InkTracker plan has ended, so new quotes and invoices use QuickBooks pay links. Payouts, refunds and disputes below still work. Renew in Billing & Plan to switch InkTracker payments back on."
            : `Your InkTracker plan has ended. Customers can keep paying on InkTracker until ${state.paymentsPauseOn}; after that, new quotes and invoices use QuickBooks pay links. Renew in Billing & Plan to keep them.`}
        </div>
      )}

      {state.enabled && !approved && state.canToggle && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
          <span>InkTracker payments are switched on but paused until your account is active again. Customers pay through QuickBooks meanwhile.</span>
          <button className={ghost} disabled={!!busy} onClick={toggle}>{busy === "setEnabled" ? "Saving…" : "Turn off"}</button>
        </div>
      )}

      {state.canMapAccounts && ["active", "suspended", "declined"].includes(state.stage) && (
        <details className="rounded-lg border border-slate-200 px-3 py-2" onToggle={(e) => setActivityOpen(e.currentTarget.open)}>
          <summary className="text-xs font-bold text-slate-800 cursor-pointer">Payments &amp; payouts</summary>
          {/* Mounted only when opened: each view opens a Rainforest session. */}
          {activityOpen && <div className="mt-3"><PaymentActivity /></div>}
        </details>
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
                    {onboarding ? (
                      <OnboardingForm
                        key={onboarding.sessionKey}
                        session={onboarding}
                        onSubmitted={onSubmitted}
                        onReopen={() => run("startOnboarding", {}, setOnboarding)}
                      />
                    ) : stage === "declined" && state.canStartOver ? (
                      <button className={btn} disabled={!!busy} onClick={() => run("startOnboarding", {}, setOnboarding)}>
                        {busy === "startOnboarding" ? "Opening…" : "Start a new application"}
                      </button>
                    ) : ["not_started", "in_progress", "needs_information"].includes(stage) && (
                      <>
                        {stage === "not_started" && (
                          <div>About 10 minutes. Have your EIN, the owner's date of birth, and your bank login ready. We fill in your shop details for you.</div>
                        )}
                        {state.canToggle ? (
                          <button className={btn} disabled={!!busy} onClick={() => run("startOnboarding", {}, setOnboarding)}>
                            {busy === "startOnboarding" ? "Opening…" : stage === "not_started" ? "Start sign-up" : "Continue sign-up"}
                          </button>
                        ) : (
                          <div>The shop owner signs up for payments.</div>
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
                          <select id="rf-bank-account" className={selectCls} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                            <option value="">Choose…</option>
                            {accounts.banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="block font-semibold text-slate-700">Expense account for fees</span>
                          <select id="rf-fee-account" className={selectCls} value={feeId} onChange={(e) => setFeeId(e.target.value)}>
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
                        ? "Customers pay on InkTracker. QuickBooks pay links are off on new and updated invoices."
                        : "When this is on, quote and invoice emails link to InkTracker's payment page instead of QuickBooks."}
                    </div>
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
