// End-to-end "numbers match" for the additional-fees feature:
//   buildQBInvoicePayload (frontend)  →  buildInvoiceLinesFromPayload (edge)
//   →  the per-line tax + reconcile math qbSync runs.
//
// Locks in the 2026-06-15 fix where setup fees + additional fees (incl. a
// NON-taxable shipping line) must appear on the QB invoice with the right tax
// codes, and the resulting QB total must equal the quote total. A regression
// here = customer pays one price, QB records another.

import { describe, it, expect, beforeEach } from "vitest";
import { buildQBInvoicePayload, loadShopPricingConfig, allocateGarmentDecoration } from "../pricing";
import { buildInvoiceLinesFromPayload } from "../../../../supabase/functions/_shared/qbInvoice.js";

const r2 = (n) => Math.round(n * 100) / 100;

// Replicate qbSync's reconcile: tax applies only to TAX-coded lines. The discount rides
// its own QBO DiscountLineDetail line, so SALES lines are pre-discount
// while the customer was quoted tax on the POST-discount base — the
// taxable share of the discount has to come off before applying the
// rate, and the discount comes off the invoice total. Keep this in
// lockstep with handleCreateInvoice in supabase/functions/qbSync.
function deriveQbTotals(lines, taxPercent) {
  const salesLines = lines.filter((l) => l.DetailType !== "DiscountLineDetail");
  const discount = lines.reduce(
    (s, l) => s + (l.DetailType === "DiscountLineDetail" ? (Number(l.Amount) || 0) : 0),
    0,
  );
  const sentSubtotal = salesLines.reduce((s, l) => s + (Number(l.Amount) || 0), 0);
  const grossTaxable = salesLines.reduce(
    (s, l) => s + (l?.SalesItemLineDetail?.TaxCodeRef?.value === "TAX" ? (Number(l.Amount) || 0) : 0),
    0,
  );
  // Fees are excluded from the discount base by the builder, so
  // apportion the discount across the discountable (non-fee) lines and
  // take only the taxable part of that off the tax base.
  const discountable = salesLines.reduce(
    (s, l) => s + (l._isFee ? 0 : (Number(l.Amount) || 0)),
    0,
  );
  const discountableTaxable = salesLines.reduce(
    (s, l) => s + (!l._isFee && l?.SalesItemLineDetail?.TaxCodeRef?.value === "TAX" ? (Number(l.Amount) || 0) : 0),
    0,
  );
  const taxableDiscountShare = discountable > 0
    ? r2((discount * discountableTaxable) / discountable)
    : 0;
  const taxableSubtotal = r2(Math.max(0, grossTaxable - taxableDiscountShare));
  const tax = r2(taxableSubtotal * (taxPercent / 100));
  return {
    sentSubtotal: r2(sentSubtotal),
    discount: r2(discount),
    taxableSubtotal,
    tax,
    total: r2(sentSubtotal - discount + tax),
  };
}

// Map every itemName the payload references to a dummy QB item id so no line
// is dropped for a missing mapping.
function itemMapFor(payload, defaultName) {
  const m = new Map();
  for (const l of payload.lines) m.set((l.itemName || defaultName).trim(), `id-${l.itemName}`);
  m.set(defaultName, "id-default");
  return m;
}

const garmentLine = { category: "T-Shirts", brand: "Comfort Colors", style: "1717", garmentColor: "Banana", sizes: { M: 10 }, _ppp: 10, _lineTotal: 100, _rushFee: 0, imprints: [{ location: "Front", technique: "Screen Print" }] };

describe("allocateGarmentDecoration (per-technique split math)", () => {
  it("sums exactly to the total (decoration absorbs the remainder)", () => {
    expect(allocateGarmentDecoration(100, 6, 4, 0)).toEqual({ garment: 60, decoration: 40 });
  });
  it("all-garment when there's no decoration cost", () => {
    expect(allocateGarmentDecoration(100, 6, 0, 0)).toEqual({ garment: 100, decoration: 0 });
  });
  it("all-decoration when garment cost is zero (customer-supplied blanks)", () => {
    expect(allocateGarmentDecoration(80, 0, 5, 1)).toEqual({ garment: 0, decoration: 80 });
  });
  it("never loses a penny under awkward ratios", () => {
    const { garment, decoration } = allocateGarmentDecoration(99.99, 7, 3, 1.5);
    expect(r2(garment + decoration)).toBe(99.99);
  });
});

