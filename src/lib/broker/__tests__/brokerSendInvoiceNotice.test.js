import { describe, it, expect } from "vitest";
import { brokerInvoiceSendNotice } from "../brokerSendInvoiceNotice";

describe("brokerInvoiceSendNotice — broker sees WHY the pay link wasn't created", () => {
  it("no error (benign skip / nothing) → no notice", () => {
    expect(brokerInvoiceSendNotice(null)).toBeNull();
    expect(brokerInvoiceSendNotice("")).toBeNull();
    expect(brokerInvoiceSendNotice(undefined)).toBeNull();
  });

  it("QuickBooks not connected → gentle INFO, not a red error", () => {
    const n = brokerInvoiceSendNotice("QuickBooks not connected.");
    expect(n.level).toBe("info");
    expect(n.title).toMatch(/connect quickbooks/i);
  });

  it("monthly invoice-limit error → ERROR with an upgrade hint (Ethan's wall)", () => {
    const n = brokerInvoiceSendNotice("You have reached the maximum number of invoices for your plan.");
    expect(n.level).toBe("error");
    expect(n.description).toMatch(/monthly invoice limit/i);
    expect(n.description).toMatch(/upgrade/i);
  });

  it("a generic QB error → ERROR that keeps the real message + a retry hint", () => {
    const n = brokerInvoiceSendNotice("QuickBooks returned 500.");
    expect(n.level).toBe("error");
    expect(n.description).toMatch(/QuickBooks returned 500/);
    expect(n.description).toMatch(/re-send/i);
  });

  it("'no client pricing' data error surfaces (not swallowed)", () => {
    const n = brokerInvoiceSendNotice("No client line pricing on this quote — nothing to invoice.");
    expect(n.level).toBe("error");
    expect(n.description).toMatch(/no client line pricing/i);
  });
});
