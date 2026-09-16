import { useState, useEffect, useCallback } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { resetSupplierFlags } from "@/lib/suppliers/useSupplierFlags";

// In-app setup steppers for S&S Activewear and AS Colour — the siblings of
// SanMarOrderingSetup. Buttons instead of "email the supplier and hope":
//   S&S:       get key (self-serve on ssactivewear.com) → enter → VERIFY
//   AS Colour: request API creds (we email) → enter → VERIFY → request credit
//              application (we email) → mark approved
// "Verify" makes a real authenticated call with the shop's OWN credentials
// via the supplierSetup edge function, so a wrong key is caught here instead
// of at the first order. Rendered inside each supplier card; the card's own
// credential form is step 2, so this component only reads `connected`.

const btn = "bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50";
const ghost = "text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50";

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; }
}

function useSupplierSetup() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const call = useCallback(async (action, extra = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in");
    const { data, error } = await base44.functions.invoke("supplierSetup", { action, accessToken: session.access_token, ...extra });
    if (error) throw new Error(error.message || String(error));
    if (data?.error && !("ok" in (data || {}))) throw new Error(data.error);
    return data;
  }, []);

  const refresh = useCallback(() => {
    return call("status").then((d) => setState(d)).catch(() => setState(null)).finally(() => setLoading(false));
  }, [call]);

  useEffect(() => { refresh(); }, [refresh]);

  const run = async (action, label, extra) => {
    setBusy(action);
    try {
      const d = await call(action, extra);
      if (d?.ok === false) { notify.error(d.error || `${label} failed`); return d; }
      setState(d);
      resetSupplierFlags();
      notify.success(label);
      return d;
    } catch (e) {
      notify.error(e.message || `${label} failed`);
      return null;
    } finally {
      setBusy("");
    }
  };

  return { state, loading, busy, run, refresh };
}

