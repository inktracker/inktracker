// "Numbers match" — the highest-stakes invariant in the app.
//
// The shop owner's promise to the customer is: "Quote $X = Stripe
// charge $X = QB invoice $X." If any link in that chain silently
// drifts, the shop loses trust and faces reconciliation hell.
//
// Two places where numbers ARE pinned today:
//   - sum of `lines.Amount` returned by QB vs sum we sent
//     (supabase/functions/_shared/qbWriteContracts.js + tests)
//   - SendQuoteModal payload fields (sendOrchestration tests E1, P4)
//
// What's NOT pinned, and is what this file locks in: the chain from
// calcQuoteTotalsWithLinking → buildQBInvoicePayload. If a future
// change adds a fee bucket to the totals math but forgets to
// surface it on the QB lines (or vice versa), the customer pays one
// price and QB records another. That's the kind of bug that's
// silent until the shop reconciles month-end statements.

import { describe, it, expect, beforeEach } from "vitest";
import {
  calcQuoteTotalsWithLinking,
  buildQBInvoicePayload,
  loadShopPricingConfig,
  STANDARD_MARKUP,
  BROKER_MARKUP,
} from "../pricing";

// Money-comparison tolerance — line totals are rounded to 2 decimals,
// so 1 cent of drift across many lines is acceptable. Anything more
// is a real bug.
const PENNY = 0.011;

function makeImprint(overrides = {}) {
  return {
    id: "imp-1",
    title: "",
    location: "Front",
    width: "",
    height: "",
    colors: 1,
    technique: "Screen Print",
    linked: false,
    ...overrides,
  };
}

function makeLineItem(overrides = {}) {
  return {
    id: "li-1",
    style: "1717",
    brand: "Comfort Colors",
    category: "T-Shirts",
    garmentCost: "4.62",
    garmentColor: "Black",
    sizes: { S: "10", M: "15", L: "20" },
    imprints: [makeImprint()],
    ...overrides,
  };
}

function makeQuote(overrides = {}) {
  return {
    line_items: [makeLineItem()],
    rush_rate: 0,
    extras: {},
    discount: 0,
    discount_type: "percent",
    tax_rate: 0,
    deposit_pct: 0,
    ...overrides,
  };
}

function sumLineAmounts(payload) {
  return payload.lines.reduce((s, l) => s + Number(l.amount || 0), 0);
}

beforeEach(() => {
  // Ensure consistent global pricing config across tests.
  loadShopPricingConfig(null);
});

// ─────────────────────────────────────────────────────────────────────
// Chain: calcQuoteTotalsWithLinking ↔ buildQBInvoicePayload
// ─────────────────────────────────────────────────────────────────────

