import { describe, it, expect, vi } from "vitest";

// Control garment cost deterministically — this is the exact seam the
// "wizard drops the blank cost" bug lives on.
vi.mock("@/lib/wizard/getEffectiveCost", () => ({
  getEffectiveCost: (g) => (g && typeof g._testCost === "number" ? g._testCost : 0),
}));

import { buildWizardQuote, getWizardValidationIssues } from "../wizardQuote";

function garment(over = {}) {
  return {
    id: over.id || "g1",
    // "in" checks so an explicit `style: null` / `color: ""` is respected
    // (the ?? operator would swap them back to the defaults).
    style: "style" in over ? over.style : { name: "Staple Tee", brand: "AS Colour", styleNumber: "5001", garment: "T-Shirts" },
    color: "color" in over ? over.color : "Black",
    sizes: over.sizes ?? { M: "20", L: "10" },
    _testCost: over._testCost ?? 4.62,
  };
}

describe("buildWizardQuote", () => {
  const base = {
    imprints: [{ id: "p1", location: "Front", colors: 2, technique: "Screen Print" }],
    artFiles: {},
    contact: { name: "Joe", email: "joe@x.com", phone: "555", company: "Biota", notes: "n", dueDate: "", taxExempt: false, taxId: "" },
    rush: false,
    shopOwner: "shop@x.com",
    botHoneypot: "",
    wizardOpenedAt: Date.now() - 10000,
  };

  it("maps garmentCost straight from getEffectiveCost onto each line item", () => {
    const { quote } = buildWizardQuote({ ...base, garments: [garment({ _testCost: 7.25 })] });
    expect(quote.line_items).toHaveLength(1);
    expect(quote.line_items[0].garmentCost).toBe(7.25); // the bug-class assertion
    expect(quote.line_items[0].garmentColor).toBe("Black");
    expect(quote.line_items[0].category).toBe("T-Shirts");
  });

  it("only includes garments that have both a style and a color", () => {
    const { quote, validGarments } = buildWizardQuote({
      ...base,
      garments: [garment({ id: "a" }), garment({ id: "b", color: "" }), garment({ id: "c", style: null })],
    });
    expect(validGarments.map((g) => g.id)).toEqual(["a"]);
    expect(quote.line_items).toHaveLength(1);
  });

  it("carries customer + status fields and defaults tax/discount/deposit", () => {
    const { quote } = buildWizardQuote({ ...base, garments: [garment()] });
    expect(quote.status).toBe("Pending");
    expect(quote.shop_owner).toBe("shop@x.com");
    expect(quote.customer_email).toBe("joe@x.com");
    expect(quote.discount).toBe(0);
    expect(quote.tax_rate).toBe(0);
    expect(quote.deposit_pct).toBe(0);
    expect(quote.rush_rate).toBe(0); // rush:false
  });

  it("run-level imprints become linked on every line and collect artwork", () => {
    const { quote } = buildWizardQuote({
      ...base,
      garments: [garment()],
      artFiles: { 0: { url: "http://a/art.png", name: "art.png" } },
    });
    expect(quote.line_items[0].imprints[0].linked).toBe(true);
    expect(quote.line_items[0].imprints[0].artwork_url).toBe("http://a/art.png");
    expect(quote.selected_artwork).toEqual([{ id: "http://a/art.png", name: "art.png", url: "http://a/art.png" }]);
  });

  it("threads the honeypot + dwell metadata for the server anti-bot check", () => {
    const { quote } = buildWizardQuote({ ...base, garments: [garment()], botHoneypot: "gotcha" });
    expect(quote._bot_honeypot).toBe("gotcha");
    expect(typeof quote._bot_dwell_ms).toBe("number");
    expect(quote._bot_dwell_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("getWizardValidationIssues", () => {
  it("flags a missing style, then a missing color", () => {
    expect(getWizardValidationIssues([garment({ style: null })])).toContain("Select a garment style");
    expect(getWizardValidationIssues([garment({ color: "" })])).toContain("Choose a garment color");
  });

  it("flags too-few pieces below the minimum order qty", () => {
    const issues = getWizardValidationIssues([garment({ sizes: { M: "1" } })]);
    expect(issues.some((i) => /Minimum \d+ pieces/.test(i))).toBe(true);
  });

  it("fail-closed: an unpriceable garment (cost 0) blocks with a contact-us message", () => {
    const issues = getWizardValidationIssues([garment({ _testCost: 0, sizes: { M: "50" } })]);
    expect(issues.some((i) => /Live pricing isn't available/.test(i))).toBe(true);
  });

  it("no issues for a valid, priceable, sufficient-qty garment", () => {
    expect(getWizardValidationIssues([garment({ _testCost: 4.62, sizes: { M: "50" } })])).toEqual([]);
  });
});
