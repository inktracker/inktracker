import { describe, it, expect } from "vitest";
import {
  ADD_TO_PRODUCTION,
  decideAddToProduction,
  buildOrderFromInvoice,
} from "../buildOrderFromInvoice";

const NOW = new Date("2026-07-18T12:00:00Z").getTime();

const importedInvoice = {
  id: "inv-uuid-1",
  invoice_id: "annual.picnic.7.23.26",
  qb_invoice_id: "580",
  shop_owner: "shop@example.com",
  customer_id: "cust-1",
  customer_name: "Big Brothers Big Sisters",
  date: "2026-07-17",
  due: "2026-08-16",
  subtotal: 900,
  tax: 0,
  tax_rate: 0,
  total: 900,
  paid: false,
  paid_date: null,
  line_items: [
    { id: "qb-1", style: "Event tees", qty: 50, lineTotal: 900, sizes: {}, imprints: [], garmentCost: 0 },
  ],
  notes: "picnic order",
  discount: 0,
  rush_rate: 0,
  extras: {},
  order_id: null,
};

describe("decideAddToProduction (D1–D6)", () => {
  it("D1: unlinked invoice with no matching quotes → CREATE", () => {
    expect(decideAddToProduction(importedInvoice, []).action).toBe(ADD_TO_PRODUCTION.CREATE);
  });

  it("D2: invoice already linked to an order → ALREADY_LINKED, never create", () => {
    const d = decideAddToProduction({ ...importedInvoice, order_id: "ORD-2026-AAAAA" }, []);
    expect(d.action).toBe(ADD_TO_PRODUCTION.ALREADY_LINKED);
    expect(d.orderId).toBe("ORD-2026-AAAAA");
  });

  it("D3: quote-born invoice whose quote is converted → LINK_EXISTING with the quote's order", () => {
    const quote = { id: "q1", quote_id: "Q-2026-JV81", converted_order_id: "ORD-2026-JP35R" };
    const d = decideAddToProduction(importedInvoice, [quote]);
    expect(d.action).toBe(ADD_TO_PRODUCTION.LINK_EXISTING);
    expect(d.orderId).toBe("ORD-2026-JP35R");
    expect(d.quote).toBe(quote);
  });

  it("D4: quote-born invoice whose quote is NOT converted → BLOCKED_QUOTE (quote flow owns the order)", () => {
    const quote = { id: "q1", quote_id: "Q-2026-JV81", converted_order_id: null };
    const d = decideAddToProduction(importedInvoice, [quote]);
    expect(d.action).toBe(ADD_TO_PRODUCTION.BLOCKED_QUOTE);
    expect(d.quote).toBe(quote);
  });

  it("D5: converted quote wins over an unconverted sibling match", () => {
    const unconverted = { id: "q1", converted_order_id: null };
    const converted = { id: "q2", converted_order_id: "ORD-2026-BBBBB" };
    const d = decideAddToProduction(importedInvoice, [unconverted, converted]);
    expect(d.action).toBe(ADD_TO_PRODUCTION.LINK_EXISTING);
    expect(d.orderId).toBe("ORD-2026-BBBBB");
  });

  it("D6: ALREADY_LINKED beats quote matches (no relink of a linked invoice)", () => {
    const quote = { id: "q1", converted_order_id: "ORD-2026-CCCCC" };
    const d = decideAddToProduction({ ...importedInvoice, order_id: "ORD-2026-AAAAA" }, [quote]);
    expect(d.action).toBe(ADD_TO_PRODUCTION.ALREADY_LINKED);
    expect(d.orderId).toBe("ORD-2026-AAAAA");
  });
});

describe("buildOrderFromInvoice (B1–B8)", () => {
  const opts = {
    userEmail: "shop@example.com",
    customer: { id: "cust-1", name: "BBBS", company: "BBBS of Northern Nevada", email: "events@bbbs.org" },
    dueDate: "2026-07-22",
    status: "Pre-Press",
    now: NOW,
    today: "2026-07-18",
  };

  it("B1: money fields copy verbatim from the invoice — no re-pricing", () => {
    const o = buildOrderFromInvoice(importedInvoice, opts);
    expect(o.subtotal).toBe(900);
    expect(o.tax).toBe(0);
    expect(o.total).toBe(900);
    expect(o.tax_rate).toBe(0);
    expect(o.discount).toBe(0);
  });

  it("B2: quote_id stays empty — the invoice order_id backlink is the only linkage", () => {
    const o = buildOrderFromInvoice(importedInvoice, opts);
    expect(o.quote_id).toBe("");
  });

  it("B3: due_date comes from the operator, NOT invoice.due (QB payment due ≠ press date)", () => {
    const o = buildOrderFromInvoice(importedInvoice, opts);
    expect(o.due_date).toBe("2026-07-22");
    const noDue = buildOrderFromInvoice(importedInvoice, { ...opts, dueDate: null });
    expect(noDue.due_date).toBeNull();
  });

  it("B4: paid + paid_date carry over for pre-paid QB jobs", () => {
    const paidInv = { ...importedInvoice, paid: true, paid_date: "2026-07-10" };
    const o = buildOrderFromInvoice(paidInv, opts);
    expect(o.paid).toBe(true);
    expect(o.paid_date).toBe("2026-07-10");
    const unpaid = buildOrderFromInvoice(importedInvoice, opts);
    expect(unpaid.paid).toBe(false);
    expect(unpaid.paid_date).toBeNull();
  });

  it("B5: operator's starting status is used; defaults to Art Approval", () => {
    expect(buildOrderFromInvoice(importedInvoice, opts).status).toBe("Pre-Press");
    expect(buildOrderFromInvoice(importedInvoice, { ...opts, status: undefined }).status).toBe("Art Approval");
  });

  it("B6: customer company/email come from the matched customer row", () => {
    const o = buildOrderFromInvoice(importedInvoice, opts);
    expect(o.company).toBe("BBBS of Northern Nevada");
    expect(o.customer_email).toBe("events@bbbs.org");
    expect(o.customer_id).toBe("cust-1");
    expect(o.customer_name).toBe("Big Brothers Big Sisters");
  });

  it("B7: line items pass through untouched; missing arrays become []", () => {
    const o = buildOrderFromInvoice(importedInvoice, opts);
    expect(o.line_items).toEqual(importedInvoice.line_items);
    expect(buildOrderFromInvoice({ ...importedInvoice, line_items: null }, opts).line_items).toEqual([]);
  });

  it("B8: order_id generated, shop_owner scoped, order_date from shop tz", () => {
    const o = buildOrderFromInvoice(importedInvoice, opts);
    expect(o.order_id).toMatch(/^ORD-2026-/);
    expect(o.shop_owner).toBe("shop@example.com");
    expect(o.order_date).toBe("2026-07-18");
  });
});
