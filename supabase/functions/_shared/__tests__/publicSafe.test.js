import { describe, it, expect } from "vitest";
import {
  isBrokerDoc,
  sanitizeLineItems,
  sanitizeQuoteForCustomer,
  sanitizeOrderForCustomer,
  customerFacingShopPayload,
} from "../publicSafe.js";

const brokerQuote = {
  id: "q1", broker_id: "broker@x.com", broker_company: "Broker Co",
  total: 646, client_total: 753,
  qb_payment_link: "https://connect.intuit.com/t/scs-abc",
  qb_deposit_payment_link: "https://connect.intuit.com/t/scs-dep",
  qb_invoice_id: "42", qb_deposit_invoice_id: "43",
  qb_total: 646, qb_subtotal: 600, qb_tax_amount: 46, qb_doc_number: "Q-1",
  notes: "wholesale only — 20% margin",
  line_items: [{ style: "1717", garmentCost: 4.2, garmentCostManual: true, _ppp: 12, sizes: { M: 10 } }],
};

describe("sanitizeLineItems — shop costs never reach ANY customer", () => {
  it("strips every cost-named key, keeps customer pricing", () => {
    const [li] = sanitizeLineItems(brokerQuote.line_items);
    expect(li.garmentCost).toBeUndefined();
    expect(li.garmentCostManual).toBeUndefined();
    expect(li._ppp).toBe(12);
    expect(li.sizes).toEqual({ M: 10 });
  });
  it("strips partner-sourcing keys — subcontractor email + shop cost never reach the customer", () => {
    const [li] = sanitizeLineItems([{
      style: "1717", _ppp: 12, sizes: { M: 10 },
      partner_source: "frontst@example.com", // subcontractor identity (blind handoff)
      _partner_cost: 300, _partner_ppp: 6,    // shop's cost / margin basis
      partner_status: "accepted",
    }]);
    expect(li.partner_source).toBeUndefined();
    expect(li._partner_cost).toBeUndefined();
    expect(li._partner_ppp).toBeUndefined();
    expect(li.partner_status).toBeUndefined();
    expect(li._ppp).toBe(12); // retail kept
    expect(li.sizes).toEqual({ M: 10 });
  });
  it("tolerates junk", () => {
    expect(sanitizeLineItems(null)).toBeNull();
    expect(sanitizeLineItems([null, "x"])).toEqual([null, "x"]);
  });
});

describe("sanitizeQuoteForCustomer", () => {
  it("BROKER quote: strips the shop's payable links, wholesale qb_* mirrors, and notes", () => {
    const q = sanitizeQuoteForCustomer(brokerQuote);
    expect(q.qb_payment_link).toBeUndefined();
    expect(q.qb_deposit_payment_link).toBeUndefined();
    expect(q.qb_invoice_id).toBeUndefined();
    expect(q.qb_deposit_invoice_id).toBeUndefined();
    expect(q.qb_total).toBeUndefined();
    expect(q.qb_subtotal).toBeUndefined();
    expect(q.qb_tax_amount).toBeUndefined();
    expect(q.notes).toBeUndefined();
    expect(q.client_total).toBe(753); // retail stays
  });
  it("DIRECT quote: keeps the qb payment rails the page needs, still strips costs", () => {
    const direct = { ...brokerQuote, broker_id: null, broker_email: null };
    const q = sanitizeQuoteForCustomer(direct);
    expect(q.qb_payment_link).toBe(brokerQuote.qb_payment_link);
    expect(q.qb_deposit_payment_link).toBe(brokerQuote.qb_deposit_payment_link);
    expect(q.qb_total).toBe(646);
    expect(q.line_items[0].garmentCost).toBeUndefined();
  });
  it("does not mutate its input", () => {
    sanitizeQuoteForCustomer(brokerQuote);
    expect(brokerQuote.qb_payment_link).toBeTruthy();
    expect(brokerQuote.line_items[0].garmentCost).toBe(4.2);
  });
});

describe("sanitizeOrderForCustomer — allowlist, never the raw row", () => {
  const order = {
    id: "o1", order_id: "ORD-1", status: "Printing", job_title: "Tees",
    date: "2026-08-01", due_date: "2026-08-20", customer_name: "Jane",
    selected_artwork: [{ url: "x" }], art_approved: true,
    total: 646, subtotal: 600, notes: "internal", checklist: { x: 1 },
    assigned_operator: "Mike", broker_company: "Broker Co", broker_id: "broker@x.com",
    line_items: [{ style: "1717", garmentCost: 4.2 }],
  };
  it("passes journey fields, drops money/internal fields", () => {
    const o = sanitizeOrderForCustomer(order);
    expect(o.order_id).toBe("ORD-1");
    expect(o.status).toBe("Printing");
    expect(o.selected_artwork).toEqual([{ url: "x" }]);
    expect(o.total).toBeUndefined();
    expect(o.subtotal).toBeUndefined();
    expect(o.notes).toBeUndefined();
    expect(o.checklist).toBeUndefined();
    expect(o.assigned_operator).toBeUndefined();
    expect(o.line_items[0].garmentCost).toBeUndefined();
  });
});

describe("customerFacingShopPayload — white-label rule", () => {
  const shop = {
    shop_name: "Biota MFG", logo_url: "https://x/shop.png", email: "joe@biotamfg.co",
    phone: "555", address: "1 Main", city: "Reno", state: "NV", zip: "89501",
    website: "biota.com", stripe_account_id: "acct_1", stripe_account_status: "active",
    owner_email: "joe@biotamfg.co",
  };
  it("BROKER doc: broker identity + broker logo; the shop is invisible", () => {
    const p = customerFacingShopPayload({
      shop, doc: brokerQuote, brokerProfile: { logo_url: "https://x/broker.png", phone: "777" },
    });
    expect(p.shop_name).toBe("Broker Co");
    expect(p.logo_url).toBe("https://x/broker.png");
    expect(p.email).toBe("broker@x.com");
    expect(p.phone).toBe("777");
    expect(JSON.stringify(p)).not.toContain("Biota");
    expect(JSON.stringify(p)).not.toContain("acct_1");
  });
  it("BROKER doc with no broker logo: logo is NULL, never the shop's", () => {
    const p = customerFacingShopPayload({ shop, doc: brokerQuote, brokerProfile: null });
    expect(p.logo_url).toBeNull();
  });
  it("DIRECT doc: shop identity minus Stripe/owner-email internals", () => {
    const p = customerFacingShopPayload({ shop, doc: { broker_id: null }, brokerProfile: null });
    expect(p.shop_name).toBe("Biota MFG");
    expect(p.logo_url).toBe("https://x/shop.png");
    expect(p.stripe_account_id).toBeUndefined();
    expect(p.stripe_account_status).toBeUndefined();
    expect(p.owner_email).toBeUndefined();
  });
});

describe("isBrokerDoc", () => {
  it("matches broker_id or broker_email, not empty strings", () => {
    expect(isBrokerDoc({ broker_id: "b@x.com" })).toBe(true);
    expect(isBrokerDoc({ broker_email: "b@x.com" })).toBe(true);
    expect(isBrokerDoc({ broker_id: "" })).toBe(false);
    expect(isBrokerDoc({})).toBe(false);
  });
});
