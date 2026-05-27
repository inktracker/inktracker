import { describe, it, expect, beforeEach } from "vitest";
import {
  getQty,
  getTier,
  getAdminMarkup,
  getBrokerMarkup,
  getBrokerMarkupShare,
  getMarkup,
  sortSizeEntries,
  fmtMoney,
  buildLinkedQtyMap,
  findLinkedPrints,
  getPrintKey,
  resolveLineCategory,
  calcLinkedLinePrice,
  calcQuoteTotalsWithLinking,
  calcQuoteTotals,
  buildQBInvoicePayload,
  loadShopPricingConfig,
  calcSetupScreenCount,
  calcSetupFees,
  STANDARD_MARKUP,
  BROKER_MARKUP,
  FIRST_PRINT,
  ADDL_PRINT,
  EXTRA_RATES,
  SIZES,
  BIG_SIZES,
} from "../pricing";

// ── Test Fixtures ──────────────────────────────────────────────────────────

function makeImprint(overrides = {}) {
  return {
    id: "imp-1",
    title: "",
    location: "Front",
    width: "",
    height: "",
    colors: 1,
    technique: "Screen Print",
    linked: false,
    ...overrides,
  };
}

function makeLineItem(overrides = {}) {
  return {
    id: "li-1",
    style: "1717",
    brand: "Comfort Colors",
    category: "T-Shirts",
    garmentCost: "4.62",
    garmentColor: "Black",
    sizes: { S: "10", M: "15", L: "20" },
    imprints: [makeImprint()],
    ...overrides,
  };
}

function makeQuote(overrides = {}) {
  return {
    line_items: [makeLineItem()],
    rush_rate: 0,
    extras: {},
    discount: 0,
    discount_type: "percent",
    tax_rate: 0,
    deposit_pct: 0,
    ...overrides,
  };
}

// ── Group 1: Helper Functions ──────────────────────────────────────────────

describe("Helper Functions", () => {
  beforeEach(() => {
    loadShopPricingConfig(null);
  });

  describe("getQty", () => {
    it("returns sum of all sizes", () => {
      expect(getQty({ sizes: { S: "10", M: "15", L: "20" } })).toBe(45);
    });

    it("handles string and number values", () => {
      expect(getQty({ sizes: { S: 10, M: "15", L: 20 } })).toBe(45);
    });

    it("returns 0 for empty sizes", () => {
      expect(getQty({ sizes: {} })).toBe(0);
    });

    it("returns 0 for null/undefined", () => {
      expect(getQty(null)).toBe(0);
      expect(getQty(undefined)).toBe(0);
      expect(getQty({})).toBe(0);
    });

    it("ignores non-numeric values", () => {
      expect(getQty({ sizes: { S: "abc", M: "10" } })).toBe(10);
    });
  });

  describe("getTier", () => {
    it("returns lowest tier for small quantities", () => {
      expect(getTier(1)).toBe(25);
      expect(getTier(24)).toBe(25);
    });

    it("returns correct tier at breakpoints", () => {
      expect(getTier(25)).toBe(25);
      expect(getTier(50)).toBe(50);
      expect(getTier(100)).toBe(100);
      expect(getTier(200)).toBe(200);
    });

    it("returns highest tier met", () => {
      expect(getTier(30)).toBe(25);
      expect(getTier(75)).toBe(50);
      expect(getTier(150)).toBe(100);
      expect(getTier(500)).toBe(200);
    });
  });

  describe("getAdminMarkup", () => {
    it("returns 1.4 for garments under $8", () => {
      expect(getAdminMarkup(5)).toBe(1.4);
      expect(getAdminMarkup(0)).toBe(1.4);
    });

    it("returns 1.3 for garments $8-$15", () => {
      expect(getAdminMarkup(10)).toBe(1.3);
      expect(getAdminMarkup(8.01)).toBe(1.3);
    });

    it("returns 1.22 for garments $15-$25", () => {
      expect(getAdminMarkup(20)).toBe(1.22);
      expect(getAdminMarkup(15.01)).toBe(1.22);
    });

    it("returns 1.15 for garments over $25", () => {
      expect(getAdminMarkup(30)).toBe(1.15);
      expect(getAdminMarkup(25.01)).toBe(1.15);
    });

    it("handles string input", () => {
      expect(getAdminMarkup("5")).toBe(1.4);
    });
  });

  describe("getBrokerMarkup", () => {
    it("returns lower markup than admin", () => {
      const adminM = getAdminMarkup(5);
      const brokerM = getBrokerMarkup(5);
      expect(brokerM).toBeLessThan(adminM);
    });

    it("uses formula: 1 + (adminMarkup - 1) * share", () => {
      // Default share = 0.2, admin markup for $5 = 1.4
      // broker = 1 + (1.4 - 1) * 0.2 = 1 + 0.08 = 1.08
      expect(getBrokerMarkup(5)).toBeCloseTo(1.08, 2);
    });

    it("accepts custom share", () => {
      // share = 0.5, admin markup for $5 = 1.4
      // broker = 1 + (1.4 - 1) * 0.5 = 1 + 0.2 = 1.2
      expect(getBrokerMarkup(5, 0.5)).toBeCloseTo(1.2, 2);
    });
  });

  describe("getMarkup", () => {
    it("returns admin markup by default", () => {
      expect(getMarkup(5)).toBe(getAdminMarkup(5));
    });

    it("returns broker markup when isBroker is true", () => {
      expect(getMarkup(5, true)).toBe(getBrokerMarkup(5));
    });
  });

  describe("getBrokerMarkupShare", () => {
    it("returns default 0.2", () => {
      expect(getBrokerMarkupShare()).toBe(0.2);
    });

    it("returns custom value from config", () => {
      loadShopPricingConfig({ brokerMarkupShare: 0.35 });
      expect(getBrokerMarkupShare()).toBe(0.35);
      loadShopPricingConfig(null);
    });
  });

  describe("sortSizeEntries", () => {
    it("sorts in standard size order", () => {
      const entries = [["L", 5], ["S", 10], ["XL", 3], ["M", 7]];
      const sorted = sortSizeEntries(entries);
      expect(sorted.map(([k]) => k)).toEqual(["S", "M", "L", "XL"]);
    });

    it("handles 2XL+ sizes", () => {
      const entries = [["3XL", 2], ["S", 10], ["2XL", 5]];
      const sorted = sortSizeEntries(entries);
      expect(sorted.map(([k]) => k)).toEqual(["S", "2XL", "3XL"]);
    });

    it("sorts unknown sizes alphabetically after known ones", () => {
      const entries = [["Youth L", 5], ["S", 10]];
      const sorted = sortSizeEntries(entries);
      expect(sorted[0][0]).toBe("S");
      expect(sorted[1][0]).toBe("Youth L");
    });
  });

  describe("fmtMoney", () => {
    it("formats positive numbers", () => {
      expect(fmtMoney(1234.5)).toBe("$1,234.50");
    });

    it("formats zero", () => {
      expect(fmtMoney(0)).toBe("$0.00");
    });

    it("handles null/undefined", () => {
      expect(fmtMoney(null)).toBe("$0.00");
      expect(fmtMoney(undefined)).toBe("$0.00");
    });

    it("formats small decimals", () => {
      expect(fmtMoney(9.9)).toBe("$9.90");
    });
  });

  describe("resolveLineCategory", () => {
    it("returns explicit category when set", () => {
      const li = makeLineItem({ category: "Hoodies & Sweatshirts" });
      expect(resolveLineCategory(li)).toBe("Hoodies & Sweatshirts");
    });

    it("falls back to technique mapping for Screen Print", () => {
      const li = makeLineItem({ category: "" });
      expect(resolveLineCategory(li)).toBe("Custom Apparel");
    });

    it("maps Embroidery technique", () => {
      const li = makeLineItem({
        category: "",
        imprints: [makeImprint({ technique: "Embroidery" })],
      });
      expect(resolveLineCategory(li)).toBe("Embroidery");
    });
  });

  describe("buildLinkedQtyMap", () => {
    it("returns empty map when no linked prints", () => {
      const items = [makeLineItem()];
      expect(buildLinkedQtyMap(items)).toEqual({});
    });

    it("combines qty for linked prints across line items", () => {
      const imp = makeImprint({ linked: true, title: "Logo", location: "Front" });
      const li1 = makeLineItem({ id: "li-1", sizes: { S: "10", M: "10" }, imprints: [imp] });
      const li2 = makeLineItem({ id: "li-2", sizes: { L: "20", XL: "15" }, imprints: [imp] });
      const map = buildLinkedQtyMap([li1, li2]);
      const key = getPrintKey(imp);
      expect(map[key]).toBe(55); // 20 + 35
    });

    it("keeps separate keys for different prints", () => {
      const imp1 = makeImprint({ linked: true, title: "Logo A" });
      const imp2 = makeImprint({ linked: true, title: "Logo B" });
      const li1 = makeLineItem({ id: "li-1", sizes: { S: "10" }, imprints: [imp1] });
      const li2 = makeLineItem({ id: "li-2", sizes: { M: "20" }, imprints: [imp2] });
      const map = buildLinkedQtyMap([li1, li2]);
      expect(Object.keys(map)).toHaveLength(2);
    });
  });
});

