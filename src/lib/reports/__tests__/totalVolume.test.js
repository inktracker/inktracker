import { describe, it, expect } from "vitest";
import { computeTotalVolume, isQbOnlyInvoice, invoiceVolumeUnits, orderVolumeUnits } from "../totalVolume.js";

const qbLine = (qty, style = "AS Colour 5050") => ({ id: `qb-${qty}`, qty, sizes: {}, style });
const prodLine = (sizes) => ({ id: "li-1", sizes });

describe("isQbOnlyInvoice (dedup — the three birth paths)", () => {
  const liveOrderIds = new Set(["ORD-1"]);
  const quotesByQuoteId = new Map([["Q-77", { quote_id: "Q-77", converted_order_id: "ORD-2" }]]);

  it("QB-import invoice (no linkage) → QB-only", () => {
    expect(isQbOnlyInvoice({ invoice_id: "1428", order_id: null }, { liveOrderIds, quotesByQuoteId })).toBe(true);
  });

  it("Add-to-Production invoice (order_id → live order) → counted via order", () => {
    expect(isQbOnlyInvoice({ invoice_id: "1428", order_id: "ORD-1" }, { liveOrderIds, quotesByQuoteId })).toBe(false);
  });

  it("quote-born invoice (order_id null, quote converted) → counted via order, NOT double", () => {
    expect(isQbOnlyInvoice({ invoice_id: "Q-77", order_id: null }, { liveOrderIds, quotesByQuoteId })).toBe(false);
  });

  it("dangling order_id (order deleted) falls back to QB-only", () => {
    expect(isQbOnlyInvoice({ invoice_id: "1428", order_id: "ORD-GONE" }, { liveOrderIds, quotesByQuoteId })).toBe(true);
  });
});

describe("line units + fee exclusion", () => {
  it("invoice lines: fee-ish styles excluded, garments counted via qty fallback", () => {
    const inv = { line_items: [qbLine(2675), qbLine(1, "Estimated Shipping"), qbLine(1, "Setup Fee")] };
    expect(invoiceVolumeUnits(inv)).toBe(2675);
  });

  it("order lines: exclusion ONLY for qb- inherited lines; production lines never excluded", () => {
    const order = { line_items: [prodLine({ S: "10", M: "5" }), { id: "li-2", sizes: { OS: "3" }, style: "Rush Tee" }, qbLine(1, "Estimated Shipping")] };
    // "Rush Tee" is a production line — style regex must NOT apply to it.
    expect(orderVolumeUnits(order)).toBe(18);
  });
});

describe("computeTotalVolume", () => {
  const orders = [
    { order_id: "ORD-1", status: "Completed", completed_date: "2026-07-10", line_items: [prodLine({ S: "40" })] },
    { order_id: "ORD-2", status: "Completed", completed_date: "2026-07-11", line_items: [prodLine({ M: "60" })] },
    { order_id: "ORD-3", status: "Printing", completed_date: null, line_items: [prodLine({ M: "999" })] }, // active — never counted
    { order_id: "ORD-4", status: "Completed", completed_date: "2026-06-01", line_items: [prodLine({ L: "7" })] }, // out of range
  ];
  const invoices = [
    { invoice_id: "1428", order_id: null, date: "2026-07-05", line_items: [qbLine(2675), qbLine(1, "Estimated Shipping")] },
    { invoice_id: "Q-77", order_id: null, date: "2026-07-11", line_items: [qbLine(60)] },      // quote-born → dedup
    { invoice_id: "INV-9", order_id: "ORD-1", date: "2026-07-10", line_items: [qbLine(40)] },  // order-linked → dedup
    { invoice_id: "1500", order_id: null, date: "2026-05-01", line_items: [qbLine(500)] },     // out of range
  ];
  const quotes = [{ quote_id: "Q-77", converted_order_id: "ORD-2" }];

  it("unions completed orders + QB-only invoices with no double count", () => {
    const r = computeTotalVolume({ orders, invoices, quotes, from: "2026-07-01", to: "2026-07-31" });
    expect(r).toEqual({ units: 40 + 60 + 2675, orderCount: 2, invoiceCount: 1 });
  });

  it("open range counts everything", () => {
    const r = computeTotalVolume({ orders, invoices, quotes, from: null, to: null });
    expect(r.orderCount).toBe(3);
    expect(r.invoiceCount).toBe(2);
    expect(r.units).toBe(40 + 60 + 7 + 2675 + 500);
  });

  it("bridging an invoice moves buckets without changing the total", () => {
    const before = computeTotalVolume({ orders, invoices, quotes, from: "2026-07-01", to: "2026-07-31" });
    // Simulate Add to Production on 1428: order created+completed, backlink written.
    const bridgedOrders = [...orders, { order_id: "ORD-5", status: "Completed", completed_date: "2026-07-12", line_items: invoices[0].line_items }];
    const bridgedInvoices = invoices.map((i) => (i.invoice_id === "1428" ? { ...i, order_id: "ORD-5" } : i));
    const after = computeTotalVolume({ orders: bridgedOrders, invoices: bridgedInvoices, quotes, from: "2026-07-01", to: "2026-07-31" });
    expect(after.units).toBe(before.units);
    expect(after.orderCount).toBe(before.orderCount + 1);
    expect(after.invoiceCount).toBe(before.invoiceCount - 1);
  });

  it("empty inputs → zeros", () => {
    expect(computeTotalVolume({})).toEqual({ units: 0, orderCount: 0, invoiceCount: 0 });
  });
});
