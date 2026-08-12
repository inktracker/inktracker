import { describe, it, expect } from "vitest";
import { buildOrderFromQuote } from "../buildOrderFromQuote";
import { buildOrderInsertFromQuote } from "../../../../supabase/functions/_shared/qbWebhookLogic.js";
import { QUOTE_DUPLICATE_EXCLUDED } from "../../quotes/customerSwitch";

// The order-from-quote builder exists TWICE: the frontend copy
// (src/lib/orders/buildOrderFromQuote.js — manual "Convert to Order") and
// the edge copy (_shared/qbWebhookLogic.js buildOrderInsertFromQuote —
// every webhook/reconcile conversion, i.e. every ONLINE-PAID quote and
// deposit). They drifted once and it corrupted books: the edge copy
// dropped qb_deposit_invoice_id, settlement never ran, and qbSync posted
// a phantom deposit Payment on every online-paid deposit (audit
// 2026-08-12, CRITICAL 1 — found independently by three auditors).
// This suite pins the fields that must NEVER diverge again.

const quote = {
  id: "q-uuid",
  quote_id: "Q-2026-TEST",
  shop_owner: "shop@x.com",
  customer_id: "c1",
  customer_name: "Acme",
  customer_email: "acme@example.com",
  date: "2026-08-12",
  line_items: [],
  subtotal: 900,
  tax: 100,
  total: 1000,
  deposit_pct: 50,
  deposit_paid: true,
  deposit_amount: 500,
  qb_deposit_invoice_id: "1988",
};

describe("order-builder parity — deposit fields (CRITICAL 1 pin)", () => {
  it("the EDGE builder carries every deposit field", () => {
    const order = buildOrderInsertFromQuote(quote, "ORD-1");
    expect(order.deposit_pct).toBe(50);
    expect(order.deposit_paid).toBe(true);
    expect(order.deposit_amount).toBe(500);
    expect(order.qb_deposit_invoice_id).toBe("1988");
  });

  it("the FRONTEND builder carries every deposit field", () => {
    const order = buildOrderFromQuote(quote, { userEmail: "shop@x.com", now: new Date("2026-08-12T00:00:00Z") });
    expect(order.deposit_pct).toBe(50);
    expect(order.deposit_paid).toBe(true);
    expect(order.deposit_amount).toBe(500);
    expect(order.qb_deposit_invoice_id).toBe("1988");
  });

  it("both builders null-default the deposit fields identically", () => {
    const bare = { ...quote };
    delete bare.deposit_amount;
    delete bare.qb_deposit_invoice_id;
    bare.deposit_pct = null;
    bare.deposit_paid = false;
    const edge = buildOrderInsertFromQuote(bare, "ORD-2");
    const fe = buildOrderFromQuote(bare, { userEmail: "shop@x.com", now: new Date("2026-08-12T00:00:00Z") });
    for (const f of ["deposit_amount", "qb_deposit_invoice_id"]) {
      expect(edge[f], `edge ${f}`).toBeNull();
      expect(fe[f], `frontend ${f}`).toBeNull();
    }
    expect(edge.deposit_paid).toBe(false);
    expect(fe.deposit_paid).toBe(false);
  });
});

describe("quote duplication — deposit lifecycle never survives (CRITICAL 2 pin)", () => {
  it("QUOTE_DUPLICATE_EXCLUDED strips the snapshot and both deposit-invoice pointers", () => {
    for (const col of ["deposit_amount", "deposit_paid_at", "qb_deposit_invoice_id", "qb_deposit_payment_link", "deposit_paid"]) {
      expect(QUOTE_DUPLICATE_EXCLUDED, `missing ${col}`).toContain(col);
    }
  });
  it("deposit_pct is NOT excluded — deposit terms are job-shaped and should survive duplication", () => {
    expect(QUOTE_DUPLICATE_EXCLUDED).not.toContain("deposit_pct");
  });
});
