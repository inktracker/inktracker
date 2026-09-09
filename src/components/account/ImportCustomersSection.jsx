import { useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { UploadCloud, Loader2, CheckCircle2 } from "lucide-react";
import { shopScope } from "@/lib/shopScope";
import { normalizeCustomerWrite } from "@/lib/customers/normalizeCustomerWrite";
import { parseCsv, classifyImport } from "@/lib/import/customerImport";

// Import a customer list from Printavo (or any CSV) WITHOUT ever duplicating
// or conflicting with customers already in InkTracker — including ones that
// came from QuickBooks. The classifier matches every incoming row against the
// full existing list (QB rows included) using the same identity ladder the QB
// sync uses; matches are shown as "already in your list" and never inserted.
export default function ImportCustomersSection({ user }) {
  const [preview, setPreview] = useState(null); // { toCreate, duplicates, invalid, fileName }
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);       // { added }
  const [error, setError] = useState("");

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError(""); setDone(null); setPreview(null);
    setBusy(true);
    try {
      const text = await file.text();
      const { rows } = parseCsv(text);
      if (!rows.length) { setError("That file has no rows we could read."); return; }

      // RLS scopes this to the shop; includes QB-imported customers so they
      // dedupe. shopScope handles managers/brokers acting for the shop.
      const existing = await base44.entities.Customer.filter(
        { shop_owner: shopScope(user) }, "-created_date", 100000,
      );
      const result = classifyImport(rows, existing || []);
      if (result.toCreate.length === 0) {
        setError(
          result.duplicates.length
            ? `All ${result.duplicates.length} customer${result.duplicates.length === 1 ? "" : "s"} in that file are already in your list — nothing to import.`
            : "We couldn't find any customers to import in that file. Check that it has Name/Company/Email columns.",
        );
        return;
      }
      setPreview({ ...result, fileName: file.name });
    } catch (err) {
      setError(err?.message || "Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setBusy(true); setError("");
    let added = 0;
    try {
      // Sequential inserts keep it simple and let a mid-run failure stop
      // cleanly with an accurate count. These are genuinely-new customers
      // (no qb_customer_id) — QB sync will match/adopt them on its next run.
      for (const c of preview.toCreate) {
        await base44.entities.Customer.create(normalizeCustomerWrite({
          name: c.name || c.company || "Unknown",
          company: c.company || "",
          email: c.email || "",
          phone: c.phone || "",
          address: c.address || "",
          shop_owner: shopScope(user),
          orders: 0,
        }));
        added++;
      }
      setDone({ added });
      setPreview(null);
    } catch (err) {
      setError(`Imported ${added} before an error: ${err?.message || "unknown"}. Re-importing the same file is safe — the ${added} already added will be skipped as duplicates.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Moving from Printavo or a spreadsheet? Import your customer list from a CSV. We match every row against your existing customers — including anyone synced from QuickBooks — and only add the ones you don't already have, so nothing gets duplicated. Columns we read: Name (or First/Last), Company, Email, Phone, Address.
      </p>

      {!preview && !done && (
        <label className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 cursor-pointer transition">
          {busy ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : <UploadCloud className="w-4 h-4 text-teal-500" />}
          {busy ? "Reading file…" : "Choose a customer CSV"}
          <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} className="hidden" />
        </label>
      )}

      {preview && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <div className="text-sm text-slate-700">
            <span className="font-semibold">{preview.fileName}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat n={preview.toCreate.length} label="New to add" tone="teal" />
            <Stat n={preview.duplicates.length} label="Already have" tone="slate" />
            <Stat n={preview.invalid} label="Skipped (blank)" tone="slate" />
          </div>
          <p className="text-xs text-slate-500">
            {preview.duplicates.length > 0
              ? `${preview.duplicates.length} row${preview.duplicates.length === 1 ? "" : "s"} already match a customer you have (by email or name) and won't be touched.`
              : "None of these match an existing customer."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmImport}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-60 transition"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {busy ? "Importing…" : `Add ${preview.toCreate.length} customer${preview.toCreate.length === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={() => { setPreview(null); setError(""); }}
              disabled={busy}
              className="px-4 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 disabled:opacity-60 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 dark:bg-teal-900/20 px-4 py-3 text-sm text-teal-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Added {done.added} customer{done.added === 1 ? "" : "s"}. Import another file anytime.
        </div>
      )}

      {error && <p className="text-xs text-amber-700 leading-relaxed">{error}</p>}
    </div>
  );
}

function Stat({ n, label, tone }) {
  const color = tone === "teal" ? "text-teal-600" : "text-slate-600";
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 py-2">
      <div className={`font-display text-2xl ${color}`}>{n}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