function Step({ n, title, state, children }) {
  // state: "done" | "active" | "todo"
  const cls = state === "active" ? "border-teal-300 bg-teal-50/40" : state === "done" ? "border-emerald-100 bg-emerald-50/30" : "border-slate-100 bg-slate-50/50";
  const dot = state === "done" ? "bg-emerald-600 text-white" : state === "active" ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-600";
  return (
    <li className={`rounded-lg border px-3 py-2.5 ${cls}`}>
      <div className="flex items-center gap-2">
        <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${dot}`}>{state === "done" ? "✓" : n}</span>
        <span className={`text-xs font-bold ${state === "done" ? "text-emerald-800" : state === "active" ? "text-teal-900" : "text-slate-600"}`}>{title}</span>
      </div>
      {children && <div className="mt-2 pl-7 space-y-2 text-xs text-slate-600">{children}</div>}
    </li>
  );
}

function Header({ title, sub, done, stepLabel }) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <div className="text-sm font-bold text-slate-800">{title}</div>
        <div className="text-[11px] text-slate-500">{sub}</div>
      </div>
      {done ? (
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Ordering ready</span>
      ) : (
        <span className="text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">{stepLabel}</span>
      )}
    </div>
  );
}

// ── S&S Activewear ─────────────────────────────────────────────────────────
export function SsSetupSteps({ connected, refreshKey }) {
  const { state, loading, busy, run, refresh } = useSupplierSetup();
  useEffect(() => { if (refreshKey) refresh(); }, [refreshKey, refresh]);
  if (loading || !state) return null;
  const ss = state.setup?.ss || {};
  const verified = !!(connected && ss.verified_at);
  const step = verified ? 4 : connected ? 3 : 1;
  const st = (n) => (step > n ? "done" : step === n ? "active" : "todo");

  return (
    <div className="mt-3 border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
      <Header title="S&S ordering setup" sub="No approval process — S&S lets you generate an API key yourself." done={verified} stepLabel={`Step ${Math.min(step, 3)} of 3`} />
      <ol className="space-y-3">
        <Step n={1} title="Get your API key from S&S" state={connected ? "done" : "active"}>
          {!connected && (
            <div>Sign in at <a href="https://www.ssactivewear.com/" target="_blank" rel="noreferrer" className="font-semibold underline">ssactivewear.com</a>, open your account's API settings, and generate a key. No request or waiting period — it's immediate. Orders through InkTracker bill this S&S account.</div>
          )}
        </Step>
        <Step n={2} title="Enter your account number and API key" state={connected ? "done" : "todo"}>
          {!connected && <div>Use the form above, then Save.</div>}
        </Step>
        <Step n={3} title="Verify the connection" state={st(3)}>
          {verified ? (
            <div>Verified {fmtDate(ss.verified_at)} against account {ss.verified_account}. Purchase orders to S&S submit from the Purchase Orders page. <button className={ghost} disabled={!!busy} onClick={() => run("ssVerify", "S&S connection verified")}>Re-check</button></div>
          ) : connected ? (
            <>
              <div>We make a real call to S&S with your key so a typo is caught here, not on your first order.</div>
              <button className={btn} disabled={!!busy} onClick={() => run("ssVerify", "S&S connection verified")}>{busy === "ssVerify" ? "Checking…" : "Verify connection"}</button>
            </>
          ) : null}
        </Step>
      </ol>
    </div>
  );
}

// ── AS Colour ──────────────────────────────────────────────────────────────
export function AcSetupSteps({ connected, accountEmail, refreshKey }) {
  const { state, loading, busy, run, refresh } = useSupplierSetup();
  useEffect(() => { if (refreshKey) refresh(); }, [refreshKey, refresh]);
  if (loading || !state) return null;
  const ac = state.setup?.ac || {};
  const verified = !!(connected && ac.verified_at);
  const creditRequested = !!ac.credit_requested_at;
  const approved = !!(verified && ac.credit_approved_at);
  const step = approved ? 6 : verified ? (creditRequested ? 5 : 4) : connected ? 3 : ac.api_requested_at ? 2 : 1;
  const st = (n) => (step > n ? "done" : step === n ? "active" : "todo");

  return (
    <div className="mt-3 border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
      <Header title="AS Colour ordering setup" sub="API access comes from AS Colour; orders through the API need approved credit terms." done={approved} stepLabel={`Step ${Math.min(step, 5)} of 5`} />
      <ol className="space-y-3">
        <Step n={1} title="Ask AS Colour for API credentials" state={st(1)}>
          {step === 1 ? (
            <>
              <div>We email AS Colour's API team for a subscription key on your account. Their reply goes to <span className="font-semibold">{state.ownerEmail}</span>. Already have a key? Skip to the form above.</div>
              <div className="flex items-center gap-3 flex-wrap">
                <button className={btn} disabled={!!busy} onClick={() => run("acRequestApi", "Request sent to AS Colour", { accountEmail: accountEmail || "" })}>{busy === "acRequestApi" ? "Sending…" : "Send request to AS Colour"}</button>
                <button className={ghost} disabled={!!busy} onClick={() => run("acMarkApiRequested", "Marked as requested")}>I already asked / have a key</button>
              </div>
            </>
          ) : ac.api_requested_at && !connected ? (
            <div>Requested {fmtDate(ac.api_requested_at)}. Paste the credentials into the form above when they arrive.</div>
          ) : null}
        </Step>
        <Step n={2} title="Enter subscription key, email and password" state={connected ? "done" : step === 2 ? "active" : "todo"}>
          {!connected && step === 2 && <div>All three are required — pricing runs on your account login, not just the key.</div>}
        </Step>
        <Step n={3} title="Verify the connection" state={st(3)}>
          {verified ? (
            <div>Verified {fmtDate(ac.verified_at)}. Catalog, live inventory and your pricing are on. <button className={ghost} disabled={!!busy} onClick={() => run("acVerify", "AS Colour connection verified")}>Re-check</button></div>
          ) : connected ? (
            <>
              <div>We sign in to AS Colour with your key, email and password so a bad value is caught now.</div>
              <button className={btn} disabled={!!busy} onClick={() => run("acVerify", "AS Colour connection verified")}>{busy === "acVerify" ? "Checking…" : "Verify connection"}</button>
            </>
          ) : null}
        </Step>
        <Step n={4} title="Apply for credit terms" state={st(4)}>
          {step === 4 ? (
            <>
              <div>AS Colour only takes API orders on credit terms. We email them for the credit application; they send a PDF to <span className="font-semibold">{state.ownerEmail}</span>, you return it, and approval takes about 2–4 weeks (they call your credit references, then it goes to their CFO — nudging your references along helps). Until then orders still submit but sit in "awaiting payment" at AS Colour until you arrange payment with them.</div>
              <div className="flex items-center gap-3 flex-wrap">
                <button className={btn} disabled={!!busy} onClick={() => run("acRequestCredit", "Credit application requested")}>{busy === "acRequestCredit" ? "Sending…" : "Request the credit application"}</button>
                <button className={ghost} disabled={!!busy} onClick={() => run("acMarkCreditRequested", "Marked as applied")}>I already applied</button>
              </div>
            </>
          ) : creditRequested && !approved ? (
            <div>Requested {fmtDate(ac.credit_requested_at)}.</div>
          ) : null}
        </Step>
        <Step n={5} title="Credit terms approved" state={st(5)}>
          {approved ? (
            <div>Approved {fmtDate(ac.credit_approved_at)}. API orders process on account. <button className={ghost} disabled={!!busy} onClick={() => run("acUnmarkCreditApproved", "Credit approval cleared")}>Undo</button></div>
          ) : step === 5 ? (
            <>
              <div>When AS Colour confirms your terms, mark it here so the team knows orders will process without a payment hold.</div>
              <button className={btn} disabled={!!busy} onClick={() => run("acMarkCreditApproved", "Credit terms marked approved")}>{busy === "acMarkCreditApproved" ? "Saving…" : "AS Colour approved our terms"}</button>
            </>
          ) : null}
        </Step>
      </ol>
    </div>
  );
}
