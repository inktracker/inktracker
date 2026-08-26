// AI quote-draft logic. The model calls are I/O; everything here is the
// decision layer that turns model output into editor-safe structure.
//
// The predecessor (emailScanner parseOnly) shipped hidden because its
// output couldn't be trusted. These tests pin the v2 contract: malformed
// model output degrades to null or gets clamped — it can never crash the
// handler or smuggle un-validated shapes to the client.

import { describe, it, expect } from "vitest";
import {
  buildExtractionPrompt, buildDraftPrompt,
  coerceExtraction, coerceDraft,
  summarizeHistory, sizeCurve, shapeCandidates,
  EXTRACTION_TOOL, DRAFT_TOOL,
} from "../quoteDraftLogic.js";

describe("prompts", () => {
  it("extraction prompt carries the raw message and anti-invention rules", () => {
    const p = buildExtractionPrompt("15 Medium (Dry-Fit)\n15 Large (Dry-Fit)");
    expect(p).toContain("15 Medium (Dry-Fit)");
    expect(p).toContain("Do NOT invent");
  });

  // 2026-08-26, Joe's first local test: his OWN outbound offer ("here's the
  // shirt, $15/pc" + an S&S link) was refused as "not a quote request".
  // Both directions of the conversation must be draftable, product URLs
  // must be mined, and stated prices must be captured — but only as text.
  it("extraction prompt accepts shop-side offers, mines URLs, and captures stated prices", () => {
    const p = buildExtractionPrompt("Here is a link to that shirt — $15pc. https://ssactivewear.com/p/lane_seven/ls16005");
    expect(p).toContain("FROM the shop");
    expect(p).toContain("MINE PRODUCT URLS");
    expect(p).toContain("STATED PRICE");
    expect(p).toContain("no quantity is STILL an item");
  });

  it("draft prompt forbids baking a stated price into the numbers", () => {
    const d = buildDraftPrompt({ extraction: { items: [] }, historyText: "", todayISO: "2026-08-26", shopPriorsText: "" });
    expect(d).toContain("STATED PRICE");
    expect(d).toContain("NOT bake");
  });

  it("draft prompt forbids pricing decisions and resolves dates against TODAY", () => {
    const p = buildDraftPrompt({
      extraction: { items: [] }, historyText: "", todayISO: "2026-08-26", shopPriorsText: "",
    });
    expect(p).toContain("NEVER invent");
    expect(p).toContain("2026-08-26");
    // no history → the cold-request stance, not silence
    expect(p).toContain("new customer");
  });

  it("draft prompt injects history when present", () => {
    const p = buildDraftPrompt({
      extraction: { items: [] }, historyText: "ORDER ORD-1 …", todayISO: "2026-08-26", shopPriorsText: "- Gildan 5000 ×4",
    });
    expect(p).toContain("ORDER ORD-1");
    expect(p).toContain("Gildan 5000");
  });

  it("tool schemas force the fields the pipeline depends on", () => {
    expect(EXTRACTION_TOOL.input_schema.required).toContain("items");
    expect(DRAFT_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(["line_items", "assumptions", "blanks"]),
    );
  });
});

describe("coerceExtraction", () => {
  it("keeps a well-formed extraction", () => {
    const e = coerceExtraction({
      is_quote_request: true, customer_name: "Dayana", company: "Orea Roofing",
      customer_email: "CAMILAG218@YAHOO.COM", references_past_order: true,
      deadline_text: "", print_text: "remove the license number from the back",
      items: [{ description: "Dry-Fit", style_number: "", color: "", quantity_text: "15 M, 15 L, 10 XL" }],
    });
    expect(e.customer_email).toBe("camilag218@yahoo.com"); // normalized
    expect(e.references_past_order).toBe(true);
    expect(e.items).toHaveLength(1);
  });

  it("drops junk items and returns null on garbage", () => {
    expect(coerceExtraction(null)).toBeNull();
    expect(coerceExtraction("nope")).toBeNull();
    const e = coerceExtraction({ items: [{ description: "", style_number: "" }, 42, null] });
    expect(e.items).toHaveLength(0);
  });
});

