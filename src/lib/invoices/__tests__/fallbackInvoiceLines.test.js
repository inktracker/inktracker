import { describe, it, expect } from "vitest";
import { buildFallbackInvoiceLines } from "../fallbackInvoiceLines";

describe("buildFallbackInvoiceLines", () => {
  // The exact Cold Stream Design invoice that doubled to $630 in QuickBooks.
  const coldStream = {
    subtotal: 315, total: 315,
    line_items: [
      { id: "qb-1", qty: 25, sizes: {}, style: "Comfort Colors 1717 Blue Spruce | S:3, M:7 | Front", lineTotal: 375 },
      { id: "qb-3", qty: 1, sizes: {}, style: "bottle openers!", lineTotal: -60 },
    ],
  };

  it("reads lineTotal per line (does NOT stamp the invoice total on every line)", () => {
    const lines = buildFallbackInvoiceLines(coldStream.line_items, coldStream);
    expect(lines).toHaveLength(2);
    expect(lines[0].amount).toBe(375);
    expect(lines[1].amount).toBe(-60);
    // The regression: both were 315 → sum 630. Guard the sum stays right.
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(315);
  });

  it("keeps the negative discount/credit line (was dropped by amount>0 filter)", () => {
    const lines = buildFallbackInvoiceLines(coldStream.line_items, coldStream);
    expect(lines.some((l) => l.amount === -60)).toBe(true);
  });

  it("computes unitPrice per line from its own amount and qty", () => {
    const lines = buildFallbackInvoiceLines(coldStream.line_items, coldStream);
    expect(lines[0].unitPrice).toBe(15);   // 375 / 25
    expect(lines[1].unitPrice).toBe(-60);  // -60 / 1
  });

  it("falls back to total/amount fields, then subtotal only when no per-line value", () => {
    const items = [
      { qty: 2, total: 100 },                 // uses total
      { qty: 1, amount: 40 },                 // uses amount
      { qty: 1, style: "no value anywhere" }, // → subtotal fallback
    ];
    const lines = buildFallbackInvoiceLines(items, { subtotal: 500, total: 500 });
    expect(lines[0].amount).toBe(100);
    expect(lines[1].amount).toBe(40);
    expect(lines[2].amount).toBe(500);
  });

  it("prefers lineTotal over total/amount when several are present", () => {
    const lines = buildFallbackInvoiceLines([{ qty: 1, lineTotal: 12, total: 999, amount: 888 }], { subtotal: 0 });
    expect(lines[0].amount).toBe(12);
  });

  it("drops truly-zero lines but not negative ones", () => {
    const lines = buildFallbackInvoiceLines(
      [{ qty: 1, lineTotal: 0 }, { qty: 1, lineTotal: -25 }, { qty: 1, lineTotal: 50 }],
      { subtotal: 25 },
    );
    expect(lines.map((l) => l.amount)).toEqual([-25, 50]);
  });

  it("empty line items → a single invoice-total line", () => {
    const lines = buildFallbackInvoiceLines([], { subtotal: 200, total: 200 });
    expect(lines).toEqual([
      { description: "Invoice", qty: 1, unitPrice: 200, amount: 200, itemName: "Screen Print" },
    ]);
  });

  it("tolerates junk input", () => {
    expect(buildFallbackInvoiceLines(null, {})).toEqual([
      { description: "Invoice", qty: 1, unitPrice: 0, amount: 0, itemName: "Screen Print" },
    ]);
  });
});
