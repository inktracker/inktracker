import { describe, it, expect } from "vitest";
import { decideStatusEmail, buildStatusEmailSubject, buildStatusEmailHtml, STATUS_PHRASES } from "../statusCustomerEmail";

const order = { customer_email: "kelley@kilroyvtg.com", customer_name: "Kelley Smith", broker_id: null };
const config = { Printing: { enabled: true, note: "" }, Shipped: { enabled: true, note: "Tracking arrives separately." } };

describe("decideStatusEmail", () => {
  it("sends only for enabled, customer-facing statuses", () => {
    expect(decideStatusEmail({ order, config, toStatus: "Printing" })).toMatchObject({ send: true, phrase: "is now in production" });
    expect(decideStatusEmail({ order, config, toStatus: "Completed" })).toEqual({ send: false, reason: "not_enabled" });
    expect(decideStatusEmail({ order, config: {}, toStatus: "Printing" })).toEqual({ send: false, reason: "not_enabled" });
  });

  it("never emails for non-customer-facing statuses, even if config claims enabled", () => {
    expect(decideStatusEmail({ order, config: { "Pre-Press": { enabled: true } }, toStatus: "Pre-Press" }))
      .toEqual({ send: false, reason: "status_not_customer_facing" });
  });

  it("skips broker orders — the broker owns client communication", () => {
    expect(decideStatusEmail({ order: { ...order, broker_id: "b1" }, config, toStatus: "Printing" }))
      .toEqual({ send: false, reason: "broker_order" });
  });

  it("skips when there's no usable customer email", () => {
    expect(decideStatusEmail({ order: { ...order, customer_email: "" }, config, toStatus: "Printing" }))
      .toEqual({ send: false, reason: "no_customer_email" });
    expect(decideStatusEmail({ order: { ...order, customer_email: "not-an-email" }, config, toStatus: "Printing" }))
      .toEqual({ send: false, reason: "no_customer_email" });
  });

  it("carries the shop's note, clamped", () => {
    const d = decideStatusEmail({ order, config, toStatus: "Shipped" });
    expect(d.note).toBe("Tracking arrives separately.");
    const long = decideStatusEmail({ order, config: { Shipped: { enabled: true, note: "x".repeat(600) } }, toStatus: "Shipped" });
    expect(long.note).toHaveLength(500);
  });
});

describe("email rendering", () => {
  it("subject and body read like a human wrote them", () => {
    expect(buildStatusEmailSubject({ shopName: "Biota Mfg", orderId: "ORD-1", subjectBit: STATUS_PHRASES.Shipped.subjectBit }))
      .toBe("Biota Mfg: order ORD-1 is shipped");
    const html = buildStatusEmailHtml({
      shopName: "Biota Mfg", customerName: "Kelley Smith", orderId: "ORD-1",
      phrase: "is on its way", note: "Thanks!", statusUrl: "https://x/OrderStatus?id=1",
    });
    expect(html).toContain("Hi Kelley,");
    expect(html).toContain("<strong>ORD-1</strong> is on its way");
    expect(html).toContain("View order status");
    expect(html).toContain("Thanks!");
  });

  it("escapes HTML in customer-controlled fields", () => {
    const html = buildStatusEmailHtml({
      shopName: "S", customerName: "<script>x</script>", orderId: "ORD-1", phrase: "p", note: "<b>n</b>", statusUrl: "",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>n</b>");
  });
});
