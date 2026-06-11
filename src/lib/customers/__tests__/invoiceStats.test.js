// Pins the profile-card aggregation contract. Bug story (2026-06-10):
// the card showed QB-sourced stats, undercounting customers with
// pre-QB history (Beloved's: card said 2/$3,550; truth was 4/$8,210).

import { describe, it, expect } from "vitest";
import { aggregateInvoiceStatsByCustomer } from "../invoiceStats";

describe("aggregateInvoiceStatsByCustomer", () => {
  it("counts all invoices but only sums paid ones", () => {
    const stats = aggregateInvoiceStatsByCustomer([
      { customer_id: "c1", total: "2320", paid: true },
      { customer_id: "c1", total: "2340", paid: true },
      { customer_id: "c1", total: "500", paid: false },
    ]);
    expect(stats.c1).toEqual({ count: 3, collected: 4660 });
  });

  it("matches the beloved's repair: 4 invoices, $8,210 collected", () => {
    const stats = aggregateInvoiceStatsByCustomer([
      { customer_id: "zach", total: "2320", paid: true },
      { customer_id: "zach", total: "2340", paid: true },
      { customer_id: "zach", total: "2500", paid: true },
      { customer_id: "zach", total: "1050", paid: true },
    ]);
    expect(stats.zach).toEqual({ count: 4, collected: 8210 });
  });

  it("skips rows with no customer link instead of crashing", () => {
    const stats = aggregateInvoiceStatsByCustomer([
      { customer_id: null, total: "100", paid: true },
      { customer_id: "", total: "100", paid: true },
      { customer_id: "c1", total: "100", paid: true },
    ]);
    expect(Object.keys(stats)).toEqual(["c1"]);
  });

  it("tolerates junk totals and empty input", () => {
    expect(aggregateInvoiceStatsByCustomer([])).toEqual({});
    expect(aggregateInvoiceStatsByCustomer(null)).toEqual({});
    const stats = aggregateInvoiceStatsByCustomer([
      { customer_id: "c1", total: "not-a-number", paid: true },
    ]);
    expect(stats.c1).toEqual({ count: 1, collected: 0 });
  });
});