describe("buildQBInvoicePayload — split mode preserves the customer total", () => {
  it("split line amounts sum to the same subtotal as single-line", () => {
    const quote = {
      line_items: [garmentLine],
      tax_rate: 0,
      discount: 0,
      setup_total: 25,
      additional_charges: [{ id: "r", label: "Rush", amount: 20, taxable: true }],
    };
    loadShopPricingConfig(null);
    const single = buildQBInvoicePayload(quote);
    const singleSum = r2(single.lines.reduce((s, l) => s + l.amount, 0));

    loadShopPricingConfig({ qb_split_lines: true });
    const split = buildQBInvoicePayload(quote);
    const splitSum = r2(split.lines.reduce((s, l) => s + l.amount, 0));

    expect(splitSum).toBe(singleSum);
    loadShopPricingConfig(null);
  });
});

describe("QB fees — numbers match end to end", () => {
  beforeEach(() => loadShopPricingConfig(null));

  it("garment + setup + taxable fee + NON-taxable shipping reconcile to the quote total", () => {
    const quote = {
      line_items: [garmentLine],
      tax_rate: 10,
      discount: 0,
      setup_total: 25,
      additional_charges: [
        { id: "s", label: "Shipping", amount: 15, taxable: false },
        { id: "r", label: "Rush Fee", amount: 20, taxable: true },
      ],
    };
    const payload = buildQBInvoicePayload(quote);
    const lines = buildInvoiceLinesFromPayload(payload, itemMapFor(payload, "T-shirts"), "T-shirts", false);

    const ship = lines.find((l) => l.Description === "Shipping");
    expect(ship.SalesItemLineDetail.TaxCodeRef.value).toBe("NON");

    const qb = deriveQbTotals(lines, payload.taxPercent);
    // taxable base = 100 garment + 25 setup + 20 rush = 145 (shipping excluded)
    expect(qb.taxableSubtotal).toBe(145);
    expect(qb.tax).toBe(14.5);
    // total = 160 lines + 14.50 tax = 174.50
    expect(qb.total).toBe(174.5);
  });

  it("discount applies to garments only, not fees", () => {
    const quote = {
      line_items: [garmentLine],
      tax_rate: 10,
      discount: 10,
      discount_type: "percent",
      setup_total: 25,
      additional_charges: [
        { id: "s", label: "Shipping", amount: 15, taxable: false },
        { id: "r", label: "Rush Fee", amount: 20, taxable: true },
      ],
    };
    const payload = buildQBInvoicePayload(quote);
    const lines = buildInvoiceLinesFromPayload(payload, itemMapFor(payload, "T-shirts"), "T-shirts", false);
    const qb = deriveQbTotals(lines, payload.taxPercent);
    // garment 100 → 90 after 10%; setup 25 + rush 20 untouched → taxable 135
    expect(qb.taxableSubtotal).toBe(135);
    expect(qb.tax).toBe(13.5);
    expect(qb.total).toBe(163.5); // 90+25+20+15 + 13.50
  });

  it("tax-exempt customer → every line NON, total = subtotal (no tax)", () => {
    const quote = {
      line_items: [garmentLine],
      tax_rate: 10,
      setup_total: 25,
      additional_charges: [{ id: "s", label: "Shipping", amount: 15, taxable: false }],
    };
    const payload = buildQBInvoicePayload(quote);
    const lines = buildInvoiceLinesFromPayload(payload, itemMapFor(payload, "T-shirts"), "T-shirts", true);
    expect(lines.every((l) => l.SalesItemLineDetail.TaxCodeRef.value === "NON")).toBe(true);
    const qb = deriveQbTotals(lines, payload.taxPercent);
    expect(qb.tax).toBe(0);
    expect(qb.total).toBe(140); // 100 + 25 + 15
  });
});

describe("QB line description uses the shop's custom garment title", () => {
  it("customTitle replaces the brand in the styleLabel", () => {
    // Truman's 31-069: an OTTO cap whose style number collides with an
    // S&S fleece crewneck. The customer's QB invoice must carry the
    // shop's name for the garment, not the colliding supplier's.
    loadShopPricingConfig(null);
    const quote = {
      line_items: [{
        ...garmentLine,
        style: "31-069",
        brand: "Otto",
        garmentColor: "Drk Green/Khaki",
        customTitle: "Otto Cap 5 Panel Mid Profile",
      }],
      tax_rate: 0,
      discount: 0,
    };
    const payload = buildQBInvoicePayload(quote);
    const desc = payload.lines[0].description;
    expect(desc).toContain("Otto Cap 5 Panel Mid Profile 31-069 Drk Green/Khaki");
    expect(desc).not.toContain("Otto 31-069"); // brand alone must not lead
  });

  it("without customTitle the brand-led label is unchanged", () => {
    loadShopPricingConfig(null);
    const payload = buildQBInvoicePayload({ line_items: [garmentLine], tax_rate: 0, discount: 0 });
    expect(payload.lines[0].description).toContain("Comfort Colors 1717 Banana");
  });
});
