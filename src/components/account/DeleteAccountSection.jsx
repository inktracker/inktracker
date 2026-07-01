import { useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";

// Self-serve account + data deletion (PRIV-01). Owner-only. Two-step: load a
// dry-run preview of exactly what will be removed, then require typing the
// account email before the irreversible purge. Calls adminAction.purgeShopData
// (authorizes owner-of-own-shop + the typed confirm); on success the account is
// gone, so we sign out and leave.
export default function DeleteAccountSection({ user }) {
  const [step, setStep] = useState("idle"); // idle | preview
  const [preview, setPreview] = useState(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const email = user?.email || "";
  const confirmed = typed.trim().toLowerCase() === email.toLowerCase() && email !== "";

  async function call(extra) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error: invErr } = await base44.functions.invoke("adminAction", {
      action: "purgeShopData", shopOwner: email, confirm: typed.trim() || email,
      accessToken: session?.access_token, ...extra,
    });
    if (invErr) throw new Error(invErr.message || "Request failed");
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function loadPreview() {
    setBusy(true); setErr("");
    try { setPreview(await call({})); setStep("preview"); }
    catch (e) { setErr(e.message || "Couldn't load the deletion preview."); }
    finally { setBusy(false); }
  }

  async function confirmDelete() {
    if (!confirmed) return;
    setBusy(true); setErr("");
    try {
      await call({ apply: true });
      await supabase.auth.signOut().catch(() => {});
      window.location.href = "/";
    } catch (e) { setErr(e.message || "Deletion failed."); setBusy(false); }
  }

  const rows = preview ? Object.entries(preview.wouldDelete || {}).filter(([, v]) => Number(v) > 0) : [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Permanently delete your account and <b>all</b> of your shop's data — customers,
        quotes, orders, invoices, artwork, exemption certificates — and cancel billing.
        This cannot be undone.
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}

      {step === "idle" && (
        <button onClick={loadPreview} disabled={busy}
          className="text-sm font-semibold text-red-600 border border-red-300 hover:bg-red-50 rounded-lg px-4 py-2 disabled:opacity-50 transition">
          {busy ? "Loading…" : "Delete account & all data"}
        </button>
      )}

      {step === "preview" && preview && (
        <div className="border border-red-200 bg-red-50 dark:bg-red-950/30 rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-red-700">This will permanently delete:</div>
          <ul className="text-sm text-red-700 grid grid-cols-2 gap-x-6 gap-y-0.5 list-disc list-inside">
            {rows.map(([t, v]) => <li key={t}>{v} {t.replace(/_/g, " ")}</li>)}
            {Number(preview.profiles) > 0 && <li>{preview.profiles} profile(s)</li>}
            {Number(preview.artworkObjects) > 0 && <li>{preview.artworkObjects} artwork file(s)</li>}
          </ul>
          <div className="text-sm text-red-700">…plus stored certificates and your Stripe billing. <b>This cannot be undone.</b></div>
          <div>
            <label className="block text-xs font-semibold text-red-700 mb-1">
              Type <span className="font-mono">{email}</span> to confirm
            </label>
            <input
              type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={email} autoComplete="off"
              className="w-full text-sm border border-red-300 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-red-300"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setStep("idle"); setPreview(null); setTyped(""); setErr(""); }} disabled={busy}
              className="text-sm text-slate-600 hover:text-slate-800 px-3 py-2">Cancel</button>
            <button onClick={confirmDelete} disabled={busy || !confirmed}
              className="text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg px-4 py-2 disabled:opacity-50 transition">
              {busy ? "Deleting…" : "Permanently delete everything"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
