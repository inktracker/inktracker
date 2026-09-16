import { useState, useEffect, useCallback } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { resetSupplierFlags } from "@/lib/suppliers/useSupplierFlags";

// SanMar ORDERING setup — the in-app version of SanMar's per-account
// PO-integration onboarding (guide v24.5). Five buttons instead of an email
// thread + a PDF: request access → paste EDEV test login → submit test order
// → tell SanMar → turn on. Everything runs through the smOnboarding edge
// function; the test order is hard-wired to SanMar's EDEV host and can never
// place a real order. Shown inside the SanMar card once product-data creds
// are connected. Only owners/managers can act (server-enforced).

const STEPS = [
  { n: 1, title: "Ask SanMar for ordering access" },
  { n: 2, title: "Enter your EDEV test login" },
  { n: 3, title: "Send a test order" },
  { n: 4, title: "Tell SanMar it's submitted" },
  { n: 5, title: "Turn ordering on" },
];

function stepFor(status) {
  return { not_started: 1, requested: 2, edev_ready: 3, tested: 4, awaiting_sanmar: 5, live: 6 }[status] || 1;
}

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; }
}

export default function SanMarOrderingSetup() {
  const [state, setState] = useState(null); // status payload
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [edevUser, setEdevUser] = useState("");
  const [edevPass, setEdevPass] = useState("");
  const [shipMethod, setShipMethod] = useState("UPS");
  const [payment, setPayment] = useState("");
  const [lastTest, setLastTest] = useState(null);

  const call = useCallback(async (action, extra = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in");
    const { data, error } = await base44.functions.invoke("smOnboarding", { action, accessToken: session.access_token, ...extra });
    if (error) throw new Error(error.message || String(error));
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    call("status")
      .then((d) => { if (alive) { setState(d); setPayment(d?.onboarding?.payment_method || ""); } })
      .catch(() => { if (alive) setState(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [call]);

  const run = async (label, action, extra, after) => {
    setBusy(action);
    try {
      const d = await call(action, extra);
      setState(d);
      resetSupplierFlags();
      if (after) after(d);
      else notify.success(label);
    } catch (e) {
      notify.error(e.message || `${label} failed`);
    } finally {
      setBusy("");
    }
  };

  if (loading) return <div className="text-xs text-slate-400">Loading SanMar ordering setup…</div>;
  if (!state) return null;

  const ob = state.onboarding || {};
  const step = stepFor(ob.status);
  const live = ob.status === "live";
  const tests = ob.tests || [];
  const okTests = tests.filter((t) => t?.result?.success);
  const shipToLine = state.shipTo
    ? `${state.shipTo.name}, ${state.shipTo.address1}, ${state.shipTo.city} ${state.shipTo.state} ${state.shipTo.zip}`
    : null;

  const btn = "bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg px-3 py-1.5 disabled:opacity-50";
  const ghost = "text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50";
  const inputCls = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300";

  return (
    <div className="mt-3 border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm font-bold text-slate-800">SanMar ordering setup</div>
          <div className="text-[11px] text-slate-500">
            SanMar turns on purchase-order submission per account. These steps do it for you — no emails to write, no guide to read.
          </div>
        </div>
        {live ? (
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Ordering ON</span>
        ) : (
          <span className="text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">Step {Math.min(step, 5)} of 5</span>
        )}
      </div>

      {state.shipToError && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{state.shipToError}</div>
      )}

      <ol className="space-y-3">
        {STEPS.map((s) => {
          const done = step > s.n;
          const active = step === s.n && !live;
          return (
            <li key={s.n} className={`rounded-lg border px-3 py-2.5 ${active ? "border-teal-300 bg-teal-50/40" : done ? "border-emerald-100 bg-emerald-50/30" : "border-slate-100 bg-slate-50/50"}`}>
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${done ? "bg-emerald-600 text-white" : active ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-600"}`}>
                  {done ? "✓" : s.n}
                </span>
                <span className={`text-xs font-bold ${done ? "text-emerald-800" : active ? "text-teal-900" : "text-slate-600"}`}>{s.title}</span>
              </div>

              {/* Step 1 */}
              {s.n === 1 && (
                <div className="mt-2 pl-7 space-y-2 text-xs text-slate-600">
                  {done ? (
                    <div>Requested {fmtDate(ob.requested_at)}. SanMar emails you a one-time link to your EDEV test login, usually within 2–3 business days.</div>
                  ) : (
                    <>
                      <div>
                        We email SanMar Integration Support on your behalf (customer #{state.customerNumber}) asking them to set up ordering. Their reply — with a one-time link to your test login — goes straight to <span className="font-semibold">{state.ownerEmail}</span>.
                      </div>
                      {shipToLine && <div>Ship-to on file: <span className="font-semibold">{shipToLine}</span></div>}
                      <div className="flex items-center gap-3 flex-wrap">
                        <button className={btn} disabled={!!busy || !!state.shipToError || !state.hasSanmarCreds} onClick={() => run("Request sent to SanMar", "requestAccess")}>
                          {busy === "requestAccess" ? "Sending…" : "Send request to SanMar"}
                        </button>
                        <button className={ghost} disabled={!!busy || !!state.shipToError} onClick={() => run("Marked as requested", "markRequested")}>
                          I already emailed SanMar
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Step 2 */}
              {s.n === 2 && (step >= 2 || state.hasEdevCreds) && !live && (
                <div className="mt-2 pl-7 space-y-2 text-xs text-slate-600">
                  {state.hasEdevCreds && step > 2 ? (
                    <div>EDEV login saved{state.edevUsername ? ` (${state.edevUsername})` : ""}. <button className={ghost} onClick={() => setState({ ...state, hasEdevCreds: false })}>Replace</button></div>
                  ) : (
                    <>
                      <div>Open the one-time link in SanMar's email and paste the EDEV username and password here. These are separate from your sanmar.com login and only work on SanMar's test system.</div>
                      <div className="grid grid-cols-2 gap-3">
                        <input className={inputCls} placeholder="EDEV username" value={edevUser} onChange={(e) => setEdevUser(e.target.value)} autoComplete="off" />
                        <input className={inputCls} placeholder="EDEV password" type="password" value={edevPass} onChange={(e) => setEdevPass(e.target.value)} autoComplete="new-password" />
                      </div>
                      <button className={btn} disabled={!!busy || !edevUser.trim() || !edevPass.trim()}
                        onClick={() => run("EDEV login saved", "saveEdevCreds", { username: edevUser.trim(), password: edevPass.trim() }, () => { setEdevUser(""); setEdevPass(""); notify.success("EDEV login saved"); })}>
                        {busy === "saveEdevCreds" ? "Saving…" : "Save EDEV login"}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Step 3 */}
              {s.n === 3 && step >= 3 && !live && (
                <div className="mt-2 pl-7 space-y-2 text-xs text-slate-600">
                  <div>
                    Sends a 4-line test order (SanMar's recommended test styles) to SanMar's test system, shipping to <span className="font-semibold">{shipToLine}</span>. Nothing ships and nothing is billed.
                    {" "}Run it once per ship method you'll use; UPS ground is all most shops need.
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" value={shipMethod} onChange={(e) => setShipMethod(e.target.value)}>
                      {(state.shipMethods || ["UPS"]).filter((m) => m !== "PSST" && m !== "TRUCK").map((m) => (
                        <option key={m} value={m}>{m === "UPS" ? "UPS (ground)" : m}</option>
                      ))}
                    </select>
                    <button className={btn} disabled={!!busy || !state.hasEdevCreds || !!state.shipToError}
                      onClick={() => run("Test order submitted", "runTestOrder", { shipMethod }, (d) => {
                        setLastTest(d.test);
                        if (d.ok) notify.success(`Test order ${d.test.po_number} submitted to SanMar's test system`);
                        else notify.error(`SanMar's test system rejected the order: ${d.test?.result?.message || "unknown"}`);
                      })}>
                      {busy === "runTestOrder" ? "Submitting…" : tests.length ? "Send another test order" : "Send test order"}
                    </button>
                  </div>
                  {tests.length > 0 && (
                    <ul className="space-y-1">
                      {tests.map((t) => (
                        <li key={t.po_number} className={`rounded px-2 py-1 border ${t.result?.success ? "border-emerald-100 bg-emerald-50/40" : "border-red-100 bg-red-50/40"}`}>
                          <span className="font-mono font-semibold">{t.po_number}</span> · {t.ship_method} · {fmtDate(t.submitted_at)} ·{" "}
                          {t.result?.success ? <span className="text-emerald-700">accepted</span> : <span className="text-red-700">rejected — {t.result?.message}</span>}
                          {t.presubmit && !t.presubmit.ok && <span className="text-amber-700"> · stock check: {t.presubmit.message}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {lastTest?.presubmit?.lines?.length > 0 && (
                    <div className="text-[11px] text-slate-500">
                      Warehouses: {[...new Set(lastTest.presubmit.lines.map((l) => l.whseNo).filter(Boolean))].join(", ") || "n/a"}
                    </div>
                  )}
                </div>
              )}

              {/* Step 4 */}
              {s.n === 4 && step >= 4 && !live && (
                <div className="mt-2 pl-7 space-y-2 text-xs text-slate-600">
                  {ob.notified_at ? (
                    <div>Sent {fmtDate(ob.notified_at)}. SanMar reviews the order files and enables your production account, usually within 1–2 business days. Watch <span className="font-semibold">{state.ownerEmail}</span> for their reply.</div>
                  ) : (
                    <>
                      <div>
                        We email SanMar your test PO number{okTests.length === 1 ? "" : "s"} ({okTests.map((t) => t.po_number).join(", ")}) plus the setup answers they need: shipping notifications to {state.ownerEmail}, label name "{state.shipTo?.name}", Warehouse Consolidation shipping, no PSST.
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Payment method on your SanMar account</label>
                        <input className={inputCls} placeholder='e.g. "Net 30 terms" or "Visa on file ending 1234"' value={payment} onChange={(e) => setPayment(e.target.value)} />
                        <div className="text-[10px] text-slate-400 mt-1">SanMar needs net terms or a card already saved on sanmar.com. Never type a full card number here.</div>
                      </div>
                      <button className={btn} disabled={!!busy || okTests.length === 0} onClick={() => run("SanMar notified", "notifySanmar", { paymentMethod: payment })}>
                        {busy === "notifySanmar" ? "Sending…" : "Email SanMar the test PO"}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Step 5 */}
              {s.n === 5 && step >= 5 && !live && (
                <div className="mt-2 pl-7 space-y-2 text-xs text-slate-600">
                  <div>When SanMar emails that your production account is configured for integrated POs, turn ordering on. Your first live order should be small — SanMar validates it.</div>
                  <button className={btn} disabled={!!busy} onClick={() => {
                    if (!window.confirm("SanMar has confirmed your production account is set up for integrated purchase orders?\n\nAfter this, submitting a SanMar PO in InkTracker places a real order on your SanMar account.")) return;
                    run("SanMar ordering is on", "markLive");
                  }}>
                    {busy === "markLive" ? "Turning on…" : "SanMar confirmed — turn ordering on"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {live && (
        <div className="text-xs text-slate-600 flex items-center justify-between gap-2 flex-wrap">
          <span>Live since {fmtDate(ob.live_at)}. SanMar purchase orders submit from the Purchase Orders page like S&amp;S and AS Colour.</span>
          <button className={ghost} disabled={!!busy} onClick={() => { if (window.confirm("Turn SanMar ordering off for this shop?")) run("SanMar ordering turned off", "markNotLive"); }}>Turn off</button>
        </div>
      )}
    </div>
  );
}
