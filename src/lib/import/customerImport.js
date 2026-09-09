// Printavo (and generic) customer-CSV import — pure logic, no I/O.
//
// The one hard rule (Joe, 2026-09-09): NEVER duplicate or conflict with
// customers that came from QuickBooks. So the classifier matches every
// incoming row against ALL existing customers — including QB-imported ones
// (qb_customer_id set) — using the SAME identity ladder qbSync's
// pullCustomers uses (email decisive, then normalized company + name). A
// match is reported as a duplicate and NEVER inserted; the existing record
// (QB fields included) is left completely untouched. Only genuinely-new
// rows become new customers, with no qb_customer_id.
//
// normalizeForMatch below MIRRORS supabase/functions/_shared/qbInvoice.js.
// A drift-canary test (customerImport.test.js) asserts they stay identical,
// so the importer and the QB sync can never disagree on what "same
// customer" means.

// Mirror of _shared/qbInvoice.js normalizeForMatch — keep byte-identical.
export function normalizeForMatch(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isLikelyEmail(v) {
  return typeof v === "string" && EMAIL_RE.test(v.trim());
}

// True when an incoming row is the same logical customer as an existing one.
// Both are InkTracker-shaped { name, company, email }. Email is decisive;
// otherwise normalized company + name (both required when both present, so
// two contacts at one company aren't merged), or the single field present.
export function customerRowMatches(row, existing) {
  if (!row || !existing) return false;

  // Email match is DECISIVE (like qbInvoice.customerIdentityMatches): equal
  // emails → same customer. But differing emails do NOT rule out a match —
  // same name + company with an updated email is a merge, not a duplicate —
  // so fall through to the identity check rather than returning false here.
  const email = isLikelyEmail(row.email) ? row.email.trim().toLowerCase() : "";
  const exEmail = isLikelyEmail(existing.email) ? existing.email.trim().toLowerCase() : "";
  if (email && exEmail && email === exEmail) return true;

  const company = normalizeForMatch(row.company);
  const name = normalizeForMatch(row.name);
  const exCompany = normalizeForMatch(existing.company);
  const exName = normalizeForMatch(existing.name);

  if (company && name) return exCompany === company && exName === name;
  if (company) return exCompany === company;
  if (name) return exName === name;
  return false;
}

// ── CSV parsing ──────────────────────────────────────────────────────────
// Minimal RFC-4180-ish parser: quoted fields, escaped quotes (""), commas
// and newlines inside quotes, CRLF or LF. Good enough for a Printavo export.
export function parseCsv(text) {
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  const src = String(text ?? "").replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field); field = "";
      if (record.length > 1 || record[0] !== "") rows.push(record);
      record = [];
    } else field += c;
  }
  if (field !== "" || record.length > 0) { record.push(field); rows.push(record); }
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => String(h).trim());
  const body = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
    return obj;
  });
  return { headers, rows: body };
}

// Map a Printavo/generic CSV row (header→value) to an InkTracker customer
// shape. Header matching is case/space-insensitive and accepts the common
// aliases Printavo and hand-built exports use.
const pick = (row, ...aliases) => {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const want = normalizeForMatch(alias);
    const hit = keys.find((k) => normalizeForMatch(k) === want);
    if (hit && row[hit]) return String(row[hit]).trim();
  }
  return "";
};

export function mapCustomerRow(row) {
  const first = pick(row, "first name", "firstname", "contact first name");
  const last = pick(row, "last name", "lastname", "contact last name");
  const fullName = pick(row, "name", "contact name", "full name", "customer name");
  const name = fullName || [first, last].filter(Boolean).join(" ");
  const company = pick(row, "company", "company name", "business name", "customer");
  const email = pick(row, "email", "email address", "contact email");
  const phone = pick(row, "phone", "phone number", "contact phone", "mobile");
  const address = pick(row, "address", "billing address", "street", "address line 1");
  return { name, company, email: email || null, phone: phone || null, address: address || null };
}

// Classify parsed CSV rows against existing customers.
//   → { toCreate: [customerShape...], duplicates: [{ row, matchId }], invalid: n }
// A row is invalid (skipped) when it has neither a name nor a company —
// nothing to key on. Within-file duplicates also collapse to one create.
export function classifyImport(csvRows, existingCustomers) {
  const existing = Array.isArray(existingCustomers) ? existingCustomers : [];
  const toCreate = [];
  const duplicates = [];
  let invalid = 0;
  const seen = []; // rows already queued this run, to dedupe within the file

  for (const raw of csvRows || []) {
    const c = mapCustomerRow(raw);
    if (!c.name && !c.company) { invalid++; continue; }

    const existingMatch = existing.find((e) => customerRowMatches(c, e));
    if (existingMatch) { duplicates.push({ row: c, matchId: existingMatch.id }); continue; }

    const inFile = seen.find((s) => customerRowMatches(c, s));
    if (inFile) { duplicates.push({ row: c, matchId: null }); continue; }

    seen.push(c);
    toCreate.push(c);
  }
  return { toCreate, duplicates, invalid };
}
