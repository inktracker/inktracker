import { describe, it, expect } from "vitest";
import {
  effectiveCustomerTotal,
  decideCustomerCharge,
  buildCheckoutLineItems,
  InvalidChargeAmountError,
} from "../customerCharge.js";

// ─────────────────────────────────────────────────────────────────────
// effectiveCustomerTotal — what we charge the customer
// ─────────────────────────────────────────────────────────────────────

describe("effectiveCustomerTotal (CT priority chain)", () => {
  it("CT1 — qb_total wins (QB invoice is the billing source of truth)", () => {
    const r = effectiveCustomerTotal({
      total: 1000,        // saved
      qb_total: 999.50,   // QB recorded slightly different (tax rounding)
    });
    expect(r.total).toBe(999.50);
    expect(r.source).toBe("qb");
  });

  it("CT2 — no qb_total → saved total", () => {
    const r = effectiveCustomerTotal({ total: 1000 });
    expect(r.total).toBe(1000);
    expect(r.source).toBe("saved");
  });

  it("CT3 — neither qb nor saved → live calc fallback", () => {
    // No saved total, no qb_total. The live calc on empty line_items
    // returns 0 — that's the floor, surfaced as 'live'.
    const r = effectiveCustomerTotal({ line_items: [] });
    expect(r.total).toBe(0);
    expect(r.source).toBe("live");
  });

  it("CT4 — qb_total === 0 is IGNORED (treated as missing)", () => {
    // A quote without a QB invoice has qb_total = null. If somehow
    // it's set to 0, that's nonsensical for billing — fall through.
    const r = effectiveCustomerTotal({ qb_total: 0, total: 500 });
    expect(r.total).toBe(500);
    expect(r.source).toBe("saved");
  });

  it("CT5 — null/undefined quote → safe 0, no crash", () => {
    expect(effectiveCustomerTotal(null)).toEqual({ total: 0, source: "live" });
    expect(effectiveCustomerTotal(undefined)).toEqual({ total: 0, source: "live" });
  });

  it("CT6 — invalid qb_total (NaN, string) falls back to saved", () => {
    expect(effectiveCustomerTotal({ qb_total: "garbage", total: 500 }).source).toBe("saved");
    expect(effectiveCustomerTotal({ qb_total: NaN, total: 500 }).source).toBe("saved");
  });
});

// ─────────────────────────────────────────────────────────────────────
// decideCustomerCharge — deposit / remaining / full
// ─────────────────────────────────────────────────────────────────────

