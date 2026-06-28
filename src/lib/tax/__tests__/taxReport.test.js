import { describe, it, expect } from "vitest";
import { summarizeTaxByState, taxReportTotals } from "../taxReport";

const records = [
  { ship_to_state: "NV", taxable_amount: 100, tax_total: 8.27, total: 108.27, exempt: false },
  { ship_to_state: "nv", taxable_amount: 50, tax_total: 4.13, total: 54.13, exempt: false }, // case-insensitive
  { ship_to_state: "CA", taxable_amount: 200, tax_total: 17.5, total: 217.5, exempt: false },
  { ship_to_state: "TX", taxable_amount: 0, tax_total: 0, total: 300, exempt: true },         // exempt
  { ship_to_state: "", taxable_amount: 0, tax_total: 0, total: 75, exempt: false },           // no state → "—"
];

describe("summarizeTaxByState", () => {
  it("rolls up by state (case-insensitive), sorted by tax desc", () => {
    const rows = summarizeTaxByState(records);
    expect(rows.map((r) => r.state)).toEqual(["CA", "NV", "TX", "—"]);
    const nv = rows.find((r) => r.state === "NV");
    expect(nv).toMatchObject({ taxable: 150, tax: 12.4, count: 2 });
  });

  it("counts exempt invoices per state", () => {
    const tx = summarizeTaxByState(records).find((r) => r.state === "TX");
    expect(tx).toMatchObject({ tax: 0, exemptCount: 1, count: 1 });
  });

  it("handles empty input", () => {
    expect(summarizeTaxByState([])).toEqual([]);
    expect(summarizeTaxByState(null)).toEqual([]);
  });
});

describe("taxReportTotals", () => {
  it("sums across the by-state rows", () => {
    const totals = taxReportTotals(summarizeTaxByState(records));
    expect(totals).toEqual({ taxable: 350, tax: 29.9, total: 754.9, count: 5 });
  });
  it("is zero for no rows", () => {
    expect(taxReportTotals([])).toEqual({ taxable: 0, tax: 0, total: 0, count: 0 });
  });
});
