import { describe, it, expect } from "vitest";
import { isFlatDiscount } from "../discountType";

describe("isFlatDiscount — one shared flat/percent inference", () => {
  it("explicit 'flat' is flat; explicit 'percent' is percent", () => {
    expect(isFlatDiscount(50, "flat")).toBe(true);
    expect(isFlatDiscount(50, "percent")).toBe(false);
    expect(isFlatDiscount(150, "percent")).toBe(false); // a real (if huge) percent
  });

  it("the critical case: a legacy flat $150-off with null/empty type is FLAT, not 150%", () => {
    // This is what the strict QB-push fallbacks got wrong (pushed 150%).
    expect(isFlatDiscount(150, null)).toBe(true);
    expect(isFlatDiscount(150, "")).toBe(true);
    expect(isFlatDiscount(150, undefined)).toBe(true);
    expect(isFlatDiscount("150", null)).toBe(true); // Postgres string
  });

  it("a small untyped discount (<=100) stays percent (can't disambiguate, matches legacy default)", () => {
    expect(isFlatDiscount(10, null)).toBe(false);
    expect(isFlatDiscount(100, null)).toBe(false);
    expect(isFlatDiscount(0, null)).toBe(false);
  });

  it("junk/absent value → not flat, never throws", () => {
    expect(isFlatDiscount(undefined, null)).toBe(false);
    expect(isFlatDiscount("abc", null)).toBe(false);
  });
});
