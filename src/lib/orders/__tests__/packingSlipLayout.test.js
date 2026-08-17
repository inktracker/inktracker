import { describe, it, expect } from "vitest";
import {
  SLIP_SIZES,
  slipSize,
  buildSlipLines,
  slipGrandTotal,
  lineHeight,
  paginateSlipLines,
} from "../packingSlipLayout";

const order = {
  order_id: "ORD-2026-YDYOP",
  line_items: [
    { style: "AS Colour 5026", garmentColor: "NAVY", productName: "Staple Tee", sizes: { M: 17, L: 23, XL: 5 } },
    { style: "AS Colour 5071", garmentColor: "NAVY", productName: "Relax Tee", sizes: { M: 3, L: 9, XL: 3 } },
    // Zero-qty line: never prints.
    { style: "Ghost", garmentColor: "Black", sizes: { M: 0 } },
  ],
};

describe("slipSize", () => {
  it("knows both sizes and falls back to letter", () => {
    expect(slipSize("4x6").format).toEqual([101.6, 152.4]);
    expect(slipSize("letter").format).toBe("letter");
    expect(slipSize("nonsense").id).toBe("letter");
    expect(slipSize(undefined).id).toBe("letter");
  });
  it("4x6 drops the logo and notes; letter keeps them", () => {
    expect(SLIP_SIZES["4x6"].showLogo).toBe(false);
    expect(SLIP_SIZES["4x6"].showNotes).toBe(false);
    expect(SLIP_SIZES.letter.showLogo).toBe(true);
    expect(SLIP_SIZES.letter.showNotes).toBe(true);
  });
});

describe("buildSlipLines", () => {
  it("builds printable rows and drops zero-qty lines", () => {
    const lines = buildSlipLines(order, null);
    expect(lines).toHaveLength(2);
    expect(lines[0].title).toBe("AS Colour 5026 — NAVY");
    expect(lines[0].sub).toBe("Staple Tee");
    expect(lines[0].total).toBe(45);
    expect(slipGrandTotal(lines)).toBe(45 + 15);
  });
  it("confirmed counts win over ordered, and added sizes appear", () => {
    const lines = buildSlipLines(order, { 0: { M: 10, L: 23, XL: 5, "2XL": 2 } });
    expect(lines[0].total).toBe(40);
    expect(lines[0].sizes.map((s) => s.size)).toContain("2XL");
  });
  it("suppresses a sub-line that merely repeats the title", () => {
    const [line] = buildSlipLines(
      { line_items: [{ style: "Tee", productName: "Tee", sizes: { M: 1 } }] }, null);
    expect(line.title).toBe("Tee");
    expect(line.sub).toBe("");
  });
  it("survives an order with no line items", () => {
    expect(buildSlipLines({}, null)).toEqual([]);
    expect(slipGrandTotal([])).toBe(0);
  });
});

describe("paginateSlipLines", () => {
  const cfg = SLIP_SIZES["4x6"];
  it("keeps a short order on one label", () => {
    const pages = paginateSlipLines(buildSlipLines(order, null), cfg, 100);
    expect(pages).toHaveLength(1);
  });
  it("splits when lines exceed the label's body height", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      style: `Style ${i}`, garmentColor: "Navy", productName: "Tee", sizes: { M: 2 },
    }));
    const lines = buildSlipLines({ line_items: many }, null);
    const usable = 100;
    const pages = paginateSlipLines(lines, cfg, usable);
    expect(pages.length).toBeGreaterThan(1);
    // No page may overflow the body budget — that was the whole point.
    for (const page of pages) {
      const used = page.reduce((sum, l) => sum + lineHeight(l, cfg), 0);
      expect(used).toBeLessThanOrEqual(usable);
    }
    // Every line printed exactly once.
    expect(pages.flat()).toHaveLength(lines.length);
  });
  it("always returns at least one page, even with nothing to print", () => {
    expect(paginateSlipLines([], cfg, 100)).toEqual([[]]);
  });
  it("a single oversized line still gets its own page rather than vanishing", () => {
    const lines = buildSlipLines({ line_items: [{ style: "Big", productName: "Sub", sizes: { M: 1 } }] }, null);
    const pages = paginateSlipLines(lines, cfg, 1);
    expect(pages.flat()).toHaveLength(1);
  });
});
