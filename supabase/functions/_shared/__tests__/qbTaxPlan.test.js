import { describe, it, expect } from "vitest";
import { planSelfTax, buildTaxLine, stripInternalNotes } from "../qbTaxPlan.js";

describe("planSelfTax — mode selection", () => {
  const base = {
    taxMode: "self", taxPercent: 8.265, isTaxExempt: false,
    usingSalesTax: true, matchingTaxCode: "2", taxAmount: 57.86,
  };

  it("qb mode → none (AST path, unchanged)", () => {
    expect(planSelfTax({ ...base, taxMode: "qb" })).toEqual({ mode: "none" });
  });

  it("missing/blank taxMode → none", () => {
    expect(planSelfTax({ ...base, taxMode: undefined })).toEqual({ mode: "none" });
    expect(planSelfTax({ ...base, taxMode: "" })).toEqual({ mode: "none" });
    expect(planSelfTax({})).toEqual({ mode: "none" });
  });

  it("self but 0% rate → none (nothing to bill)", () => {
    expect(planSelfTax({ ...base, taxPercent: 0 })).toEqual({ mode: "none" });
    expect(planSelfTax({ ...base, taxPercent: null })).toEqual({ mode: "none" });
  });

  it("self but tax-exempt customer → none", () => {
    expect(planSelfTax({ ...base, isTaxExempt: true })).toEqual({ mode: "none" });
  });

  it("self + sales tax ON + matching code → PROPER", () => {
    expect(planSelfTax(base)).toEqual({ mode: "proper", taxCode: "2" });
  });

  it("PROPER stringifies a numeric tax code id", () => {
    expect(planSelfTax({ ...base, matchingTaxCode: 2 })).toEqual({ mode: "proper", taxCode: "2" });
  });

  it("self + sales tax ON but NO matching rate → LINE fallback", () => {
    expect(planSelfTax({ ...base, matchingTaxCode: null }))
      .toEqual({ mode: "line", lineAmount: 57.86 });
  });

  it("Truman's case: rate exists but sales tax OFF → LINE (code ignored)", () => {
    // A matching code with UsingSalesTax=false is useless — QB discards tax.
    expect(planSelfTax({ ...base, usingSalesTax: false, matchingTaxCode: "2" }))
      .toEqual({ mode: "line", lineAmount: 57.86 });
  });

  it("self + sales tax OFF + no code → LINE", () => {
    expect(planSelfTax({ ...base, usingSalesTax: false, matchingTaxCode: null }))
      .toEqual({ mode: "line", lineAmount: 57.86 });
  });
});

describe("planSelfTax — LINE amount handling", () => {
  const line = (taxAmount) => planSelfTax({
    taxMode: "self", taxPercent: 8.265, isTaxExempt: false,
    usingSalesTax: false, matchingTaxCode: null, taxAmount,
  });

  it("rounds to cents (half up / down)", () => {
    expect(line(57.855).lineAmount).toBe(57.86);
    expect(line(57.854).lineAmount).toBe(57.85);
  });

  it("coerces a string amount", () => {
    expect(line("57.86").lineAmount).toBe(57.86);
  });

  it("zero / missing amount → 0 (caller then skips the line)", () => {
    expect(line(0).lineAmount).toBe(0);
    expect(line(undefined).lineAmount).toBe(0);
    expect(line(null).lineAmount).toBe(0);
  });

  it("negative amount is clamped to 0 — never a negative line", () => {
    expect(line(-10).lineAmount).toBe(0);
  });

  it("garbage amount → 0", () => {
    expect(line("abc").lineAmount).toBe(0);
    expect(line(NaN).lineAmount).toBe(0);
  });
});

