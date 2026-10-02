import { describe, it, expect } from "vitest";
import { isQbStale, isBrokerClientInvoiceStale } from "../qbStale";

describe("isQbStale", () => {
  it("false when no QB invoice", () => {
    expect(isQbStale({ total: 2.08, tax: 0.08 })).toBe(false);
    expect(isQbStale({ qb_total: null, total: 2.08 })).toBe(false);
    expect(isQbStale(null)).toBe(false);
  });

  it("false when QB pre-tax matches quote pre-tax (in sync)", () => {
    // both pre-tax = 1.00
    expect(isQbStale({ total: 1.08, tax: 0.08, qb_total: 1.08, qb_tax_amount: 0.08 })).toBe(false);
  });

  it("false when only the TAX differs (QB tax by address vs our estimate)", () => {
    // pre-tax both 100.00; QB tax 9.10 vs our 8.27 — NOT stale
    expect(isQbStale({ total: 108.27, tax: 8.27, qb_total: 109.10, qb_tax_amount: 9.10 })).toBe(false);
  });

  it("true when a fee was added after the invoice (pre-tax diverges)", () => {
    // quote pre-tax 2.00 (incl $1 shipping); QB pre-tax 1.00 — stale
    expect(isQbStale({ total: 2.08, tax: 0.08, qb_total: 1.08, qb_tax_amount: 0.08 })).toBe(true);
  });

  it("true when the quote pre-tax dropped below the QB invoice", () => {
    expect(isQbStale({ total: 1.08, tax: 0.08, qb_total: 51.08, qb_tax_amount: 0.08 })).toBe(true);
  });
});

// ── edge cases ───────────────────────────────────────────────────────────────
describe("isQbStale — edge cases", () => {
  it("handles numeric STRING fields (Postgres returns strings)", () => {
    // pre-tax 2.00 vs 1.00 → stale, even as strings
    expect(isQbStale({ total: "2.08", tax: "0.08", qb_total: "1.08", qb_tax_amount: "0.08" })).toBe(true);
    expect(isQbStale({ total: "1.08", tax: "0.08", qb_total: "1.08", qb_tax_amount: "0.08" })).toBe(false);
  });

  it("ignores sub-cent floating-point noise but flags real differences", () => {
    // ~0.001 diff (well under the 1-cent tolerance) → not stale
    expect(isQbStale({ total: 1.001, tax: 0, qb_total: 1.00, qb_tax_amount: 0 })).toBe(false);
    // a real $1 difference → stale
    expect(isQbStale({ total: 2.00, tax: 0, qb_total: 1.00, qb_tax_amount: 0 })).toBe(true);
  });

  it("not stale when qb_total present but our total is missing/NaN (don't false-flag)", () => {
    expect(isQbStale({ qb_total: 1.08, qb_tax_amount: 0.08 })).toBe(false);
    expect(isQbStale({ total: "abc", qb_total: 1.08, qb_tax_amount: 0.08 })).toBe(false);
  });

  it("treats missing qb_tax_amount as 0", () => {
    // qb pre-tax = 1.08; our pre-tax = 1.00 → stale
    expect(isQbStale({ total: 1.00, tax: 0, qb_total: 1.08 })).toBe(true);
  });
});

describe("isBrokerClientInvoiceStale", () => {
  it("false when no minted total stamped (legacy / pre-migration invoice)", () => {
    expect(isBrokerClientInvoiceStale({ client_total: 769.5 })).toBe(false);
    expect(isBrokerClientInvoiceStale({ client_total: 769.5, qb_broker_client_invoice_total: null })).toBe(false);
    expect(isBrokerClientInvoiceStale({ client_total: 769.5, qb_broker_client_invoice_total: 0 })).toBe(false);
    expect(isBrokerClientInvoiceStale(null)).toBe(false);
  });

  it("false when the current client total matches what was invoiced", () => {
    expect(isBrokerClientInvoiceStale({ client_total: 769.5, qb_broker_client_invoice_total: 769.5 })).toBe(false);
    // sub-cent noise tolerated
    expect(isBrokerClientInvoiceStale({ client_total: 769.501, qb_broker_client_invoice_total: 769.5 })).toBe(false);
  });

  it("true when the quote was edited after invoicing (totals diverge)", () => {
    // invoiced at 769.50, quote now says 820 → stale, link must be gated
    expect(isBrokerClientInvoiceStale({ client_total: 820, qb_broker_client_invoice_total: 769.5 })).toBe(true);
    // also catches a DROP (client now owes less than the stale invoice charges)
    expect(isBrokerClientInvoiceStale({ client_total: 700, qb_broker_client_invoice_total: 769.5 })).toBe(true);
  });

  it("handles Postgres numeric strings", () => {
    expect(isBrokerClientInvoiceStale({ client_total: "820", qb_broker_client_invoice_total: "769.5" })).toBe(true);
    expect(isBrokerClientInvoiceStale({ client_total: "769.5", qb_broker_client_invoice_total: "769.5" })).toBe(false);
  });

  it("not stale when client_total is missing/NaN (don't false-flag)", () => {
    expect(isBrokerClientInvoiceStale({ qb_broker_client_invoice_total: 769.5 })).toBe(false);
    expect(isBrokerClientInvoiceStale({ client_total: "abc", qb_broker_client_invoice_total: 769.5 })).toBe(false);
  });
});
