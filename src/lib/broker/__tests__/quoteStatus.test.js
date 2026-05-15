import { describe, it, expect } from "vitest";
import { normalizeQuoteStatus, bucketQuotes } from "../quoteStatus.js";

describe("normalizeQuoteStatus", () => {
  it("collapses 'Approved' and 'Approved and Paid' to 'Shop Approved'", () => {
    expect(normalizeQuoteStatus("Approved")).toBe("Shop Approved");
    expect(normalizeQuoteStatus("Approved and Paid")).toBe("Shop Approved");
  });

  it("collapses 'Sent' to 'Pending'", () => {
    expect(normalizeQuoteStatus("Sent")).toBe("Pending");
  });

  it("passes through statuses that already match a broker bucket", () => {
    expect(normalizeQuoteStatus("Pending")).toBe("Pending");
    expect(normalizeQuoteStatus("Declined")).toBe("Declined");
    expect(normalizeQuoteStatus("Converted to Order")).toBe("Converted to Order");
    expect(normalizeQuoteStatus("Draft")).toBe("Draft");
  });

  it("defaults to 'Draft' when status is missing or empty", () => {
    expect(normalizeQuoteStatus(undefined)).toBe("Draft");
    expect(normalizeQuoteStatus(null)).toBe("Draft");
    expect(normalizeQuoteStatus("")).toBe("Draft");
  });
});

describe("bucketQuotes", () => {
  it("groups Sent and Pending into the pending bucket", () => {
    // This is the bug-fix case — Dashboard previously only counted
    // status === "Pending" and missed every Sent quote, reporting 0
    // even when quotes were out with customers.
    const sent    = { id: "1", status: "Sent",    total: 100 };
    const pending = { id: "2", status: "Pending", total: 200 };
    const { pending: p } = bucketQuotes([sent, pending]);
    expect(p).toEqual([sent, pending]);
  });

  it("groups Approved and Approved and Paid into the approved bucket", () => {
    const approved = { id: "1", status: "Approved",          total: 100 };
    const paid     = { id: "2", status: "Approved and Paid", total: 200 };
    const { approved: a } = bucketQuotes([approved, paid]);
    expect(a).toEqual([approved, paid]);
  });

  it("puts Draft into draft, Declined into declined, Converted to Order into converted", () => {
    const draft     = { id: "1", status: "Draft" };
    const declined  = { id: "2", status: "Declined" };
    const converted = { id: "3", status: "Converted to Order" };
    const b = bucketQuotes([draft, declined, converted]);
    expect(b.draft).toEqual([draft]);
    expect(b.declined).toEqual([declined]);
    expect(b.converted).toEqual([converted]);
  });

  it("treats missing/empty status as Draft (matches normalizeQuoteStatus default)", () => {
    const q1 = { id: "1" };
    const q2 = { id: "2", status: null };
    const q3 = { id: "3", status: "" };
    expect(bucketQuotes([q1, q2, q3]).draft).toEqual([q1, q2, q3]);
  });

  it("omits unknown statuses entirely (doesn't silently inflate any bucket)", () => {
    // Defensive: if someone adds a future status we don't know about,
    // it shouldn't accidentally inflate the pending count.
    const weird = { id: "1", status: "Totally New Status" };
    const b = bucketQuotes([weird]);
    expect(b.pending).toEqual([]);
    expect(b.approved).toEqual([]);
    expect(b.draft).toEqual([]);
    expect(b.declined).toEqual([]);
    expect(b.converted).toEqual([]);
  });

  it("returns empty buckets for null/empty input (no throws)", () => {
    expect(bucketQuotes(null)).toEqual({
      pending: [], approved: [], draft: [], declined: [], converted: [],
    });
    expect(bucketQuotes([])).toEqual({
      pending: [], approved: [], draft: [], declined: [], converted: [],
    });
  });

  it("returns the original quote objects (preserves total for sum calculations)", () => {
    // Dashboard does sumTotals(buckets.pending) to compute $ value —
    // make sure we hand back the original objects with .total intact.
    const sent = { id: "1", status: "Sent", total: 1234.56, customer: "X" };
    const { pending } = bucketQuotes([sent]);
    expect(pending[0]).toBe(sent); // same reference
    expect(pending[0].total).toBe(1234.56);
  });
});