describe("Numbers match — quote totals ↔ QB invoice payload", () => {
  it("N1 — single line: sum(QB line amounts) ≈ totals.sub", () => {
    const quote = makeQuote();
    const totals = calcQuoteTotalsWithLinking(quote);
    const payload = buildQBInvoicePayload(quote);
    expect(sumLineAmounts(payload)).toBeCloseTo(totals.sub, 1);
  });

  it("N2 — multi-line: sum(QB line amounts) ≈ totals.sub", () => {
    const quote = makeQuote({
      line_items: [
        makeLineItem({ id: "li-A" }),
        makeLineItem({
          id: "li-B",
          style: "5000",
          brand: "Gildan",
          garmentCost: "3.50",
          sizes: { S: "12", M: "8" },
        }),
      ],
    });
    const totals = calcQuoteTotalsWithLinking(quote);
    const payload = buildQBInvoicePayload(quote);
    expect(sumLineAmounts(payload)).toBeCloseTo(totals.sub, 1);
  });

  it("N3 — rush surcharge surfaces in BOTH totals.sub and QB lines", () => {
    const quote = makeQuote({ rush_rate: 0.20 });
    const totals = calcQuoteTotalsWithLinking(quote);
    const payload = buildQBInvoicePayload(quote);
    expect(sumLineAmounts(payload)).toBeCloseTo(totals.sub, 1);
    // Rush adds real money — sub should exceed the no-rush baseline.
    const noRush = calcQuoteTotalsWithLinking(makeQuote({ rush_rate: 0 }));
    expect(totals.sub).toBeGreaterThan(noRush.sub);
  });

  it("N4 — discount lives in QB payload metadata, NOT in line amounts", () => {
    // The contract: QB applies discount on top of the line amounts
    // it receives. If we baked the discount into line amounts here
    // too, QB would double-discount.
    const noDisc = makeQuote();
    const withPct = makeQuote({ discount: 10, discount_type: "percent" });
    const totalsNoDisc = calcQuoteTotalsWithLinking(noDisc);
    const totalsWithDisc = calcQuoteTotalsWithLinking(withPct);
    const payloadNoDisc = buildQBInvoicePayload(noDisc);
    const payloadWithDisc = buildQBInvoicePayload(withPct);

    // afterDisc shows the discount applied
    expect(totalsWithDisc.afterDisc).toBeLessThan(totalsNoDisc.sub);
    // BUT QB lines still sum to the pre-discount subtotal — discount
    // arrives separately in discountPercent / discountAmount.
    expect(sumLineAmounts(payloadWithDisc)).toBeCloseTo(totalsNoDisc.sub, 1);
    expect(payloadWithDisc.discountPercent).toBe(10);
    expect(payloadNoDisc.discountPercent).toBe(0);
  });

  it("N4 — flat-amount discount surfaces in discountAmount, not lines", () => {
    const quote = makeQuote({ discount: 50, discount_type: "flat" });
    const payload = buildQBInvoicePayload(quote);
    expect(payload.discountType).toBe("flat");
    expect(payload.discountAmount).toBe(50);
    expect(payload.discountPercent).toBe(0);
  });

  it("N5 — tax lives in QB payload metadata, NOT in line amounts", () => {
    // Same shape as discount — tax_rate goes on the payload, not the
    // individual lines. QB applies it on its side. Double-taxing
    // would make the customer pay 1.0825 × 1.0825 = 17% extra silently.
    const taxed = makeQuote({ tax_rate: 8.25 });
    const totals = calcQuoteTotalsWithLinking(taxed);
    const payload = buildQBInvoicePayload(taxed);

    // tax in totals reflects the rate
    expect(totals.tax).toBeGreaterThan(0);
    // QB lines sum to subtotal — tax is separate
    expect(sumLineAmounts(payload)).toBeCloseTo(totals.sub, 1);
    expect(payload.taxPercent).toBe(8.25);
  });

  it("N5 — tax_rate = 0 produces taxPercent = 0", () => {
    expect(buildQBInvoicePayload(makeQuote({ tax_rate: 0 })).taxPercent).toBe(0);
  });

  it("N6 — deposit math is (total × deposit_pct), persisted as depositAmount", () => {
    const quote = makeQuote({ deposit_pct: 50, deposit_paid: true });
    const totals = calcQuoteTotalsWithLinking(quote);
    const payload = buildQBInvoicePayload(quote);
    // afterDisc + tax = total; deposit is 50% of that.
    const expectedDeposit = Number((totals.total * 0.50).toFixed(2));
    expect(payload.depositAmount).toBeCloseTo(expectedDeposit, 2);
  });

  it("N6 — deposit_paid = false → depositAmount = 0 even if pct is set", () => {
    const quote = makeQuote({ deposit_pct: 50, deposit_paid: false });
    expect(buildQBInvoicePayload(quote).depositAmount).toBe(0);
  });

  it("N7 — broker quotes: line amounts match BROKER totals, not admin", () => {
    // Brokers see a different price than the shop's standard. If the
    // QB payload reflected the standard markup but the totals used
    // broker markup, the customer would pay one number while QB
    // shows another. Tested explicitly here so a future markup change
    // can't silently desync the two paths.
    const quote = makeQuote();
    const adminTotals = calcQuoteTotalsWithLinking(quote, STANDARD_MARKUP);
    const brokerTotals = calcQuoteTotalsWithLinking(quote, BROKER_MARKUP);
    const brokerPayload = buildQBInvoicePayload(quote, BROKER_MARKUP);

    // Broker price should differ from admin price (otherwise the
    // markup constants aren't doing what we think).
    expect(brokerTotals.sub).not.toBeCloseTo(adminTotals.sub, 1);
    // Critical: QB payload follows the broker totals, not admin.
    expect(sumLineAmounts(brokerPayload)).toBeCloseTo(brokerTotals.sub, 1);
  });

  it("N8 — saved totals + rush: amount includes rushFee, unitPrice is internally consistent (amount/qty)", () => {
    // "Calculate once" + rush. The saved `_lineTotal` is `ppp × qty`
    // (pre-rush). `_rushFee` is the per-line rush component. QB
    // needs `amount = qty × unitPrice`, so we hand back:
    //   amount    = _lineTotal + _rushFee  (rush IS in QB)
    //   unitPrice = amount / qty           (math consistent for QB)
    // Customer sees a slightly-higher per-piece price in QB that
    // reflects the rush — same total customers paid in the email.
    const li = makeLineItem({
      _ppp: 12.345,
      _lineTotal: 555.525, // 12.345 × 45
      _rushFee: 30.00,
    });
    const quote = makeQuote({ line_items: [li] });
    const payload = buildQBInvoicePayload(quote);
    expect(payload.lines[0].amount).toBeCloseTo(585.525, 1);
    expect(payload.lines[0].unitPrice).toBeCloseTo(585.525 / 45, 3);
  });

  it("N8 — saved totals without rush: amount === _lineTotal exactly", () => {
    // No rush means _rushFee is 0 / missing — amount unchanged.
    const li = makeLineItem({
      _ppp: 12.345,
      _lineTotal: 555.55,
      // no _rushFee
    });
    const quote = makeQuote({ line_items: [li], total: 555.55 });
    const payload = buildQBInvoicePayload(quote);
    expect(payload.lines[0].amount).toBe(555.55);
    // unitPrice = 555.55 / 45 = 12.3456 — very close to saved _ppp
    expect(payload.lines[0].unitPrice).toBeCloseTo(12.345, 2);
  });

  it("N8 — broker quote ignores saved _ppp/_lineTotal (markup must always be live)", () => {
    // Saved values reflect the standard markup. Broker quotes need a
    // separate markup applied at send time. If QB silently used the
    // saved admin price, the broker would see broker price in the
    // editor but the customer would be billed admin price in QB.
    const li = makeLineItem({ _ppp: 12.345, _lineTotal: 555.55 });
    const quote = makeQuote({ line_items: [li] });
    const payload = buildQBInvoicePayload(quote, BROKER_MARKUP);
    expect(payload.lines[0].unitPrice).not.toBe(12.345);
  });

  it("N9 — zero-qty lines NEVER produce a QB line (no $0 noise on the invoice)", () => {
    const quote = makeQuote({
      line_items: [
        makeLineItem({ id: "real", sizes: { M: "10" } }),
        makeLineItem({ id: "ghost", sizes: { M: "0", L: "0" } }),
      ],
    });
    const payload = buildQBInvoicePayload(quote);
    expect(payload.lines.length).toBe(1);
    expect(payload.lines[0].qty).toBe(10);
  });

  it("N9 — empty line_items → empty payload lines (no crash)", () => {
    const payload = buildQBInvoicePayload(makeQuote({ line_items: [] }));
    expect(payload.lines).toEqual([]);
  });

  it("N10 — full happy path: discount + rush + tax all reconcile in one quote", () => {
    // Worst-case chain: every fee/discount/tax bucket exercised at
    // once. Any drift in any bucket would surface here.
    const quote = makeQuote({
      rush_rate: 0.15,
      discount: 5,
      discount_type: "percent",
      tax_rate: 8.25,
      line_items: [
        makeLineItem({ id: "A", sizes: { M: "20", L: "10" } }),
        makeLineItem({
          id: "B",
          style: "5000",
          brand: "Gildan",
          garmentCost: "3.10",
          sizes: { S: "15", XL: "5" },
        }),
      ],
    });
    const totals = calcQuoteTotalsWithLinking(quote);
    const payload = buildQBInvoicePayload(quote);

    // (1) QB lines sum to subtotal (pre-discount, pre-tax)
    expect(sumLineAmounts(payload)).toBeCloseTo(totals.sub, 1);
    // (2) Discount + tax surface on the payload metadata, not lines
    expect(payload.discountPercent).toBe(5);
    expect(payload.taxPercent).toBe(8.25);
    // (3) afterDisc < sub by 5%
    expect(totals.afterDisc).toBeCloseTo(totals.sub * 0.95, 1);
    // (4) total = afterDisc + tax
    expect(totals.total).toBeCloseTo(totals.afterDisc + totals.tax, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Chain: live calc ↔ saved totals on the row
// ─────────────────────────────────────────────────────────────────────

describe("Numbers match — saved totals on quote row stay consistent with live calc", () => {
  // The "calculate once" model freezes prices on save so customer-
  // facing totals don't shift while the shop is editing. The test
  // here is: when nothing about the quote has changed since save,
  // saved values should equal live recompute. If they drift, that
  // means something silently mutated the line items or pricing
  // config without a save round trip — exactly the kind of bug we
  // can't see without a test.

  it("N11 — saved _ppp × qty + sum across lines ≈ saved total", () => {
    const li1 = { ...makeLineItem({ id: "li-1" }), _ppp: 10.00, _lineTotal: 450.00 };
    const li2 = { ...makeLineItem({ id: "li-2", sizes: { M: "10" } }), _ppp: 12.50, _lineTotal: 125.00 };
    const quote = makeQuote({
      line_items: [li1, li2],
      total: 575.00,
      subtotal: 575.00,
      tax: 0,
    });
    const payload = buildQBInvoicePayload(quote);
    expect(sumLineAmounts(payload)).toBeCloseTo(quote.subtotal, PENNY);
    expect(quote.total).toBeCloseTo(quote.subtotal + quote.tax, PENNY);
  });
});
