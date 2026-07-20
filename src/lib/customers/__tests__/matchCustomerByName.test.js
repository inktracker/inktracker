import { describe, it, expect } from "vitest";
import { matchCustomerByName } from "../matchCustomerByName";

const CUSTOMERS = [
  { id: "c1", name: "Acme Screen Co", company: "" },
  { id: "c2", name: "Jane Doe", company: "Big Brothers Big Sisters of Northern Nevada Inc." },
  { id: "c3", name: "  Reno  Runners ", company: null },
];

describe("matchCustomerByName — conservative name/company match", () => {
  it("matches on customer name, case-insensitive", () => {
    expect(matchCustomerByName(CUSTOMERS, "acme screen co")?.id).toBe("c1");
  });

  it("falls back to company when no name matches", () => {
    expect(
      matchCustomerByName(CUSTOMERS, "Big Brothers Big Sisters of Northern Nevada Inc.")?.id,
    ).toBe("c2");
  });

  it("prefers a name match over a company match", () => {
    const list = [
      { id: "byCompany", name: "Someone Else", company: "Acme Screen Co" },
      { id: "byName", name: "Acme Screen Co", company: "" },
    ];
    expect(matchCustomerByName(list, "Acme Screen Co")?.id).toBe("byName");
  });

  it("normalizes internal + surrounding whitespace", () => {
    expect(matchCustomerByName(CUSTOMERS, "Reno Runners")?.id).toBe("c3");
    expect(matchCustomerByName(CUSTOMERS, "  Acme   Screen  Co ")?.id).toBe("c1");
  });

  it("does NOT fuzzy-match partial names", () => {
    expect(matchCustomerByName(CUSTOMERS, "Acme")).toBeNull();
    expect(matchCustomerByName(CUSTOMERS, "Big Brothers Big Sisters")).toBeNull();
  });

  it("returns null for empty/blank/missing name or empty list", () => {
    expect(matchCustomerByName(CUSTOMERS, "")).toBeNull();
    expect(matchCustomerByName(CUSTOMERS, "   ")).toBeNull();
    expect(matchCustomerByName(CUSTOMERS, undefined)).toBeNull();
    expect(matchCustomerByName([], "Acme Screen Co")).toBeNull();
    expect(matchCustomerByName(null, "Acme Screen Co")).toBeNull();
  });

  it("tolerates rows with null/missing name fields", () => {
    expect(matchCustomerByName([{ id: "x" }, null, { id: "c1", name: "Acme" }], "Acme")?.id).toBe("c1");
  });
});
