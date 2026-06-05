import { describe, it, expect } from "vitest";
import {
  buildQuotePatchFromFreshInvoice,
  decideRefreshConversion,
  REFRESH_CONVERSION,
} from "../qbRefreshLogic.js";

// ─────────────────────────────────────────────────────────────────────
// buildQuotePatchFromFreshInvoice
// ─────────────────────────────────────────────────────────────────────

describe("buildQuotePatchFromFreshInvoice (BPF)", () => {
  it("BPF1 — null invoice → null patch (nothing to do)", () => {
    expect(buildQuotePatchFromFreshInvoice(null, {})).toBe(null);
  });

  it("BPF2 — unpaid invoice → totals patch, no paid flip", () => {
    const inv = {
      TotalAmt: 250.0,
      Balance:  250.0,
      TxnTaxDetail: { TotalTax: 20.0 },
    };
    const patch = buildQuotePatchFromFreshInvoice(inv, { paid: false });
    expect(patch.qb_total).toBe(250);
    expect(patch.qb_tax_amount).toBe(20);
    expect(patch.qb_subtotal).toBe(230);
    expect(patch.paid).toBeUndefined();
    expect(patch.paid_date).toBeUndefined();
  });

  it("BPF3 — paid invoice + unpaid quote → flips paid + stamps paid_date", () => {
    const inv = {
      TotalAmt: 500.0,
      Balance:  0,
      TxnTaxDetail: { TotalTax: 0 },
    };
    const patch = buildQuotePatchFromFreshInvoice(inv, { paid: false });
    expect(patch.paid).toBe(true);
    expect(patch.paid_date).toBe(patch.qb_synced_at);
  });

  it("BPF4 — paid invoice + already-paid quote → no paid flip (idempotent)", () => {
    const inv = { TotalAmt: 100, Balance: 0 };
    const patch = buildQuotePatchFromFreshInvoice(inv, { paid: true });
    expect(patch.paid).toBeUndefined();
  });

  it("BPF5 — $0 invoice with Balance=0 is NOT paid (matches qbInvoice predicate)", () => {
    const inv = { TotalAmt: 0, Balance: 0 };
    const patch = buildQuotePatchFromFreshInvoice(inv, { paid: false });
    expect(patch.paid).toBeUndefined();
  });

  it("BPF6 — fresh payment link overwrites; missing link does NOT clear existing one", () => {
    const withLink = {
      TotalAmt: 100, Balance: 100,
      InvoiceLink: "https://qb.example/pay/abc",
    };
    expect(buildQuotePatchFromFreshInvoice(withLink, {}).qb_payment_link)
      .toBe("https://qb.example/pay/abc");

    const without = { TotalAmt: 100, Balance: 100 };
    // The KEY assertion: no qb_payment_link key in patch when QB
    // returns no link. If we wrote null we'd silently clear the
    // operator's previously-minted link on every refresh.
    expect(buildQuotePatchFromFreshInvoice(without, {}).qb_payment_link).toBeUndefined();
  });

  it("BPF7 — qb_synced_at is set to a fresh ISO timestamp", () => {
    const inv = { TotalAmt: 1, Balance: 1 };
    const patch = buildQuotePatchFromFreshInvoice(inv, {});
    expect(typeof patch.qb_synced_at).toBe("string");
    expect(new Date(patch.qb_synced_at).toString()).not.toBe("Invalid Date");
  });
});

// ─────────────────────────────────────────────────────────────────────
// decideRefreshConversion
// ─────────────────────────────────────────────────────────────────────

describe("decideRefreshConversion (DRC)", () => {
  const goodQuote = { id: "q1", shop_owner: "x", quote_id: "Q-1" };

  it("DRC1 — paid invoice + clean quote → CONVERT", () => {
    const inv = { TotalAmt: 100, Balance: 0 };
    expect(decideRefreshConversion(inv, goodQuote).action).toBe(REFRESH_CONVERSION.CONVERT);
  });

  it("DRC2 — unpaid invoice → SKIP_NOT_PAID", () => {
    const inv = { TotalAmt: 100, Balance: 50 };
    expect(decideRefreshConversion(inv, goodQuote).action).toBe(REFRESH_CONVERSION.SKIP_NOT_PAID);
  });

  it("DRC3 — already-converted quote → SKIP_ALREADY_CONVERTED", () => {
    const inv = { TotalAmt: 100, Balance: 0 };
    const q   = { ...goodQuote, status: "Converted to Order" };
    expect(decideRefreshConversion(inv, q).action).toBe(REFRESH_CONVERSION.SKIP_ALREADY_CONVERTED);
  });

  it("DRC4 — quote with converted_order_id but no status field → SKIP_ALREADY_CONVERTED", () => {
    const inv = { TotalAmt: 100, Balance: 0 };
    const q   = { ...goodQuote, converted_order_id: "ord-77" };
    expect(decideRefreshConversion(inv, q).action).toBe(REFRESH_CONVERSION.SKIP_ALREADY_CONVERTED);
  });

  it("DRC5 — invalid quote (no id) → SKIP_INVALID_QUOTE", () => {
    const inv = { TotalAmt: 100, Balance: 0 };
    expect(decideRefreshConversion(inv, { shop_owner: "x" }).action)
      .toBe(REFRESH_CONVERSION.SKIP_INVALID_QUOTE);
  });

  it("DRC6 — invalid quote (no shop_owner) → SKIP_INVALID_QUOTE", () => {
    const inv = { TotalAmt: 100, Balance: 0 };
    expect(decideRefreshConversion(inv, { id: "q1" }).action)
      .toBe(REFRESH_CONVERSION.SKIP_INVALID_QUOTE);
  });
});
