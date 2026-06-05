// Compute the additive-merge patch for a customer merge.
//
// Returns an object suitable to pass to Customer.update(primary.id, patch).
// The patch contains ONLY fields that should change on the primary — never
// overwrites a populated field on the primary. Sources missing values from
// the duplicate. For `notes` (free text) and `saved_imprints` (array), it
// concatenates rather than empty-fills, so neither record's content
// disappears when the duplicate is deleted.
//
// This is the contract the user explicitly asked for after the "beloved's"
// merge incident: nothing gets silently dropped.

const SIMPLE_EMPTY_FILL_FIELDS = [
  "email",
  "phone",
  "address",
  "company",
  "tax_id",
  "qb_customer_id",
];

function isBlank(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function unionSavedImprints(primary, dup) {
  const a = Array.isArray(primary) ? primary : [];
  const b = Array.isArray(dup) ? dup : [];
  if (a.length === 0 && b.length === 0) return null;
  if (a.length === 0) return b.slice();
  if (b.length === 0) return null; // nothing new from dup
  // Dedupe by a stable signature: id if present, else stringified content.
  const seen = new Set(a.map(sig));
  const merged = a.slice();
  for (const entry of b) {
    const s = sig(entry);
    if (!seen.has(s)) {
      merged.push(entry);
      seen.add(s);
    }
  }
  // If we didn't actually add anything new, signal no-op.
  return merged.length === a.length ? null : merged;
}

function sig(entry) {
  if (!entry) return "";
  if (entry.id) return `id:${entry.id}`;
  try { return JSON.stringify(entry); } catch { return String(entry); }
}

function appendNotes(primary, dup, dupName) {
  const p = (primary || "").trim();
  const d = (dup || "").trim();
  if (!d) return null;            // dup has nothing to contribute
  if (!p) return d;               // primary blank → use dup verbatim
  if (p.includes(d)) return null; // dup already substring (idempotent on re-merge)
  const tag = dupName ? `— from ${dupName} —` : "— merged in —";
  return `${p}\n\n${tag}\n${d}`;
}

/**
 * @param {object} primary  the customer being kept
 * @param {object} dup      the customer being absorbed
 * @returns {object|null}   patch to apply, or null when no changes
 */
export function buildAdditiveMergePatch(primary, dup) {
  if (!primary || !dup) return null;
  const patch = {};

  for (const field of SIMPLE_EMPTY_FILL_FIELDS) {
    if (isBlank(primary[field]) && !isBlank(dup[field])) {
      patch[field] = dup[field];
    }
  }

  // tax_exempt — treat undefined/null as "not set." If primary has an
  // explicit boolean (even false), preserve it. Only carry over when
  // primary is unset AND dup has a definite value.
  if (
    (primary.tax_exempt === undefined || primary.tax_exempt === null) &&
    (dup.tax_exempt === true || dup.tax_exempt === false)
  ) {
    patch.tax_exempt = dup.tax_exempt;
  }

  // default_deposit_pct — numeric. 0 is a legitimate value (e.g. "this
  // customer pays everything COD"). Only carry over when primary's is
  // null/undefined.
  if (
    (primary.default_deposit_pct === undefined || primary.default_deposit_pct === null) &&
    typeof dup.default_deposit_pct === "number" && !Number.isNaN(dup.default_deposit_pct)
  ) {
    patch.default_deposit_pct = dup.default_deposit_pct;
  }

  // notes — concat. The user told us they want nothing dropped; merging
  // both customers' notes is the only way to honor that without an
  // overwrite gesture.
  const mergedNotes = appendNotes(primary.notes, dup.notes, dup.name);
  if (mergedNotes != null) patch.notes = mergedNotes;

  // saved_imprints — concat-dedupe so the survivor inherits every
  // template either record had set up.
  const mergedImprints = unionSavedImprints(primary.saved_imprints, dup.saved_imprints);
  if (mergedImprints != null) patch.saved_imprints = mergedImprints;

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Returns the list of fields that WILL be touched on the primary by a
 * proposed merge. Used by the confirm dialog to show the operator what
 * is about to happen before they commit. The format is intentionally
 * shop-readable, not engineering-ready.
 *
 * @param {object} primary
 * @param {object} dup
 * @returns {Array<{ field: string, mode: 'fill' | 'append' | 'union', from: any, to: any }>}
 */
export function describeMergeFor(primary, dup) {
  if (!primary || !dup) return [];
  const out = [];

  for (const field of SIMPLE_EMPTY_FILL_FIELDS) {
    if (isBlank(primary[field]) && !isBlank(dup[field])) {
      out.push({ field, mode: "fill", from: dup[field], to: dup[field] });
    }
  }
  if (
    (primary.tax_exempt === undefined || primary.tax_exempt === null) &&
    (dup.tax_exempt === true || dup.tax_exempt === false)
  ) {
    out.push({ field: "tax_exempt", mode: "fill", from: dup.tax_exempt, to: dup.tax_exempt });
  }
  if (
    (primary.default_deposit_pct === undefined || primary.default_deposit_pct === null) &&
    typeof dup.default_deposit_pct === "number" && !Number.isNaN(dup.default_deposit_pct)
  ) {
    out.push({ field: "default_deposit_pct", mode: "fill", from: dup.default_deposit_pct, to: dup.default_deposit_pct });
  }
  if (appendNotes(primary.notes, dup.notes, dup.name) != null) {
    out.push({ field: "notes", mode: "append", from: dup.notes });
  }
  if (unionSavedImprints(primary.saved_imprints, dup.saved_imprints) != null) {
    out.push({ field: "saved_imprints", mode: "union" });
  }
  return out;
}
