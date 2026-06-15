import { describe, it, expect } from "vitest";
import { managerCanAccess, firstAllowedPage, sectionForPage } from "../managerPermissions";

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
