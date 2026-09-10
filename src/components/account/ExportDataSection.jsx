import { useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { DownloadCloud, Loader2 } from "lucide-react";
import { shopScope } from "@/lib/shopScope";
import { toCsv, redactRow } from "@/lib/export/exportFormat";
import { notify } from "@/lib/notify";
import { isNative } from "@/lib/mobile/native";

// good enough for the row counts a shop generates over its lifetime.
export default function ExportDataSection({ user }) {
  const [busy, setBusy] = useState(null);

  const ENTITIES = [
    { key: "customers", label: "Customers", entity: base44.entities.Customer },
    { key: "quotes",    label: "Quotes",    entity: base44.entities.Quote },
    { key: "orders",    label: "Orders",    entity: base44.entities.Order },
    { key: "invoices",  label: "Invoices",  entity: base44.entities.Invoice },
    { key: "expenses",  label: "Expenses",  entity: base44.entities.Expense },
    { key: "inventory", label: "Inventory", entity: base44.entities.InventoryItem },
  ];

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  // Returns false when the download can't happen (native shell), so callers
  // don't report success. A blob-URL <a download> is a NO-OP inside the
  // Capacitor WKWebView (same class as the window.open(blob) no-op), so the
  // buttons would silently do nothing on iOS. Export is a web/desktop action —
  // say so instead of appearing broken.
  function downloadBlob(content, filename, mime) {
    if (isNative()) {
      notify.info("Export from the web app", "Open inktracker.app on a computer to download your data.");
      return false;
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a); // some browsers (Firefox/Safari) require the anchor in the DOM
    a.click();
    // Defer cleanup — revoking the URL synchronously on the same tick can
    // cancel the download before the browser reads it.
    setTimeout(() => { try { document.body.removeChild(a); } catch { /* already gone */ } URL.revokeObjectURL(url); }, 0);
    return true;
  }

  // Returns { rows, ok }. ok=false on ANY fetch error so callers can REFUSE to
  // write a file that looks complete but silently dropped a table — a partial
  // "backup" is worse than a clear failure.
  async function fetchAll(entity) {
    try {
      // .all() paginates past PostgREST's 1000-row response cap — a plain
      // .filter(..., 100000) was silently truncating exports of large tables.
      const rows = await entity.all({ shop_owner: shopScope(user) }, "-created_date");
      return { rows, ok: true };
    } catch (e) {
      console.error("[Export] fetch failed:", e);
      return { rows: [], ok: false };
    }
  }

  async function exportCsv(item) {
    setBusy(item.key);
    try {
      const { rows, ok } = await fetchAll(item.entity);
      if (!ok) {
        notify.error(`Couldn't export ${item.label}`, "The data didn't load — please try again.");
        return;
      }
      downloadBlob(toCsv(rows), `inktracker-${item.key}-${dateStamp()}.csv`, "text/csv");
    } finally {
      setBusy(null);
    }
  }

  async function exportFullBackup() {
    setBusy("backup");
    try {
      const results = await Promise.all(
        ENTITIES.map((e) => fetchAll(e.entity).then((r) => [e.key, r])),
      );
      // If ANY entity failed to load, do NOT write the file — a backup that
      // silently omits a table (the JSON still parses) is the dangerous case.
      const failed = results.filter(([, r]) => !r.ok).map(([k]) => k);
      if (failed.length) {
        notify.error("Backup not saved — some data didn't load", `Couldn't load: ${failed.join(", ")}. Please try again.`);
        return;
      }
      // Redact bearer tokens/payment links from the backup too — they're
      // credentials, not restorable business data, and a leak vector.
      const data = Object.fromEntries(results.map(([k, r]) => [k, r.rows.map(redactRow)]));
      const payload = JSON.stringify(
        { exportedAt: new Date().toISOString(), shopOwner: shopScope(user), ...data },
        null,
        2,
      );
      downloadBlob(payload, `inktracker-backup-${dateStamp()}.json`, "application/json");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Your data is yours — export it anytime, no strings. Download your customers, quotes, orders, invoices, and expenses for backup or migration. CSVs are cleaned up for Excel/Sheets — friendly column names, formatted dates, line items as readable summaries. The full backup JSON is a raw dump of every record for migration or restore. Large datasets may take a moment.
      </p>
      <div className="grid sm:grid-cols-2 gap-2">
        {ENTITIES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => exportCsv(item)}
            disabled={busy !== null}
            className="flex items-center justify-between px-3 py-2 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <span className="flex items-center gap-2">
              <DownloadCloud className="w-4 h-4 text-teal-500" />
              {item.label} (CSV)
            </span>
            {busy === item.key && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={exportFullBackup}
        disabled={busy !== null}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-60 disabled:cursor-not-allowed transition"
      >
        {busy === "backup" ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
        {busy === "backup" ? "Building backup…" : "Download Full Backup (JSON)"}
      </button>
    </div>
  );
}
