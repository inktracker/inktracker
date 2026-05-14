import { describe, it, expect } from "vitest";
import { normalizeQuoteStatus } from "../quoteStatus.js";

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