// ── Group 2: calcLinkedLinePrice ───────────────────────────────────────────

describe("calcLinkedLinePrice", () => {
  beforeEach(() => {
    loadShopPricingConfig(null);
  });

  it("returns null for zero qty", () => {
    const li = makeLineItem({ sizes: {} });
    expect(calcLinkedLinePrice(li, 0, {}, undefined, {})).toBeNull();
  });

  it("returns null when no imprints have colors", () => {
    const li = makeLineItem({ imprints: [makeImprint({ colors: 0 })] });
    expect(calcLinkedLinePrice(li, 0, {}, undefined, {})).toBeNull();
  });

  describe("screen print pricing", () => {
    it("calculates basic 1-color pricing", () => {
      // 45 pcs (S:10 M:15 L:20), tier = 25, 1 color front
      // Print: FIRST_PRINT[1][25] = 6.3 per piece × 45 = 283.50
      const li = makeLineItem();
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      expect(r.qty).toBe(45);
      expect(r.tier).toBe(25);
      expect(r.printCost).toBeCloseTo(FIRST_PRINT[1][25] * 45, 2);
    });

    it("calculates multi-color pricing", () => {
      // 3 colors, tier 25: FIRST_PRINT[3][25] = 7.55
      const li = makeLineItem({
        imprints: [makeImprint({ colors: 3 })],
      });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r.printCost).toBeCloseTo(FIRST_PRINT[3][25] * 45, 2);
    });

    it("uses ADDL_PRINT table for second location", () => {
      // First: 1 color front, Second: 1 color back
      const li = makeLineItem({
        imprints: [
          makeImprint({ id: "imp-1", colors: 1, location: "Front" }),
          makeImprint({ id: "imp-2", colors: 1, location: "Back" }),
        ],
      });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      const expectedPrint = (FIRST_PRINT[1][25] + ADDL_PRINT[1][25]) * 45;
      expect(r.printCost).toBeCloseTo(expectedPrint, 2);
    });

    it("uses higher tier for larger quantities", () => {
      // 100 pcs, tier = 100
      const li = makeLineItem({
        sizes: { S: "25", M: "25", L: "25", XL: "25" },
      });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r.qty).toBe(100);
      expect(r.tier).toBe(100);
      expect(r.printCost).toBeCloseTo(FIRST_PRINT[1][100] * 100, 2);
    });

    describe("firstPrintOrdering toggle", () => {
      // Mixed-color job used by both ordering tests: 1-color front,
      // 4-color back, 45 pcs (tier 25). The two orderings reach for
      // different cells in the FIRST_PRINT / ADDL_PRINT tables.
      const makeMixed = () => makeLineItem({
        imprints: [
          makeImprint({ id: "imp-1", colors: 1, location: "Front" }),
          makeImprint({ id: "imp-4", colors: 4, location: "Back" }),
        ],
      });

      it("default (no config) treats fewest-color imprint as first", () => {
        loadShopPricingConfig(null);
        const r = calcLinkedLinePrice(makeMixed(), 0, {}, undefined, {});
        // Sorted ascending: [1c, 4c] → 1c uses FIRST_PRINT, 4c uses ADDL_PRINT
        const expected = (FIRST_PRINT[1][25] + ADDL_PRINT[4][25]) * 45;
        expect(r.printCost).toBeCloseTo(expected, 2);
        expect(r.printBreakdown[0].isFirst).toBe(true);
        expect(r.printBreakdown[0].colors).toBe(1);
      });

      it("explicit 'fewest' matches the default", () => {
        loadShopPricingConfig({ firstPrintOrdering: "fewest" });
        const r = calcLinkedLinePrice(makeMixed(), 0, {}, undefined, {});
        expect(r.printBreakdown[0].colors).toBe(1);
        expect(r.printBreakdown[0].isFirst).toBe(true);
      });

      it("'most' treats highest-color imprint as first (industry convention)", () => {
        loadShopPricingConfig({ firstPrintOrdering: "most" });
        const r = calcLinkedLinePrice(makeMixed(), 0, {}, undefined, {});
        // Sorted descending: [4c, 1c] → 4c uses FIRST_PRINT, 1c uses ADDL_PRINT
        const expected = (FIRST_PRINT[4][25] + ADDL_PRINT[1][25]) * 45;
        expect(r.printCost).toBeCloseTo(expected, 2);
        expect(r.printBreakdown[0].isFirst).toBe(true);
        expect(r.printBreakdown[0].colors).toBe(4);
      });

      it("'most' produces a different total than 'fewest' for mixed jobs", () => {
        // Sanity guard: if FIRST_PRINT/ADDL_PRINT defaults ever drift
        // to a structure where ordering doesn't matter, these tests
        // become useless. Pin that the toggle actually changes things.
        loadShopPricingConfig({ firstPrintOrdering: "fewest" });
        const rFewest = calcLinkedLinePrice(makeMixed(), 0, {}, undefined, {});
        loadShopPricingConfig({ firstPrintOrdering: "most" });
        const rMost = calcLinkedLinePrice(makeMixed(), 0, {}, undefined, {});
        expect(rMost.printCost).not.toBeCloseTo(rFewest.printCost, 2);
      });

      it("uniform-color jobs are immune to the toggle (no difference)", () => {
        // Two 2-color imprints: both orderings produce the same bill
        // since both cells are at color count 2 in the same tables.
        const uniform = makeLineItem({
          imprints: [
            makeImprint({ id: "a", colors: 2, location: "Front" }),
            makeImprint({ id: "b", colors: 2, location: "Back" }),
          ],
        });
        loadShopPricingConfig({ firstPrintOrdering: "fewest" });
        const rA = calcLinkedLinePrice(uniform, 0, {}, undefined, {});
        loadShopPricingConfig({ firstPrintOrdering: "most" });
        const rB = calcLinkedLinePrice(uniform, 0, {}, undefined, {});
        expect(rB.printCost).toBeCloseTo(rA.printCost, 2);
      });
    });
  });

  describe("mixed-technique per-imprint pricing (engine fix follow-up)", () => {
    // Was a real bug pre-fix: setting imprint 2 to "Screen Print" on a
    // line whose imprint 1 was Embroidery silently still charged
    // embroidery × 0.7. Now each imprint is priced by its OWN technique
    // with group-local first/additional logic.

    beforeEach(() => loadShopPricingConfig(null));

    function makeMixedLine() {
      // 28 pcs (matches the reported user case)
      return makeLineItem({
        sizes: { S: 7, M: 7, L: 7, XL: 7 },
        imprints: [
          makeImprint({ id: "emb",  colors: 1, technique: "Embroidery",  location: "Front" }),
          makeImprint({ id: "scrn", colors: 1, technique: "Screen Print", location: "Front" }),
        ],
      });
    }

    it("MT1 — each imprint priced under its own technique table", () => {
      const r = calcLinkedLinePrice(makeMixedLine(), 0, {}, undefined, {});
      const embRow  = r.printBreakdown.find((p) => p.technique === "Embroidery");
      const scrnRow = r.printBreakdown.find((p) => p.technique === "Screen Print");
      expect(embRow).toBeDefined();
      expect(scrnRow).toBeDefined();
      // Embroidery should NOT equal screen print × 0.7 — they're independent now.
      expect(scrnRow.rate).not.toBeCloseTo(embRow.rate * 0.7, 2);
      // Screen print should match the FIRST_PRINT 1-color cell at tier 25,
      // not embroidery × 0.7 (which was the pre-fix bug).
      expect(scrnRow.rate).toBeCloseTo(FIRST_PRINT[1][25], 2);
    });

    it("MT2 — both imprints are 'first within their group'", () => {
      const r = calcLinkedLinePrice(makeMixedLine(), 0, {}, undefined, {});
      const embRow  = r.printBreakdown.find((p) => p.technique === "Embroidery");
      const scrnRow = r.printBreakdown.find((p) => p.technique === "Screen Print");
      expect(embRow.isFirst).toBe(true);
      expect(embRow.groupIndex).toBe(0);
      expect(scrnRow.isFirst).toBe(true);
      expect(scrnRow.groupIndex).toBe(0);
    });

    it("MT3 — two embroideries: second gets 30% additional-decoration discount", () => {
      const r = calcLinkedLinePrice(makeLineItem({
        sizes: { S: 7, M: 7, L: 7, XL: 7 },
        imprints: [
          makeImprint({ id: "e1", colors: 1, technique: "Embroidery", location: "Front" }),
          makeImprint({ id: "e2", colors: 1, technique: "Embroidery", location: "Back"  }),
        ],
      }), 0, {}, undefined, {});
      const [first, second] = r.printBreakdown;
      expect(second.isFirst).toBe(false);
      expect(second.groupIndex).toBe(1);
      expect(second.rate).toBeCloseTo(first.rate * 0.7, 2);
    });

    it("MT4 — two screen prints: second uses ADDL_PRINT table (unchanged behavior)", () => {
      const r = calcLinkedLinePrice(makeLineItem({
        sizes: { S: 7, M: 7, L: 7, XL: 7 },
        imprints: [
          makeImprint({ id: "s1", colors: 1, technique: "Screen Print", location: "Front" }),
          makeImprint({ id: "s2", colors: 1, technique: "Screen Print", location: "Back"  }),
        ],
      }), 0, {}, undefined, {});
      const [first, second] = r.printBreakdown;
      expect(first.rate).toBeCloseTo(FIRST_PRINT[1][25], 2);
      expect(second.rate).toBeCloseTo(ADDL_PRINT[1][25], 2);
      expect(first.groupIndex).toBe(0);
      expect(second.groupIndex).toBe(1);
    });

    it("MT5 — single-technique line still produces same numbers as pre-fix", () => {
      // Regression guard: the 99% case must be byte-for-byte identical.
      const li = makeLineItem({
        sizes: { S: 7, M: 7, L: 7, XL: 7 },
        imprints: [
          makeImprint({ id: "a", colors: 1, location: "Front" }),
          makeImprint({ id: "b", colors: 4, location: "Back"  }),
        ],
      });
      loadShopPricingConfig({ firstPrintOrdering: "fewest" });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      // 1c sorted first → FIRST_PRINT[1][25]; 4c second → ADDL_PRINT[4][25]
      const expected = (FIRST_PRINT[1][25] + ADDL_PRINT[4][25]) * 28;
      expect(r.printCost).toBeCloseTo(expected, 2);
    });

  });

  describe("garment cost and markup", () => {
    it("applies admin markup to flat garment cost", () => {
      // garmentCost = 4.62, admin markup for $4.62 = 1.4
      // garment ppp = 4.62 * 1.4 = 6.468 → rounded to 6.47
      const li = makeLineItem();
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      const expectedGarmentPpp = Math.round(4.62 * 1.4 * 100) / 100;
      // All sizes same cost, so gCost = ppp × qty
      expect(r.gCost).toBeCloseTo(expectedGarmentPpp * 45, 2);
    });

    it("applies broker markup (lower than admin)", () => {
      const li = makeLineItem();
      const adminResult = calcLinkedLinePrice(li, 0, {}, undefined, {});
      const brokerResult = calcLinkedLinePrice(li, 0, {}, BROKER_MARKUP, {});
      expect(brokerResult.gCost).toBeLessThan(adminResult.gCost);
    });

    it("uses per-size prices when available", () => {
      const li = makeLineItem({
        sizes: { S: "10", M: "10", "2XL": "5" },
        sizePrices: { S: 4.00, M: 4.25, "2XL": 6.50 },
      });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      // Each size gets its own markup
      const sCost = Math.round(4.00 * getAdminMarkup(4.00) * 100) / 100;
      const mCost = Math.round(4.25 * getAdminMarkup(4.25) * 100) / 100;
      const xxlCost = Math.round(6.50 * getAdminMarkup(6.50) * 100) / 100;
      expect(r.gCost).toBeCloseTo(sCost * 10 + mCost * 10 + xxlCost * 5, 2);
    });

    it("falls back to flat garmentCost when sizePrices missing", () => {
      const li = makeLineItem({ sizePrices: undefined });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      const ppp = Math.round(4.62 * getAdminMarkup(4.62) * 100) / 100;
      expect(r.gCost).toBeCloseTo(ppp * 45, 2);
    });
  });

  describe("rush fee", () => {
    it("calculates as percentage of baseSubtotal", () => {
      const li = makeLineItem();
      const r = calcLinkedLinePrice(li, 0.2, {}, undefined, {});
      expect(r.rushFee).toBeCloseTo(r.baseSubtotal * 0.2, 2);
      expect(r.lineTotal).toBeCloseTo(r.baseSubtotal + r.rushFee, 2);
    });

    it("is zero when rushRate is 0", () => {
      const li = makeLineItem();
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r.rushFee).toBe(0);
      expect(r.lineTotal).toBe(r.baseSubtotal);
    });
  });

  describe("extras", () => {
    it("adds colorMatch per piece", () => {
      const li = makeLineItem();
      const base = calcLinkedLinePrice(li, 0, {}, undefined, {});
      const withExtra = calcLinkedLinePrice(li, 0, { colorMatch: true }, undefined, {});
      expect(withExtra.extraCost).toBeCloseTo(EXTRA_RATES.colorMatch * 45, 2);
      expect(withExtra.baseSubtotal).toBeGreaterThan(base.baseSubtotal);
    });

    it("adds multiple extras", () => {
      const li = makeLineItem();
      const r = calcLinkedLinePrice(li, 0, { colorMatch: true, tags: true }, undefined, {});
      expect(r.extraCost).toBeCloseTo((EXTRA_RATES.colorMatch + EXTRA_RATES.tags) * 45, 2);
    });

    it("no extras = zero extra cost", () => {
      const li = makeLineItem();
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r.extraCost).toBe(0);
    });
  });

  describe("linked prints", () => {
    it("uses combined qty for tier lookup", () => {
      const imp = makeImprint({ linked: true, title: "Logo", colors: 1 });
      // Line 1: 25 pcs, Line 2: 30 pcs → combined 55, tier = 50
      const li1 = makeLineItem({ id: "li-1", sizes: { S: "15", M: "10" }, imprints: [imp] });
      const li2 = makeLineItem({ id: "li-2", sizes: { L: "15", XL: "15" }, imprints: [imp] });
      const linkedQtyMap = buildLinkedQtyMap([li1, li2]);

      const r1 = calcLinkedLinePrice(li1, 0, {}, undefined, linkedQtyMap);
      // With linked, tier should be 50 (combined 55), not 25 (individual 25)
      expect(r1.tier).toBe(50);
      // Rate should be from tier 50 column
      expect(r1.firstPPP).toBe(FIRST_PRINT[1][50]);
    });
  });

  describe("ppp calculation", () => {
    it("ppp is average across all sizes", () => {
      const li = makeLineItem();
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r.ppp).toBeCloseTo(r.baseSubtotal / r.qty, 2);
    });

    it("lineTotal = baseSubtotal + rushFee", () => {
      const li = makeLineItem();
      const r = calcLinkedLinePrice(li, 0.15, {}, undefined, {});
      expect(r.lineTotal).toBeCloseTo(r.baseSubtotal + r.rushFee, 2);
    });

    it("sub is alias for lineTotal", () => {
      const li = makeLineItem();
      const r = calcLinkedLinePrice(li, 0.15, {}, undefined, {});
      expect(r.sub).toBe(r.lineTotal);
    });
  });

  describe("admin vs broker pricing", () => {
    it("broker total is less than admin total", () => {
      const li = makeLineItem();
      const admin = calcLinkedLinePrice(li, 0, {}, undefined, {});
      const broker = calcLinkedLinePrice(li, 0, {}, BROKER_MARKUP, {});
      expect(broker.lineTotal).toBeLessThan(admin.lineTotal);
    });

    it("print costs are the same for both", () => {
      const li = makeLineItem();
      const admin = calcLinkedLinePrice(li, 0, {}, undefined, {});
      const broker = calcLinkedLinePrice(li, 0, {}, BROKER_MARKUP, {});
      // Print costs don't change with markup — only garment cost does
      expect(broker.printCost).toBe(admin.printCost);
    });

    it("garment cost differs by markup", () => {
      const li = makeLineItem();
      const admin = calcLinkedLinePrice(li, 0, {}, undefined, {});
      const broker = calcLinkedLinePrice(li, 0, {}, BROKER_MARKUP, {});
      expect(broker.gCost).toBeLessThan(admin.gCost);
    });
  });

  describe("embroidery pricing", () => {
    it("uses stitch tier table instead of color table", () => {
      const li = makeLineItem({
        sizes: { S: "10", M: "15", L: "20" },
        imprints: [makeImprint({ technique: "Embroidery", colors: 1 })],
      });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      // Embroidery uses different qty tiers (12, 24, 48, 72, 144)
      // 45 pcs → tier 24
      expect(r.printCost).toBeGreaterThan(0);
    });

    it("additional embroidery locations at 70% rate", () => {
      const li = makeLineItem({
        sizes: { S: "10", M: "15", L: "20" },
        imprints: [
          makeImprint({ id: "e1", technique: "Embroidery", colors: 1, location: "Left Chest" }),
          makeImprint({ id: "e2", technique: "Embroidery", colors: 1, location: "Back" }),
        ],
      });
      const single = makeLineItem({
        sizes: { S: "10", M: "15", L: "20" },
        imprints: [
          makeImprint({ id: "e1", technique: "Embroidery", colors: 1, location: "Left Chest" }),
        ],
      });
      const rDouble = calcLinkedLinePrice(li, 0, {}, undefined, {});
      const rSingle = calcLinkedLinePrice(single, 0, {}, undefined, {});
      // Second location adds 70% of first location rate
      expect(rDouble.printCost).toBeCloseTo(rSingle.printCost * 1.7, 0);
    });
  });
});

