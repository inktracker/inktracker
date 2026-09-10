import { useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { DownloadCloud, Loader2 } from "lucide-react";
import { shopScope } from "@/lib/shopScope";
import { toCsv, redactRow } from "@/lib/export/exportFormat";

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

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function fetchAll(entity) {
    try {
      // .all() paginates past PostgREST's 1000-row response cap — a plain
      // .filter(..., 100000) was silently truncating exports of large tables
      // (e.g. a shop's full expense history), breaking the "your whole
      // history" promise.
      return await entity.all({ shop_owner: shopScope(user) }, "-created_date");
    } catch (e) {
      console.error("[Export] fetch failed:", e);
      return [];
    }
  }

  async function exportCsv(item) {
    setBusy(item.key);
    try {
      const rows = await fetchAll(item.entity);
      downloadBlob(toCsv(rows), `inktracker-${item.key}-${dateStamp()}.csv`, "text/csv");
    } finally {
      setBusy(null);
    }
  }

  async function exportFullBackup() {
    setBusy("backup");
    try {
      // Redact bearer tokens/payment links from the backup too — they're
      // credentials, not restorable business data, and a leak vector.
      const results = await Promise.all(
        ENTITIES.map((e) => fetchAll(e.entity).then((r) => [e.key, (r || []).map(redactRow)]))
      );
      const data = Object.fromEntries(results);
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
