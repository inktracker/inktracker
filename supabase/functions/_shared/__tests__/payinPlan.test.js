import { describe, it, expect } from "vitest";
import {
  PLATFORM_PRICING,
  STRIPE_COST,
  platformFeeCents,
  stripeCostCents,
  quickbooksPriceCents,
  shopTotalFeeCents,
  shopNetCents,
  normalizePayMethod,
  formatRatePct,
} from "../paymentsPricing.js";
import {
  choosePayTarget,
  liveInvoiceIsStale,
  payinIdempotencyKey,
  buildPayinMetadata,
  previewFee,
  NOT_PAYABLE,
  CHECKOUT_WINDOW_MS,
} from "../payinPlan.js";

// ── Pricing: the shop pays what QuickBooks charges (Joe, 2026-09-30) ────
describe("pricing: shop's all-in cost matches QuickBooks; InkTracker gets what Stripe leaves", () => {
  it("QuickBooks price is 2.99% card / 1% bank; Stripe is 2.9% + 30¢ / 0.8% capped $5 + $1.50 verification", () => {
    expect(PLATFORM_PRICING.card).toEqual({ ratePct: 2.99, fixedCents: 0, capCents: null });
    expect(PLATFORM_PRICING.ach).toEqual({ ratePct: 1.0, fixedCents: 0, capCents: null });
    expect(STRIPE_COST.card).toMatchObject({ ratePct: 2.9, fixedCents: 30 });
    expect(STRIPE_COST.ach).toMatchObject({ ratePct: 0.8, capCents: 500, verifyCents: 150 });
    expect(formatRatePct("card")).toBe("2.99%");
    expect(formatRatePct("ach")).toBe("1%");
  });

  it("Biota's average card payment ($1,126.48): InkTracker earns ~72¢, shop pays exactly the QuickBooks price", () => {
    expect(quickbooksPriceCents("card", 112648)).toBe(3368);
    expect(stripeCostCents("card", 112648)).toBe(3297); // 3267 + 30
    expect(platformFeeCents("card", 112648)).toBe(71);
    expect(shopTotalFeeCents("card", 112648)).toBe(3368);
  });

  it("Biota's average bank payment ($1,297): Stripe capped at $5 + $1.50, InkTracker earns $6.47", () => {
    expect(quickbooksPriceCents("ach", 129700)).toBe(1297);
    expect(stripeCostCents("ach", 129700)).toBe(650);
    expect(platformFeeCents("ach", 129700)).toBe(647);
    expect(shopTotalFeeCents("ach", 129700)).toBe(1297);
  });

  it("small card payments: Stripe's 30¢ is more than 2.99%, so InkTracker takes nothing (never negative)", () => {
    expect(platformFeeCents("card", 5000)).toBe(0);
    expect(shopTotalFeeCents("card", 5000)).toBe(175); // Stripe's price, not below
    expect(platformFeeCents("ach", 10000)).toBe(0);     // $100 bank: 1% = $1 < 80¢ + $1.50
  });

  it("integer cents, half-up once; never NaN or a fee on junk", () => {
    expect(quickbooksPriceCents("card", 104000)).toBe(3110);
    for (const bad of [0, -100, null, undefined, "abc", NaN, 12.5]) {
      expect(platformFeeCents("card", bad)).toBe(0);
      expect(shopNetCents("card", bad)).toBe(0);
    }
    expect(platformFeeCents("paypal", 10000)).toBe(0);
  });

  it("shop net is the amount minus everything it pays", () => {
    expect(shopNetCents("card", 112648)).toBe(112648 - 3368);
    expect(previewFee({ method: "ach", amountCents: 129700 })).toEqual({ method: "ach", feeCents: 1297, platformFeeCents: 647, netCents: 128403 });
  });

  it("normalises Stripe and other method names", () => {
    expect(normalizePayMethod("card")).toBe("card");
    expect(normalizePayMethod("us_bank_account")).toBe("ach");
    expect(normalizePayMethod("ACH")).toBe("ach");
    expect(normalizePayMethod("venmo")).toBeNull();
  });
});

