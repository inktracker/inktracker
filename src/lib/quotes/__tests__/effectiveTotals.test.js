import { describe, it, expect, beforeEach } from "vitest";
import { effectiveQuoteTotals } from "../effectiveTotals.js";
import { loadShopPricingConfig, BROKER_MARKUP } from "../../../components/shared/pricing.jsx";

beforeEach(() => {
  loadShopPricingConfig(null);
});

function makeLine(overrides = {}) {
  return {
    id: "li-1",
    style: "1717",
    brand: "Comfort Colors",
    garmentCost: "4.62",
    garmentColor: "Black",
    sizes: { M: "50" },
    imprints: [{ id: "imp-1", location: "Front", colors: 1, technique: "Screen Print" }],
    ...overrides,
  };
}

function makeQuote(overrides = {}) {
  return {
    line_items: [makeLine()],
    rush_rate: 0,
    extras: {},
    discount: 0,
    discount_type: "percent",
    tax_rate: 8.25,
    ...overrides,
  };
}

describe("effectiveQuoteTotals — saved wins, live is fallback", () => {
  it("ET1 — saved total > 0 → returns saved values, source = 'saved'", () => {
    const quote = makeQuote({ subtotal: 923, tax: 76, total: 999 });
    const t = effectiveQuoteTotals(quote);
    expect(t.total).toBe(999);
    expect(t.sub).toBe(923);
    expect(t.tax).toBe(76);
    expect(t.source).toBe("saved");
  });

  it("ET2 — saved total is missing → live calc, source = 'live'", () => {
    const quote = makeQuote();
    delete quote.subtotal;
    delete quote.tax;
    delete quote.total;
    const t = effectiveQuoteTotals(quote);
    expect(t.total).toBeGreaterThan(0);
    expect(t.source).toBe("live");
  });

  it("ET3 — saved total === 0 → live calc (blank-quote case)", () => {
    // total=0 is the blank-quote shape. Trusting it would short-
    // circuit the live calc and produce $0 orders.
    const quote = makeQuote({ subtotal: 0, tax: 0, total: 0 });
    const t = effectiveQuoteTotals(quote);
    expect(t.total).toBeGreaterThan(0);
    expect(t.source).toBe("live");
  });

  it("ET4 — saved total is NaN / non-finite → live calc", () => {
    const quote = makeQuote({ subtotal: NaN, tax: NaN, total: NaN });
    const t = effectiveQuoteTotals(quote);
    expect(t.source).toBe("live");
  });

  it("ET5 — saved total present, saved subtotal missing → use saved total but live subtotal", () => {
    // Defensive partial-data case. We always trust .total when set
    // (that's the customer-paid amount). Other fields fall back
    // individually if missing.
    const quote = makeQuote({ total: 999 });
    delete quote.subtotal;
    const t = effectiveQuoteTotals(quote);
    expect(t.total).toBe(999);
    // sub came from live calc (not stamped on the row)
    expect(t.sub).toBeGreaterThan(0);
    expect(t.source).toBe("saved");
  });

  it("ET6 — null/undefined quote → safe defaults, no crash", () => {
    expect(() => effectiveQuoteTotals(null)).not.toThrow();
    expect(() => effectiveQuoteTotals(undefined)).not.toThrow();
    const t = effectiveQuoteTotals(null);
    expect(t.source).toBe("live");
  });

  it("ET7 — broker markup is passed through to live fallback", () => {
    // When the saved path doesn't fire, we still compute with the
    // correct markup. A broker quote that hasn't been saved yet
    // shouldn't accidentally use admin pricing.
    const q = makeQuote();
    delete q.total;
    const adminLive = effectiveQuoteTotals(q);
    const brokerLive = effectiveQuoteTotals(q, BROKER_MARKUP);
    expect(adminLive.source).toBe("live");
    expect(brokerLive.source).toBe("live");
    expect(brokerLive.total).not.toBeCloseTo(adminLive.total, 1);
  });

  it("ET8 — saved path returns SAVED values UNCHANGED by markup arg", () => {
    // When the customer-facing total is stamped on the row, that's
    // the contract — markup recomputation can't override it. A
    // re-conversion of a broker quote with saved totals must still
    // hit the same number.
    const saved = makeQuote({
      broker_id: "b@x.com",
      subtotal: 500,
      tax: 0,
      total: 500,
    });
    const tAdmin  = effectiveQuoteTotals(saved);
    const tBroker = effectiveQuoteTotals(saved, BROKER_MARKUP);
    expect(tAdmin.total).toBe(500);
    expect(tBroker.total).toBe(500);
  });
});
