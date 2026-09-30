import { describe, it, expect } from "vitest";
import { summarizeBrokerAR } from "../brokerAr";

const order = (o) => ({ status: "Completed", ...o });

describe("summarizeBrokerAR", () => {
  it("ignores orders without a broker invoice", () => {
    const out = summarizeBrokerAR([
      order({ order_id: "O1" }), // no qb_broker_invoice_id
      order({ order_id: "O2", broker_email: "e@x.com", qb_broker_invoice_id: "QB1", qb_broker_invoice_total: 100, broker_invoice_paid: false }),
    ]);
    expect(out.invoiceCount).toBe(1);
    expect(out.brokers).toHaveLength(1);
    expect(out.totalDue).toBe(100);
  });

  it("groups by broker and sums only UNPAID toward due", () => {
    const out = summarizeBrokerAR([
      order({ order_id: "O1", broker_email: "e@x.com", qb_broker_invoice_id: "A", qb_broker_invoice_total: 100, broker_invoice_paid: false }),
      order({ order_id: "O2", broker_email: "e@x.com", qb_broker_invoice_id: "B", qb_broker_invoice_total: 250, broker_invoice_paid: true }),
      order({ order_id: "O3", broker_email: "e@x.com", qb_broker_invoice_id: "C", qb_broker_invoice_total: 75, broker_invoice_paid: false }),
    ]);
    expect(out.brokers).toHaveLength(1);
    const b = out.brokers[0];
    expect(b.invoiceCount).toBe(3);
    expect(b.paidCount).toBe(1);
    expect(b.dueCount).toBe(2);
    expect(b.dueTotal).toBe(175); // 100 + 75, not the paid 250
    expect(out.totalDue).toBe(175);
    expect(out.dueCount).toBe(2);
  });

  it("sorts brokers by most owed first", () => {
    const out = summarizeBrokerAR([
      order({ order_id: "O1", broker_email: "small@x.com", qb_broker_invoice_id: "A", qb_broker_invoice_total: 50, broker_invoice_paid: false }),
      order({ order_id: "O2", broker_email: "big@x.com", qb_broker_invoice_id: "B", qb_broker_invoice_total: 900, broker_invoice_paid: false }),
    ]);
    expect(out.brokers.map((b) => b.email)).toEqual(["big@x.com", "small@x.com"]);
  });

  it("flags unknown amounts (legacy invoice with null total) without corrupting the due total", () => {
    const out = summarizeBrokerAR([
      order({ order_id: "O1", broker_email: "e@x.com", qb_broker_invoice_id: "A", qb_broker_invoice_total: 100, broker_invoice_paid: false }),
      order({ order_id: "O2", broker_email: "e@x.com", qb_broker_invoice_id: "B", qb_broker_invoice_total: null, broker_invoice_paid: false }),
    ]);
    const b = out.brokers[0];
    expect(b.dueCount).toBe(2);
    expect(b.dueTotal).toBe(100); // the known one only
    expect(b.dueAmountKnown).toBe(false);
    expect(out.totalDueAmountKnown).toBe(false);
  });

  it("uses broker_company for the display name, falling back to email", () => {
    const out = summarizeBrokerAR([
      order({ order_id: "O1", broker_email: "e@x.com", broker_company: "TTR Supply", qb_broker_invoice_id: "A", qb_broker_invoice_total: 10, broker_invoice_paid: false }),
      order({ order_id: "O2", broker_email: "n@x.com", qb_broker_invoice_id: "B", qb_broker_invoice_total: 20, broker_invoice_paid: false }),
    ]);
    const names = Object.fromEntries(out.brokers.map((b) => [b.email, b.name]));
    expect(names["e@x.com"]).toBe("TTR Supply");
    expect(names["n@x.com"]).toBe("n@x.com");
  });

  it("handles empty / null input", () => {
    expect(summarizeBrokerAR([])).toEqual({ brokers: [], totalDue: 0, totalDueAmountKnown: true, invoiceCount: 0, dueCount: 0 });
    expect(summarizeBrokerAR(null).invoiceCount).toBe(0);
  });
});
