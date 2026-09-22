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

// Decide which warehouse an item should ship from.
//
//   inStockByWarehouse: { "CA": 198, "NC": 112 }  (qty per warehouse)
//   defaultWarehouse:   shop's preferred warehouse (e.g. "CA")
//
// Matches Joe's literal ask: "if a garment is out of stock there, route
// to the other." "Out of stock" means zero. If the default has ANY stock
// we ship from there — AS Colour handles partial-warehouse splits on
// their side (their lifecycle includes a "Partially Shipped" status
// exactly for this case). Otherwise route to the warehouse that has
// stock. If both are at zero, stick with default + surface it as
// "default-empty" so the UI can flag the row.
//
// Returns { warehouse, source } where source is:
//   "default"       — default has stock (>0); use it
//   "fallback"      — default at 0, switched to a warehouse with stock
//   "default-empty" — both at 0 (or no stock data); keep default
export function routeWarehouseForSku(inStockByWarehouse, defaultWarehouse, _hintQty) {
  const stock = inStockByWarehouse || {};
  const def = String(defaultWarehouse || "CA");
  if ((Number(stock[def]) || 0) > 0) return { warehouse: def, source: "default" };
  // Default is out — pick the non-default warehouse with the most stock.
  const alt = Object.entries(stock)
    .filter(([w]) => w !== def)
    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))[0];
  if (alt && Number(alt[1]) > 0) {
    return { warehouse: alt[0], source: "fallback" };
  }
  return { warehouse: def, source: "default-empty" };
}

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
  // Keep the row while editing — clearing the field to retype must NOT delete
  // the item (Joe 2026-09-17: "if I delete the existing number to type a new
  // one, the item disappears"). Removal is the explicit ✕ (removeItem). A blank
  // field stays blank; a number is clamped to ≥ 0. Zero/blank quantities are
  // rejected by validateForSubmit, so an unfinished edit can never be ordered.
  const raw = String(quantity ?? "").trim();
  const qty = raw === "" ? "" : Math.max(0, Number(raw) || 0);
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
// Build the payload shape ssPlaceOrder expects (a different contract from AS
// Colour: poNumber + shipTo + lines; S&S resolves guessed SKUs → real SKUs
// server-side, so a line only needs style + colour + size + qty).
export function buildSsSubmitPayload(po) {
  const sa = po.ship_to || {};
  const name = sa.company || [sa.firstName, sa.lastName].filter(Boolean).join(" ").trim();
  return {
    poNumber: String(po.reference || ""),
    shipTo: {
      name: name || "",
      address1: sa.address1 || "",
      address2: sa.address2 || "",
      city: sa.city || "",
      state: sa.state || "",
      zip: sa.zip || "",
      country: sa.countryCode || "US",
      phone: sa.phone || "",
      email: sa.email || "",
    },
    lines: (po.items || []).map((it) => ({
      sku: String(it.sku || ""),
      style: String(it.styleCode || ""),
      color: String(it.color || ""),
      size: String(it.size || ""),
      qty: Number(it.quantity) || 0,
      // Pinned S&S warehouse for this line ("" = let S&S auto-route).
      warehouse: String(it.warehouse || ""),
    })),
    shippingMethod: String(po.shipping_method || "").trim() || "Ground",
    warehouse: String(po.warehouse || ""),
  };
}

// SanMar submit payload — shape consumed by the smPlaceOrder edge function,
// which resolves each line's style/color/size to a SanMar inventoryKey +
// sizeIndex server-side before building the SOAP envelope. Mirrors the S&S
// payload's ship-to shape; SanMar needs a real style/color/size per line
// (SKU alone can't be resolved to a SanMar variant).
export function buildSmSubmitPayload(po) {
  const sa = po.ship_to || {};
  const name = sa.company || [sa.firstName, sa.lastName].filter(Boolean).join(" ").trim();
  return {
    poNumber: String(po.reference || ""),
    shipTo: {
      name: name || "",
      address1: sa.address1 || "",
      address2: sa.address2 || "",
      city: sa.city || "",
      state: sa.state || "",
      zip: sa.zip || "",
      country: sa.countryCode || "US",
      phone: sa.phone || "",
      email: sa.email || "",
    },
    shippingMethod: String(po.shipping_method || "").trim(),
    notes: String(po.notes || ""),
    lines: (po.items || []).map((it) => ({
      style: String(it.styleCode || ""),
      color: String(it.color || ""),
      size: String(it.size || ""),
      qty: Number(it.quantity) || 0,
    })),
  };
}