// ── Group 3: calcQuoteTotalsWithLinking ────────────────────────────────────

describe("calcQuoteTotalsWithLinking", () => {
  beforeEach(() => {
    loadShopPricingConfig(null);
  });

  it("sums line items correctly", () => {
    const q = makeQuote({
      line_items: [
        makeLineItem({ id: "li-1" }),
        makeLineItem({ id: "li-2", sizes: { XL: "20" } }),
      ],
    });
    const t = calcQuoteTotalsWithLinking(q);
    expect(t.sub).toBeGreaterThan(0);
    expect(t.subtotal).toBeGreaterThan(0);
  });

  describe("discount", () => {
    it("applies percent discount", () => {
      const q = makeQuote({ discount: 10, discount_type: "percent" });
      const t = calcQuoteTotalsWithLinking(q);
      expect(t.afterDisc).toBeCloseTo(t.sub * 0.9, 2);
    });

    it("applies flat discount", () => {
      const q = makeQuote({ discount: 50, discount_type: "flat" });
      const t = calcQuoteTotalsWithLinking(q);
      expect(t.afterDisc).toBeCloseTo(t.sub - 50, 2);
    });

    it("auto-detects flat when value > $100 and no explicit type", () => {
      // discount_type must NOT be "percent" for auto-detect to trigger
      const q = makeQuote({ discount: 150, discount_type: undefined });
      const t = calcQuoteTotalsWithLinking(q);
      // Should treat as flat, not 150%
      expect(t.afterDisc).toBeCloseTo(t.sub - 150, 2);
    });

    it("respects explicit percent even when > 100", () => {
      // Edge case: discount_type explicitly "percent" should NOT be auto-flat
      const q = makeQuote({ discount: 150, discount_type: "percent" });
      const t = calcQuoteTotalsWithLinking(q);
      // 150% discount → afterDisc = sub * (1 - 1.5) = negative → but Math.max not applied here
      // Actually the code doesn't clamp percent, only flat uses Math.max(0, ...)
      expect(t.afterDisc).toBeLessThan(0);
    });

    it("flat discount does not go below zero", () => {
      const q = makeQuote({ discount: 99999, discount_type: "flat" });
      const t = calcQuoteTotalsWithLinking(q);
      expect(t.afterDisc).toBe(0);
    });
  });

  describe("tax", () => {
    it("applies tax after discount", () => {
      const q = makeQuote({ discount: 10, discount_type: "percent", tax_rate: 8 });
      const t = calcQuoteTotalsWithLinking(q);
      const expectedAfterDisc = t.sub * 0.9;
      expect(t.tax).toBeCloseTo(expectedAfterDisc * 0.08, 2);
      expect(t.total).toBeCloseTo(expectedAfterDisc + t.tax, 2);
    });

    it("is zero when tax_rate is 0", () => {
      const q = makeQuote({ tax_rate: 0 });
      const t = calcQuoteTotalsWithLinking(q);
      expect(t.tax).toBe(0);
    });
  });

  describe("deposit", () => {
    it("calculates as percentage of total", () => {
      const q = makeQuote({ tax_rate: 8, deposit_pct: 50 });
      const t = calcQuoteTotalsWithLinking(q);
      expect(t.deposit).toBeCloseTo(t.total * 0.5, 2);
    });

    it("is zero when deposit_pct is 0", () => {
      const q = makeQuote({ deposit_pct: 0 });
      const t = calcQuoteTotalsWithLinking(q);
      expect(t.deposit).toBe(0);
    });
  });

  describe("clientPpp override", () => {
    it("uses override price instead of calculated", () => {
      const li = makeLineItem({ clientPpp: 20 });
      const q = makeQuote({ line_items: [li] });
      const t = calcQuoteTotalsWithLinking(q);
      // Override: 20 × 45 = 900, no rush added
      expect(t.subtotal).toBe(900);
      expect(t.rushTotal).toBe(0);
    });

    it("override skips rush fee", () => {
      const li = makeLineItem({ clientPpp: 20 });
      const q = makeQuote({ line_items: [li], rush_rate: 0.2 });
      const t = calcQuoteTotalsWithLinking(q);
      // Override line: subtotal = 900, rush = 0
      expect(t.rushTotal).toBe(0);
      expect(t.sub).toBe(900);
    });

    it("override only respected for STANDARD_MARKUP", () => {
      const li = makeLineItem({ clientPpp: 20 });
      const q = makeQuote({ line_items: [li] });
      const adminT = calcQuoteTotalsWithLinking(q, STANDARD_MARKUP);
      const brokerT = calcQuoteTotalsWithLinking(q, BROKER_MARKUP);
      // Admin uses override → subtotal = 900
      expect(adminT.subtotal).toBe(900);
      // Broker ignores override → calculates normally
      expect(brokerT.subtotal).not.toBe(900);
    });
  });

  describe("admin vs broker totals", () => {
    it("broker total is lower than admin total", () => {
      const q = makeQuote();
      const admin = calcQuoteTotalsWithLinking(q, STANDARD_MARKUP);
      const broker = calcQuoteTotalsWithLinking(q, BROKER_MARKUP);
      expect(broker.total).toBeLessThan(admin.total);
    });
  });

  it("calcQuoteTotals is alias for calcQuoteTotalsWithLinking", () => {
    const q = makeQuote({ discount: 5, tax_rate: 8 });
    const a = calcQuoteTotalsWithLinking(q);
    const b = calcQuoteTotals(q);
    expect(a.total).toBe(b.total);
    expect(a.sub).toBe(b.sub);
  });
});

