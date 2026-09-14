import { base44 } from "@/api/supabaseClient";
import { shopScope } from "@/lib/shopScope";
import { lookupStyle, SUPPLIERS } from "@/api/suppliers";
import { aggregateBlankNeeds } from "@/lib/orders/consolidateBlankNeeds";
import { resolveAcNeedsToItems } from "@/lib/orders/resolveAcPoItems";
import { buildSsPoItems } from "@/lib/orders/buildSsPoItems";

// Auto-create draft purchase order(s) for an order the moment it enters the
// "Order Goods" phase — one DRAFT per supplier of the order's blanks, at full
// order quantity. This is "Consolidate buying" scoped to a single order, so it
// reuses the exact same needs→items path (aggregateBlankNeeds +
// resolveAcNeedsToItems / buildSsPoItems).
//
// Guarantees:
//   - DRAFTS ONLY. Never submits — submitting spends real money and stays a
//     deliberate operator action on the Purchase Orders page.
//   - IDEMPOTENT. If the order already has a (non-cancelled) PO — a per-order
//     link or a consolidated one — it does nothing, so re-advancing or a second
//     trigger can't create duplicates.
//   - NON-FATAL. Best-effort: any failure is returned, never thrown, so a
//     hiccup here never blocks the status change that triggered it.
//
// SKU handling matches consolidation: AS Colour SKUs are resolved via
// acLookupStyle (unresolved lines are reported and left for the operator to
// fix on the PO); S&S and SanMar carry style/colour/size and resolve to a real
// variant server-side at submit.

// Ship-to prefilled from the shop so the draft is close to submittable. Mirrors
// defaultShipTo in PurchaseOrders.jsx / ACOrderModal.jsx.
function shopShipTo(user) {
  return {
    company: user?.shop_name || "",
    firstName: "",
    lastName: "",
    address1: user?.address || "",
    address2: "",
    city: "",
    state: "",
    zip: "",
    countryCode: "US",
    email: user?.email || "",
    phone: user?.phone || "",
  };
}

// AS Colour lookup → the product-with-variants shape resolveAcNeedsToItems wants
// (same adapter ConsolidateBuyingModal uses).
async function acLookup(styleNumber) {
  const result = await lookupStyle(SUPPLIERS.AC, { styleCode: styleNumber });
  const matches = result?.matches || result?.results || result?.items || result?.products || [];
  const first = matches[0] || result?.product || (result?.variants ? result : null);
  return first?.variants ? first : null;
}

const SHORT_CODE = {
  [SUPPLIERS.AC]: "AC",
  [SUPPLIERS.SS]: "SS",
  [SUPPLIERS.SANMAR]: "SM",
};

// Does this order already have a PO? A cancelled PO (archived merge source)
// doesn't count. Checks both the single-order link and consolidated batches.
export function orderAlreadyHasPo(order, pos) {
  const oid = order?.id;
  if (!oid) return false;
  return (pos || []).some((p) => {
    if (!p || p.status === "cancelled") return false;
    if (p.source_order_id === oid) return true;
    const arr = Array.isArray(p.source_order_ids) ? p.source_order_ids : [];
    return arr.includes(oid);
  });
}

// PO reference for an order's draft. Capped at 20 (AS Colour's limit) and
// suffixed with a supplier code only when the order spans multiple suppliers.
export function orderPoReference(order, supplier, multi) {
  const base = String(order?.order_id || `Order ${String(order?.id || "").slice(0, 8)}`);
  return (multi ? `${base}-${SHORT_CODE[supplier] || ""}` : base).slice(0, 20);
}

// Ensure draft PO(s) exist for one order. Returns
// { created: PO[], skipped: boolean, warnings: [] }.
export async function ensurePoDraftsForOrder(order, user, { existingPos, lookup = acLookup } = {}) {
  if (!order?.id || !user?.email) return { created: [], skipped: false };

  // Idempotency — never create a second PO for an order that already has one.
  // Check any caller-supplied list first (catches consolidated source_order_ids
  // the caller has loaded), then a direct query on the single-order link.
  if (existingPos && orderAlreadyHasPo(order, existingPos)) {
    return { created: [], skipped: true };
  }
  try {
    const linked = await base44.entities.PurchaseOrder.filter({ source_order_id: order.id });
    if (orderAlreadyHasPo(order, linked)) return { created: [], skipped: true };
  } catch {
    // A failed idempotency read shouldn't create duplicates by proceeding
    // blindly — but it also shouldn't block first-time creation. We proceed;
    // the common path (caller-supplied existingPos) already guarded above.
  }

  const { bySupplier } = aggregateBlankNeeds([order]);
  const suppliers = Object.keys(bySupplier).sort();
  const multi = suppliers.length > 1;
  const created = [];
  const warnings = [];

  for (const supplier of suppliers) {
    const group = bySupplier[supplier];
    let items = [];
    try {
      if (supplier === SUPPLIERS.AC) {
        const r = await resolveAcNeedsToItems(group.lines, { lookup });
        items = r.items;
        if (r.unresolved?.length || r.lookupErrors?.length) {
          warnings.push({ supplier, unresolved: r.unresolved, lookupErrors: r.lookupErrors });
        }
      } else if (supplier === SUPPLIERS.SS || supplier === SUPPLIERS.SANMAR) {
        // Both resolve the real variant server-side at submit from style/colour/size.
        items = buildSsPoItems(group.lines);
      } else {
        continue; // unknown/no supplier → left in the unresolved bucket, no PO
      }
      if (items.length === 0) continue;

      const po = await base44.entities.PurchaseOrder.create({
        shop_owner: shopScope(user),
        supplier,
        status: "draft",
        reference: orderPoReference(order, supplier, multi),
        ship_to: shopShipTo(user),
        items,
        source_order_id: order.id,
      });
      created.push(po);
    } catch (err) {
      warnings.push({ supplier, error: err?.message || "create failed" });
    }
  }

  return { created, skipped: false, warnings };
}
