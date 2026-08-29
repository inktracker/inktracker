import { describe, it, expect } from "vitest";
import { pickQbEmployeeMatch, buildTimeActivityBody } from "../qbTime";

const EMPLOYEES = [
  { Id: "55", DisplayName: "Sam Rivera", GivenName: "Sam", FamilyName: "Rivera", Active: true, PrimaryEmailAddr: { Address: "sam@biotamfg.co" } },
  { Id: "56", DisplayName: "Pat Doe", GivenName: "Pat", FamilyName: "Doe", Active: true },
  { Id: "57", DisplayName: "Old Timer", Active: false, PrimaryEmailAddr: { Address: "old@biotamfg.co" } },
];

describe("pickQbEmployeeMatch", () => {
  it("matches by email, case-insensitively", () => {
    expect(pickQbEmployeeMatch({ member_email: "SAM@Biotamfg.co" }, EMPLOYEES)?.Id).toBe("55");
  });

  it("falls back to exact name match when no email match exists", () => {
    expect(pickQbEmployeeMatch({ member_email: "pat@x.co", member_name: "pat doe" }, EMPLOYEES)?.Id).toBe("56");
    expect(pickQbEmployeeMatch({ member_email: "pat@x.co", member_name: "Pat  Doe " }, EMPLOYEES)?.Id).toBe("56");
  });

  it("never matches inactive employees", () => {
    expect(pickQbEmployeeMatch({ member_email: "old@biotamfg.co" }, EMPLOYEES)).toBe(null);
  });

  it("refuses ambiguous email matches instead of guessing", () => {
    const dupes = [
      { Id: "1", Active: true, PrimaryEmailAddr: { Address: "x@x.co" } },
      { Id: "2", Active: true, PrimaryEmailAddr: { Address: "x@x.co" } },
    ];
    expect(pickQbEmployeeMatch({ member_email: "x@x.co" }, dupes)).toBe(null);
  });

  it("does NOT fuzzy-match names (wrong person's payroll is worse than no match)", () => {
    expect(pickQbEmployeeMatch({ member_email: "s@x.co", member_name: "Sam R" }, EMPLOYEES)).toBe(null);
  });

  it("tolerates null/empty inputs", () => {
    expect(pickQbEmployeeMatch(null, EMPLOYEES)).toBe(null);
    expect(pickQbEmployeeMatch({ member_email: "sam@biotamfg.co" }, null)).toBe(null);
  });
});

describe("buildTimeActivityBody", () => {
  const entry = { work_date: "2026-08-24", minutes: 485, notes: "press day" };

  it("splits minutes into Hours/Minutes and stamps the source", () => {
    const body = buildTimeActivityBody(entry, "55");
    expect(body).toMatchObject({
      NameOf: "Employee",
      EmployeeRef: { value: "55" },
      TxnDate: "2026-08-24",
      Hours: 8,
      Minutes: 5,
      Taxable: false,
      BillableStatus: "NotBillable",
    });
    expect(body.Description).toBe("InkTracker timesheet — press day");
  });

  it("returns null for zero-minute or incomplete entries (never books empty time)", () => {
    expect(buildTimeActivityBody({ ...entry, minutes: 0 }, "55")).toBe(null);
    expect(buildTimeActivityBody({ ...entry, minutes: null }, "55")).toBe(null);
    expect(buildTimeActivityBody(entry, null)).toBe(null);
    expect(buildTimeActivityBody({ minutes: 60 }, "55")).toBe(null);
  });

  it("uses a plain source stamp when there are no notes", () => {
    expect(buildTimeActivityBody({ ...entry, notes: "" }, "55").Description).toBe("InkTracker timesheet");
  });
});
