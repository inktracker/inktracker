import { describe, it, expect } from "vitest";
import {
  customerSnapshotPatch,
  buildQuoteDuplicate,
  QUOTE_DUPLICATE_EXCLUDED,
} from "../customerSwitch";

// The 2026-08-06 shop report: duplicate an order to switch it to a new
// client — the old client's detail kept filling the data.

describe("customerSnapshotPatch", () => {
  const newClient = {
    id: "c2", name: "New Co Contact", email: "new@newco.com", phone: "555-0102",
    company: "New Co", tax_id: "TX-99", tax_exempt: false, default_deposit_pct: 25,
  };

  it("carries EVERY customer-snapshot field — email/phone/tax included (the bug)", () => {
    const patch = customerSnapshotPatch(newClient, { defaultTaxRate: 8.265, currentTaxRate: 8.265 });
    expect(patch).toMatchObject({
      customer_id: "c2",
      customer_name: "New Co Contact",
      customer_email: "new@newco.com",   // was left as the OLD client's
      phone: "555-0102",                  // was left as the OLD client's
      company: "New Co",
      tax_id: "TX-99",                    // was left as the OLD client's
      tax_exempt: false,
      deposit_pct: 25,
    });
  });

  it("a tax-exempt OLD client's exemption cannot ride into the NEW client's quote", () => {
    // Quote previously held tax_exempt:true / tax_rate:0 from an exempt client.
    const patch = customerSnapshotPatch(newClient, { defaultTaxRate: 8.265, currentTaxRate: 0 });
    expect(patch.tax_exempt).toBe(false);
    // currentTaxRate 0 (from the exempt era) falls through to the default.
    expect(patch.tax_rate).toBe(8.265);
  });

  it("switching TO an exempt client zeroes the rate", () => {
    const patch = customerSnapshotPatch({ ...newClient, tax_exempt: true }, { defaultTaxRate: 8.265, currentTaxRate: 8.265 });
    expect(patch.tax_exempt).toBe(true);
    expect(patch.tax_rate).toBe(0);
  });

  it("clearing the customer blanks the snapshot instead of keeping stale data", () => {
    const patch = customerSnapshotPatch(null);
    expect(patch.customer_id).toBe("");
    expect(patch.customer_email).toBe("");
    expect(patch.phone).toBe("");
    expect(patch.tax_id).toBe("");
    expect(patch.tax_exempt).toBe(false);
  });
});

describe("buildQuoteDuplicate", () => {
  const original = {
    id: "row-1", quote_id: "Q-2026-AAAA", status: "Approved", date: "2026-07-01",
    customer_id: "c1", customer_name: "Old Client", customer_email: "old@old.com",
    line_items: [{ id: "li1", style: "1717" }], notes: "rush job", total: 500,
    public_token: "tok-original", payment_link: "https://pay/x",
    sent_to: "old@old.com", sent_date: "2026-07-02", sent_to_client_at: "2026-07-02T10:00:00Z",
    client_status: "approved", client_approved_at: "2026-07-03T10:00:00Z",
    payment_status: "paid", paid: true, paid_date: "2026-07-04", deposit_paid: true,
    expires_date: "2026-08-01", qb_invoice_id: "77", qb_doc_number: "Q-2026-AAAA",
    qb_line_snapshot: [{ i: "1" }], converted_order_id: "ORD-9", converted_at: "2026-07-05",
    source_email_id: "em-1", possible_existing_customer_id: "c9", is_reorder: true,
    created_at: "2026-07-01T00:00:00Z",
  };

  const dup = buildQuoteDuplicate(original, { quoteId: "Q-2026-BBBB", date: "2026-08-06" });

  it("public_token NEVER survives — a copied token lets the old client's link open the new quote", () => {
    expect(dup.public_token).toBeUndefined();
    expect(dup.payment_link).toBeUndefined();
  });

  it("resets identity + the whole sent/approved/paid lifecycle", () => {
    for (const key of QUOTE_DUPLICATE_EXCLUDED) {
      expect(dup[key], `${key} must not survive duplication`).toBeUndefined();
    }
    expect(dup.quote_id).toBe("Q-2026-BBBB");
    expect(dup.status).toBe("Draft");
    expect(dup.date).toBe("2026-08-06");
  });

  it("keeps the job itself", () => {
    expect(dup.line_items).toEqual(original.line_items);
    expect(dup.notes).toBe("rush job");
    expect(dup.total).toBe(500);
    // Customer snapshot copies too — switching is the EDITOR's job
    // (customerSnapshotPatch), duplication just doesn't fight it.
    expect(dup.customer_name).toBe("Old Client");
  });
});