// ── Group 4: buildQBInvoicePayload ─────────────────────────────────────────

describe("buildQBInvoicePayload", () => {
  beforeEach(() => {
    loadShopPricingConfig(null);
  });

  it("uses saved _ppp/_lineTotal for admin quotes", () => {
    const li = makeLineItem({ _ppp: 15.50, _lineTotal: 697.50 });
    const q = makeQuote({ line_items: [li] });
    const payload = buildQBInvoicePayload(q);
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0].unitPrice).toBeCloseTo(15.50, 4);
    expect(payload.lines[0].amount).toBeCloseTo(697.50, 2);
  });

  it("falls back to live calc when no saved values", () => {
    const li = makeLineItem(); // no _ppp/_lineTotal
    const q = makeQuote({ line_items: [li] });
    const payload = buildQBInvoicePayload(q);
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0].unitPrice).toBeGreaterThan(0);
    expect(payload.lines[0].amount).toBeGreaterThan(0);
  });

  it("broker quotes USE saved per-line values (quote-snapshot invariant)", () => {
    // Updated 2026-06: BrokerQuoteEditor now stamps _ppp / _lineTotal
    // with BROKER_MARKUP at save time, so reading those values here is
    // correct AND avoids the per-viewer pricing-config divergence that
    // produced the broker $12.62 vs shop $14.02 bug. The QB invoice's
    // numbers must match what the broker quoted; a live recompute in
    // the shop's session can drift from that. See memory:
    // project_quote_immutability.md
    const li = makeLineItem({ _ppp: 15.50, _lineTotal: 697.50 });
    const q = makeQuote({ broker_id: "b@example.com", line_items: [li] });
    const payload = buildQBInvoicePayload(q, BROKER_MARKUP);
    expect(payload.lines[0].unitPrice).toBeCloseTo(15.50, 4);
    expect(payload.lines[0].amount).toBeCloseTo(697.50, 2);
  });

  it("skips zero-qty lines", () => {
    const li = makeLineItem({ sizes: {} });
    const q = makeQuote({ line_items: [li] });
    const payload = buildQBInvoicePayload(q);
    expect(payload.lines).toHaveLength(0);
  });

  describe("discount serialization", () => {
    it("serializes percent discount", () => {
      const q = makeQuote({ discount: 10, discount_type: "percent" });
      const payload = buildQBInvoicePayload(q);
      expect(payload.discountPercent).toBe(10);
      expect(payload.discountAmount).toBe(0);
      expect(payload.discountType).toBe("percent");
    });

    it("serializes flat discount", () => {
      const q = makeQuote({ discount: 50, discount_type: "flat" });
      const payload = buildQBInvoicePayload(q);
      expect(payload.discountPercent).toBe(0);
      expect(payload.discountAmount).toBe(50);
      expect(payload.discountType).toBe("flat");
    });
  });

  it("includes deposit amount when paid", () => {
    const q = makeQuote({
      deposit_paid: true,
      deposit_pct: 50,
      tax_rate: 8,
    });
    const payload = buildQBInvoicePayload(q);
    expect(payload.depositAmount).toBeGreaterThan(0);
  });

  it("deposit is zero when not paid", () => {
    const q = makeQuote({ deposit_paid: false, deposit_pct: 50 });
    const payload = buildQBInvoicePayload(q);
    expect(payload.depositAmount).toBe(0);
  });

  it("builds correct description format", () => {
    const li = makeLineItem({
      brand: "Comfort Colors",
      style: "1717",
      garmentColor: "Black",
      sizes: { S: "10", M: "15" },
      imprints: [makeImprint({ title: "Logo", location: "Front", technique: "Screen Print" })],
    });
    const q = makeQuote({ line_items: [li] });
    const payload = buildQBInvoicePayload(q);
    const desc = payload.lines[0].description;
    expect(desc).toContain("Comfort Colors");
    expect(desc).toContain("1717");
    expect(desc).toContain("Black");
    expect(desc).toContain("S:10");
    expect(desc).toContain("M:15");
    expect(desc).toContain("Front");
  });
});

