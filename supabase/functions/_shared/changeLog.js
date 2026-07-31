// change_log writer — "who changed what, when, and from where".
//
// Append-only shop-facing history. This module NEVER mutates the
// document it describes: recording that QuickBooks changed a garment
// colour is not the same as applying that change, and prices are never
// touched here. Adoption stays an explicit operator click.
//
// `source` answers where the change came from:
//   'quickbooks' — edited inside QBO, seen via webhook
//   'inktracker' — edited in the app by a signed-in user
//   'system'     — automated (reconcile, cascade, scheduled job)
//
// `actor` answers who. For InkTracker edits that's the user's email.
// QuickBooks does not report the acting user on the Invoice payload
// (the QBO Audit Log is UI-only, not exposed on the entity), so QB-side
// rows carry a null actor and the UI renders "in QuickBooks" rather
// than inventing a name.

export const CHANGE_SOURCES = Object.freeze({
  QUICKBOOKS: "quickbooks",
  INKTRACKER: "inktracker",
  SYSTEM: "system",
});

const VALID_ENTITIES = new Set(["invoice", "quote", "order"]);
const VALID_SOURCES = new Set(Object.values(CHANGE_SOURCES));

/**
 * Build a change_log row. Pure — validation lives here so the caller
 * can be unit-tested without a database.
 *
 * @returns {object|null} the row, or null when required fields are
 *   missing/invalid (callers treat logging as best-effort and must
 *   never fail the operation they're describing).
 */
export function buildChangeLogRow({
  shopOwner,
  entityType,
  entityId,
  entityRef = null,
  source,
  actor = null,
  summary,
  changes = [],
  metadata = {},
}) {
  if (!shopOwner || typeof shopOwner !== "string") return null;
  if (!VALID_ENTITIES.has(entityType)) return null;
  if (!entityId) return null;
  if (!VALID_SOURCES.has(source)) return null;
  const text = typeof summary === "string" ? summary.trim() : "";
  if (!text) return null;

  return {
    shop_owner: shopOwner,
    entity_type: entityType,
    entity_id: String(entityId),
    entity_ref: entityRef ? String(entityRef) : null,
    source,
    actor: actor ? String(actor) : null,
    summary: text,
    changes: Array.isArray(changes) ? changes : [],
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
}

/**
 * Insert a change_log row. Best-effort by contract: swallows its own
 * errors so a logging failure can never break the webhook or edit that
 * triggered it. Returns true only on a confirmed write.
 */
export async function recordChange(supabase, input) {
  const row = buildChangeLogRow(input);
  if (!row) {
    console.error("[changeLog] refused to write an invalid row:", JSON.stringify(input ?? {}).slice(0, 200));
    return false;
  }
  try {
    const { error } = await supabase.from("change_log").insert(row);
    if (error) {
      console.error("[changeLog] insert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[changeLog] insert threw:", err?.message ?? err);
    return false;
  }
}