// ── What gets charged ──────────────────────────────────────────────────
const inv = (over = {}) => ({
  Id: "3815",
  TotalAmt: 1643,
  Balance: 1643,
  TxnTaxDetail: { TotalTax: 0 },
  CustomerRef: { value: "61" },
  DocNumber: "Q-2026-HKSO",
  Line: [],
  ...over,
});
const quote = (over = {}) => ({
  id: "q-uuid",
  quote_id: "Q-2026-HKSO",
  shop_owner: "joe@biotamfg.co",
  total: 1643,
  tax: 0,
  qb_invoice_id: "3815",
  ...over,
});

describe("choosePayTarget", () => {
  it("charges the live QuickBooks balance on a normal quote", () => {
    expect(choosePayTarget({ quote: quote(), depositsEnabled: true, liveFinal: inv() }))
      .toEqual({ ok: true, kind: "full", qbInvoiceId: "3815", amountCents: 164300 });
  });

  it("charges what QUICKBOOKS says is owed, not the saved total", () => {
    // Joe's own test quote: QB auto-applied an old $143.99 credit.
    const t = choosePayTarget({ quote: quote(), depositsEnabled: true, liveFinal: inv({ Balance: 1499.01 }) });
    expect(t).toEqual({ ok: true, kind: "balance", qbInvoiceId: "3815", amountCents: 149901 });
  });

  it("refuses to charge an invoice that is already paid — a second click can't double-charge", () => {
    expect(choosePayTarget({ quote: quote(), depositsEnabled: true, liveFinal: inv({ Balance: 0 }) }))
      .toEqual({ ok: false, reason: NOT_PAYABLE.PAID });
  });

  it("routes an unpaid deposit to the DEPOSIT invoice while no final invoice exists", () => {
    const q = quote({ qb_invoice_id: null, qb_deposit_invoice_id: "3900", deposit_amount: 500, deposit_paid: false });
    const t = choosePayTarget({ quote: q, depositsEnabled: true, liveDeposit: inv({ Id: "3900", TotalAmt: 500, Balance: 500 }) });
    expect(t).toEqual({ ok: true, kind: "deposit", qbInvoiceId: "3900", amountCents: 50000 });
  });

  it("deposit already paid and no final invoice yet → nothing to charge", () => {
    const q = quote({ qb_invoice_id: null, qb_deposit_invoice_id: "3900", deposit_amount: 500, deposit_paid: false });
    expect(choosePayTarget({ quote: q, depositsEnabled: true, liveDeposit: inv({ Id: "3900", Balance: 0 }) }).reason)
      .toBe(NOT_PAYABLE.DEPOSIT_PAID_AWAITING_FINAL);
  });

  it("deposit paid (flag set) and no final invoice yet → 'awaiting final', not 'not set up'", () => {
    const q = quote({ qb_invoice_id: null, qb_deposit_invoice_id: "3900", deposit_amount: 500, deposit_paid: true });
    expect(choosePayTarget({ quote: q, depositsEnabled: true }).reason).toBe(NOT_PAYABLE.DEPOSIT_PAID_AWAITING_FINAL);
  });

  it("once the final invoice exists, the deposit window is over — pay the final balance", () => {
    const q = quote({ qb_deposit_invoice_id: "3900", deposit_amount: 500, deposit_paid: true });
    expect(choosePayTarget({ quote: q, depositsEnabled: true, liveFinal: inv({ Balance: 1143 }) }))
      .toMatchObject({ ok: true, kind: "balance", amountCents: 114300 });
  });

  it("deposits switched off → a stray deposit request falls through to the final invoice", () => {
    const q = quote({ qb_deposit_invoice_id: "3900", deposit_amount: 500, qb_invoice_id: "3815" });
    expect(choosePayTarget({ quote: q, depositsEnabled: false, liveFinal: inv() }).kind).toBe("full");
  });

  it("never takes payment on a broker quote", () => {
    expect(choosePayTarget({ quote: quote({ broker_id: "b@x.com" }), depositsEnabled: true, liveFinal: inv() }).reason)
      .toBe(NOT_PAYABLE.BROKER);
  });

  it("blocks when the quote changed after its QB invoice (customer would under-pay)", () => {
    const q = quote({ total: 1700 }); // $57 fee added after invoicing
    expect(choosePayTarget({ quote: q, depositsEnabled: true, liveFinal: inv() }).reason).toBe(NOT_PAYABLE.STALE);
  });

  it("a tax-only difference is NOT stale — QuickBooks computes tax from the address", () => {
    const q = quote({ total: 1778.79, tax: 135.79 });
    const live = inv({ TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 } });
    expect(liveInvoiceIsStale(q, live)).toBe(false);
    expect(choosePayTarget({ quote: q, depositsEnabled: true, liveFinal: live }).ok).toBe(true);
  });

  it("no QB invoice → not payable here (the shop needs to invoice first)", () => {
    expect(choosePayTarget({ quote: quote({ qb_invoice_id: null }), depositsEnabled: true }).reason).toBe(NOT_PAYABLE.NO_INVOICE);
    expect(choosePayTarget({ quote: quote(), depositsEnabled: true, liveFinal: null }).reason).toBe(NOT_PAYABLE.NO_INVOICE);
  });

  it("junk balances are refused, never charged", () => {
    expect(choosePayTarget({ quote: quote(), depositsEnabled: true, liveFinal: inv({ Balance: "abc" }) }).reason)
      .toBe(NOT_PAYABLE.BAD_AMOUNT);
  });
});