// Supplier-aware pre-submit validation. AS Colour and S&S have different
// required fields (AS Colour: shipping method, first/last name, country code,
// 20-char reference cap; S&S: just a complete ship-to + a style/sku per line;
// SanMar: complete ship-to + a style/color/size per line so the variant can be
// resolved to inventoryKey/sizeIndex server-side).
export function validateForSubmit(po, supplier) {
  if (!po) return ["nothing to submit"];
  if (supplier === "S&S Activewear") return validateSsSubmit(po);
  if (supplier === "SanMar") return validateSmSubmit(po);
  return validateAcSubmit(po);
}

function validateSmSubmit(po) {
  const errors = [];
  if (!po.reference || !String(po.reference).trim()) errors.push("PO reference is required");
  const sa = po.ship_to;
  if (!sa || typeof sa !== "object") {
    errors.push("Shipping address is required");
  } else {
    if (!sa.address1) errors.push("Shipping address: street is required");
    if (!sa.city) errors.push("Shipping address: city is required");
    if (!sa.state) errors.push("Shipping address: state is required");
    if (!sa.zip) errors.push("Shipping address: zip is required");
  }
  if (!Array.isArray(po.items) || po.items.length === 0) {
    errors.push("At least one item is required");
  } else {
    po.items.forEach((it, i) => {
      // SanMar resolves the variant from style + color + size — a SKU alone
      // can't be matched, so all three are required.
      if (!it?.styleCode) errors.push(`Item ${i + 1}: style number is required`);
      if (!it?.color) errors.push(`Item ${i + 1}: color is required`);
      if (!it?.size) errors.push(`Item ${i + 1}: size is required`);
      const qty = Number(it?.quantity);
      if (!Number.isFinite(qty) || qty <= 0) errors.push(`Item ${i + 1}: quantity must be positive`);
    });
  }
  return errors;
}

function validateSsSubmit(po) {
  const errors = [];
  if (!po.reference || !String(po.reference).trim()) errors.push("PO reference is required");
  const sa = po.ship_to;
  if (!sa || typeof sa !== "object") {
    errors.push("Shipping address is required");
  } else {
    if (!sa.address1) errors.push("Shipping address: street is required");
    if (!sa.city) errors.push("Shipping address: city is required");
    if (!sa.state) errors.push("Shipping address: state is required");
    if (!sa.zip) errors.push("Shipping address: zip is required");
  }
  if (!Array.isArray(po.items) || po.items.length === 0) {
    errors.push("At least one item is required");
  } else {
    po.items.forEach((it, i) => {
      if (!it?.styleCode && !it?.sku) errors.push(`Item ${i + 1}: style number or SKU is required`);
      const qty = Number(it?.quantity);
      if (!Number.isFinite(qty) || qty <= 0) errors.push(`Item ${i + 1}: quantity must be positive`);
    });
  }
  return errors;
}

