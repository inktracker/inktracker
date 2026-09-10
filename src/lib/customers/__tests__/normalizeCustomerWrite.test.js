import { describe, it, expect } from "vitest";
import { normalizeCustomerWrite, toCustomerWritePayload } from "../normalizeCustomerWrite";

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

describe("toCustomerWritePayload — strip server-managed columns + normalize dates", () => {
  it("drops id, created_date, updated_date, shop_owner from a spread customer row", () => {
    // The exact failure: BrokerClientList / Customers edit spread a whole
    // loaded row into the update; PostgREST 400s on the server-managed cols.
    const row = {
      id: "78a2ae98-1111-2222-3333-444455556666",
      created_date: "2026-01-01T00:00:00Z",
      updated_date: "2026-02-02T00:00:00Z",
      shop_owner: "broker:reagan@dragonheadinc.com",
      name: "Dragon Head",
      email: "reagan@dragonheadinc.com",
      exemption_expires_at: "",
    };
    expect(toCustomerWritePayload(row)).toEqual({
      name: "Dragon Head",
      email: "reagan@dragonheadinc.com",
      exemption_expires_at: null,
    });
  });

  it("keeps real writable columns (jsonb, flags, orders count)", () => {
    const input = {
      name: "Acme",
      tax_exempt: true,
      orders: 4,
      saved_imprints: [{ title: "Left chest" }],
      bill_to_address: { state: "NV" },
    };
    expect(toCustomerWritePayload(input)).toEqual(input);
  });

  it("does not mutate the input object", () => {
    const input = { id: "x", name: "Acme" };
    toCustomerWritePayload(input);
    expect(input).toEqual({ id: "x", name: "Acme" });
  });

  it("returns non-objects unchanged (defensive)", () => {
    expect(toCustomerWritePayload(null)).toBe(null);
    expect(toCustomerWritePayload(undefined)).toBe(undefined);
  });
});