describe("idempotency + metadata", () => {
  const t0 = Date.UTC(2026, 9, 1, 15, 5);
  const k = (o = {}) => payinIdempotencyKey({ quoteId: "q", qbInvoiceId: "1", amountCents: 100, method: "card", nowMs: t0, ...o });
  it("same doc/invoice/amount/method in the same 30-min window → same key AND same expiry", () => {
    expect(k()).toEqual(k({ nowMs: t0 + 10 * 60 * 1000 }));
    expect(k().key).not.toBe(k({ amountCents: 99 }).key);
    expect(k().key).not.toBe(k({ method: "ach" }).key);
    expect(k().key).not.toBe(k({ attempt: 1 }).key);
    expect(k().key).not.toBe(k({ nowMs: t0 + CHECKOUT_WINDOW_MS }).key);
  });
  it("the checkout lives at least an hour from any request in its window (Stripe needs ≥ 30 min)", () => {
    const windowStart = Math.floor(t0 / CHECKOUT_WINDOW_MS) * CHECKOUT_WINDOW_MS;
    for (const now of [windowStart, windowStart + CHECKOUT_WINDOW_MS - 1]) {
      const { expiresAt } = k({ nowMs: now });
      expect(expiresAt * 1000 - now).toBeGreaterThanOrEqual(60 * 60 * 1000);
    }
  });

  it("metadata carries the ids the webhook needs, as strings", () => {
    expect(buildPayinMetadata({ quote: quote(), target: { kind: "full", qbInvoiceId: "3815" } })).toEqual({
      inktracker_doc_type: "quote",
      inktracker_quote_id: "q-uuid",
      quote_number: "Q-2026-HKSO",
      shop_owner: "joe@biotamfg.co",
      qb_invoice_id: "3815",
      pay_kind: "full",
    });
  });
});

describe("invoices (order-then-invoice flow) pay the same way", () => {
  const invoiceRow = { id: "inv-uuid", invoice_id: "INV-2026-0042", shop_owner: "joe@biotamfg.co", total: 1643, tax: 0, qb_invoice_id: "3815" };
  it("routes to the invoice's QB balance and tags the metadata as an invoice", () => {
    const t = choosePayTarget({ quote: invoiceRow, depositsEnabled: true, liveFinal: inv() });
    expect(t).toEqual({ ok: true, kind: "full", qbInvoiceId: "3815", amountCents: 164300 });
    expect(buildPayinMetadata({ quote: invoiceRow, target: t, docType: "invoice" })).toMatchObject({
      inktracker_doc_type: "invoice",
      inktracker_quote_id: "inv-uuid",
      quote_number: "INV-2026-0042",
    });
  });
});
