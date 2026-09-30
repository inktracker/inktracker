import { describe, it, expect, vi } from "vitest";
import { resolveOrderInvoiceForSend } from "../resolveOrderInvoiceForSend";

function mockBase44({ invoicesByOrderId = [], invoicesByInvoiceId = [], customers = [] } = {}) {
  return {
    entities: {
      Invoice: {
        filter: vi.fn(async (q) => {
          if (q.order_id) return invoicesByOrderId;
          if (q.invoice_id) return invoicesByInvoiceId;
          return [];
        }),
      },
      Customer: { filter: vi.fn(async () => customers) },
    },
  };
}

const order = { shop_owner: "shop@x.com", order_id: "ORD-1", quote_id: "Q-1", customer_id: "c1", customer_email: "buyer@x.com", customer_name: "Acme" };

describe("resolveOrderInvoiceForSend", () => {
  it("returns nulls when the order has no shop_owner", async () => {
    const r = await resolveOrderInvoiceForSend(mockBase44(), { order_id: "ORD-1" });
    expect(r).toEqual({ invoice: null, customer: null });
  });

  it("finds the invoice by order_id and its customer by id", async () => {
    const b = mockBase44({
      invoicesByOrderId: [{ id: "inv1", order_id: "ORD-1", customer_id: "c1" }],
      customers: [{ id: "c1", email: "buyer@x.com", name: "Acme" }],
    });
    const r = await resolveOrderInvoiceForSend(b, order);
    expect(r.invoice.id).toBe("inv1");
    expect(r.customer.email).toBe("buyer@x.com");
  });

  it("falls back to invoice_id = quote_id when no order_id match", async () => {
    const b = mockBase44({
      invoicesByOrderId: [],
      invoicesByInvoiceId: [{ id: "inv2", invoice_id: "Q-1", customer_id: "c1" }],
      customers: [{ id: "c1", email: "buyer@x.com" }],
    });
    const r = await resolveOrderInvoiceForSend(b, order);
    expect(r.invoice.id).toBe("inv2");
  });

  it("returns invoice:null when no invoice exists (nothing to send)", async () => {
    const r = await resolveOrderInvoiceForSend(mockBase44(), order);
    expect(r.invoice).toBeNull();
  });

  it("derives a lightweight customer from the order when the Customer row is missing", async () => {
    const b = mockBase44({
      invoicesByOrderId: [{ id: "inv1", order_id: "ORD-1" }], // no customer_id
      customers: [], // lookup finds nothing
    });
    const r = await resolveOrderInvoiceForSend(b, order);
    expect(r.invoice.id).toBe("inv1");
    expect(r.customer).toEqual({ email: "buyer@x.com", name: "Acme" });
  });
});
