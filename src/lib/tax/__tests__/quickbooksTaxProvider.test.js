import { describe, it, expect, vi } from "vitest";
import {
  createQuickBooksTaxProvider,
  buildQBOInvoiceJSON,
  syncBackFromQBO,
} from "../quickbooksTaxProvider";

const QB_URL = "https://example.supabase.co/functions/v1/qbSync";

function quoteWith(lines, overrides = {}) {
  return {
    id: "q-1",
    line_items: lines,
    notes: "Thanks!",
    ...overrides,
  };
}

describe("buildQBOInvoiceJSON", () => {
  it("emits TaxCodeRef='TAX' on taxable lines and 'NON' on non-taxable", () => {
    const quote = quoteWith([
      { id: "L1", description: "Tee", qty: 10, _ppp: 12, _lineTotal: 120, taxable: true },
      { id: "L2", description: "Setup fee", qty: 1,  _ppp: 50, _lineTotal: 50,  taxable: false },
    ]);
    const customer = { taxable: true };

    const payload = buildQBOInvoiceJSON(quote, { customer });

    expect(payload.Line[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: "TAX" });
    expect(payload.Line[1].SalesItemLineDetail.TaxCodeRef).toEqual({ value: "NON" });
  });

  it("forces all lines to NON when the customer is non-taxable", () => {
    const quote = quoteWith([
      { id: "L1", _lineTotal: 100, taxable: true },
      { id: "L2", _lineTotal: 50,  taxable: true },
    ]);
    const payload = buildQBOInvoiceJSON(quote, { customer: { taxable: false } });
    expect(payload.Line.every(l => l.SalesItemLineDetail.TaxCodeRef.value === "NON")).toBe(true);
  });

  it("includes ship_to_address as BillAddr + ShipAddr", () => {
    const quote = quoteWith([{ id: "L1", _lineTotal: 100, taxable: true }]);
    const customer = {
      taxable: true,
      ship_to_address: { street: "1 Main", city: "Austin", state: "TX", zip: "78701", country: "US" },
    };

    const payload = buildQBOInvoiceJSON(quote, { customer });

    expect(payload.BillAddr).toEqual({
      Line1: "1 Main", City: "Austin", CountrySubDivisionCode: "TX", PostalCode: "78701", Country: "US",
    });
    expect(payload.ShipAddr).toEqual(payload.BillAddr);
  });

  it("sends TxnTaxDetail:{} so QBO AST takes over", () => {
    const payload = buildQBOInvoiceJSON(quoteWith([]), { customer: {} });
    expect(payload.TxnTaxDetail).toEqual({});
  });
});

describe("syncBackFromQBO", () => {
  it("writes returned tax/total/invoice id onto the local quote", () => {
    const quote = { id: "q-1", qb_total: null, qb_tax: null };
    const updated = syncBackFromQBO(quote, {
      qbInvoiceId: "INV-42",
      qb_tax: 8.88,
      qb_total: 108.88,
    });
    expect(updated.qb_invoice_id).toBe("INV-42");
    expect(updated.qb_tax).toBe(8.88);
    expect(updated.qb_total).toBe(108.88);
  });

  it("preserves existing values when QBO omits them", () => {
    const quote = { id: "q-1", qb_total: 100, qb_tax: 8 };
    const updated = syncBackFromQBO(quote, { qbInvoiceId: "INV-42" });
    expect(updated.qb_total).toBe(100);
    expect(updated.qb_tax).toBe(8);
    expect(updated.qb_invoice_id).toBe("INV-42");
  });
});

describe("createQuickBooksTaxProvider.pushInvoice", () => {
  it("POSTs to qbSyncUrl and returns the QBO-derived totals", async () => {
    const httpClient = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        qbInvoiceId: "INV-42",
        qb_tax: 8.88,
        qb_total: 108.88,
        paymentLink: "https://pay.example.com/xyz",
      }),
    });

    const provider = createQuickBooksTaxProvider({
      httpClient,
      qbSyncUrl: QB_URL,
      accessToken: "token-abc",
    });

    const quote = quoteWith([
      { id: "L1", description: "Tee", qty: 10, _ppp: 10, _lineTotal: 100, taxable: true },
    ]);
    const customer = {
      taxable: true,
      ship_to_address: { street: "1 Main", city: "Austin", state: "TX", zip: "78701" },
    };

    const result = await provider.pushInvoice(quote, { customer, invoicePayload: { lines: [], taxPercent: 0 } });

    expect(httpClient).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = httpClient.mock.calls[0];
    expect(calledUrl).toBe(QB_URL);

    const sentBody = JSON.parse(calledOpts.body);
    expect(sentBody.action).toBe("createInvoice");
    expect(sentBody.accessToken).toBe("token-abc");
    expect(sentBody.qboInvoice.Line[0].SalesItemLineDetail.TaxCodeRef.value).toBe("TAX");
    expect(sentBody.qboInvoice.BillAddr.PostalCode).toBe("78701");
    expect(sentBody.qboInvoice.TxnTaxDetail).toEqual({});

    expect(result.externalId).toBe("INV-42");
    expect(result.taxFromProvider).toBe(8.88);
    expect(result.totalFromProvider).toBe(108.88);
  });

  it("calculate() returns nulls before push and persisted values after", () => {
    const provider = createQuickBooksTaxProvider({
      httpClient: vi.fn(),
      qbSyncUrl: QB_URL,
      accessToken: "tok",
    });

    expect(provider.calculate({ id: "q-1" })).toMatchObject({
      totalTax: 0, rate: null, jurisdiction: null,
    });

    const synced = provider.calculate({ id: "q-1", qb_total: 108.88, qb_tax: 8.88 });
    expect(synced.totalTax).toBe(8.88);
  });

  it("throws on non-OK response", async () => {
    const httpClient = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "QB realm not connected" }),
    });
    const provider = createQuickBooksTaxProvider({ httpClient, qbSyncUrl: QB_URL, accessToken: "t" });
    await expect(
      provider.pushInvoice(quoteWith([]), { customer: {} })
    ).rejects.toThrow("QB realm not connected");
  });
});