describe("decideCustomerCharge (DC1–DC8)", () => {
  const baseQuote = { quote_id: "Q-2026-X", total: 1000 };

  it("DC1 — no deposit configured: charge full effectiveTotal", () => {
    const r = decideCustomerCharge(baseQuote, {});
    expect(r.chargeAmount).toBe(1000);
    expect(r.isDeposit).toBe(false);
    expect(r.label).toMatch(/Quote Q-2026-X/);
  });

  it("DC2 — deposit configured, unpaid: charge deposit %", () => {
    const r = decideCustomerCharge({ ...baseQuote, deposit_pct: 30 }, {});
    expect(r.chargeAmount).toBe(300);
    expect(r.isDeposit).toBe(true);
    expect(r.label).toMatch(/Deposit \(30%\)/);
  });

  it("DC3 — deposit already paid: charge remaining balance", () => {
    const r = decideCustomerCharge(
      { ...baseQuote, deposit_pct: 30, deposit_paid: true },
      {},
    );
    expect(r.chargeAmount).toBe(700);
    expect(r.isDeposit).toBe(false);
    expect(r.label).toMatch(/Remaining Balance/);
  });

  it("DC4 — customer.default_deposit_pct OVERRIDES quote.deposit_pct", () => {
    // The shop set the customer to "pay in full" via the customer
    // record; that must win over the quote's own deposit setting.
    const r = decideCustomerCharge(
      { ...baseQuote, deposit_pct: 30 },
      { default_deposit_pct: 0 },
    );
    expect(r.chargeAmount).toBe(1000);
    expect(r.isDeposit).toBe(false);
    expect(r.depositPct).toBe(0);
  });

  it("DC5 — customer.default_deposit_pct = 50 with quote.deposit_pct = 30 → 50 wins", () => {
    const r = decideCustomerCharge(
      { ...baseQuote, deposit_pct: 30 },
      { default_deposit_pct: 50 },
    );
    expect(r.chargeAmount).toBe(500);
    expect(r.depositPct).toBe(50);
  });

  it("DC6 — 100% deposit + paid: remaining = 0 (the edge case)", () => {
    // Some shops collect full payment up front as a "deposit". After
    // that's paid, there's nothing left to charge. Test should
    // produce 0 — the caller (QuotePayment) is responsible for not
    // sending 0 to Stripe.
    const r = decideCustomerCharge(
      { ...baseQuote, deposit_pct: 100, deposit_paid: true },
      {},
    );
    expect(r.chargeAmount).toBe(0);
  });

  it("DC7 — qb_total is what gets % deposit applied (not quote.total)", () => {
    // If QB recorded $999.50 and quote.total was $1000, the deposit
    // is taken from $999.50 — keeping Stripe + QB in sync.
    const r = decideCustomerCharge(
      { quote_id: "Q-1", total: 1000, qb_total: 999.50, deposit_pct: 50 },
      {},
    );
    expect(r.chargeAmount).toBe(499.75);
    expect(r.effectiveTotal).toBe(999.50);
  });

  it("DC8 — undefined customer is fine (no crash on first-time payer)", () => {
    expect(() => decideCustomerCharge(baseQuote, undefined)).not.toThrow();
    expect(decideCustomerCharge(baseQuote, undefined).chargeAmount).toBe(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildCheckoutLineItems — the Stripe payload
// ─────────────────────────────────────────────────────────────────────

describe("buildCheckoutLineItems (BL1–BL5)", () => {
  it("BL1 — converts dollars to cents (Stripe contract)", () => {
    const items = buildCheckoutLineItems({ quote_id: "Q-1" }, 100, "Deposit");
    expect(items[0].unit_amount).toBe(10000);
  });

  it("BL2 — rounds to nearest cent (no half-cents in Stripe)", () => {
    const items = buildCheckoutLineItems({ quote_id: "Q-1" }, 100.005, "test");
    expect(items[0].unit_amount).toBe(10001); // 0.005 rounds to 1c
  });

  it("BL3 — name includes the quote_id; label becomes description", () => {
    const items = buildCheckoutLineItems({ quote_id: "Q-2026-X" }, 50, "Deposit (30%)");
    expect(items[0].name).toBe("Quote Q-2026-X");
    expect(items[0].description).toBe("Deposit (30%)");
    expect(items[0].quantity).toBe(1);
  });

  it("BL4 — amount = 0 THROWS (refuses to open a $0 checkout)", () => {
    // The OLD inline implementation used Math.max(1, ...) which
    // silently charged $0.01. That hid bugs — $0 means our calc
    // produced nothing chargeable, which is an error, not a penny.
    expect(() => buildCheckoutLineItems({ quote_id: "Q-1" }, 0, "x"))
      .toThrow(InvalidChargeAmountError);
  });

  it("BL5 — negative amount THROWS", () => {
    expect(() => buildCheckoutLineItems({ quote_id: "Q-1" }, -5, "x"))
      .toThrow(InvalidChargeAmountError);
  });

  it("BL5 — non-numeric amount THROWS", () => {
    expect(() => buildCheckoutLineItems({ quote_id: "Q-1" }, "not a number", "x"))
      .toThrow(InvalidChargeAmountError);
    expect(() => buildCheckoutLineItems({ quote_id: "Q-1" }, undefined, "x"))
      .toThrow(InvalidChargeAmountError);
  });
});

// ─────────────────────────────────────────────────────────────────────
// End-to-end: customer email amount === Stripe checkout amount
// ─────────────────────────────────────────────────────────────────────

describe("Customer-side numbers match — Stripe charges what the email said", () => {
  it("XC1 — saved quote: Stripe unit_amount === quote.total × 100", () => {
    // The simplest happy path: shop sent quote.total = $500. Customer
    // clicks, no deposit, full payment. Stripe must receive 50000.
    const quote = { quote_id: "Q-1", total: 500 };
    const { chargeAmount } = decideCustomerCharge(quote, {});
    const items = buildCheckoutLineItems(quote, chargeAmount, "");
    expect(items[0].unit_amount).toBe(50000);
  });

  it("XC2 — QB invoice exists: Stripe unit_amount === qb_total × 100", () => {
    // QB rounded subtly differently — Stripe must charge QB's number
    // so reconciliation works. Email-displayed total might be $500
    // but qb_total = $500.02 (cents-level drift). Stripe gets 50002.
    const quote = { quote_id: "Q-1", total: 500, qb_total: 500.02 };
    const { chargeAmount } = decideCustomerCharge(quote, {});
    const items = buildCheckoutLineItems(quote, chargeAmount, "");
    expect(items[0].unit_amount).toBe(50002);
  });

  it("XC3 — deposit flow: Stripe charges 30% of qb_total when present", () => {
    const quote = { quote_id: "Q-1", total: 1000, qb_total: 999.50, deposit_pct: 30 };
    const decision = decideCustomerCharge(quote, {});
    expect(decision.chargeAmount).toBeCloseTo(299.85, 2);
    const items = buildCheckoutLineItems(quote, decision.chargeAmount, decision.label);
    expect(items[0].unit_amount).toBe(29985);
  });

  it("XC4 — 100% deposit already paid: caller never reaches Stripe (chargeAmount=0)", () => {
    const quote = { quote_id: "Q-1", total: 1000, deposit_pct: 100, deposit_paid: true };
    const { chargeAmount } = decideCustomerCharge(quote, {});
    expect(chargeAmount).toBe(0);
    // Caller MUST check chargeAmount before calling buildCheckoutLineItems
    expect(() => buildCheckoutLineItems(quote, chargeAmount, ""))
      .toThrow(InvalidChargeAmountError);
  });
});
