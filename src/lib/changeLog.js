// change_log — client-side writer + field differ.
//
// Records WHO changed a document, WHEN, and WHERE FROM. Purely
// descriptive: nothing here alters a price, total, or line item. The
// companion edge-side writer is supabase/functions/_shared/changeLog.js
// (QuickBooks-sourced rows); this one covers edits made in the app.
//
// Best-effort by contract — a logging failure must never block or undo
// the save it describes.

import { base44 } from "@/api/supabaseClient";
import { shopScope } from "@/lib/shopScope";

export const CHANGE_SOURCES = Object.freeze({
  QUICKBOOKS: "quickbooks",
  INKTRACKER: "inktracker",
  SYSTEM: "system",
});

const fmtUsd = (n) => `$${Number(n ?? 0).toFixed(2)}`;

// Fields worth telling a shop owner about, with how to render them.
// Anything not listed is ignored — internal bookkeeping columns
// (qb_synced_at, qb_line_snapshot, updated timestamps) are noise in a
// history panel.
const TRACKED_FIELDS = [
  { key: "total",         label: "Total",        fmt: fmtUsd },
  { key: "subtotal",      label: "Subtotal",     fmt: fmtUsd },
  { key: "tax",           label: "Tax",          fmt: fmtUsd },
  { key: "tax_rate",      label: "Tax rate",     fmt: (v) => `${Number(v ?? 0)}%` },
  { key: "discount",      label: "Discount",     fmt: (v) => String(v ?? 0) },
  { key: "rush_rate",     label: "Rush rate",    fmt: (v) => String(v ?? 0) },
  { key: "paid",          label: "Paid",         fmt: (v) => (v ? "yes" : "no") },
  { key: "status",        label: "Status",       fmt: (v) => String(v ?? "") },
  { key: "due",           label: "Due date",     fmt: (v) => String(v ?? "") },
  { key: "date",          label: "Date",         fmt: (v) => String(v ?? "") },
  { key: "customer_name", label: "Customer",     fmt: (v) => String(v ?? "") },
  { key: "invoice_id",    label: "Invoice #",    fmt: (v) => String(v ?? "") },
];

const MONEYISH = new Set(["total", "subtotal", "tax", "tax_rate", "discount", "rush_rate"]);

const sameMoney = (a, b) =>
  Math.abs(Number((Number(a ?? 0) - Number(b ?? 0)).toFixed(2))) <= 0.01;

/**
 * Human-readable list of what changed between two versions of a row.
 * Money fields compare at cent precision so float noise doesn't
 * manufacture entries. Returns [] when nothing tracked moved.
 */
export function diffTrackedFields(before, after) {
  if (!before || !after) return [];
  const changes = [];
  for (const { key, label, fmt } of TRACKED_FIELDS) {
    if (!(key in after)) continue;
    const a = before[key];
    const b = after[key];
    const unchanged = MONEYISH.has(key)
      ? sameMoney(a, b)
      : String(a ?? "") === String(b ?? "");
    if (!unchanged) changes.push(`${label}: ${fmt(a)} → ${fmt(b)}`);
  }
  return changes;
}

/**
 * Count line-item movement without dumping the whole itemization into
 * the log. Descriptive only — line items themselves are never rewritten
 * from here.
 */
export function diffLineItems(before, after) {
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  if (a.length === b.length) {
    const moved = b.filter((line, i) => JSON.stringify(line) !== JSON.stringify(a[i])).length;
    return moved ? [`${moved} line item${moved === 1 ? "" : "s"} edited`] : [];
  }
  return [b.length > a.length
    ? `${b.length - a.length} line item${b.length - a.length === 1 ? "" : "s"} added`
    : `${a.length - b.length} line item${a.length - b.length === 1 ? "" : "s"} removed`];
}

/**
 * Write one history entry. Never throws.
 *
 * @param {object} args
 * @param {object} args.user        the signed-in user (supplies actor + shop scope)
 * @param {string} args.entityType  'invoice' | 'quote' | 'order'
 * @param {string} args.entityId    row id
 * @param {string} [args.entityRef] human ref shown in the list
 * @param {string} args.summary     one-line description
 * @param {string[]} [args.changes] itemized changes
 */
export async function recordChange({
  user,
  entityType,
  entityId,
  entityRef = null,
  summary,
  changes = [],
  metadata = {},
  source = CHANGE_SOURCES.INKTRACKER,
}) {
  try {
    // Call sites inside modals often don't hold the user. Resolving it
    // here keeps `actor` accurate without threading a prop through every
    // component that can edit a document.
    const actingUser = user ?? await base44.auth.me();
    const shopOwner = shopScope(actingUser);
    if (!shopOwner || !entityId || !summary) return false;
    await base44.entities.ChangeLog.create({
      shop_owner: shopOwner,
      entity_type: entityType,
      entity_id: String(entityId),
      entity_ref: entityRef ? String(entityRef) : null,
      source,
      // WHO. Managers and employees act under the owner's shop_owner,
      // so their own email here is the only record of who touched it.
      actor: actingUser?.email ?? null,
      summary,
      changes,
      metadata,
    });
    return true;
  } catch (err) {
    console.error("[changeLog] write failed:", err?.message ?? err);
    return false;
  }
}

/**
 * Diff a row before/after an in-app edit and log it if anything moved.
 * No-op when nothing tracked changed, so ordinary saves don't pad the
 * history with empty entries.
 */
export async function recordEntityEdit({ user, entityType, entityId, entityRef, before, after, summaryPrefix = "Edited" }) {
  const changes = [
    ...diffTrackedFields(before, after),
    ...diffLineItems(before?.line_items, after?.line_items),
  ];
  if (changes.length === 0) return false;
  return recordChange({
    user,
    entityType,
    entityId,
    entityRef,
    summary: `${summaryPrefix} in InkTracker — ${changes.length} change${changes.length === 1 ? "" : "s"}`,
    changes,
  });
}
