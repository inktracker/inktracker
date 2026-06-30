// INTEGRATION-SEAM test for the order→invoice→QuickBooks pricing projection.
//
// The QB invoice is built from the INVOICE row, which is a projection of the
// quote (quote → buildOrderFromQuote → buildOrderCompletionPlan.invoiceCreate).
// If that projection drops ANY field buildQBInvoicePayload reads, the QB
// invoice silently diverges from the order — exactly the class of bug that
// kept resurfacing (setup fee dropped, additional charges dropped, flat
// discount misread as percent, deposit not credited).
//
// This walks the real chain end-to-end and asserts the resulting QB payload
// carries every pricing component. Unit tests on each function pass while the
// SEAM between them drops data — so the assertion lives here, on the seam.

import { describe, it, expect, beforeEach } from "vitest";
import { buildOrderFromQuote } from "../buildOrderFromQuote";
import { buildOrderCompletionPlan } from "../completeOrder";
import { buildQBInvoicePayload, loadShopPricingConfig } from "@/components/shared/pricing";

const NOW = new Date("2026-05-12T12:00:00.000Z").getTime();
const SHOP = "shop@example.com";

beforeEach(() => {
  loadShopPricingConfig(null); // deterministic global pricing config
});

// A quote exercising every component buildQBInvoicePayload emits: saved per-line
// stamps (garment), a setup fee, an additional charge, a FLAT discount, and a
// paid deposit. Saved totals present so the saved-totals contract is exercised.
function richQuote(overrides = {}) {
  return {
    id: "q-1",
    quote_id: "Q-2026-RICH",
    customer_id: "c-1",
    customer_name: "Acme",
    line_items: [{
      id: "li-1",
      style: "1717",
      brand: "Comfort Colors",
      garmentColor: "Black",
      sizes: { M: "10" },
      imprints: [{ id: "imp-1", location: "Front", colors: 1, technique: "Screen Print" }],
      _ppp: 10,
      _lineTotal: 100,
      _rushFee: 0,
    }],
    rush_rate: 0,
    extras: {},
    setup_total: 45,
    additional_charges: [{ label: "Shipping", amount: 85, taxable: true }],
    discount: 20,
    discount_type: "flat",
    tax_rate: 0,
    deposit_pct: 50,
    deposit_paid: true,
    // saved totals: garment 100 − flat 20 + setup 45 + addl 85 + tax 0 = 210
    subtotal: 100,
    tax: 0,
    total: 210,
    ...overrides,
  };
}

function projectToInvoice(quote) {
  const order = buildOrderFromQuote(quote, { userEmail: SHOP, now: NOW });
  const plan = buildOrderCompletionPlan(
    { ...order, id: "ord-uuid-1" },
    { today: "2026-05-12", shopOwner: SHOP, invoiceId: "INV-TEST" },
  );
  return plan.invoiceCreate;
}

describe("order→invoice→QB projection — no silent drops", () => {
  it("the QB line amounts cover garment + setup + every additional charge", () => {
    const invoice = projectToInvoice(richQuote());
    const payload = buildQBInvoicePayload(invoice);
    const lineSum = payload.lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    const addlSum = (invoice.additional_charges || []).reduce((s, c) => s + Number(c.amount || 0), 0);
    // 100 (garment) + 45 (setup) + 85 (shipping) = 230
    expect(lineSum).toBeCloseTo((invoice.subtotal || 0) + (invoice.setup_total || 0) + addlSum, 2);
    expect(lineSum).toBeCloseTo(230, 2);
    // The setup + shipping lines must actually be present (not folded away).
    expect(payload.lines.some((l) => /setup/i.test(l.description))).toBe(true);
    expect(payload.lines.some((l) => /shipping/i.test(l.description))).toBe(true);
  });

  it("a FLAT discount stays flat (not misread as a percentage)", () => {
    const invoice = projectToInvoice(richQuote());
    const payload = buildQBInvoicePayload(invoice);
    expect(payload.discountType).toBe("flat");
    expect(payload.discountAmount).toBe(20);
    expect(payload.discountPercent).toBe(0);
  });

  it("a paid deposit is credited (deposit_pct + deposit_paid survive the projection)", () => {
    const invoice = projectToInvoice(richQuote());
    const payload = buildQBInvoicePayload(invoice);
    // 50% of the saved total 210 = 105
    expect(payload.depositAmount).toBeCloseTo(105, 2);
  });

  it("regression guard: dropping additional_charges from the invoice under-bills QB", () => {
    // Prove the test would have caught the original bug: an invoice WITHOUT the
    // carried fee produces a QB line sum short by the fee amount.
    const invoice = projectToInvoice(richQuote());
    const broken = { ...invoice, additional_charges: null };
    const lineSum = buildQBInvoicePayload(broken).lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    expect(lineSum).toBeCloseTo(145, 2); // 230 − 85 shipping → the silent drop
  });
});
