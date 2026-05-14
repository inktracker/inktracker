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

// Client-side mirror of supabase/functions/_shared/acOrderLogic.js
// validateOrderPayload. Returns array of human-readable errors.
// The server re-validates — this is for UX, not security.
export function validateForSubmit(po) {
  const errors = [];
  if (!po) return ["nothing to submit"];
  if (!po.reference || !String(po.reference).trim()) {
    errors.push("PO reference (your internal name / PO number) is required");
  }
  if (!po.shipping_method || !String(po.shipping_method).trim()) {
    errors.push("Shipping method is required");
  }
  const sa = po.ship_to;
  if (!sa || typeof sa !== "object") {
    errors.push("Shipping address is required");
  } else {
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
export function buildSubmitPayload(po) {
  return {
    reference: String(po.reference),
    shippingMethod: String(po.shipping_method),
    orderNotes: po.notes ?? "",
    courierInstructions: po.courier_instructions ?? "",
    shippingAddress: po.ship_to,
    items: (po.items || []).map((it) => ({
      sku: String(it.sku),
      warehouse: String(it.warehouse ?? ""),
      quantity: Number(it.quantity),
    })),
  };
}
