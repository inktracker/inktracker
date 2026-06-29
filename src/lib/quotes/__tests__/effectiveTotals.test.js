import { describe, it, expect, beforeEach } from "vitest";
import { effectiveQuoteTotals } from "../effectiveTotals.js";
import { loadShopPricingConfig, BROKER_MARKUP, getShopPricingConfig, getShopPricingConfigOwner } from "../../../components/shared/pricing.jsx";

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

  // ──────────────────────────────────────────────────────────────────
  // Snapshot-invariant tests. The bug these pin:
  //
  // The PDF and quote modals render "Subtotal:" from `totals.subtotal`
  // (without rush) — NOT from `totals.sub` (with rush). Earlier versions
  // of effectiveQuoteTotals only overrode `sub` from the saved row but
  // left `subtotal` from the live calc. When the viewer's pricing
  // config differed from the quote-author's pricing config (e.g. shop
  // with custom brokerMarkupShare vs broker on defaults), the live
  // subtotal computed in the viewer's session diverged from the saved
  // subtotal stored in the DB — and the PDF showed the viewer's number
  // for "Subtotal:" while showing the saved number for "Total:".
  //
  // Concrete failure mode: broker saved $12.62 / $12.62, shop opened
  // PDF and saw "Subtotal: $14.02 / Total: $12.62" with no discount
  // line to explain the gap. Pin this so any regression is caught.
  //
  // See memory: project_quote_immutability.md
  // ──────────────────────────────────────────────────────────────────
  describe("snapshot invariant — saved fields are not overridden by live calc", () => {
    it("ET9 — saved row exposes SAVED `subtotal`, not live `subtotal`", () => {
      // Saved 500 should win even if the live calc would produce a different
      // subtotal (e.g. because the caller's pricing config differs from the
      // author's). We can't easily mock _pc divergence inside the test, but
      // we can prove that the returned `subtotal` matches the saved one
      // regardless of what live would have produced.
      const saved = makeQuote({ subtotal: 500, tax: 0, total: 500 });
      const t = effectiveQuoteTotals(saved);
      expect(t.subtotal).toBe(500);
      expect(t.sub).toBe(500);
      expect(t.total).toBe(500);
    });

    it("ET10 — saved subtotal differs from live subtotal → SAVED wins", () => {
      // Make the saved subtotal an obviously-not-derivable number so we
      // can prove it was read straight from the row. The live calc on
      // this line item would produce something else entirely (depends on
      // garmentCost × markup + print cost), but the returned subtotal
      // must be 1234.56.
      const saved = makeQuote({ subtotal: 1234.56, tax: 100, total: 1334.56 });
      const t = effectiveQuoteTotals(saved);
      expect(t.subtotal).toBe(1234.56);
      expect(t.sub).toBe(1234.56);
      // tax + total too — full snapshot
      expect(t.tax).toBe(100);
      expect(t.total).toBe(1334.56);
    });

    it("ET11 — broker quote: saved subtotal NOT recomputed regardless of markup arg", () => {
      // The whole point: a broker quote saved with the broker's pricing
      // must read the SAME number when later viewed by a shop owner with
      // different pricing. effectiveQuoteTotals can't be the leak.
      const saved = makeQuote({
        broker_id: "broker@example.com",
        subtotal: 12.62,
        tax: 0,
        total: 12.62,
      });
      const tBroker = effectiveQuoteTotals(saved, BROKER_MARKUP);
      const tAdmin  = effectiveQuoteTotals(saved);
      // Both subtotal AND total locked to saved — viewer cannot influence.
      expect(tBroker.subtotal).toBe(12.62);
      expect(tBroker.total).toBe(12.62);
      expect(tAdmin.subtotal).toBe(12.62);
      expect(tAdmin.total).toBe(12.62);
    });

    it("ET12 — partial save (subtotal missing) falls back ONLY for that field", () => {
      // If subtotal isn't on the row, fall back to live. But total still
      // wins from saved (it's the contract). This is the exact behavior
      // ET5 covered for `sub`; verify it for `subtotal` too.
      const quote = makeQuote({ total: 999 });
      delete quote.subtotal;
      const t = effectiveQuoteTotals(quote);
      expect(t.total).toBe(999);
      // subtotal field populated from live calc (no saved value to use)
      expect(t.subtotal).toBeGreaterThan(0);
    });
  });
});