describe("coerceDraft", () => {
  const goodLine = {
    style_number: "TT41", brand: "Team 365", style_name: "Zone Hooded T",
    garment_color: "Sport Silver", sizes: { M: 15, L: 15, XL: 10 }, total_qty: 0,
    catalog_search: "", imprints: [{ location: "Left Chest", title: "Logo", colors: 1 }],
  };

  it("keeps a well-formed draft", () => {
    const d = coerceDraft({ job_title: "Reorder", line_items: [goodLine], assumptions: ["a"], blanks: [] });
    expect(d.line_items[0].sizes).toEqual({ M: 15, L: 15, XL: 10 });
    expect(d.line_items[0].imprints[0].colors).toBe(1);
  });

  it("clamps ink colors into 1..8 — color count IS the price", () => {
    const d = coerceDraft({
      line_items: [{ ...goodLine, imprints: [{ location: "Front", title: "x", colors: 45 }, { location: "Back", title: "y", colors: 0 }] }],
      assumptions: [], blanks: [],
    });
    expect(d.line_items[0].imprints.map((i) => i.colors)).toEqual([8, 1]);
  });

  it("drops negative/garbage size quantities", () => {
    const d = coerceDraft({
      line_items: [{ ...goodLine, sizes: { M: -3, L: "12", XL: "nope", HUGE_SIZE_KEY: 5 } }],
      assumptions: [], blanks: [],
    });
    expect(d.line_items[0].sizes).toEqual({ L: 12 });
  });

  it("rejects a lineless draft outright (null → handler re-asks or errors)", () => {
    expect(coerceDraft({ line_items: [], assumptions: [], blanks: [] })).toBeNull();
    expect(coerceDraft({ line_items: [{ style_number: "", catalog_search: "", style_name: "" }], assumptions: [], blanks: [] })).toBeNull();
  });

  it("rejects a non-ISO due date instead of passing model prose through", () => {
    const d = coerceDraft({ line_items: [goodLine], due_date: "sometime mid-September", assumptions: [], blanks: [] });
    expect(d.due_date).toBe("");
  });
});

describe("summarizeHistory", () => {
  it("compresses orders to style/color/sizes/prints — the fields nicknames resolve against", () => {
    const t = summarizeHistory([{
      order_id: "ORD-2026-JWN39", completed_date: "2026-08-24",
      line_items: [{
        brand: "Team 365", style: "TT41", styleName: "Zone Hooded T", garmentColor: "Sport Silver",
        sizes: { M: 2, L: 5 },
        imprints: [{ location: "Back", title: "Orea Roofing With License", colors: 1, pantones: "Black Ink" }],
      }],
    }]);
    expect(t).toContain("ORD-2026-JWN39");
    expect(t).toContain("TT41");
    expect(t).toContain("Sport Silver");
    expect(t).toContain("Orea Roofing With License");
  });

  it("returns empty for no history (cold request)", () => {
    expect(summarizeHistory([])).toBe("");
    expect(summarizeHistory(null)).toBe("");
  });
});

describe("sizeCurve", () => {
  it("sums exactly to the requested total", () => {
    for (const n of [1, 4, 12, 24, 50, 73, 100, 144]) {
      const c = sizeCurve(n);
      expect(Object.values(c).reduce((s, v) => s + v, 0)).toBe(n);
    }
  });

  it("puts the bulk in M/L like a real crew order", () => {
    const c = sizeCurve(50);
    expect(c.L).toBeGreaterThanOrEqual(c.S);
    expect(c.M).toBeGreaterThanOrEqual(c.S);
  });

  it("handles zero/garbage", () => {
    expect(sizeCurve(0)).toEqual({});
    expect(sizeCurve("x")).toEqual({});
  });
});

describe("shapeCandidates", () => {
  const results = [
    { styleNumber: "18500", brandName: "Gildan", styleName: "Heavy Blend Hoodie",
      colors: [
        { colorName: "Sport Grey", piecePrice: 9.12, sizeQuantities: { M: 100 } },
        { colorName: "Black", piecePrice: 8.9, sizeQuantities: { M: 500 } },
      ] },
    { styleNumber: "SS4500", brandName: "Independent", styleName: "Midweight Hoodie",
      colors: [{ colorName: "Black", piecePrice: 13.2, sizeQuantities: { M: 40 } }] },
    { styleNumber: "NOSTOCK", brandName: "X", styleName: "Ghost",
      colors: [{ colorName: "Black", piecePrice: 5, sizeQuantities: { M: 0 } }] },
    { styleNumber: "", brandName: "Bad", colors: [] },
  ];

  it("leads with the cheapest in-stock color and caps at 3", () => {
    const c = shapeCandidates(results);
    expect(c[0]).toMatchObject({ style_number: "18500", from_price: 8.9, example_color: "Black" });
    expect(c.length).toBeLessThanOrEqual(3);
  });

  it("keeps a style with no priced stock but nulls its price (shop still may want it)", () => {
    const c = shapeCandidates(results);
    const ghost = c.find((x) => x.style_number === "NOSTOCK");
    expect(ghost.from_price).toBeNull();
  });

  it("drops styleless rows and survives garbage input", () => {
    expect(shapeCandidates(null)).toEqual([]);
    expect(shapeCandidates(results).every((c) => c.style_number)).toBe(true);
  });
});