// ── Group 5: Quote Stamping Logic ──────────────────────────────────────────
// Tests the stamping logic as implemented in QuoteEditorModal and BrokerQuoteEditor.
// We replicate the stamping algorithm here to verify it produces consistent results.

describe("Quote Stamping", () => {
  beforeEach(() => {
    loadShopPricingConfig(null);
  });

  function stampAdmin(q) {
    const linkedQtyMap = buildLinkedQtyMap(q.line_items || []);
    const stampedItems = (q.line_items || []).map((li) => {
      const qty = getQty(li);
      const r = calcLinkedLinePrice(li, q.rush_rate, q.extras, undefined, linkedQtyMap);
      if (!r || !qty) return li;
      const override = Number(li?.clientPpp);
      const hasOverride = Number.isFinite(override) && override > 0;
      const ppp = hasOverride ? override : r.ppp;
      const lineTotal = ppp * qty;
      const rushFee = hasOverride ? 0 : r.rushFee;
      return { ...li, _ppp: ppp, _lineTotal: lineTotal, _rushFee: rushFee };
    });
    const lineSubtotal = stampedItems.reduce((s, li) => s + (li._lineTotal || 0), 0);
    const rushTotal = stampedItems.reduce((s, li) => s + (li._rushFee || 0), 0);
    const sub = Math.round((lineSubtotal + rushTotal) * 100) / 100;
    const discVal = parseFloat(q.discount) || 0;
    const isFlat = q.discount_type === "flat" || (discVal > 100 && q.discount_type !== "percent");
    const afterDisc = isFlat ? Math.max(0, sub - discVal) : sub * (1 - discVal / 100);
    const tax = Math.round(afterDisc * ((parseFloat(q.tax_rate) || 0) / 100) * 100) / 100;
    const total = Math.round((afterDisc + tax) * 100) / 100;
    return { line_items: stampedItems, subtotal: sub, tax, total };
  }

  function stampBroker(q) {
    const linkedQtyMap = buildLinkedQtyMap(q.line_items || []);
    const stampedItems = (q.line_items || []).map((li) => {
      const qty = getQty(li);
      const r = calcLinkedLinePrice(li, q.rush_rate, q.extras, STANDARD_MARKUP, linkedQtyMap);
      if (!r || !qty) return li;
      const override = Number(li?.clientPpp);
      const hasOverride = Number.isFinite(override) && override > 0;
      const ppp = hasOverride ? override : r.ppp;
      const lineTotal = ppp * qty;
      const rushFee = hasOverride ? 0 : r.rushFee;
      return { ...li, _ppp: ppp, _lineTotal: lineTotal, _rushFee: rushFee };
    });
    const lineSubtotal = stampedItems.reduce((s, li) => s + (li._lineTotal || 0), 0);
    const rushTotal = stampedItems.reduce((s, li) => s + (li._rushFee || 0), 0);
    const sub = Math.round((lineSubtotal + rushTotal) * 100) / 100;
    const discVal = parseFloat(q.discount) || 0;
    const isFlat = q.discount_type === "flat" || (discVal > 100 && q.discount_type !== "percent");
    const afterDisc = isFlat ? Math.max(0, sub - discVal) : sub * (1 - discVal / 100);
    const total = Math.round(afterDisc * 100) / 100;
    return { line_items: stampedItems, subtotal: sub, tax: 0, total };
  }

  describe("admin stamping", () => {
    it("stamps _ppp, _lineTotal, _rushFee on each line", () => {
      const q = makeQuote();
      const result = stampAdmin(q);
      const li = result.line_items[0];
      expect(li._ppp).toBeGreaterThan(0);
      expect(li._lineTotal).toBeGreaterThan(0);
      expect(li._rushFee).toBe(0); // no rush
    });

    it("stamped _ppp matches calcLinkedLinePrice output", () => {
      const q = makeQuote();
      const result = stampAdmin(q);
      const li = result.line_items[0];
      const r = calcLinkedLinePrice(q.line_items[0], 0, {}, undefined, {});
      expect(li._ppp).toBe(r.ppp);
    });

    it("clientPpp override sets _ppp to override", () => {
      const q = makeQuote({
        line_items: [makeLineItem({ clientPpp: 20 })],
      });
      const result = stampAdmin(q);
      expect(result.line_items[0]._ppp).toBe(20);
      expect(result.line_items[0]._lineTotal).toBe(20 * 45);
      expect(result.line_items[0]._rushFee).toBe(0);
    });

    it("total includes tax", () => {
      const q = makeQuote({ tax_rate: 8 });
      const result = stampAdmin(q);
      expect(result.tax).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(result.subtotal);
    });

    it("subtotal = sum of _lineTotal + _rushFee", () => {
      const q = makeQuote({ rush_rate: 0.2 });
      const result = stampAdmin(q);
      const expected = result.line_items.reduce(
        (s, li) => s + (li._lineTotal || 0) + (li._rushFee || 0),
        0
      );
      expect(result.subtotal).toBeCloseTo(expected, 2);
    });
  });

  describe("broker stamping", () => {
    it("stamps same fields as admin", () => {
      const q = makeQuote();
      const result = stampBroker(q);
      const li = result.line_items[0];
      expect(li._ppp).toBeGreaterThan(0);
      expect(li._lineTotal).toBeGreaterThan(0);
      expect(typeof li._rushFee).toBe("number");
    });

    it("tax is always 0", () => {
      const q = makeQuote({ tax_rate: 8 });
      const result = stampBroker(q);
      expect(result.tax).toBe(0);
    });

    it("total = afterDisc (no tax)", () => {
      const q = makeQuote({ discount: 10, discount_type: "percent" });
      const result = stampBroker(q);
      // total should be sub * 0.9 (no tax added)
      const expectedAfterDisc = Math.round(result.subtotal * 0.9 * 100) / 100;
      expect(result.total).toBe(expectedAfterDisc);
    });

    it("applies discount correctly", () => {
      const q = makeQuote({ discount: 50, discount_type: "flat" });
      const result = stampBroker(q);
      expect(result.total).toBeCloseTo(result.subtotal - 50, 2);
    });
  });

  describe("admin vs broker stamping differences", () => {
    it("same line items produce same _ppp (both use STANDARD_MARKUP for stamping)", () => {
      const q = makeQuote();
      const admin = stampAdmin(q);
      const broker = stampBroker(q);
      // Both stamp with STANDARD_MARKUP (the client-facing price)
      expect(admin.line_items[0]._ppp).toBe(broker.line_items[0]._ppp);
    });

    it("admin includes tax, broker does not", () => {
      const q = makeQuote({ tax_rate: 8 });
      const admin = stampAdmin(q);
      const broker = stampBroker(q);
      expect(admin.tax).toBeGreaterThan(0);
      expect(broker.tax).toBe(0);
      expect(admin.total).toBeGreaterThan(broker.total);
    });
  });
});

