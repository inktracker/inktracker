import { describe, it, expect } from "vitest";
import {
  validateQuoteForSave,
  validateQuoteForSend,
} from "../validation";

// Helper: build a minimum-valid quote (one customer, one line with qty)
function validQuote(overrides = {}) {
  return {
    customer_id: "cust-1",
    customer_email: "customer@example.com",
    line_items: [
      { id: 1, sizes: { S: 10, M: 5 } }, // 15 total qty
    ],
    ...overrides,
  };
}

describe("validateQuoteForSave — minimum bar", () => {
  it("returns null for a quote with a customer and at least one line with qty > 0", () => {
    expect(validateQuoteForSave(validQuote())).toBeNull();
  });

  it("flags a missing customer", () => {
    const errors = validateQuoteForSave(validQuote({ customer_id: "" }));
    expect(errors).toContain("Pick a customer before saving.");
  });

  it("flags a missing customer (undefined)", () => {
    const errors = validateQuoteForSave(validQuote({ customer_id: undefined }));
    expect(errors).toContain("Pick a customer before saving.");
  });

  it("flags a whitespace-only customer id (still empty)", () => {
    const errors = validateQuoteForSave(validQuote({ customer_id: "   " }));
    expect(errors).toContain("Pick a customer before saving.");
  });

  it("flags an empty line_items array", () => {
    const errors = validateQuoteForSave(validQuote({ line_items: [] }));
    expect(errors).toContain("Add at least one line item with a quantity greater than zero.");
  });

  it("flags line_items that all have qty=0 (the blank-$0-quote bug Joe hit)", () => {
    const errors = validateQuoteForSave(validQuote({
      line_items: [{ id: 1, sizes: {} }, { id: 2, sizes: { S: 0 } }],
    }));
    expect(errors).toContain("Add at least one line item with a quantity greater than zero.");
  });

  it("accepts a quote with mixed line items where at least one has qty > 0", () => {
    const errors = validateQuoteForSave(validQuote({
      line_items: [
        { id: 1, sizes: {} },              // empty
        { id: 2, sizes: { M: 12 } },       // 12 qty
      ],
    }));
    expect(errors).toBeNull();
  });

  it("returns multiple errors when multiple things are missing", () => {
    const errors = validateQuoteForSave({});
    expect(errors).toHaveLength(2); // no customer, no line items
  });

  it("returns one error for a completely empty or null quote", () => {
    expect(validateQuoteForSave(null)).toEqual(["Quote is empty."]);
    expect(validateQuoteForSave(undefined)).toEqual(["Quote is empty."]);
    expect(validateQuoteForSave("not a quote")).toEqual(["Quote is empty."]);
  });
});

describe("validateQuoteForSend — stricter than save", () => {
  it("returns null when everything is present (customer + line items + email + token)", () => {
    expect(validateQuoteForSend(validQuote(), "tok_abc123")).toBeNull();
  });

  it("inherits all save errors (missing customer)", () => {
    const errors = validateQuoteForSend(validQuote({ customer_id: "" }), "tok_abc123");
    expect(errors).toContain("Pick a customer before saving.");
  });

  it("inherits all save errors (no line items with qty)", () => {
    const errors = validateQuoteForSend(validQuote({ line_items: [] }), "tok_abc123");
    expect(errors).toContain("Add at least one line item with a quantity greater than zero.");
  });

  it("flags missing customer email", () => {
    const errors = validateQuoteForSend(validQuote({ customer_email: "" }), "tok_abc123");
    expect(errors).toContain("The quote has no customer email — can't send.");
  });

  it("flags missing customer email (undefined)", () => {
    const errors = validateQuoteForSend(validQuote({ customer_email: undefined }), "tok_abc123");
    expect(errors).toContain("The quote has no customer email — can't send.");
  });

  it("flags whitespace-only customer email", () => {
    const errors = validateQuoteForSend(validQuote({ customer_email: "   " }), "tok_abc123");
    expect(errors).toContain("The quote has no customer email — can't send.");
  });

  it("flags missing public token — the 'broken payment link' bug from the audit", () => {
    const errors = validateQuoteForSend(validQuote(), null);
    expect(errors?.some((e) => e.includes("secure link"))).toBe(true);
  });

  it("flags empty-string public token", () => {
    const errors = validateQuoteForSend(validQuote(), "");
    expect(errors?.some((e) => e.includes("secure link"))).toBe(true);
  });

  it("flags whitespace-only public token", () => {
    const errors = validateQuoteForSend(validQuote(), "   ");
    expect(errors?.some((e) => e.includes("secure link"))).toBe(true);
  });

  it("returns multiple errors when multiple things are missing", () => {
    const errors = validateQuoteForSend({}, null);
    // no customer, no line items, no email, no token → 4 errors
    expect(errors?.length).toBeGreaterThanOrEqual(3);
  });

  it("invariant: returns null only when no errors found at all", () => {
    // Belt-and-suspenders contract — callers depend on null === valid
    const valid = validateQuoteForSend(validQuote(), "tok");
    const invalid = validateQuoteForSend({}, null);
    expect(valid).toBeNull();
    expect(invalid).not.toBeNull();
    expect(Array.isArray(invalid)).toBe(true);
  });
});
