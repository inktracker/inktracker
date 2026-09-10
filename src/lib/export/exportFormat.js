// Pure formatting + safety logic for the account data export (CSV + JSON
// backup). Extracted from ExportDataSection so the security-sensitive parts —
// formula-injection escaping, bearer-token redaction, line-item summarizing —
// are unit-tested without mounting a component.

// Bearer credentials — a public quote/pay token or payment URL is a
// capability: anyone holding it can view or PAY a quote. Useless in a backup
// (the server regenerates them) and a real leak vector once the exported file
// is emailed around, so they're stripped from BOTH the CSV and the JSON
// backup. Name-based, so a future *_token / *payment_link column is covered.
export function isSensitiveField(k) {
  return /(_token|_secret|payment_link|pay_link)$/.test(k) || k === "public_token";
}

// Shallow copy of a row with sensitive keys removed. Used for the JSON backup
// (the CSV drops the same keys at the header stage).
export function redactRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!isSensitiveField(k)) out[k] = v;
  }
  return out;
}

// Fields that are bookkeeping/internal — noise in a CSV a shop owner opens in
// Excel. Dropped from the CSV only; the JSON backup keeps them (raw restore
// dump of the owner's own data).
export const HIDE_FIELDS = new Set([
  "shop_owner", "auth_id", "user_id", "created_by", "updated_by",
  "_pc", "pricing_config", "raw_payload", "stripe_session_id",
  "stripe_payment_intent_id", "qb_sync_token", "qb_doc_number",
  "line_items_json", "metadata", "search_vector",
]);

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

const ORDER_PRIORITY = [
  "id", "created_date", "customer_name", "customer_email", "customer_company",
  "quote_status", "order_status", "invoice_status", "status",
  "subtotal", "tax_amount", "total", "balance", "paid_amount", "due_date",
  "qb_customer_id", "qb_invoice_id",
];

export function humanizeLabel(key) {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function looksLikeIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
}

export function formatCell(key, value) {
  if (value == null || value === "") return "";
  if (looksLikeIsoDate(value)) {
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
    // Line items → a readable summary like "Black Tee (Black) × 24; ...".
    const parts = value.map((item) => {
      if (item == null) return "";
      if (typeof item !== "object") return String(item);
      // InkTracker line items name the garment product_title/productName/
      // garmentName/style_name — the old name/title/style guesses missed all
      // of them and fell through to JSON.stringify, dumping the raw item
      // (internal cost fields included).
      const name = item.product_title || item.productName || item.garmentName ||
        item.style_name || item.name || item.title || item.description || "";
      // Quantity lives in the size grid { S: 12, M: 24, ... }, not one
      // `quantity` field — sum it. Fall back to an explicit qty if present.
      let qty = item.quantity ?? item.qty;
      if (qty == null && item.sizes && typeof item.sizes === "object") {
        qty = Object.values(item.sizes).reduce((a, b) => a + (Number(b) || 0), 0) || null;
      }
      const color = item.color ? ` (${item.color})` : "";
      if (name && qty != null) return `${name}${color} × ${qty}`;
      // Never JSON.stringify the raw item — it can carry internal costs.
      return name ? `${name}${color}` : "";
    }).filter(Boolean);
    return parts.join("; ");
  }
  if (typeof value === "object") {
    // Flatten one level — readable for address-like objects without full JSON.
    const parts = Object.entries(value)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
    return parts.join(", ");
  }
  return String(value);
}

// CSV cell escaping WITH a formula-injection guard: a cell starting with
// = + - @ (or a tab/CR) is executed as a formula by Excel/Sheets — a customer
// name like "=cmd|..." becomes a live formula for whoever opens the file.
// Prefix a single quote so it's treated as text, then apply RFC-4180 quoting.
export function escapeCsvCell(v) {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  if (!rows || rows.length === 0) return "";
  const headerSet = new Set();
  for (const r of rows) {
    if (r && typeof r === "object") {
      for (const k of Object.keys(r)) {
        if (!HIDE_FIELDS.has(k) && !isSensitiveField(k)) headerSet.add(k);
      }
    }
  }
  const all = Array.from(headerSet);
  const priority = ORDER_PRIORITY.filter((k) => headerSet.has(k));
  const rest = all.filter((k) => !priority.includes(k)).sort();
  const keys = [...priority, ...rest];

  const lines = [keys.map(humanizeLabel).join(",")];
  for (const r of rows) lines.push(keys.map((k) => escapeCsvCell(formatCell(k, r?.[k]))).join(","));
  return lines.join("\n");
}
