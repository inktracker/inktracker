// Purchase Order pure logic — kept out of the page component so it's
// unit-testable. The page is just a thin shell over these helpers.
//
// Item shape stored on purchase_orders.items (jsonb):
//   { sku, styleCode, color, size, quantity, unitPrice, warehouse }
//
// freightProgress drives the "$X to free shipping" hint. mergeItem is
// what AddToPOButton calls — adding the same SKU twice should bump the
// existing line's quantity, not create a duplicate row.
//
// validateForSubmit mirrors the server-side validateOrderPayload in
// supabase/functions/_shared/acOrderLogic.js. Client-side it surfaces
// errors before the network hop; the server still has its own copy.

export function poSubtotal(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it) => {
    const qty = Number(it?.quantity) || 0;
    const price = Number(it?.unitPrice) || 0;
    return sum + qty * price;
  }, 0);
}

export function freightProgress(items, threshold) {
  const subtotal = poSubtotal(items);
  const t = Number(threshold) || 0;
  if (t <= 0) {
    return { subtotal, threshold: t, remaining: 0, percentage: 0, qualifies: false };
  }
  const remaining = Math.max(0, t - subtotal);
  const percentage = Math.min(100, (subtotal / t) * 100);
  return {
    subtotal,
    threshold: t,
    remaining,
    percentage,
    qualifies: subtotal >= t,
  };
}

// Merge a new item into the items list. Lines are uniqued by
// sku + warehouse (warehouse can vary for the same SKU when AS Colour
// has multi-warehouse inventory). Same key → bump quantity, preserve
// existing unitPrice unless the new line carries one. Different key →
// append.
export function mergeItem(items, newItem) {
  if (!newItem?.sku) return Array.isArray(items) ? items : [];
  const list = Array.isArray(items) ? [...items] : [];
  const sku = String(newItem.sku);
  const warehouse = String(newItem.warehouse ?? "");
  const idx = list.findIndex(
    (it) => String(it.sku) === sku && String(it.warehouse ?? "") === warehouse,
  );
  const addQty = Number(newItem.quantity) || 0;
  if (idx === -1) {
    list.push({
      sku,
      styleCode: newItem.styleCode ?? "",
      color: newItem.color ?? "",
      size: newItem.size ?? "",
      quantity: addQty,
      unitPrice: Number(newItem.unitPrice) || 0,
      warehouse,
    });
  } else {
    const existing = list[idx];
    list[idx] = {
      ...existing,
      quantity: (Number(existing.quantity) || 0) + addQty,
      // If the new line came in with a price and the existing didn't,
      // adopt the new price. Don't clobber an existing price with 0.
      unitPrice:
        Number(newItem.unitPrice) > 0
          ? Number(newItem.unitPrice)
          : Number(existing.unitPrice) || 0,
    };
  }
  return list;
}

export function removeItem(items, index) {
  if (!Array.isArray(items)) return [];
  if (index < 0 || index >= items.length) return items;
  return items.slice(0, index).concat(items.slice(index + 1));
}

export function updateItemQty(items, index, quantity) {
  if (!Array.isArray(items)) return [];
  if (index < 0 || index >= items.length) return items;
  const qty = Number(quantity) || 0;
  if (qty <= 0) return removeItem(items, index);
  const next = [...items];
  next[index] = { ...next[index], quantity: qty };
  return next;
}

// Hard cap AS Colour enforces on the reference field. Mirrored from
// supabase/functions/_shared/acOrderLogic.js so the UI can surface it
// without a round-trip.
export const AC_REFERENCE_MAX = 20;

// Client-side mirror of supabase/functions/_shared/acOrderLogic.js
// validateOrderPayload. Returns array of human-readable errors.
// The server re-validates — this is for UX, not security.
export function validateForSubmit(po) {
  const errors = [];
  if (!po) return ["nothing to submit"];
  if (!po.reference || !String(po.reference).trim()) {
    errors.push("PO reference is required");
  } else if (String(po.reference).trim().length > AC_REFERENCE_MAX) {
    errors.push(`PO reference must be ${AC_REFERENCE_MAX} characters or fewer (AS Colour limit) — yours is ${String(po.reference).trim().length}`);
  }
  if (!po.shipping_method || !String(po.shipping_method).trim()) {
    errors.push("Shipping method is required");
  }
  const sa = po.ship_to;
  if (!sa || typeof sa !== "object") {
    errors.push("Shipping address is required");
  } else {
    if (!sa.firstName) errors.push("Shipping address: first name is required");
    if (!sa.lastName) errors.push("Shipping address: last name is required");
    if (!sa.address1) errors.push("Shipping address: street is required");
    if (!sa.city) errors.push("Shipping address: city is required");
    if (!sa.zip) errors.push("Shipping address: zip is required");
    if (!sa.countryCode) errors.push("Shipping address: country code is required");
  }
  if (!Array.isArray(po.items) || po.items.length === 0) {
    errors.push("At least one item is required");
  } else {
    for (let i = 0; i < po.items.length; i++) {
      const it = po.items[i];
      if (!it?.sku) errors.push(`Item ${i + 1}: SKU is missing`);
      const qty = Number(it?.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        errors.push(`Item ${i + 1}: quantity must be positive`);
      }
      if (!it?.warehouse) {
        errors.push(`Item ${i + 1}: warehouse is required (e.g. "USA")`);
      }
    }
  }
  return errors;
}