// ── footing: afterDisc derives from SAVED total/tax/setup/fees (no recompute) ──
describe("effectiveQuoteTotals — afterDisc footing (saved snapshot)", () => {
  it("reported case: 15% discount foots to the saved total ($429.49), discount = $70.00 not $70.01", () => {
    // subtotal 466.70, saved total 429.49, saved tax 32.79, no setup/fees
    const t = effectiveQuoteTotals({ subtotal: 466.70, tax: 32.79, total: 429.49, discount: 15, discount_type: "percent" });
    expect(t.source).toBe("saved");
    const discount = +(t.sub - t.afterDisc).toFixed(2);
    expect(discount).toBe(70.00); // NOT 70.01 (the live-recompute value)
    // column foots: subtotal − discount + tax === total
    expect(+(t.sub - discount + t.tax).toFixed(2)).toBe(429.49);
  });

  it("foots with setup + additional fees (afterDisc excludes them)", () => {
    // subtotal 100, setup 25, taxable shipping 0 / nontax shipping 15,
    // 10% discount → afterDisc 90, taxable base 115, tax (10%) 11.50,
    // total = 90 + 25 + 11.50 + 15 = 141.50
    const q = {
      subtotal: 100, setup_total: 25,
      additional_charges: [{ label: "Shipping", amount: 15, taxable: false }],
      tax: 11.50, total: 141.50, discount: 10, discount_type: "percent",
    };
    const t = effectiveQuoteTotals(q);
    expect(+(t.sub - t.afterDisc).toFixed(2)).toBe(10.00); // real discount, not absorbing setup/fees
    // subtotal − discount + setup + additional + tax === total
    const discount = +(t.sub - t.afterDisc).toFixed(2);
    expect(+(t.sub - discount + 25 + 15 + t.tax).toFixed(2)).toBe(141.50);
  });
});

describe("effectiveQuoteTotals — PRICE-01: live (pre-save) total includes setup fees", () => {
  it("folds setup/screen fees into the live total (a pre-save conversion no longer undercharges)", () => {
    const cfg = { setupFees: { enabled: true, items: [{ id: "screens", label: "Screens", rate: 25, reorderRate: 15 }] } };
    const quote = makeQuote();        // 1 line, 1-color front print → 1 screen
    delete quote.subtotal; delete quote.tax; delete quote.total;

    // Live total WITH setup config loaded.
    loadShopPricingConfig(cfg);
    const withSetup = effectiveQuoteTotals(quote);
    expect(withSetup.source).toBe("live");
    expect(withSetup.setup_total).toBe(25); // 1 screen × $25

    // Live total with NO setup config (the old buggy behavior).
    loadShopPricingConfig(null);
    const noSetup = effectiveQuoteTotals(quote);
    expect(noSetup.setup_total ?? 0).toBe(0);

    // The fix: setup ($25) plus tax on it ($25 × 8.25%) is now in the total.
    const delta = +(withSetup.total - noSetup.total).toFixed(2);
    expect(delta).toBeCloseTo(25 * (1 + 8.25 / 100), 2); // 27.06
  });

  it("is a no-op when the shop has no setup fees configured", () => {
    loadShopPricingConfig(null);
    const quote = makeQuote();
    delete quote.total;
    const t = effectiveQuoteTotals(quote);
    expect(t.source).toBe("live");
    expect(t.setup_total ?? 0).toBe(0);
  });
});

describe("effectiveQuoteTotals — Phase 2b config threading (CACHE-01)", () => {
  // Two configs that price the same garment differently: cost 4.62 falls in the
  // first (above:0) markup tier, so the markup value alone moves the total.
  const cfgA = { garmentMarkup: [{ above: 0, markup: 1.5 }] };
  const cfgB = { garmentMarkup: [{ above: 0, markup: 2.0 }] };
  const draft = () => {
    const q = makeQuote();
    delete q.subtotal; delete q.tax; delete q.total; // force the live path
    return q;
  };

  it("2B1 — an explicit pc prices the quote, NOT the loaded global", () => {
    loadShopPricingConfig(cfgB, "shopB@x.co");
    const underB = effectiveQuoteTotals(draft()).total;

    loadShopPricingConfig(cfgA, "shopA@x.co");
    const underA = effectiveQuoteTotals(draft()).total;
    expect(underA).not.toBe(underB); // configs genuinely differ

    // Global holds cfgA; passing cfgB explicitly must yield cfgB's number.
    const threaded = effectiveQuoteTotals(draft(), undefined, cfgB).total;
    expect(threaded).toBe(underB);
  });

  it("2B2 — restores the session global + owner after threading (no bleed left behind)", () => {
    loadShopPricingConfig(cfgA, "shopA@x.co");
    effectiveQuoteTotals(draft(), undefined, cfgB);
    expect(getShopPricingConfig()).toBe(cfgA);
    expect(getShopPricingConfigOwner()).toBe("shopA@x.co");
  });

  it("2B3 — default (pc omitted) is identical to reading the global", () => {
    loadShopPricingConfig(cfgA, "shopA@x.co");
    const viaGlobal = effectiveQuoteTotals(draft()).total;
    const viaUndef = effectiveQuoteTotals(draft(), undefined, undefined).total;
    expect(viaUndef).toBe(viaGlobal);
  });

  it("2B4 — a SAVED quote ignores pc (reads its snapshot) — borrow is a no-op", () => {
    loadShopPricingConfig(cfgA, "shopA@x.co");
    const saved = makeQuote({ subtotal: 923, tax: 76, total: 999 });
    const t = effectiveQuoteTotals(saved, undefined, cfgB);
    expect(t.total).toBe(999);
    expect(t.source).toBe("saved");
  });
});
