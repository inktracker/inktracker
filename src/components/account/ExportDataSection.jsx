import { useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { DownloadCloud, Loader2 } from "lucide-react";
import { shopScope } from "@/lib/shopScope";

// good enough for the row counts a shop generates over its lifetime.
export default function ExportDataSection({ user }) {
  const [busy, setBusy] = useState(null);

  const ENTITIES = [
    { key: "customers", label: "Customers", entity: base44.entities.Customer },
    { key: "quotes",    label: "Quotes",    entity: base44.entities.Quote },
    { key: "orders",    label: "Orders",    entity: base44.entities.Order },
    { key: "invoices",  label: "Invoices",  entity: base44.entities.Invoice },
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

  // Fields that are bookkeeping/internal — they're noise in a CSV a shop
  // owner opens in Excel. The full JSON backup still includes them.
  const HIDE_FIELDS = new Set([
    "shop_owner", "auth_id", "user_id", "created_by", "updated_by",
    "_pc", "pricing_config", "raw_payload", "stripe_session_id",
    "stripe_payment_intent_id", "qb_sync_token", "qb_doc_number",
    "line_items_json", "metadata", "search_vector",
  ]);

  // Friendly column names. Anything not listed falls back to a Title Case
  // version of the snake_case key.
  const LABEL_OVERRIDES = {
    id: "ID",
    qb_customer_id: "QB Customer ID",
    qb_invoice_id: "QB Invoice ID",
    quote_status: "Status",
    order_status: "Status",
    invoice_status: "Status",
    customer_email: "Customer Email",
    customer_name: "Customer",
    customer_phone: "Phone",
    customer_company: "Company",
    customer_address: "Address",
    is_tax_exempt: "Tax Exempt",
    tax_rate: "Tax Rate",
    tax_amount: "Tax",
    subtotal: "Subtotal",
    total: "Total",
    balance: "Balance",
    paid_amount: "Paid",
    deposit_amount: "Deposit",
    setup_fee: "Setup Fee",
    line_items: "Line Items",
    created_date: "Created",
    updated_date: "Updated",
    paid_date: "Paid On",
    due_date: "Due",
    completion_date: "Completed",
    shipping_address: "Ship To",
  };

  // Preferred column order — anything matching shows up first in this
  // sequence; everything else follows alphabetical.
  const ORDER_PRIORITY = [
    "id", "created_date", "customer_name", "customer_email", "customer_company",
    "quote_status", "order_status", "invoice_status", "status",
    "subtotal", "tax_amount", "total", "balance", "paid_amount", "due_date",
    "qb_customer_id", "qb_invoice_id",
  ];

  function humanizeLabel(key) {
    if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
    return key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function looksLikeIsoDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
  }

  function formatCell(key, value) {
    if (value == null || value === "") return "";
    if (looksLikeIsoDate(value)) {
      // Local-time, no seconds — readable in a spreadsheet column.
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString([], {
          year: "numeric", month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
      }
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) {
      // Line items + similar — turn into a readable summary like
      // "Black Tee × 24; Heather Tee × 12" instead of dumping JSON.
      const parts = value.map((item) => {
        if (item == null) return "";
        if (typeof item !== "object") return String(item);
        const name = item.name || item.title || item.style || item.description || "";
        const qty = item.quantity ?? item.qty;
        return qty != null && name ? `${name} × ${qty}` : (name || JSON.stringify(item));
      }).filter(Boolean);
      return parts.join("; ");
    }
    if (typeof value === "object") {
      // Flatten one level of object into "key: val, key: val" — readable
      // for things like address objects without dumping full JSON.
      const parts = Object.entries(value)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      return parts.join(", ");
    }
    return String(value);
  }

  function toCsv(rows) {
    if (!rows || rows.length === 0) return "";
    // Union of keys across rows, minus internal ones.
    const headerSet = new Set();
    for (const r of rows) {
      if (r && typeof r === "object") {
        for (const k of Object.keys(r)) {
          if (!HIDE_FIELDS.has(k)) headerSet.add(k);
        }
      }
    }
    // Stable order: priority list first, then alphabetical for the rest.
    const all = Array.from(headerSet);
    const priority = ORDER_PRIORITY.filter((k) => headerSet.has(k));
    const rest = all.filter((k) => !priority.includes(k)).sort();
    const keys = [...priority, ...rest];

    const escape = (v) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [keys.map(humanizeLabel).join(",")];
    for (const r of rows) lines.push(keys.map((k) => escape(formatCell(k, r?.[k]))).join(","));
    return lines.join("\n");
  }

  async function fetchAll(entity) {
    try {
      return await entity.filter({ shop_owner: shopScope(user) }, "-created_date", 100000);
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
      const results = await Promise.all(
        ENTITIES.map((e) => fetchAll(e.entity).then((r) => [e.key, r]))
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
        Download your shop's data for backup or migration. CSVs are cleaned up for Excel/Sheets — friendly column names, formatted dates, line items as readable summaries. The full backup JSON is a raw dump of every entity for migration or restore. Large datasets may take a moment.
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