function validateAcSubmit(po) {
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
      // Warehouse is set at the PO level via the dropdown; only flag
      // if neither po.warehouse nor a per-item warehouse is present.
      if (!po.warehouse && !it?.warehouse) {
        errors.push(`Item ${i + 1}: warehouse is required (set it on the PO)`);
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
  let reference = combinedReference(sources.map((s) => s.reference));
  // AS Colour caps the reference at 20 chars — a merged "ref1, ref2, …" almost
  // always blows past it, which made the merged PO un-submittable (audit B11).
  // Truncate for AS Colour (the operator can rename); leave S&S alone.
  if (supplier === "AS Colour" && reference.length > AC_REFERENCE_MAX) {
    reference = reference.slice(0, AC_REFERENCE_MAX).replace(/[,\s]+$/, "");
  }
  // Preserve the order linkage of EVERY source (audit B7 dropped it), so the
  // merged PO still ticks all covered orders' checklists on submit. Union the
  // scalar source_order_id and any source_order_ids arrays.
  const source_order_ids = [
    ...new Set(
      sources
        .flatMap((s) => [
          ...(s.source_order_id ? [String(s.source_order_id)] : []),
          ...(Array.isArray(s.source_order_ids) ? s.source_order_ids.map(String) : []),
        ])
        .filter(Boolean),
    ),
  ];
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
    source_order_ids,
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

// ── Auto-mark "ordered" on the source order's goods checklist ───────
//
// When a PO submits successfully, we want every size in that PO to
// flash amber ("ordered") on the source order's Floor Mode panel —
// without the shop owner manually clicking each size button. This is
// the bridge between the supplier-side API order and the per-size
// Order Goods tracker.
//
// Matching rule:
//   PO item → order line_item by (style code, color) — case-insensitive.
//   Style code comes from li.supplierStyleNumber / .resolvedStyleNumber
//   / .styleNumber / .style (in that priority — matches how ACOrderModal
//   builds the PO item in the first place).
//   Then we set goods_progress[`${liIdx}-${size}`] = "ordered".
//
// Never overwrites "received" — physically the goods can't un-arrive,
// and the operator's manual click takes precedence over the API
// signal.
//
// Returns a NEW checklist object (caller writes it to the order row).
// Pure — no side effects.
export function applyPOItemsToGoodsProgress(order, poItems, supplierOrderId, nowIso = new Date().toISOString()) {
  const goodsProgress = { ...(order?.checklist?.goods_progress || {}) };
  const lineItems = order?.line_items || [];
  const styleOf = (li) =>
    li?.supplierStyleNumber || li?.resolvedStyleNumber || li?.styleNumber || li?.style || "";

  for (const item of poItems || []) {
    const poStyle = String(item?.styleCode || "").trim().toUpperCase();
    const poColor = String(item?.color || "").trim().toUpperCase();
    const poSize  = String(item?.size  || "").trim();
    if (!poStyle || !poSize) continue;

    const liIdx = lineItems.findIndex((li) =>
      String(styleOf(li)).trim().toUpperCase() === poStyle &&
      String(li?.garmentColor || "").trim().toUpperCase() === poColor &&
      Object.keys(li?.sizes || {}).some((s) => s === poSize)
    );
    if (liIdx < 0) continue;

    const key = `${liIdx}-${poSize}`;
    if (goodsProgress[key]?.status === "received") continue; // never overwrite received

    goodsProgress[key] = {
      status: "ordered",
      by: "API",
      at: nowIso,
      ...(supplierOrderId ? { supplier_order_id: String(supplierOrderId) } : {}),
    };
  }

  return { ...(order?.checklist || {}), goods_progress: goodsProgress };
}

// ── Receiving (two separate checks: PO-level "Received" + per-line "Checked in") ──

// Set the checked-in (counted) quantity on a PO item.
export function setItemCheckedIn(items, index, count) {
  if (!Array.isArray(items) || index < 0 || index >= items.length) return items;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const next = [...items];
  next[index] = { ...next[index], checkedIn: n };
  return next;
}

// Receiving summary for the PO detail: which lines are checked in, whether the
// whole PO is, and any under-received lines (ordered vs counted).
export function poReceivingSummary(po) {
  const items = Array.isArray(po?.items) ? po.items : [];
  let checkedInCount = 0;
  const shortages = [];
  for (const it of items) {
    if (it?.checkedIn == null) continue;
    checkedInCount++;
    const ordered = Number(it.quantity) || 0;
    const received = Number(it.checkedIn) || 0;
    if (received < ordered) {
      shortages.push({ sku: it.sku, styleCode: it.styleCode, color: it.color, size: it.size, ordered, received, short: ordered - received });
    }
  }
  return {
    received: !!po?.received_at,
    checkedInCount,
    totalItems: items.length,
    allCheckedIn: items.length > 0 && checkedInCount === items.length,
    shortages,
  };
}

// Apply a PO's checked-in counts to ONE covered order: set matching sizes to
// 'received' (in hand) on the floor with the counted qty, and — only when this
// PO covers this single order (computeShortfall) — record any under-receipt as
// _shortfall on the line so Reorder Shortfall can top it up. Multi-order
// consolidated POs skip shortfall (which order is short is ambiguous).
// Returns an order patch { checklist, line_items }.
export function applyCheckInToOrder(order, poItems, { computeShortfall = true, nowIso = new Date().toISOString() } = {}) {
  const up = (s) => String(s ?? "").trim().toUpperCase();
  const goodsProgress = { ...(order?.checklist?.goods_progress || {}) };
  const lineItems = (order?.line_items || []).map((li) => ({ ...li }));
  // Match the PO item's style against EVERY style alias a line carries — the
  // original PO may have been built from supplierStyleNumber while a shortfall
  // reorder PO uses the bare style, so pinning to one field made the reorder
  // never reconcile (shortfall stayed lit forever).
  const styleAliases = (li) =>
    [li?.supplierStyleNumber, li?.resolvedStyleNumber, li?.styleNumber, li?.style].map(up).filter(Boolean);

  for (const item of poItems || []) {
    if (item?.checkedIn == null) continue;
    const poStyle = up(item?.styleCode);
    const poColor = up(item?.color);
    const poSize = up(item?.size);
    if (!poStyle || !poSize) continue;
    const received = Math.max(0, Number(item.checkedIn) || 0);
    const ordered = Number(item.quantity) || 0;

    // Resolve the order's own canonical size key (case-insensitive) so the
    // floor's goods_progress and _shortfall keys line up with what it reads.
    let sizeKey = null;
    const liIdx = lineItems.findIndex((li) => {
      if (!styleAliases(li).includes(poStyle)) return false;
      if (up(li?.garmentColor) !== poColor) return false;
      const sk = Object.keys(li?.sizes || {}).find((s) => up(s) === poSize);
      if (sk) { sizeKey = sk; return true; }
      return false;
    });
    if (liIdx < 0) continue;

    // Only mark a size 'received' when something ACTUALLY arrived. A 0-count is
    // a full shortage, not a receipt — marking it received would let the floor
    // auto-complete "Receive goods" and push the job to press with no goods.
    if (received > 0) {
      goodsProgress[`${liIdx}-${sizeKey}`] = { status: "received", qty: received, by: "check-in", at: nowIso };
    }

    if (computeShortfall) {
      const li = lineItems[liIdx];
      const short = Math.max(0, ordered - received);
      const sf = { ...(li._shortfall || {}) };
      if (short > 0) sf[sizeKey] = short; else delete sf[sizeKey];
      lineItems[liIdx] = { ...li, _shortfall: sf };
    }
  }
  return { checklist: { ...(order?.checklist || {}), goods_progress: goodsProgress }, line_items: lineItems };
}

// Build the payload shape acPlaceOrder expects (matches the AS Colour
// /v1/orders contract via _shared/acOrderLogic.buildOrderRequestBody).
//
// Warehouse: per-item now. Each item carries its own warehouse (set
// via auto-routing on add). Falls back to po.warehouse for legacy
// rows, then "CA" as a final default. AS Colour requires non-empty
// per-item warehouse — values are state codes "CA" / "NC".
export function buildSubmitPayload(po) {
  const fallback = String(po.warehouse || "CA").trim() || "CA";
  return {
    reference: String(po.reference),
    shippingMethod: String(po.shipping_method),
    orderNotes: po.notes ?? "",
    courierInstructions: po.courier_instructions ?? "",
    shippingAddress: po.ship_to,
    items: (po.items || []).map((it) => ({
      sku: String(it.sku),
      warehouse: String(it.warehouse || fallback),
      quantity: Number(it.quantity),
    })),
  };
}
