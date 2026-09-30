import { describe, it, expect } from "vitest";
import {
  PLATFORM_PRICING,
  platformFeeCents,
  shopNetCents,
  normalizePayMethod,
  formatRatePct,
} from "../rainforestPricing.js";
import {
  choosePayTarget,
  liveInvoiceIsStale,
  payinIdempotencyKey,
  buildPayinMetadata,
  buildInvoiceDetail,
  NOT_PAYABLE,
} from "../rainforestPayinPlan.js";

// ── Pricing: match QuickBooks (Joe, 2026-09-30) ─────────────────────────
describe("platform pricing matches QuickBooks", () => {
  it("is 2.99% on cards and 1% on bank, no fixed fee, no cap", () => {
    expect(PLATFORM_PRICING.card).toEqual({ ratePct: 2.99, fixedCents: 0, capCents: null });
    expect(PLATFORM_PRICING.ach).toEqual({ ratePct: 1.0, fixedCents: 0, capCents: null });
    expect(formatRatePct("card")).toBe("2.99%");
    expect(formatRatePct("ach")).toBe("1%");
  });

  it("computes the fee in exact integer cents, rounded half-up once", () => {
    expect(platformFeeCents("card", 104000)).toBe(3110); // $1,040 → $31.10
    expect(platformFeeCents("card", 228482)).toBe(6832); // Tahoe Gift $2,284.82 → $68.32
    expect(platformFeeCents("ach", 129700)).toBe(1297);  // $1,297 → $12.97
    expect(platformFeeCents("card", 100)).toBe(3);       // $1 → 2.99¢ rounds to 3
    expect(platformFeeCents("ach", 50)).toBe(1);         // 0.5¢ rounds half-up
    expect(platformFeeCents("ach", 49)).toBe(0);
  });

  it("never returns NaN or charges on junk amounts", () => {
    for (const bad of [0, -100, null, undefined, "abc", NaN, 12.5]) {
      expect(platformFeeCents("card", bad)).toBe(0);
    }
    expect(platformFeeCents("paypal", 10000)).toBe(0);
  });

  it("shop net is amount minus fee", () => {
    expect(shopNetCents("card", 104000)).toBe(100890);
    expect(shopNetCents("ach", 104000)).toBe(102960);
  });

  it("normalises processor method names", () => {
    expect(normalizePayMethod("CARD")).toBe("card");
    expect(normalizePayMethod("bank_account")).toBe("ach");
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
  it("same quote/invoice/amount → same key; a new balance → new key", () => {
    const a = payinIdempotencyKey({ quoteId: "q", qbInvoiceId: "1", amountCents: 100 });
    expect(a).toBe(payinIdempotencyKey({ quoteId: "q", qbInvoiceId: "1", amountCents: 100 }));
    expect(a).not.toBe(payinIdempotencyKey({ quoteId: "q", qbInvoiceId: "1", amountCents: 99 }));
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

// ── Invoice detail for business cards ──────────────────────────────────
const salesLine = (desc, qty, amount) => ({ DetailType: "SalesItemLineDetail", Description: desc, Amount: amount, SalesItemLineDetail: { Qty: qty } });

describe("buildInvoiceDetail", () => {
  const live = inv({
    TotalAmt: 1100, Balance: 1100, TxnTaxDetail: { TotalTax: 100 },
    Line: [salesLine("Comfort Colors 1717 White | S:100 | Front 1 color", 100, 1000), { DetailType: "SubTotalLineDetail", Amount: 1000 }],
  });

  it("full payment whose lines + tax reconcile → line items sent", () => {
    const d = buildInvoiceDetail({ quote: quote(), target: { kind: "full", amountCents: 110000 }, liveInvoice: live });
    expect(d.taxCents).toBe(10000);
    expect(d.customerCode).toBe("61");
    expect(d.poNumber).toBe("Q-2026-HKSO");
    expect(d.lineItems).toEqual([
      { description: "Comfort Colors 1717 White | S:100 |", quantity: 100, unitCents: 1000, totalCents: 100000 },
    ]);
  });

  it("a deposit or balance payment carries summary only — never lines that don't add up", () => {
    const d = buildInvoiceDetail({ quote: quote(), target: { kind: "balance", amountCents: 60000 }, liveInvoice: live });
    expect(d.lineItems).toEqual([]);
    expect(d.taxCents).toBeNull();
    expect(d.customerCode).toBe("61");
  });

  it("a discounted invoice sends summary only (lines would overstate the charge)", () => {
    const disc = inv({ TotalAmt: 900, Balance: 900, TxnTaxDetail: { TotalTax: 0 },
      Line: [salesLine("Tee", 10, 1000), { DetailType: "DiscountLineDetail", Amount: 100 }] });
    const d = buildInvoiceDetail({ quote: quote(), target: { kind: "full", amountCents: 90000 }, liveInvoice: disc });
    expect(d.lineItems).toEqual([]);
  });

  it("lines that don't sum to the charge are dropped rather than sent wrong", () => {
    const d = buildInvoiceDetail({ quote: quote(), target: { kind: "full", amountCents: 999999 }, liveInvoice: live });
    expect(d.lineItems).toEqual([]);
  });
});
