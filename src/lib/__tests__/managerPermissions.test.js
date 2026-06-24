import { describe, it, expect } from "vitest";
import { managerCanAccess, firstAllowedPage, sectionForPage, hasOwnerAccess } from "../managerPermissions";

const owner = { role: "shop" };
const adminU = { role: "admin" };
const mgrFull = { role: "manager", manager_permissions: null };
const mgrRestricted = { role: "manager", manager_permissions: { Invoices: false, Performance: false } };

describe("managerCanAccess", () => {
  it("non-managers always pass (owners/admins ungated)", () => {
    expect(managerCanAccess(owner, "Invoices")).toBe(true);
    expect(managerCanAccess(adminU, "Performance")).toBe(true);
  });
  it("manager with null permissions has full access", () => {
    expect(managerCanAccess(mgrFull, "Invoices")).toBe(true);
    expect(managerCanAccess(mgrFull, "Quotes")).toBe(true);
  });
  it("manager is denied an explicitly-false section", () => {
    expect(managerCanAccess(mgrRestricted, "Invoices")).toBe(false);
    expect(managerCanAccess(mgrRestricted, "Performance")).toBe(false);
  });
  it("manager keeps access to sections not set to false", () => {
    expect(managerCanAccess(mgrRestricted, "Quotes")).toBe(true);
    expect(managerCanAccess(mgrRestricted, "Customers")).toBe(true);
  });
  it("child pages inherit their section's permission", () => {
    const noInv = { role: "manager", manager_permissions: { Inventory: false } };
    expect(managerCanAccess(noInv, "PurchaseOrders")).toBe(false);
    const noProd = { role: "manager", manager_permissions: { Production: false } };
    expect(managerCanAccess(noProd, "Orders")).toBe(false);
    expect(managerCanAccess(noProd, "Calendar")).toBe(false);
  });
  it("ungated pages (Account, ShopFloor) always pass", () => {
    expect(managerCanAccess(mgrRestricted, "Account")).toBe(true);
  });
});

describe("firstAllowedPage", () => {
  it("returns Dashboard for a full-access manager", () => {
    expect(firstAllowedPage(mgrFull)).toBe("Dashboard");
  });
  it("skips denied sections to the first allowed one", () => {
    const m = { role: "manager", manager_permissions: { Dashboard: false, Quotes: false } };
    expect(firstAllowedPage(m)).toBe("Production");
  });
});

describe("sectionForPage", () => {
  it("maps children to their parent section", () => {
    expect(sectionForPage("PurchaseOrders")).toBe("Inventory");
    expect(sectionForPage("Orders")).toBe("Production");
  });
  it("returns null for ungated pages", () => {
    expect(sectionForPage("Account")).toBe(null);
  });
});

describe("hasOwnerAccess — owner-level access for full-partner managers", () => {
  it("owners and admins always have it", () => {
    expect(hasOwnerAccess({ role: "shop" }, "Customers")).toBe(true);
    expect(hasOwnerAccess({ role: "admin" }, "Customers")).toBe(true);
  });
  it("a manager has it when their permission allows the section (null = full)", () => {
    expect(hasOwnerAccess({ role: "manager", manager_permissions: null }, "Customers")).toBe(true);
    expect(hasOwnerAccess({ role: "manager", manager_permissions: { Customers: true } }, "Customers")).toBe(true);
  });
  it("a manager is denied when the owner switched that section off", () => {
    expect(hasOwnerAccess({ role: "manager", manager_permissions: { Customers: false } }, "Customers")).toBe(false);
  });
  it("brokers/employees/null never get owner-level access", () => {
    expect(hasOwnerAccess({ role: "broker" }, "Customers")).toBe(false);
    expect(hasOwnerAccess({ role: "employee" }, "Customers")).toBe(false);
    expect(hasOwnerAccess(null, "Customers")).toBe(false);
  });
});
