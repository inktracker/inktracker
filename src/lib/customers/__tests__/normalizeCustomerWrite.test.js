import { describe, it, expect } from "vitest";
import { normalizeCustomerWrite } from "../normalizeCustomerWrite";

describe("normalizeCustomerWrite — empty date → null (invalid-date-syntax fix)", () => {
  it("coerces an empty-string exemption_expires_at to null", () => {
    // The exact shape the Add Customer form sends for a non-exempt customer.
    expect(normalizeCustomerWrite({ name: "Acme", exemption_expires_at: "" }))
      .toEqual({ name: "Acme", exemption_expires_at: null });
  });

  it("coerces a whitespace-only date to null (Postgres rejects that too)", () => {
    expect(normalizeCustomerWrite({ exemption_expires_at: "   " }).exemption_expires_at).toBe(null);
  });

  it("keeps a real date untouched", () => {
    expect(normalizeCustomerWrite({ exemption_expires_at: "2027-01-15" }).exemption_expires_at)
      .toBe("2027-01-15");
  });

  it("leaves null as null", () => {
    expect(normalizeCustomerWrite({ exemption_expires_at: null }).exemption_expires_at).toBe(null);
  });

  it("does not add the key when it wasn't in the payload (edit patch subset)", () => {
    const out = normalizeCustomerWrite({ name: "Acme", email: "a@b.co" });
    expect("exemption_expires_at" in out).toBe(false);
  });

  it("does not touch other fields", () => {
    const input = { name: "Acme", default_deposit_pct: 0, tax_exempt: false, bill_to_address: null, exemption_expires_at: "" };
    expect(normalizeCustomerWrite(input)).toEqual({ ...input, exemption_expires_at: null });
  });

  it("returns non-objects unchanged (defensive)", () => {
    expect(normalizeCustomerWrite(null)).toBe(null);
    expect(normalizeCustomerWrite(undefined)).toBe(undefined);
  });
});
