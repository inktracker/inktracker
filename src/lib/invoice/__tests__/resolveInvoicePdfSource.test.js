import { describe, it, expect } from "vitest";
import { resolveInvoicePdfSource } from "../resolveInvoicePdfSource";

describe("resolveInvoicePdfSource", () => {
  it("routes to QB when qb_invoice_id is a non-empty string", () => {
    expect(resolveInvoicePdfSource({ qb_invoice_id: "INV-42" })).toEqual({
      source: "qb",
      qbInvoiceId: "INV-42",
    });
  });

  it("routes to QB when qb_invoice_id is a numeric id (QB sometimes returns numbers)", () => {
    expect(resolveInvoicePdfSource({ qb_invoice_id: 42 })).toEqual({
      source: "qb",
      qbInvoiceId: "42",
    });
  });

  it("routes to local when qb_invoice_id is missing", () => {
    expect(resolveInvoicePdfSource({})).toEqual({
      source: "local",
      qbInvoiceId: null,
    });
  });

  it("routes to local when qb_invoice_id is null/undefined", () => {
    expect(resolveInvoicePdfSource({ qb_invoice_id: null }).source).toBe("local");
    expect(resolveInvoicePdfSource({ qb_invoice_id: undefined }).source).toBe("local");
  });

  it("routes to local when qb_invoice_id is an empty/whitespace string", () => {
    expect(resolveInvoicePdfSource({ qb_invoice_id: "" }).source).toBe("local");
    expect(resolveInvoicePdfSource({ qb_invoice_id: "   " }).source).toBe("local");
  });

  it("routes to local when qb_invoice_id is a non-finite number", () => {
    expect(resolveInvoicePdfSource({ qb_invoice_id: NaN }).source).toBe("local");
    expect(resolveInvoicePdfSource({ qb_invoice_id: Infinity }).source).toBe("local");
  });

  it("survives null/undefined invoice without throwing", () => {
    expect(resolveInvoicePdfSource(null).source).toBe("local");
    expect(resolveInvoicePdfSource(undefined).source).toBe("local");
  });
});
