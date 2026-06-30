import { describe, it, expect } from "vitest";
import { sanitizeSupplierPrice, MAX_SANE_PIECE_PRICE, MAX_SANE_CASE_PRICE } from "../supplierPrice.ts";

describe("sanitizeSupplierPrice (INT-03)", () => {
  it("passes a normal piece price through, rounded to whole cents", () => {
    expect(sanitizeSupplierPrice(4.62)).toBe(4.62);
    expect(sanitizeSupplierPrice("8.5")).toBe(8.5);
    expect(sanitizeSupplierPrice(3.129)).toBe(3.13); // float-noise rounding
  });

  it("rejects non-numbers / NaN / null / undefined → 0", () => {
    expect(sanitizeSupplierPrice("abc")).toBe(0);
    expect(sanitizeSupplierPrice(null)).toBe(0);
    expect(sanitizeSupplierPrice(undefined)).toBe(0);
    expect(sanitizeSupplierPrice(NaN)).toBe(0);
    expect(sanitizeSupplierPrice({})).toBe(0);
  });

  it("rejects negatives and zero → 0 (the 'no usable price' signal)", () => {
    expect(sanitizeSupplierPrice(-5)).toBe(0);
    expect(sanitizeSupplierPrice(0)).toBe(0);
    expect(sanitizeSupplierPrice("-12.50")).toBe(0);
  });

  it("rejects absurd magnitudes above the piece ceiling → 0", () => {
    expect(sanitizeSupplierPrice(MAX_SANE_PIECE_PRICE + 0.01)).toBe(0);
    expect(sanitizeSupplierPrice(999999)).toBe(0);
    expect(sanitizeSupplierPrice(Infinity)).toBe(0);
  });

  it("accepts a value at exactly the ceiling", () => {
    expect(sanitizeSupplierPrice(MAX_SANE_PIECE_PRICE)).toBe(MAX_SANE_PIECE_PRICE);
  });

  it("case prices use a higher ceiling (a full case is many units)", () => {
    // A case total that's legitimate for case pricing but would be absurd per-piece.
    expect(sanitizeSupplierPrice(5760, MAX_SANE_CASE_PRICE)).toBe(5760);
    // still rejects outright garbage even under the case ceiling
    expect(sanitizeSupplierPrice(MAX_SANE_CASE_PRICE + 1, MAX_SANE_CASE_PRICE)).toBe(0);
    expect(sanitizeSupplierPrice(-1, MAX_SANE_CASE_PRICE)).toBe(0);
  });
});
