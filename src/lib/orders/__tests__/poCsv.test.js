import { describe, it, expect } from "vitest";
import { buildPOCsv, buildPOCsvFilename } from "../poCsv";

describe("buildPOCsv", () => {
  it("returns empty string for empty / missing items", () => {
    expect(buildPOCsv(null)).toBe("");
    expect(buildPOCsv({})).toBe("");
    expect(buildPOCsv({ items: [] })).toBe("");
  });

  it("emits header + one row per item", () => {
    const po = {
      items: [
        { style: "5001", color: "Black", size: "M", qty: 12, sku: "5001BLACK-M" },
        { style: "5001", color: "Black", size: "L", qty: 8,  sku: "5001BLACK-L" },
      ],
    };
    const csv = buildPOCsv(po);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Style,Color,Size,Quantity,SKU");
    expect(lines[1]).toBe("5001,Black,M,12,5001BLACK-M");
    expect(lines[2]).toBe("5001,Black,L,8,5001BLACK-L");
  });

  it("reads the AddItemsPanel shape (styleCode / quantity), not just shortfall (style / qty)", () => {
    // Manually-added PO items use styleCode + quantity. Before the fix the
    // CSV only read style + qty, so these exported with empty Style and
    // Quantity cells — the AS Colour assistant got the SKU but no quantity.
    const po = {
      items: [
        { styleCode: "5001", color: "Black", size: "M", quantity: 12, sku: "5001BLACK-M" },
      ],
    };
    const lines = buildPOCsv(po).trim().split("\n");
    expect(lines[1]).toBe("5001,Black,M,12,5001BLACK-M");
  });

  it("uses quantity 0 rather than falling through to the other field", () => {
    const po = { items: [{ styleCode: "5001", size: "M", quantity: 0, sku: "S-M" }] };
    const lines = buildPOCsv(po).trim().split("\n");
    expect(lines[1]).toBe("5001,,M,0,S-M");
  });

  it("escapes commas / quotes / newlines in any column", () => {
    const po = {
      items: [
        { style: "Bell, Inc 3001", color: 'Heather "Storm"', size: "M", qty: 5, sku: "X\nY" },
      ],
    };
    const csv = buildPOCsv(po);
    // Can't split on \n here because the SKU cell legitimately contains
    // a newline — splitting would corrupt the row count. Match the full
    // expected output instead.
    expect(csv).toBe(
      "Style,Color,Size,Quantity,SKU\n" +
      '"Bell, Inc 3001","Heather ""Storm""",M,5,"X\nY"\n'
    );
  });

  it("treats missing fields as empty cells (still parseable)", () => {
    const po = { items: [{ style: "X", qty: 4 }] };
    const csv = buildPOCsv(po);
    const lines = csv.trim().split("\n");
    expect(lines[1]).toBe("X,,,4,");
  });

  it("ends with a trailing newline so Excel doesn't flag the last row", () => {
    const csv = buildPOCsv({ items: [{ style: "X", qty: 1 }] });
    expect(csv.endsWith("\n")).toBe(true);
  });
});

describe("buildPOCsvFilename", () => {
  it("interpolates supplier + reference + ISO date", () => {
    const po = { supplier: "AS Colour", reference: "PO-2026-05-29" };
    const today = new Date("2026-05-29T12:00:00Z");
    expect(buildPOCsvFilename(po, today)).toBe("ASColour-PO-2026-05-29-2026-05-29.csv");
  });

  it("strips unfriendly characters from the reference", () => {
    const po = { supplier: "S&S Activewear", reference: "Reorder — ORD-2026-XYZ (S&S Activewear)" };
    const today = new Date("2026-05-29T00:00:00Z");
    // Spaces, ampersands, em-dashes, parens all collapse to hyphens
    expect(buildPOCsvFilename(po, today))
      .toBe("SSActivewear-Reorder-ORD-2026-XYZ-S-S-Activewear-2026-05-29.csv");
  });

  it("falls back when supplier / reference missing", () => {
    const today = new Date("2026-05-29T00:00:00Z");
    expect(buildPOCsvFilename({}, today)).toBe("Order-PO-2026-05-29.csv");
  });
});
