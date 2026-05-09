import { describe, it, expect } from "vitest";
import { createInternalTaxProvider, lookupRate } from "../internalTaxProvider";

const SHOP = {
  tax_mode: "internal",
  default_jurisdiction: "CA",
  rate_table: [
    { state: "CA", rate: 8.25 },
    { state: "TX", rate: 6.25 },
    { zip: "10001", rate: 8.875 },
  ],
};

function quoteWith(lines) {
  return { id: "q-1", line_items: lines };
}

describe("InternalTaxProvider", () => {
  const provider = createInternalTaxProvider();

  it("computes tax for a taxable customer + taxable line", () => {
    const quote = quoteWith([
      { id: "L1", _lineTotal: 100, taxable: true },
    ]);
    const customer = { taxable: true, ship_to_address: { state: "CA" } };

    const result = provider.calculate(quote, { shop: SHOP, customer });

    expect(result.rate).toBe(8.25);
    expect(result.jurisdiction).toBe("CA");
    expect(result.totalTax).toBe(8.25);
    expect(result.lineTax[0]).toEqual({ id: "L1", taxAmount: 8.25, taxableAmount: 100 });
  });

  it("returns zero tax for an exempt customer (taxable=false)", () => {
    const quote = quoteWith([
      { id: "L1", _lineTotal: 100, taxable: true },
      { id: "L2", _lineTotal: 50,  taxable: true },
    ]);
    const customer = { taxable: false, ship_to_address: { state: "CA" } };

    const result = provider.calculate(quote, { shop: SHOP, customer });

    expect(result.totalTax).toBe(0);
    expect(result.lineTax.every(l => l.taxAmount === 0)).toBe(true);
  });

  it("honors the legacy customer.tax_exempt flag", () => {
    const quote = quoteWith([{ id: "L1", _lineTotal: 200, taxable: true }]);
    const customer = { tax_exempt: true, ship_to_address: { state: "CA" } };

    const result = provider.calculate(quote, { shop: SHOP, customer });
    expect(result.totalTax).toBe(0);
  });

  it("zeros out tax on a non-taxable line but not its sibling", () => {
    const quote = quoteWith([
      { id: "L1", _lineTotal: 100, taxable: true  },
      { id: "L2", _lineTotal: 100, taxable: false },
    ]);
    const customer = { taxable: true, ship_to_address: { state: "CA" } };

    const result = provider.calculate(quote, { shop: SHOP, customer });

    expect(result.lineTax[0].taxAmount).toBe(8.25);
    expect(result.lineTax[1].taxAmount).toBe(0);
    expect(result.totalTax).toBe(8.25);
  });

  it("falls back to shop.default_jurisdiction when ship_to has no rate match", () => {
    const quote = quoteWith([{ id: "L1", _lineTotal: 100, taxable: true }]);
    const customer = { taxable: true, ship_to_address: { state: "ZZ" } };

    const result = provider.calculate(quote, { shop: SHOP, customer });

    expect(result.jurisdiction).toBe("CA");
    expect(result.rate).toBe(8.25);
    expect(result.totalTax).toBe(8.25);
  });

  it("prefers a zip-level rate over a state rate", () => {
    const quote = quoteWith([{ id: "L1", _lineTotal: 100, taxable: true }]);
    const customer = { taxable: true, ship_to_address: { zip: "10001", state: "NY" } };

    const result = provider.calculate(quote, { shop: SHOP, customer });
    expect(result.rate).toBe(8.875);
    expect(result.totalTax).toBe(8.88);
  });

  it("pushInvoice is a no-op returning all-null fields", async () => {
    const result = await provider.pushInvoice({});
    expect(result).toEqual({ externalId: null, taxFromProvider: null, totalFromProvider: null });
  });

  it("lookupRate handles ZIP+4 and casing", () => {
    const r = lookupRate(SHOP.rate_table, { zip: "10001-1234", state: "ny" }, null);
    expect(r.rate).toBe(8.875);
  });
});
