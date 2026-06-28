import { describe, it, expect } from "vitest";
import { buildTaxSummaryCsv, buildTaxDetailCsv, buildTaxCsvFilename } from "../taxCsv";

describe("buildTaxSummaryCsv", () => {
  it("emits a header + a row per state with 2dp money", () => {
    const csv = buildTaxSummaryCsv([
      { state: "NV", count: 2, taxable: 150, tax: 12.4, total: 162.4, exemptCount: 0 },
      { state: "TX", count: 1, taxable: 0, tax: 0, total: 300, exemptCount: 1 },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("State,Invoices,Taxable,Tax Collected,Total,Exempt Invoices");
    expect(lines[1]).toBe("NV,2,150.00,12.40,162.40,0");
    expect(lines[2]).toBe("TX,1,0.00,0.00,300.00,1");
  });
  it("handles empty input (header only)", () => {
    expect(buildTaxSummaryCsv([]).trim()).toBe("State,Invoices,Taxable,Tax Collected,Total,Exempt Invoices");
  });
});

describe("buildTaxDetailCsv", () => {
  it("emits per-invoice rows and escapes commas in names", () => {
    const csv = buildTaxDetailCsv([
      {
        txn_date: "2026-06-20", qb_invoice_id: "3712", quote_id: "Q-9",
        customer_name: "Acme, Inc.", ship_to_state: "NV", ship_to_zip: "89501",
        authority: "quickbooks_ast", subtotal: 115, taxable_amount: 115, tax_total: 9.69,
        total: 124.69, effective_rate: 8.4261, exempt: false,
        exemption_type: null, exemption_certificate_number: null,
      },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("Date,QB Invoice,Quote,Customer");
    // Quoted because of the comma in the company name
    expect(lines[1]).toContain('"Acme, Inc."');
    expect(lines[1]).toContain("NV,89501,quickbooks_ast,115.00,115.00,9.69,124.69,8.4261,no");
  });
});

describe("buildTaxCsvFilename", () => {
  it("encodes the kind and date range", () => {
    expect(buildTaxCsvFilename("by-state", { from: "2026-06-01", to: "2026-06-30" }))
      .toBe("sales-tax-by-state-2026-06-01_2026-06-30.csv");
    expect(buildTaxCsvFilename("detail", {})).toBe("sales-tax-detail-alltime.csv");
  });
});