describe("buildTaxLine", () => {
  const itemRef = { value: "3" };

  it("builds a NON sales-tax line with the exact amount", () => {
    expect(buildTaxLine({ itemRef, amount: 57.86, ratePct: 8.265 })).toEqual({
      DetailType: "SalesItemLineDetail",
      Amount: 57.86,
      Description: "Sales Tax (8.265%)",
      SalesItemLineDetail: {
        ItemRef: { value: "3" },
        Qty: 1,
        UnitPrice: 57.86,
        TaxCodeRef: { value: "NON" },
      },
    });
  });

  it("is coded NON so QB never re-taxes it", () => {
    expect(buildTaxLine({ itemRef, amount: 10, ratePct: 5 })
      .SalesItemLineDetail.TaxCodeRef).toEqual({ value: "NON" });
  });

  it("rounds the amount and mirrors it into UnitPrice", () => {
    const l = buildTaxLine({ itemRef, amount: 12.005, ratePct: 7 });
    expect(l.Amount).toBe(12.01);
    expect(l.SalesItemLineDetail.UnitPrice).toBe(12.01);
  });

  it("null when there's no amount", () => {
    expect(buildTaxLine({ itemRef, amount: 0, ratePct: 8 })).toBeNull();
    expect(buildTaxLine({ itemRef, amount: -5, ratePct: 8 })).toBeNull();
  });

  it("null when there's no ItemRef (QB requires one)", () => {
    expect(buildTaxLine({ itemRef: null, amount: 57.86, ratePct: 8 })).toBeNull();
    expect(buildTaxLine({ amount: 57.86, ratePct: 8 })).toBeNull();
  });

  it("shows a 0% rate cleanly when rate is missing", () => {
    expect(buildTaxLine({ itemRef, amount: 5 }).Description).toBe("Sales Tax (0%)");
  });
});

describe("stripInternalNotes", () => {
  it("strips order-edit audit lines, keeps real notes", () => {
    const notes =
      "Digitizing Fee: one-time.\n" +
      "[2026-09-15] Updated from order edit: total $725.38 → $757.86\n" +
      "[2026-09-16] Updated from order edit: total $757.86 → $778.86";
    expect(stripInternalNotes(notes)).toBe("Digitizing Fee: one-time.");
  });

  it("strips QB-sync audit lines too", () => {
    expect(stripInternalNotes("keep\n[2026-07-18] Synced from QuickBooks: total $1 → $2"))
      .toBe("keep");
  });

  it("strips a mix of both, preserving order of real lines", () => {
    const notes =
      "No 3d puff.\n" +
      "[2026-09-16] Updated from order edit: total $700.00 → $778.86\n" +
      "If you have a resale number, we can remove tax.\n" +
      "[2026-07-18] Synced from QuickBooks: total $1 → $2";
    expect(stripInternalNotes(notes)).toBe("No 3d puff.\nIf you have a resale number, we can remove tax.");
  });

  it("returns '' when only audit lines remain", () => {
    expect(stripInternalNotes("[2026-09-16] Updated from order edit: total $1 → $2")).toBe("");
  });

  it("a real note that merely mentions 'order edit' (no dated prefix) survives", () => {
    expect(stripInternalNotes("Please confirm the order edit before printing"))
      .toBe("Please confirm the order edit before printing");
  });

  it("tolerates junk input", () => {
    expect(stripInternalNotes(null)).toBe("");
    expect(stripInternalNotes(undefined)).toBe("");
    expect(stripInternalNotes("")).toBe("");
    expect(stripInternalNotes(42)).toBe("");
  });

  it("Truman's exact invoice notes → only the customer content", () => {
    const notes =
      "Digitizing Fee: A one-time fee to turn a design into a thread file.\n\n" +
      "No 3d puff embroidery.\n\n" +
      "If you have a resale number, we can remove tax.\n" +
      "[2026-09-15] Updated from order edit: total $725.38 → $757.86\n" +
      "[2026-09-16] Updated from order edit: total $757.86 → $778.86\n" +
      "[2026-09-16] Updated from order edit: total $778.86 → $778.86";
    expect(stripInternalNotes(notes)).toBe(
      "Digitizing Fee: A one-time fee to turn a design into a thread file.\n\n" +
      "No 3d puff embroidery.\n\n" +
      "If you have a resale number, we can remove tax.",
    );
  });
});
