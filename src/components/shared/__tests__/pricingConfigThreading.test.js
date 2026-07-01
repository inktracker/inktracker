// CACHE-01 structural guard (Tier 3.2).
//
// The pricing compute path (`calcQuoteTotalsWithLinking` / `calcQuoteTotals` /
// `calcLinkedLinePrice` / `buildQBInvoicePayload`) accepts an explicit
// `configOverride` that threads a shop's pricing_config all the way down,
// defaulting to the module global `_pc` for every existing caller.
//
// This test proves the property that makes config "bleed" STRUCTURALLY
// IMPOSSIBLE, not merely detected: when a caller threads config A while the
// module global is loaded for a DIFFERENT shop B, the result is identical to
// pricing with A loaded globally — and NOT equal to pricing under B. i.e. the
// threaded config wins over whatever the global happens to hold, so a
// multi-shop surface (broker dashboard) can never leak shop B's rates into a
// shop A quote once it threads config.
//
// It also pins back-compat: with nothing threaded, results equal the global.

import { describe, it, expect, beforeEach } from "vitest";
import {
  calcQuoteTotalsWithLinking,
  calcLinkedLinePrice,
  buildLinkedQtyMap,
  buildQBInvoicePayload,
  getMarkup,
  loadShopPricingConfig,
  STANDARD_MARKUP,
} from "../pricing.jsx";

// Two configs whose only meaningful difference is the garment markup table, so
// the same quote produces DIFFERENT totals under each — an unambiguous probe
// for "which config actually priced this line."
const CONFIG_A = { garmentMarkup: [{ above: 0, markup: 2.0 }] }; // cost × 2.0
const CONFIG_B = { garmentMarkup: [{ above: 0, markup: 1.1 }] }; // cost × 1.1

function makeQuote() {
  return {
    shop_owner: "a@shop.com",
    rush_rate: 0,
    line_items: [
      {
        id: "li",
        style: "1717",
        garmentCost: "10.00",
        garmentColor: "Black",
        sizes: { M: "50" },
        imprints: [
          { id: "imp", colors: 1, technique: "Screen Print", location: "Front" },
        ],
      },
    ],
  };
}

beforeEach(() => {
  loadShopPricingConfig(null);
});

describe("getMarkup config threading", () => {
  it("honors threaded config over the loaded global", () => {
    loadShopPricingConfig(CONFIG_B, "b@shop.com"); // wrong shop loaded
    expect(getMarkup(10, false, CONFIG_A)).toBe(2.0); // A wins
    expect(getMarkup(10, false, CONFIG_B)).toBe(1.1);
    expect(getMarkup(10, false)).toBe(1.1); // back-compat: falls back to global (B)
  });
});

describe("calcQuoteTotalsWithLinking — bleed is structurally impossible", () => {
  it("threaded config wins over a foreign global, matching global-A pricing", () => {
    const quote = makeQuote();

    loadShopPricingConfig(CONFIG_B, "b@shop.com"); // the WRONG config is loaded
    const threaded = calcQuoteTotalsWithLinking(quote, STANDARD_MARKUP, CONFIG_A);
    const underGlobalB = calcQuoteTotalsWithLinking(quote, STANDARD_MARKUP); // uses B

    loadShopPricingConfig(CONFIG_A, "a@shop.com");
    const underGlobalA = calcQuoteTotalsWithLinking(quote, STANDARD_MARKUP); // uses A

    // Threading A produces A's numbers even though B was loaded when we called.
    expect(threaded.total).toBeCloseTo(underGlobalA.total, 2);
    // And it is genuinely different from what the loaded global B would give —
    // proving the config was actually consumed, not a coincidental match.
    expect(threaded.total).not.toBeCloseTo(underGlobalB.total, 2);
    expect(threaded.total).toBeGreaterThan(underGlobalB.total); // 2.0× > 1.1×
  });

  it("a threaded result is invariant to whatever global is loaded", () => {
    const quote = makeQuote();

    loadShopPricingConfig(CONFIG_A, "a@shop.com");
    const t1 = calcQuoteTotalsWithLinking(quote, STANDARD_MARKUP, CONFIG_A);
    loadShopPricingConfig(CONFIG_B, "b@shop.com");
    const t2 = calcQuoteTotalsWithLinking(quote, STANDARD_MARKUP, CONFIG_A);
    loadShopPricingConfig(null);
    const t3 = calcQuoteTotalsWithLinking(quote, STANDARD_MARKUP, CONFIG_A);

    expect(t1.total).toBeCloseTo(t2.total, 2);
    expect(t2.total).toBeCloseTo(t3.total, 2);
  });

  it("back-compat: no override reproduces the loaded global exactly", () => {
    const quote = makeQuote();
    loadShopPricingConfig(CONFIG_A, "a@shop.com");
    const viaGlobal = calcQuoteTotalsWithLinking(quote, STANDARD_MARKUP);
    const viaOverride = calcQuoteTotalsWithLinking(quote, STANDARD_MARKUP, CONFIG_A);
    expect(viaGlobal.total).toBeCloseTo(viaOverride.total, 2);
  });
});

describe("calcLinkedLinePrice — threaded config wins over global", () => {
  it("prices the line under the threaded config, not the loaded one", () => {
    const quote = makeQuote();
    const li = quote.line_items[0];
    const map = buildLinkedQtyMap(quote.line_items);

    loadShopPricingConfig(CONFIG_B, "b@shop.com");
    const threaded = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, map, undefined, CONFIG_A);
    const globalB = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, map);

    loadShopPricingConfig(CONFIG_A, "a@shop.com");
    const globalA = calcLinkedLinePrice(li, 0, {}, STANDARD_MARKUP, map);

    expect(threaded.gCost).toBeCloseTo(globalA.gCost, 2);
    expect(threaded.gCost).not.toBeCloseTo(globalB.gCost, 2);
  });
});

describe("buildQBInvoicePayload — threaded config wins over global", () => {
  const sumLineAmounts = (payload) =>
    (payload.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);

  it("builds the QB payload under the threaded config, not the loaded one", () => {
    const quote = makeQuote(); // no saved total → live calc path

    loadShopPricingConfig(CONFIG_B, "b@shop.com");
    const threaded = buildQBInvoicePayload(quote, STANDARD_MARKUP, CONFIG_A);

    loadShopPricingConfig(CONFIG_A, "a@shop.com");
    const globalA = buildQBInvoicePayload(quote, STANDARD_MARKUP);

    loadShopPricingConfig(CONFIG_B, "b@shop.com");
    const globalB = buildQBInvoicePayload(quote, STANDARD_MARKUP);

    expect(sumLineAmounts(threaded)).toBeCloseTo(sumLineAmounts(globalA), 2);
    expect(sumLineAmounts(threaded)).not.toBeCloseTo(sumLineAmounts(globalB), 2);
  });
});
