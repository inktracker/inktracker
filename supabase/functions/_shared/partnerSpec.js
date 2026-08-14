// Partner hand-off spec builder (docs/shop-partnerships-design.md).
//
// The spec is the ONLY thing that crosses tenants in a hand-off, so this
// sanitizer is the blind-mode trust boundary — same discipline (and test
// style) as publicSafe.js. The receiving shop gets everything needed to
// PRODUCE the work (garments, sizes, imprint details, art references,
// due date) and nothing about the sender's business: no customer
// identity, no retail pricing, no internal cost stamps, no shop-internal
// notes. Pure functions; the partnerHandoff edge function does the I/O
// (including copying artwork objects and re-pointing the refs).

const STRIP_KEY_RE = /(cost|price|_ppp|_lineTotal|_rushFee|_client_|clientPpp|margin)/i;

// Imprint keys the receiver NEEDS to produce the work. Everything else
// on an imprint (per-print pricing hints, addon labels priced in) stays.
const IMPRINT_KEEP = [
  "id", "title", "location", "technique", "colors", "pantones",
  "width", "height", "details", "underbase", "mesh", "print_order",
  "artwork", "artworkPath", "artwork_url",
];

// Line-item keys that describe the PHYSICAL job.
const LINE_KEEP = [
  "id", "brand", "style", "customTitle", "garmentColor", "category",
  "sizes", "description",
];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj?.[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/** Defense-in-depth: assert no stripped-class key survived. */
export function specLeaks(spec) {
  const leaks = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (STRIP_KEY_RE.test(k)) leaks.push(`${path}.${k}`);
      else walk(v, `${path}.${k}`);
    }
  };
  walk(spec, "spec");
  return leaks;
}

/**
 * Build the portable spec from the sender's order.
 * @param {object} order   sender's order row
 * @param {object} opts    { lineIds: string[]|null (null = all lines),
 *                           blind: boolean, note: string }
 */
export function buildPartnerSpec(order, { lineIds = null, blind = true, note = "" } = {}) {
  const wanted = lineIds == null ? null : new Set(lineIds.map(String));
  const lines = (order?.line_items || [])
    .filter((li, idx) => wanted == null || wanted.has(String(li?.id ?? idx)))
    .map((li, idx) => ({
      ...pick(li, LINE_KEEP),
      id: String(li?.id ?? idx),
      imprints: (li?.imprints || []).map((imp) => pick(imp, IMPRINT_KEEP)),
    }));

  const spec = {
    job_title: order?.job_title || "",
    due_date: order?.due_date || null,
    note: String(note || ""),
    lines,
    // Blind (default): the receiver knows only the SENDING SHOP. The
    // sender's end customer never crosses. Non-blind adds the customer
    // display name only — never email/phone/address in v1.
    customer: blind ? null : { name: order?.customer_name || "" },
  };

  const leaks = specLeaks(spec);
  if (leaks.length) {
    // A leak here means LINE_KEEP/IMPRINT_KEEP drifted into conflict
    // with STRIP_KEY_RE — fail closed rather than ship sender data.
    throw new Error(`partnerSpec leak check failed: ${leaks.join(", ")}`);
  }
  return spec;
}

/**
 * Build the RECEIVER's order insert from an accepted hand-off. Mirrors
 * the shape orders need (same field names buildOrderInsertFromQuote
 * writes) — the sending shop appears as the customer.
 */
export function buildReceiverOrderInsert(handoff, orderId, todayIso) {
  const spec = handoff?.spec || {};
  return {
    order_id: orderId,
    shop_owner: handoff.receiving_shop,
    customer_id: null,
    customer_name: partnerCustomerLabel(handoff),
    company: partnerCustomerLabel(handoff),
    job_title: spec.job_title || `Partner job from ${partnerCustomerLabel(handoff)}`,
    date: todayIso,
    due_date: handoff.counter_due_date || handoff.due_date || null,
    status: "Art Approval",
    line_items: (spec.lines || []).map((l) => ({ ...l })),
    notes: spec.note || "",
    rush_rate: 0,
    extras: {},
    discount: 0,
    discount_type: "percent",
    tax_rate: 0, // partner billing is shop-to-shop; tax handled on the invoice they send
    subtotal: handoff.agreed_trade_total ?? null,
    tax: 0,
    total: handoff.agreed_trade_total ?? null,
    paid: false,
    selected_artwork: [],
    partner_handoff_id: handoff.id,
  };
}

/** "Biota MFG" — the sending shop as the receiver's customer label. */
export function partnerCustomerLabel(handoff) {
  return handoff?.sending_shop_name || handoff?.sending_shop || "Partner shop";
}

// Status values the receiver's order mirrors back to the sender as a
// partner_status chip. Anything else maps to "in_production".
export const MIRROR_STATUSES = Object.freeze({
  "Art Approval": "accepted",
  "Order Goods": "in_production",
  "Pre-Press": "in_production",
  "Printing": "in_production",
  "Finishing": "in_production",
  "QC": "in_production",
  "Ready for Pickup": "completed",
  "Completed": "completed",
});

export function mirrorStatusFor(receiverOrderStatus) {
  return MIRROR_STATUSES[receiverOrderStatus] || "in_production";
}