// ── Group 6: Edge Cases ────────────────────────────────────────────────────
// Scenarios that are unusual but possible in production. Each test below was
// added as part of pre-launch hardening — failures here mean a real customer
// could hit the edge case and get a wrong number / crash / surprise.

describe("Edge Cases", () => {
  beforeEach(() => {
    loadShopPricingConfig(null);
  });

  describe("empty quote", () => {
    it("calcQuoteTotalsWithLinking returns zeros for empty line_items", () => {
      const t = calcQuoteTotalsWithLinking({ line_items: [] });
      expect(t.subtotal).toBe(0);
      expect(t.sub).toBe(0);
      expect(t.tax).toBe(0);
      expect(t.total).toBe(0);
      expect(t.deposit).toBe(0);
    });

    it("calcQuoteTotalsWithLinking is defensive against null quote", () => {
      const t = calcQuoteTotalsWithLinking(null);
      expect(t.total).toBe(0);
    });

    it("calcQuoteTotalsWithLinking is defensive against undefined quote", () => {
      const t = calcQuoteTotalsWithLinking(undefined);
      expect(t.total).toBe(0);
    });

    it("discount on empty quote does not produce negative total", () => {
      const t = calcQuoteTotalsWithLinking({
        line_items: [],
        discount: 50,
        discount_type: "flat",
      });
      expect(t.total).toBe(0);
    });
  });

  describe("single-piece order", () => {
    it("1-piece order uses lowest tier (25)", () => {
      const li = makeLineItem({ sizes: { M: "1" } });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      expect(r.qty).toBe(1);
      expect(r.tier).toBe(25);
    });

    it("1-piece total still positive", () => {
      const q = makeQuote({ line_items: [makeLineItem({ sizes: { M: "1" } })] });
      const t = calcQuoteTotalsWithLinking(q);
      expect(t.total).toBeGreaterThan(0);
    });
  });

  describe("zero garment cost", () => {
    it("garmentCost=0 still produces a positive lineTotal from print cost", () => {
      // Customer-supplied garments: cost is 0 but printing still has a price.
      const li = makeLineItem({ garmentCost: "0" });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      expect(r.gCost).toBe(0);
      expect(r.printCost).toBeGreaterThan(0);
      expect(r.lineTotal).toBeGreaterThan(0);
    });

    it("empty-string garmentCost behaves like 0", () => {
      const li = makeLineItem({ garmentCost: "" });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      expect(r.gCost).toBe(0);
    });
  });

  describe("brokerMarkupShare boundaries", () => {
    it("share=0 → broker markup is 1.0 (broker pays raw cost)", () => {
      expect(getBrokerMarkup(5, 0)).toBeCloseTo(1.0, 2);
    });

    it("share=1 → broker markup equals admin markup", () => {
      const adminM = getAdminMarkup(5);
      const brokerM = getBrokerMarkup(5, 1);
      expect(brokerM).toBeCloseTo(adminM, 2);
    });

    it("share from config overrides default", () => {
      loadShopPricingConfig({ brokerMarkupShare: 0.0 });
      expect(getBrokerMarkupShare()).toBe(0.0);
      loadShopPricingConfig({ brokerMarkupShare: 1.0 });
      expect(getBrokerMarkupShare()).toBe(1.0);
      loadShopPricingConfig(null);
    });
  });

  describe("color count clamping", () => {
    it("colors=9 (above max) clamps to 8 — does not crash or return 0 rate", () => {
      const li = makeLineItem({
        imprints: [makeImprint({ colors: 9 })],
      });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      expect(r.printCost).toBeGreaterThan(0);
      // 9-color clamped to 8 → uses FIRST_PRINT[8][25]
      expect(r.printCost).toBeCloseTo(FIRST_PRINT[8][25] * 45, 2);
    });

    it("very high color count (50) still clamps to 8", () => {
      const li = makeLineItem({
        imprints: [makeImprint({ colors: 50 })],
      });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      expect(r.printCost).toBeCloseTo(FIRST_PRINT[8][25] * 45, 2);
    });
  });

  describe("special characters in line item data", () => {
    it("apostrophe in brand survives QB description", () => {
      const li = makeLineItem({ brand: "O'Brien's", style: "1717", garmentColor: "Black" });
      const q = makeQuote({ line_items: [li] });
      const payload = buildQBInvoicePayload(q);
      expect(payload.lines[0].description).toContain("O'Brien's");
    });

    it("ampersand in style survives QB description", () => {
      const li = makeLineItem({ brand: "Bella+Canvas", style: "Heavy & Soft", garmentColor: "Black" });
      const q = makeQuote({ line_items: [li] });
      const payload = buildQBInvoicePayload(q);
      expect(payload.lines[0].description).toContain("Heavy & Soft");
    });

    it("multi-byte (unicode) characters survive QB description", () => {
      const li = makeLineItem({ brand: "Café Décor", style: "1717", garmentColor: "Naïve Beige" });
      const q = makeQuote({ line_items: [li] });
      const payload = buildQBInvoicePayload(q);
      expect(payload.lines[0].description).toContain("Café Décor");
      expect(payload.lines[0].description).toContain("Naïve Beige");
    });
  });

  describe("mixed techniques on same line item", () => {
    // The pricing engine uses the first (lowest-color) imprint's technique to
    // decide whether the whole line is screen-print or embroidery. If a shop
    // accidentally mixes them on one line, the math should still produce a
    // number — not crash or return null.
    it("screen print + embroidery imprints on one line item still prices", () => {
      const li = makeLineItem({
        imprints: [
          makeImprint({ id: "s1", technique: "Screen Print", colors: 1, location: "Front" }),
          makeImprint({ id: "e1", technique: "Embroidery", colors: 2, location: "Left Chest" }),
        ],
      });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      expect(r.printCost).toBeGreaterThan(0);
      expect(r.lineTotal).toBeGreaterThan(0);
    });
  });

  describe("many line items in one quote", () => {
    it("5 line items sum correctly", () => {
      const items = Array.from({ length: 5 }, (_, i) =>
        makeLineItem({ id: `li-${i}`, sizes: { M: "10" } })
      );
      const q = makeQuote({ line_items: items });
      const t = calcQuoteTotalsWithLinking(q);
      // Each item: 10 pcs of identical config — totals should sum cleanly
      const singleTotal = calcLinkedLinePrice(items[0], 0, {}, undefined, {}).lineTotal;
      expect(t.subtotal).toBeCloseTo(singleTotal * 5, 1);
    });

    it("10 line items don't crash and produce expected total", () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        makeLineItem({ id: `li-${i}`, sizes: { M: "5" } })
      );
      const q = makeQuote({ line_items: items });
      const t = calcQuoteTotalsWithLinking(q);
      expect(t.total).toBeGreaterThan(0);
      expect(Number.isFinite(t.total)).toBe(true);
    });
  });

  describe("negative quantity", () => {
    // A negative size value shouldn't be possible from the UI, but defensively:
    // parseInt("-5") = -5, and getQty sums them. If total qty drops below 1,
    // calcLinkedLinePrice returns null. Test the boundary.
    it("negative size results in negative qty, but calcLinkedLinePrice returns null when total < 1", () => {
      const li = makeLineItem({ sizes: { S: "-10", M: "5" } });
      const totalQty = getQty(li); // -10 + 5 = -5
      expect(totalQty).toBe(-5);
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).toBeNull();
    });

    it("net-positive qty (even with one negative size) still prices", () => {
      const li = makeLineItem({ sizes: { S: "-5", M: "50" } });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      expect(r.qty).toBe(45);
    });
  });

  describe("rounding consistency", () => {
    it("fractional cent garmentCost rounds consistently per piece", () => {
      // 4.625 is mid-point that bankers' rounding handles differently than
      // standard round. The engine uses Math.round which is half-up.
      const li = makeLineItem({ garmentCost: "4.625" });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      // Should be deterministic — running twice should give same result
      const r2 = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r.gCost).toBe(r2.gCost);
      expect(r.lineTotal).toBe(r2.lineTotal);
    });

    it("very small garmentCost (0.01) doesn't underflow to 0", () => {
      const li = makeLineItem({ garmentCost: "0.01" });
      const r = calcLinkedLinePrice(li, 0, {}, undefined, {});
      expect(r).not.toBeNull();
      // 0.01 × 1.4 = 0.014 → rounds to 0.01 per piece × 45 = 0.45
      expect(r.gCost).toBeGreaterThan(0);
      expect(r.gCost).toBeLessThan(1);
    });
  });
});

