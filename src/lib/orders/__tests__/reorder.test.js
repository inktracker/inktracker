import { describe, it, expect } from "vitest";
import { newReorderQuoteId, buildReorderQuotePayload } from "../reorder";

describe("newReorderQuoteId", () => {
  it("matches the Q-YYYY-XXXX shape", () => {
    const id = newReorderQuoteId(new Date(2026, 8, 18, 12, 0, 0));
    expect(id).toMatch(/^Q-2026-[0-9A-Z]{1,4}$/);
  });
  it("uses the given date's local year", () => {
    // Local-constructed (not UTC) so the assertion doesn't flip across tz.
    expect(newReorderQuoteId(new Date(2030, 5, 15, 12, 0, 0))).toMatch(/^Q-2030-/);
  });
});

describe("buildReorderQuotePayload", () => {
  const order = {
    shop_owner: "joe@biotamfg.co",
    customer_id: "cust-1",
    customer_name: "New York Panda",
    job_title: "Spring Tee Run",
    notes: "Front logo only",
    rush_rate: 15,
    extras: { foldBag: true },
    line_items: [{ style: "5000", imprints: [{ title: "Front" }] }],
    discount: 10,
    discount_type: "percent",
    tax_rate: 8.25,
    deposit_pct: 25,
  };
  const p = buildReorderQuotePayload(order, { quoteId: "Q-2026-ABCD", today: "2026-09-18" });

  it("is a fresh Draft: new id, Draft status, unpaid, no due date", () => {
    expect(p.quote_id).toBe("Q-2026-ABCD");
    expect(p.status).toBe("Draft");
    expect(p.deposit_paid).toBe(false);
    expect(p.due_date).toBeNull();
    expect(p.date).toBe("2026-09-18");
  });

  it("flags is_reorder so reduced per-screen rates apply", () => {
    expect(p.is_reorder).toBe(true);
  });

  it("carries over job content, fees and deposit terms", () => {
    expect(p.customer_id).toBe("cust-1");
    expect(p.customer_name).toBe("New York Panda");
    expect(p.job_title).toBe("Spring Tee Run");
    expect(p.notes).toBe("Front logo only");
    expect(p.rush_rate).toBe(15);
    expect(p.extras).toEqual({ foldBag: true });
    expect(p.line_items).toEqual(order.line_items);
    expect(p.discount).toBe(10);
    expect(p.discount_type).toBe("percent");
    expect(p.tax_rate).toBe(8.25);
    expect(p.deposit_pct).toBe(25);
  });

  it("tolerates a sparse order without throwing or leaking undefined", () => {
    const q = buildReorderQuotePayload({ shop_owner: "s" }, { quoteId: "Q-1", today: "2026-01-01" });
    expect(q.customer_id).toBe("");
    expect(q.job_title).toBe("");
    expect(q.line_items).toEqual([]);
    expect(q.extras).toEqual({});
    expect(q.rush_rate).toBe(0);
    expect(q.deposit_pct).toBe(0);
    expect(q.discount_type).toBe("percent");
    expect(q.is_reorder).toBe(true);
  });

  it("preserves a zero deposit rather than defaulting it to 50", () => {
    expect(buildReorderQuotePayload({ deposit_pct: 0 }, { quoteId: "Q", today: "d" }).deposit_pct).toBe(0);
  });
});
