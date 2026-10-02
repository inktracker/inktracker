import { describe, it, expect } from "vitest";
import {
  cleanText,
  looksLikeCode,
  isWarehouseSku,
  extractTrailingCode,
  stripTrailingCode,
} from "../lineItemText";

// Foundational SKU/text helpers — used by garmentTitle, supplierProductName,
// the quote PDF, the payment page and the line-item editors. If their
// code-detection drifts, a style number that renders in the editor parses
// differently on the customer PDF. These pin the exact edges.

describe("cleanText", () => {
  it("trims strings and coerces to string", () => {
    expect(cleanText("  hi  ")).toBe("hi");
    expect(cleanText("x")).toBe("x");
    expect(cleanText(1717)).toBe("1717");
  });
  it("empty/absent → ''", () => {
    expect(cleanText(null)).toBe("");
    expect(cleanText(undefined)).toBe("");
    expect(cleanText("")).toBe("");
    expect(cleanText("   ")).toBe("");
  });
  it("GOTCHA: falsy values coerce to '' (0 and false are NOT preserved)", () => {
    // value || "" short-circuits on falsy — documented so callers never pass
    // a numeric 0 expecting "0".
    expect(cleanText(0)).toBe("");
    expect(cleanText(false)).toBe("");
    expect(cleanText(NaN)).toBe("");
  });
});

describe("looksLikeCode — a style code vs prose", () => {
  it("true for real style codes (alphanumeric, has a digit, no spaces)", () => {
    expect(looksLikeCode("G5000")).toBe(true);
    expect(looksLikeCode("1717")).toBe(true);
    expect(looksLikeCode("PC61-LS")).toBe(true);
    expect(looksLikeCode("A1")).toBe(true); // 2-char minimum
    expect(looksLikeCode("5000b")).toBe(true); // case-insensitive
  });
  it("false for prose, digit-less, too short, too long, or spaced", () => {
    expect(looksLikeCode("Comfort Colors")).toBe(false); // space + no digit
    expect(looksLikeCode("SHIRT")).toBe(false); // no digit
    expect(looksLikeCode("A")).toBe(false); // 1 char
    expect(looksLikeCode("1")).toBe(false); // 1 char
    expect(looksLikeCode("G 5000")).toBe(false); // space
    expect(looksLikeCode("A".repeat(29) + "1")).toBe(true); // exactly 30
    expect(looksLikeCode("A".repeat(30) + "1")).toBe(false); // 31 → too long
    expect(looksLikeCode("")).toBe(false);
    expect(looksLikeCode(null)).toBe(false);
    expect(looksLikeCode("6.1-ounce")).toBe(false); // '.' not allowed
  });
});

describe("isWarehouseSku — supplier warehouse id, never a style number", () => {
  it("true for leading-zero runs and long all-digit runs", () => {
    expect(isWarehouseSku("01234")).toBe(true); // 0 + 3+ digits
    expect(isWarehouseSku("0123")).toBe(true);
    expect(isWarehouseSku("12345")).toBe(true); // 5+ digits
    expect(isWarehouseSku("123456789")).toBe(true);
  });
  it("false for ordinary style numbers and anything with letters", () => {
    expect(isWarehouseSku("1717")).toBe(false); // 4 digits, no leading 0
    expect(isWarehouseSku("1234")).toBe(false);
    expect(isWarehouseSku("012")).toBe(false); // 0 + only 2 digits
    expect(isWarehouseSku("G5000")).toBe(false);
    expect(isWarehouseSku("")).toBe(false);
    expect(isWarehouseSku(null)).toBe(false);
  });
});

describe("extractTrailingCode — pull a trailing '- CODE'", () => {
  it("pulls the code after a trailing dash (uppercased)", () => {
    expect(extractTrailingCode("Heavyweight Tee - 1717")).toBe("1717");
    expect(extractTrailingCode("Tee-1717")).toBe("1717");
    expect(extractTrailingCode("Ring Spun Tee - pc61")).toBe("PC61");
  });
  it("NOTE: laxer than looksLikeCode — no digit required for the trailing token", () => {
    expect(extractTrailingCode("Shirt - TEE")).toBe("TEE");
  });
  it("'' when there's no trailing dash-code", () => {
    expect(extractTrailingCode("1717")).toBe("");
    expect(extractTrailingCode("Tee - ")).toBe("");
    expect(extractTrailingCode("A - B")).toBe(""); // single trailing char < 2
    expect(extractTrailingCode("")).toBe("");
    expect(extractTrailingCode(null)).toBe("");
  });
});

describe("stripTrailingCode — remove a trailing '- CODE'", () => {
  it("removes the trailing code, keeps the name", () => {
    expect(stripTrailingCode("Heavyweight Tee - 1717")).toBe("Heavyweight Tee");
    expect(stripTrailingCode("Tee-1717")).toBe("Tee");
    expect(stripTrailingCode("Ring Spun Tee - PC61-LS")).toBe("Ring Spun Tee");
  });
  it("leaves real text that merely contains spaces/dashes alone", () => {
    expect(stripTrailingCode("Comfort Colors - Ring Spun")).toBe("Comfort Colors - Ring Spun");
    expect(stripTrailingCode("1717")).toBe("1717");
    expect(stripTrailingCode("")).toBe("");
    expect(stripTrailingCode(null)).toBe("");
  });
});
