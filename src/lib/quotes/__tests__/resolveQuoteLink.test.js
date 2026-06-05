import { describe, it, expect } from "vitest";
import { resolveQuoteLink, QUOTE_LINK_KIND } from "../resolveQuoteLink.js";

describe("resolveQuoteLink (RQL)", () => {
  const orderA = { id: "ord-uuid-a", order_id: "ORD-100", quote_id: "Q-2026-001" };
  const orderB = { id: "ord-uuid-b", order_id: "ORD-200", quote_id: "Q-2026-002" };
  const orders = [orderA, orderB];

  it("RQL1 — forward link wins when converted_order_id matches", () => {
    const out = resolveQuoteLink(
      { id: "q1", quote_id: "Q-2026-001", converted_order_id: "ORD-100", status: "Converted to Order" },
      orders,
    );
    expect(out.kind).toBe(QUOTE_LINK_KIND.OPEN_ORDER);
    expect(out.order).toBe(orderA);
  });

  it("RQL2 — reverse link picks up legacy quote with no converted_order_id", () => {
    // The Alder Creek pattern: status flipped but converted_order_id never set.
    const out = resolveQuoteLink(
      { id: "q1", quote_id: "Q-2026-002", status: "Converted to Order" },
      orders,
    );
    expect(out.kind).toBe(QUOTE_LINK_KIND.OPEN_ORDER);
    expect(out.order).toBe(orderB);
  });

  it("RQL3 — converted but order not in memory → NAVIGATE_ORDERS (NOT /Quotes)", () => {
    // /Quotes filters out Converted rows, so navigating there would
    // surface "where did it go?". /Orders is the right destination.
    const out = resolveQuoteLink(
      { id: "q1", quote_id: "Q-2026-999", converted_order_id: "ORD-999", status: "Converted to Order" },
      orders,
    );
    expect(out.kind).toBe(QUOTE_LINK_KIND.NAVIGATE_ORDERS);
  });

  it("RQL4 — converted_order_id set but ORDER row missing → still NAVIGATE_ORDERS", () => {
    const out = resolveQuoteLink(
      { id: "q1", quote_id: "Q-2026-999", converted_order_id: "ORD-MISSING" },
      orders,
    );
    expect(out.kind).toBe(QUOTE_LINK_KIND.NAVIGATE_ORDERS);
  });

  it("RQL5 — truly unconverted quote → NAVIGATE_QUOTE with the quote id", () => {
    const out = resolveQuoteLink(
      { id: "q-uuid-5", quote_id: "Q-2026-500", status: "Sent" },
      orders,
    );
    expect(out.kind).toBe(QUOTE_LINK_KIND.NAVIGATE_QUOTE);
    expect(out.quoteId).toBe("q-uuid-5");
  });

  it("RQL6 — Draft quote → NAVIGATE_QUOTE", () => {
    const out = resolveQuoteLink({ id: "q-d", quote_id: "Q-D", status: "Draft" }, orders);
    expect(out.kind).toBe(QUOTE_LINK_KIND.NAVIGATE_QUOTE);
  });

  it("RQL7 — empty/null orders array doesn't crash", () => {
    expect(resolveQuoteLink({ id: "q", quote_id: "Q", status: "Sent" }, null).kind)
      .toBe(QUOTE_LINK_KIND.NAVIGATE_QUOTE);
    expect(resolveQuoteLink({ id: "q", quote_id: "Q", status: "Sent" }, undefined).kind)
      .toBe(QUOTE_LINK_KIND.NAVIGATE_QUOTE);
  });

  it("RQL8 — null quote → NAVIGATE_QUOTE with undefined id (safe degenerate)", () => {
    const out = resolveQuoteLink(null, orders);
    expect(out.kind).toBe(QUOTE_LINK_KIND.NAVIGATE_QUOTE);
    expect(out.quoteId).toBeUndefined();
  });

  it("RQL9 — forward link takes precedence over reverse when both match", () => {
    // Defense in depth — if both pointers resolve, trust the forward
    // (explicit) one.
    const out = resolveQuoteLink(
      { id: "q1", quote_id: "Q-2026-001", converted_order_id: "ORD-200" },
      orders,
    );
    expect(out.order).toBe(orderB);
  });
});