// ── Setup Fees (per-screen) ────────────────────────────────────────────────
describe("calcSetupScreenCount", () => {
  it("returns 0 for empty / null input", () => {
    expect(calcSetupScreenCount([])).toBe(0);
    expect(calcSetupScreenCount(null)).toBe(0);
    expect(calcSetupScreenCount(undefined)).toBe(0);
  });

  it("sums colors across a single line item's imprints", () => {
    const li = {
      imprints: [
        { technique: "Screen Print", title: "Front", colors: 4 },
        { technique: "Screen Print", title: "Back", colors: 2 },
      ],
    };
    expect(calcSetupScreenCount([li])).toBe(6);
  });

  it("dedupes imprints sharing the same print-key across line items (linked artwork)", () => {
    // Two line items, both using the same Front imprint (same key) → one
    // set of screens. Plus a distinct Back on one of them.
    const front = { technique: "Screen Print", title: "Front", width: 10, height: 10, colors: 3 };
    const back  = { technique: "Screen Print", title: "Back",  width: 10, height: 10, colors: 1 };
    const li1 = { imprints: [front, back] };
    const li2 = { imprints: [front] };
    expect(calcSetupScreenCount([li1, li2])).toBe(4); // 3 (front) + 1 (back), front not double-counted
  });

  it("ignores embroidery imprints (no screens used)", () => {
    const li = {
      imprints: [
        { technique: "Embroidery", title: "LC", colors: 5 },
        { technique: "Screen Print", title: "Back", colors: 2 },
      ],
    };
    expect(calcSetupScreenCount([li])).toBe(2);
  });

  it("ignores zero-color imprints", () => {
    const li = {
      imprints: [
        { technique: "Screen Print", title: "Front", colors: 0 },
        { technique: "Screen Print", title: "Back", colors: 3 },
      ],
    };
    expect(calcSetupScreenCount([li])).toBe(3);
  });
});

