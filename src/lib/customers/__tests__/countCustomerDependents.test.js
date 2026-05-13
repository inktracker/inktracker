import { describe, it, expect } from "vitest";
import {
  countCustomerDependents,
  formatDependentsMessage,
} from "../countCustomerDependents";

const ACME = { id: "cust-acme", name: "Acme Co" };
const OTHER = { id: "cust-other", name: "Other Inc" };

describe("countCustomerDependents — id matching", () => {
  it("counts entities whose customer_id matches", () => {
    const counts = countCustomerDependents(ACME, {
      quotes: [
        { id: "q1", customer_id: "cust-acme" },
        { id: "q2", customer_id: "cust-acme" },
        { id: "q3", customer_id: "cust-other" },
      ],
      orders: [{ id: "o1", customer_id: "cust-acme" }],
      invoices: [],
    });
    expect(counts).toEqual({ quotes: 2, orders: 1, invoices: 0, total: 3 });
  });

  it("returns all-zero when nothing matches", () => {
    const counts = countCustomerDependents(ACME, {
      quotes: [{ id: "q1", customer_id: "cust-other" }],
      orders: [],
      invoices: [],
    });
    expect(counts).toEqual({ quotes: 0, orders: 0, invoices: 0, total: 0 });
  });

  it("returns all-zero when called with no customer (defensive)", () => {
    expect(countCustomerDependents(null)).toEqual({ quotes: 0, orders: 0, invoices: 0, total: 0 });
    expect(countCustomerDependents({})).toEqual({ quotes: 0, orders: 0, invoices: 0, total: 0 });
    expect(countCustomerDependents({ id: "x" }, {})).toEqual({ quotes: 0, orders: 0, invoices: 0, total: 0 });
  });
});

describe("countCustomerDependents — name fallback (legacy data without customer_id)", () => {
  it("counts entities lacking customer_id by case-insensitive name match", () => {
    const counts = countCustomerDependents(ACME, {
      quotes: [
        { id: "q1", customer_name: "Acme Co" },     // legacy, no id
        { id: "q2", customer_name: "acme co" },     // case-insensitive
        { id: "q3", customer_name: "  Acme Co  " }, // whitespace-tolerant
      ],
      orders: [],
      invoices: [],
    });
    expect(counts.quotes).toBe(3);
  });

  it("does NOT count entities whose customer_id points to a DIFFERENT customer who happens to share a name", () => {
    // Critical invariant: same display name, different id → different customer.
    // Counting these would block deletes incorrectly when two real customers share a name.
    const counts = countCustomerDependents(ACME, {
      quotes: [
        { id: "q1", customer_id: "cust-other", customer_name: "Acme Co" },
      ],
      orders: [],
      invoices: [],
    });
    expect(counts.total).toBe(0);
  });

  it("name fallback ignores customers with no name", () => {
    const customerNoName = { id: "cust-x", name: "" };
    const counts = countCustomerDependents(customerNoName, {
      quotes: [
        { id: "q1", customer_name: "" },             // empty name on both sides — don't match
        { id: "q2", customer_name: "Whoever" },      // different name
      ],
      orders: [],
      invoices: [],
    });
    expect(counts.total).toBe(0);
  });
});

describe("countCustomerDependents — mixed id + name buckets", () => {
  it("counts both id-matched and name-matched entities together", () => {
    const counts = countCustomerDependents(ACME, {
      quotes: [
        { id: "q1", customer_id: "cust-acme" },         // id match
        { id: "q2", customer_name: "Acme Co" },         // name fallback
        { id: "q3", customer_id: "cust-other" },        // different id
      ],
      orders: [],
      invoices: [],
    });
    expect(counts.quotes).toBe(2);
  });

  it("survives malformed entities in the bucket (null, undefined, plain objects)", () => {
    const counts = countCustomerDependents(ACME, {
      quotes: [null, undefined, {}, { id: "q1", customer_id: "cust-acme" }],
      orders: [],
      invoices: [],
    });
    expect(counts.quotes).toBe(1);
  });
});

describe("formatDependentsMessage", () => {
  it("returns null when there are no dependents (caller treats null as 'proceed')", () => {
    expect(formatDependentsMessage({ quotes: 0, orders: 0, invoices: 0, total: 0 })).toBeNull();
    expect(formatDependentsMessage(null)).toBeNull();
  });

  it("pluralizes correctly", () => {
    const msg = formatDependentsMessage({ quotes: 1, orders: 2, invoices: 0, total: 3 }, "Acme Co");
    expect(msg).toContain("1 quote,");
    expect(msg).toContain("2 orders");
    expect(msg).not.toContain("invoice");
  });

  it("includes the customer name in the message", () => {
    const msg = formatDependentsMessage({ quotes: 1, orders: 0, invoices: 0, total: 1 }, "Acme Co");
    expect(msg).toContain("Acme Co");
  });

  it("points the user at the merge tool as the recovery path", () => {
    const msg = formatDependentsMessage({ quotes: 1, orders: 0, invoices: 0, total: 1 }, "Acme Co");
    expect(msg.toLowerCase()).toContain("merge");
  });
});
