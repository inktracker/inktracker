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
// Both are InkTracker-shaped { name, company, email }.
//
// Email is decisive (equal emails → same customer), consistent with
// qbSync's customerIdentityMatches so a QB customer is never re-created. When
// emails differ (or are absent) the match is SYMMETRIC over the fields BOTH
// records actually have — this is the fix for the "asymmetric enrichment"
// bug where a QB record with only a name (blank company) would NOT match a
// richer CSV row carrying name+company, and get duplicated. Match on the
// intersection of populated fields, never keyed off one side alone.
export function customerRowMatches(row, existing) {
  if (!row || !existing) return false;

  const email = isLikelyEmail(row.email) ? row.email.trim().toLowerCase() : "";
  const exEmail = isLikelyEmail(existing.email) ? existing.email.trim().toLowerCase() : "";
  if (email && exEmail && email === exEmail) return true;

  const company = normalizeForMatch(row.company);
  const name = normalizeForMatch(row.name);
  const exCompany = normalizeForMatch(existing.company);
  const exName = normalizeForMatch(existing.name);

  const bothCompany = company && exCompany;
  const bothName = name && exName;

  // Both records carry company AND name → require both to agree (distinct
  // contacts at the same company are NOT merged).
  if (bothCompany && bothName) return exCompany === company && exName === name;
  // Only one field is shared by both → match on that field (mirrors QB's
  // single-field behavior, and closes the enrichment-asymmetry gap).
  if (bothName) return exName === name;
  if (bothCompany) return exCompany === company;
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
    } else if (c === '"' && field === "") {
      // Quote is only special at the START of a field (RFC-4180). A stray
      // quote mid-field — an inch mark (12" sleeve) or Apt "B" — is a literal,
      // NOT a quote-mode toggle, so it can't swallow later commas/newlines.
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
  const fullName = pick(row, "name", "contact name", "full name", "customer name", "primary contact");
  const name = fullName || [first, last].filter(Boolean).join(" ");
  const company = pick(row, "company", "company name", "business name", "customer");
  const email = pick(row, "email", "email address", "contact email");
  const phone = pick(row, "phone", "phone number", "contact phone", "mobile");
  const address = pick(row, "address", "billing address", "billing address 1", "street", "address line 1");
  return { name, company, email: email || null, phone: phone || null, address: address || null };
}

// True when `a` and `b` share an email but have DIFFERENT (both non-empty)
// names — the one collapse worth showing the user before import: two distinct
// contacts on one address (info@…) that email-decisive matching folds into a
// single customer. Not a bug (email-decisive is what protects the QB-dedup
// guarantee), just worth surfacing so a real different-person case is caught.
function sharedEmailNameDiffers(a, b) {
  const ea = isLikelyEmail(a?.email) ? a.email.trim().toLowerCase() : "";
  const eb = isLikelyEmail(b?.email) ? b.email.trim().toLowerCase() : "";
  if (!ea || !eb || ea !== eb) return false;
  const na = normalizeForMatch(a?.name);
  const nb = normalizeForMatch(b?.name);
  return Boolean(na && nb && na !== nb);
}

// Duplicate record for the preview: the incoming row, what it matched (id +
// display name), and the shared-email-different-name flag above.
function makeDuplicate(row, matched, matchId) {
  return {
    row,
    matchId,
    matchedName: matched?.name || matched?.company || "",
    sharedEmailNameDiffers: sharedEmailNameDiffers(row, matched),
  };
}

// Classify parsed CSV rows against existing customers.
//   → { toCreate: [customerShape...],
//       duplicates: [{ row, matchId, matchedName, sharedEmailNameDiffers }],
//       invalid: n }
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
    if (existingMatch) { duplicates.push(makeDuplicate(c, existingMatch, existingMatch.id)); continue; }

    const inFile = seen.find((s) => customerRowMatches(c, s));
    if (inFile) { duplicates.push(makeDuplicate(c, inFile, null)); continue; }

    seen.push(c);
    toCreate.push(c);
  }
  return { toCreate, duplicates, invalid };
}