describe("calcSetupFees", () => {
  const lineItems = [{ imprints: [{ technique: "Screen Print", title: "Front", colors: 4 }] }];
  const items = [
    { id: "screens",  label: "Screens",     rate: 25, reorderRate: 5 },
    { id: "film",     label: "Film",        rate: 10, reorderRate: 0 },
  ];

  it("returns disabled shape when config has no items AND enabled is false", () => {
    // True empty config — shop hasn't entered any fees.
    const r = calcSetupFees({ lineItems, config: { enabled: false, items: [] } });
    expect(r).toEqual({ enabled: false, screens: 0, items: [], total: 0 });
  });

  it("returns disabled shape when config is missing entirely", () => {
    const r = calcSetupFees({ lineItems });
    expect(r).toEqual({ enabled: false, screens: 0, items: [], total: 0 });
  });

  it("rescue clause: items configured but enabled=false → treated as enabled", () => {
    // Mirrors the embroidery gate fix. Shop entered fees in the pricing UI
    // but didn't separately toggle the enable flag — fees still apply.
    const r = calcSetupFees({ lineItems, config: { enabled: false, items } });
    expect(r.enabled).toBe(true);
    expect(r.screens).toBe(4);
    expect(r.total).toBe(140);
  });

  it("sums each fee item: screens × rate", () => {
    const r = calcSetupFees({ lineItems, config: { enabled: true, items } });
    expect(r.screens).toBe(4);
    expect(r.items).toEqual([
      { id: "screens", label: "Screens", rate: 25, total: 100 },
      { id: "film",    label: "Film",    rate: 10, total: 40 },
    ]);
    expect(r.total).toBe(140);
  });

  it("honors integer override across all fees", () => {
    const r = calcSetupFees({
      lineItems,
      override: 2,
      config: { enabled: true, items },
    });
    expect(r.screens).toBe(2);
    expect(r.total).toBe(2 * 25 + 2 * 10); // 70
  });

  it("uses each fee's reorderRate when isReorder=true", () => {
    const r = calcSetupFees({
      lineItems,
      isReorder: true,
      config: { enabled: true, items },
    });
    expect(r.items).toEqual([
      { id: "screens", label: "Screens", rate: 5, total: 20 },
      { id: "film",    label: "Film",    rate: 0, total: 0 },
    ]);
    expect(r.total).toBe(20);
  });

  it("skippedFeeIds removes specific fees from the bill", () => {
    const r = calcSetupFees({
      lineItems,
      skippedFeeIds: ["film"],
      config: { enabled: true, items },
    });
    expect(r.items.map((i) => i.id)).toEqual(["screens"]);
    expect(r.total).toBe(100);
  });

  it("treats a 0 override as zero screens (explicit zero is valid)", () => {
    const r = calcSetupFees({
      lineItems,
      override: 0,
      config: { enabled: true, items },
    });
    expect(r.screens).toBe(0);
    expect(r.total).toBe(0);
  });

  it("ignores a non-integer override and falls back to auto-count", () => {
    const r = calcSetupFees({
      lineItems,
      override: "abc",
      config: { enabled: true, items },
    });
    expect(r.screens).toBe(4);
  });

  it("legacy single-rate config still works (perScreenRate without items array)", () => {
    const r = calcSetupFees({
      lineItems,
      config: { enabled: true, perScreenRate: 25, reorderPerScreenRate: 5 },
    });
    expect(r.items).toEqual([
      { id: "screens", label: "Screens", rate: 25, total: 100 },
    ]);
    expect(r.total).toBe(100);
  });

  it("no items and no legacy rate yields zero total without throwing", () => {
    const r = calcSetupFees({ lineItems, config: { enabled: true } });
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
  });
});