/**
 * Merge a source PO's items into the destination PO's items, deduping
 * by SKU+warehouse via mergeItem. Returns the new items array.
 *
 * The destination's ship_to / reference / shipping method / notes are
 * intentionally NOT touched — the caller decides what to do with them.
 * Common case is "destination already has them set, keep as-is."
 */
export function mergePOItems(sourceItems, destItems) {
  let next = Array.isArray(destItems) ? [...destItems] : [];
  for (const it of sourceItems || []) {
    next = mergeItem(next, it);
  }
  return next;
}

/**
 * Combine source references into a single readable label.
 *
 * The naive `refs.join(", ")` produced things like
 *   "PO for ORD-2026-0WCV9, PO for ORD-2026-0EVS3"
 * which repeats "PO for " for every source. Strip the longest common
 * prefix (ending at a space so we never split mid-word) and prepend it
 * once:
 *   "PO for ORD-2026-0WCV9, ORD-2026-0EVS3"
 *
 * Falls back to a plain comma-join when sources don't share a prefix.
 */
export function combinedReference(refs) {
  const cleaned = (refs || []).map((r) => String(r ?? "").trim() || "Untitled PO");
  if (cleaned.length === 0) return "Untitled PO";
  if (cleaned.length === 1) return cleaned[0];
  // Longest common prefix across all references.
  let prefix = cleaned[0];
  for (let i = 1; i < cleaned.length && prefix.length > 0; i++) {
    while (prefix.length > 0 && !cleaned[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  // Pull back to the last space so a prefix like "PO for ORD" doesn't
  // chop "ORD" off the first reference. Without this, refs like
  // ["PO for ORD-001", "PO for ORD-002"] could collapse to
  // "PO for ORD, -001, -002" — readable but ugly.
  const spaceIdx = prefix.lastIndexOf(" ");
  if (spaceIdx <= 0) return cleaned.join(", ");
  const cleanPrefix = prefix.slice(0, spaceIdx + 1); // keep trailing space
  const remainders = cleaned.map((r) => r.slice(cleanPrefix.length));
  // If sources are literally identical, just keep one copy.
  const uniqRemainders = Array.from(new Set(remainders));
  return cleanPrefix + uniqRemainders.join(", ");
}

/**
 * Combine multiple draft POs into one. Used by the multi-select merge
 * action on the Purchase Orders page.
 *
 * Returns the patch to apply to a brand-new PO row. Caller is responsible
 * for creating that row, then deleting the source rows in a second step.
 *
 * Decisions baked in:
 *   - reference = source references joined by ", " (matches the
 *     comma-separated convention shops asked for so the merged row
 *     visibly inherits its provenance)
 *   - supplier  = source supplier (validated to be uniform; throws
 *     otherwise — different suppliers need separate POSTs)
 *   - shop_owner = source shop_owner (likewise required to be uniform)
 *   - ship_to / shipping_method / notes / courier_instructions =
 *     pulled from the FIRST source (oldest first as ordered by caller)
 *   - items = mergePOItems applied left-to-right so dupes sum cleanly
 *
 * Throws on invalid inputs so the caller surfaces a real error rather
 * than silently producing a malformed PO.
 */
export function buildMergedPO(sources) {
  if (!Array.isArray(sources) || sources.length < 2) {
    throw new Error("Need at least two POs to merge");
  }
  const supplier = sources[0].supplier;
  const shopOwner = sources[0].shop_owner;
  for (const s of sources) {
    if (s.supplier !== supplier) {
      throw new Error("Cannot merge POs from different suppliers");
    }
    if (s.shop_owner !== shopOwner) {
      throw new Error("Cannot merge POs from different shops");
    }
    if (s.status !== "draft") {
      throw new Error("Only draft POs can be merged");
    }
  }
  let items = [];
  for (const s of sources) items = mergePOItems(s.items, items);
  const reference = combinedReference(sources.map((s) => s.reference));
  const first = sources[0];
  return {
    shop_owner: shopOwner,
    supplier,
    status: "draft",
    reference,
    ship_to: first.ship_to || null,
    shipping_method: first.shipping_method || null,
    notes: first.notes || null,
    courier_instructions: first.courier_instructions || null,
    items,
  };
}

/**
 * Decide which drafts a given PO can be merged into.
 *   - same supplier (different suppliers need separate POSTs)
 *   - status = "draft" (can't change a submitted PO)
 *   - not the same row
 */
export function mergeableDestinations(po, allPOs) {
  if (!po) return [];
  return (allPOs || []).filter(
    (other) =>
      other.id !== po.id &&
      other.status === "draft" &&
      other.supplier === po.supplier,
  );
}

// Build the payload shape acPlaceOrder expects (matches the AS Colour
// /v1/orders contract via _shared/acOrderLogic.buildOrderRequestBody).
//
// Warehouse default = "USA" — AS Colour requires non-empty per item;
// US accounts use USA, AUS/NZ accounts override. Same default lives
// server-side in acOrderLogic.buildOrderRequestBody.
export function buildSubmitPayload(po) {
  return {
    reference: String(po.reference),
    shippingMethod: String(po.shipping_method),
    orderNotes: po.notes ?? "",
    courierInstructions: po.courier_instructions ?? "",
    shippingAddress: po.ship_to,
    items: (po.items || []).map((it) => ({
      sku: String(it.sku),
      warehouse: String(it.warehouse || "USA"),
      quantity: Number(it.quantity),
    })),
  };
}
